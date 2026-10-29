"""Vườn nhà: a few plots of soil where the seeds the pet brings back are planted, and friends who come to help.

Planting takes one seed out of the inventory (inventory.use_one) only when it succeeds: the plot must be empty and the
seed owned. It is one transaction under the user's inventory lock, and `client_request_id` makes a retried or repeated
tap plant once. A plant grows by itself (sprout, growing, grown, by the hours since planting); a grown plant can be
cleared to free its plot. Nothing here gives EXP.

Caring ("Tưới nước", "Chăm sóc") is open to the owner and to visiting friends. Each planting takes each kind once per
owner day, from anyone (unique key of garden_care), and a request id is handled once, so retries, fast taps and
friends caring at the same time never count twice. A visitor cares for at most `garden_care_daily_limit` plants a day
across all friends' gardens. Care is shown in the garden (who did it today) and tells the owner; it changes nothing
else: no EXP, no items, the plant grows as before.

Visiting a friend's garden follows the room visits (room_visits.py): accepted friends only, never across a block, and
only while the owner lets friends visit (social_profiles.allow_room_visits). A visitor sees the plots and their care,
never the owner's seeds, and cannot plant, clear or move anything: those endpoints only ever touch one's own garden.
"""
from __future__ import annotations

import json
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock
from . import inventory as inv
from . import items_catalog as cat
from .config import settings
from .db import get_db
from .errors import APIError
from .friends import _visible_user, are_friends, ensure_profile, is_blocked_between
from .models import GardenCare, GardenPlot, InventoryEvent, User, as_utc, utcnow
from .notifications import latest_unread, notify, replace
from .ratelimit import enforce
from .room_visits import host_day, owner_view
from .security import current_user

router = APIRouter(prefix="/api/garden", tags=["garden"])

PLOTS = 6
# Hours after planting at which each stage starts: sprout, growing, grown.
STAGE_HOURS = (0, 4, 12)
STAGE_LABELS = ("Mới nảy mầm", "Đang lớn", "Đã lớn")
CARE_KINDS = ("water", "tend")
CARE_LABELS = {"water": "Tưới nước", "tend": "Chăm sóc"}
CareKind = Literal["water", "tend"]


class PlantInput(BaseModel):
    item_id: str = Field(max_length=40)
    variant: str = Field(default="default", max_length=24)
    client_request_id: str = Field(min_length=8, max_length=80)


class CareInput(BaseModel):
    kind: CareKind
    client_request_id: str = Field(min_length=8, max_length=80)


def stage_of(plot: GardenPlot, now=None) -> int:
    hours = ((now or utcnow()) - as_utc(plot.planted_at)).total_seconds() / 3600
    return max(i for i, h in enumerate(STAGE_HOURS) if hours >= h)


def care_view(row: GardenCare | None, names: dict[int, str], viewer_id: int) -> dict:
    if row is None:
        return {"done": False, "by": None, "at": None}
    return {"done": True, "at": as_utc(row.created_at).isoformat(),
            "by": {"id": row.carer_id, "display_name": names.get(row.carer_id, ""), "me": row.carer_id == viewer_id}}


def plot_view(index: int, plot: GardenPlot | None, now, care: dict[str, dict] | None = None) -> dict:
    if plot is None or plot.item_id not in cat.ITEMS:
        return {"plot": index, "empty": True}
    stage = stage_of(plot, now)
    nxt = as_utc(plot.planted_at) + timedelta(hours=STAGE_HOURS[stage + 1]) if stage + 1 < len(STAGE_HOURS) else None
    return {"plot": index, "empty": False, "item_id": plot.item_id, "variant": plot.variant,
            "name": cat.ITEMS[plot.item_id]["name"], "rarity": cat.ITEMS[plot.item_id]["rarity"],
            "planted_at": as_utc(plot.planted_at).isoformat(), "stage": stage, "stage_label": STAGE_LABELS[stage],
            "grown": stage == len(STAGE_HOURS) - 1, "next_stage_at": nxt.isoformat() if nxt else None,
            "care": care or {k: {"done": False, "by": None, "at": None} for k in CARE_KINDS}}


def garden_view(db: Session, user: User, viewer: User | None = None) -> dict:
    """`user`'s garden. Seen by its owner it lists their seeds too; seen by a friend (`viewer`) only the plots."""
    viewer = viewer or user
    now = utcnow()
    rows = {p.plot: p for p in db.scalars(select(GardenPlot).where(GardenPlot.user_id == user.id)
                                          .execution_options(populate_existing=True))}
    day = host_day(db, user)
    cares: dict[int, dict[str, GardenCare]] = {}
    for c in db.scalars(select(GardenCare).where(GardenCare.owner_id == user.id, GardenCare.local_date == day)):
        cares.setdefault(c.planting_id, {})[c.kind] = c
    carer_ids = {c.carer_id for kinds in cares.values() for c in kinds.values()}
    names = dict(db.execute(select(User.id, User.display_name).where(User.id.in_(carer_ids))).all()) if carer_ids else {}

    def care_of(plot: GardenPlot | None) -> dict[str, dict] | None:
        if plot is None:
            return None
        done = cares.get(plot.id, {})
        return {k: care_view(done.get(k), names, viewer.id) for k in CARE_KINDS}

    view = {"size": PLOTS, "plots": [plot_view(i, rows.get(i), now, care_of(rows.get(i))) for i in range(PLOTS)],
            "care_kinds": [{"id": k, "label": CARE_LABELS[k]} for k in CARE_KINDS], "care_day": day.isoformat(),
            "server_now": now.isoformat()}
    if viewer.id == user.id:
        view["seeds"] = [s for s in inv.inventory_view(db, user.id) if s["group"] == "seed" and s["available"] > 0]
    return view


@router.get("")
def get_garden(user: User = Depends(current_user), db: Session = Depends(get_db)):
    inv.refresh(db, user)
    return garden_view(db, user)


def _plot_index(plot: int) -> int:
    if not 0 <= plot < PLOTS:
        raise APIError(404, "plot_not_found", "There is no such plot")
    return plot


@router.post("/plots/{plot}/plant")
def plant(data: PlantInput, plot: int = Path(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Plant one seed in an empty plot. The seed leaves the inventory only when the plant is in the ground."""
    _plot_index(plot)
    event_key = f"plant:{data.client_request_id}"
    done = lambda: db.scalar(select(InventoryEvent.id).where(InventoryEvent.user_id == user.id,
                                                            InventoryEvent.event_key == event_key))
    if done():
        return {"planted": False, "replayed": True, "garden": garden_view(db, user)}
    item = cat.ITEMS.get(data.item_id)
    if item is None or item["group"] != "seed":
        raise APIError(422, "not_a_seed", "Only seeds can be planted")
    inv.lock_user(db, user.id)
    if done():  # a concurrent retry planted it while this one waited for the lock
        db.commit()
        return {"planted": False, "replayed": True, "garden": garden_view(db, user)}
    if db.scalar(select(GardenPlot.id).where(GardenPlot.user_id == user.id, GardenPlot.plot == plot)):
        db.rollback()
        raise APIError(409, "plot_taken", "Something is already growing in this plot")
    if not inv.use_one(db, user.id, data.item_id, data.variant):
        db.rollback()
        raise APIError(409, "not_enough_items", "There is no seed of this kind left")
    try:
        with db.begin_nested():
            db.add(GardenPlot(user_id=user.id, plot=plot, item_id=data.item_id, variant=data.variant,
                              request_id=data.client_request_id, planted_at=utcnow()))
            db.flush()
    except IntegrityError:
        db.rollback()
        raise APIError(409, "plot_taken", "Something is already growing in this plot")
    inv.record(db, user.id, data.item_id, data.variant, kind="plant", delta=-1, ref=f"garden:{plot}", event_key=event_key)
    db.commit()
    return {"planted": True, "replayed": False, "garden": garden_view(db, user)}


@router.post("/plots/{plot}/clear")
def clear(plot: int = Path(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Free the plot of a grown plant, to plant something new. Idempotent: an empty plot stays empty."""
    _plot_index(plot)
    row = db.scalar(select(GardenPlot).where(GardenPlot.user_id == user.id, GardenPlot.plot == plot))
    if row is not None:
        if stage_of(row) < len(STAGE_HOURS) - 1:
            raise APIError(409, "not_grown", "The plant is still growing")
        db.execute(delete(GardenCare).where(GardenCare.planting_id == row.id))
        db.delete(row)
        db.commit()
    return {"garden": garden_view(db, user)}


# ---------------------------------------------------------------------------- caring
def care_allowance(db: Session, visitor: User) -> dict:
    """How many friends' plants the visitor may still care for today (a rolling day, like room visit interactions)."""
    used = db.scalar(select(func.count()).select_from(GardenCare).where(
        GardenCare.carer_id == visitor.id, GardenCare.owner_id != visitor.id,
        GardenCare.created_at >= clock.now() - timedelta(days=1))) or 0
    limit = settings.garden_care_daily_limit
    return {"daily_limit": limit, "used": used, "left": max(0, limit - used)}


def _notify_care(db: Session, owner: User, carer: User, row: GardenCare, plant: str) -> None:
    """One notification while unread: more care from friends joins the unread one from the last hours."""
    since = clock.now() - timedelta(hours=settings.visit_notification_group_hours)
    old = latest_unread(db, owner.id, "garden_care", "garden", since)
    previous = json.loads(old.data_json) if old is not None else {}
    actor_ids = [carer.id] + [a for a in previous.get("actor_ids", []) if a != carer.id]
    count = previous.get("count", 0) + 1
    name, action = carer.display_name, "tưới nước cho" if row.kind == "water" else "chăm sóc"
    title = f"{name} và {len(actor_ids) - 1} bạn khác đã chăm vườn của bạn" if len(actor_ids) > 1 \
        else f"{name} đã ghé chăm vườn của bạn"
    body = f"{count} lượt tưới nước và chăm sóc, mới nhất: {name} {action} {plant}." if count > 1 \
        else f"{name} đã {action} {plant} trong Vườn nhà."
    data = {"group": "garden", "action": row.kind, "user_id": carer.id, "actor_ids": actor_ids[:20], "count": count,
            "plot": row.plot}
    if old is None:
        notify(db, owner.id, "garden_care", title, body, data)
    else:
        replace(db, old, title, body, data)


def care_for(db: Session, owner: User, carer: User, plot: int, data: CareInput) -> dict:
    """Water or tend the planting in `plot` of `owner`'s garden. `cared` is false with `reason: already_cared` when
    someone did it today; the same request id answers as the first time did (`replayed`)."""
    _plot_index(plot)
    guest = carer.id != owner.id
    same = select(GardenCare).where(GardenCare.carer_id == carer.id,
                                    GardenCare.client_request_id == data.client_request_id)
    if db.scalar(same) is not None:
        return {"cared": True, "replayed": True, "reason": None}
    if guest:
        enforce("garden-care", settings.rate_limit_garden_care, str(carer.id))
        inv.lock_user(db, carer.id)  # one visitor's care is counted one at a time, so the daily limit holds
        if db.scalar(same) is not None:
            db.commit()
            return {"cared": True, "replayed": True, "reason": None}
    planting = db.scalar(select(GardenPlot).where(GardenPlot.user_id == owner.id, GardenPlot.plot == plot))
    if planting is None or planting.item_id not in cat.ITEMS:
        db.rollback()
        raise APIError(409, "plot_empty", "Nothing grows in this plot")
    day = host_day(db, owner)
    already = select(GardenCare.id).where(GardenCare.planting_id == planting.id, GardenCare.kind == data.kind,
                                          GardenCare.local_date == day)
    if db.scalar(already) is not None:
        db.rollback()
        return {"cared": False, "replayed": False, "reason": "already_cared"}
    if guest and care_allowance(db, carer)["left"] <= 0:
        db.rollback()
        raise APIError(429, "garden_care_daily_limit", "That's enough garden care for today")
    row = GardenCare(owner_id=owner.id, carer_id=carer.id, planting_id=planting.id, plot=plot, kind=data.kind,
                     local_date=day, client_request_id=data.client_request_id, created_at=clock.now())
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:  # the same request from another device, or someone else cared for it a moment ago
        replayed = db.scalar(same) is not None
        db.rollback()
        return {"cared": replayed, "replayed": replayed, "reason": None if replayed else "already_cared"}
    if guest:
        _notify_care(db, owner, carer, row, cat.ITEMS[planting.item_id]["name"])
    db.commit()
    return {"cared": True, "replayed": False, "reason": None}


@router.post("/plots/{plot}/care")
def care_own(data: CareInput, plot: int = Path(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """"Tưới nước" or "Chăm sóc" for a plant of one's own garden."""
    return {**care_for(db, user, user, plot, data), "garden": garden_view(db, user)}


# ---------------------------------------------------------------------------- visiting a friend's garden
def garden_host(db: Session, visitor: User, host_id: int) -> User:
    """Only accepted friends visit, never across a block; anything else looks like a missing garden. A friend who
    turned visits off says so (`garden_visits_disabled`), so the app can explain instead of failing."""
    host = _visible_user(db, host_id)
    if host is None or host.id == visitor.id or is_blocked_between(db, visitor.id, host.id) \
            or not are_friends(db, visitor.id, host.id):
        raise APIError(404, "garden_not_found", "Garden not found")
    if not ensure_profile(db, host.id).allow_room_visits:
        raise APIError(403, "garden_visits_disabled", "This friend doesn't take visitors right now")
    return host


def visit_view(db: Session, visitor: User, host: User) -> dict:
    return {"owner": owner_view(host), "garden": garden_view(db, host, viewer=visitor),
            "care": care_allowance(db, visitor)}


@router.get("/visit/{user_id}")
def visit_garden(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A friend's garden as it is now: its plots, how each plant grows and who cared for it today. Opening it changes
    nothing (no walk is settled, no seed is shown)."""
    host = garden_host(db, user, user_id)
    return visit_view(db, user, host)


@router.post("/visit/{user_id}/plots/{plot}/care")
def care_friend(user_id: int, data: CareInput, plot: int = Path(...), user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    """Water or tend a friend's plant: friendship, visits allowed, the plant's day and the visitor's daily limit are all
    checked here. Answers with the garden as it is now, so the app shows what friends did meanwhile."""
    host = garden_host(db, user, user_id)
    return {**care_for(db, host, user, plot, data), **visit_view(db, user, host)}
