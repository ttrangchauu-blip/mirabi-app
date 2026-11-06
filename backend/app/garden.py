"""Vườn nhà: nine plots of soil, the seeds bought in its shop or brought back by the pet, harvests, and friends who help.

What grows, what it costs and what it gives is garden_catalog.py (data/garden_plants.json), never the app: the app sends
which seed, which plot, how many, and a request id; prices, growing times and rewards are decided here.

- Buying (`/shop/buy`): the price comes from the catalog, coins leave through wallet.spend (never below zero) and the
  seeds arrive through inventory.grant, in one transaction under the user's lock: either both happen or neither does. The
  request id is the coin event's key and the inventory event's, so a retry or a second device buys once. A tier opens at
  its pet level.
- Planting takes one seed out of the inventory (inventory.use_one) only when it succeeds: the plot must be empty and the
  seed owned. `client_request_id` makes a retried or repeated tap plant once. The planting keeps its growing time and
  rewards from that moment.
- A plant grows by itself in real time from `planted_at` (the app being closed changes nothing), through the catalog's
  five stages; at the last one it is ready.
- Harvesting a ready plant gives its coins (wallet.earn) and its EXP to the active pet (progression.award_exp, source
  "garden", under `garden_daily_exp_cap` a day: past the cap the coins still come and the EXP doesn't), records a
  GardenHarvest and frees the plot, in one transaction under the user's lock. A planting is harvested once (unique
  planting_ref) and a request id is handled once, so fast taps, retries and several devices never pay twice. "Dọn ô"
  (`/clear`, older apps) harvests a ready plant the same way.

Caring ("Tưới nước", "Chăm sóc") is open to the owner and to visiting friends. Each planting takes each kind once per
owner day, from anyone (unique key of garden_care), and a request id is handled once, so retries, fast taps and
friends caring at the same time never count twice. A visitor cares for at most `garden_care_daily_limit` plants a day
across all friends' gardens. Care is shown in the garden (who did it today) and tells the owner; it changes nothing
else: no EXP, no coins, the plant grows as before.

Visiting a friend's garden follows the room visits (room_visits.py): accepted friends only, never across a block, and
only while the owner lets friends visit (social_profiles.allow_room_visits). A visitor sees the plots and their care,
never the owner's seeds or coins, and cannot plant, harvest or move anything: those endpoints only ever touch one's own
garden.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock
from . import garden_catalog as gc
from . import inventory as inv
from . import items_catalog as cat
from . import wallet
from .config import settings
from .db import get_db
from .errors import APIError
from .friends import _visible_user, are_friends, ensure_profile, is_blocked_between
from .models import GardenCare, GardenHarvest, GardenPlot, InventoryEvent, User, as_utc, utcnow
from .notifications import latest_unread, notify, replace
from .progression import award_exp, daily_exp_remaining, source_daily_cap
from .ratelimit import enforce
from .room_visits import host_day, owner_view
from .security import current_user

router = APIRouter(prefix="/api/garden", tags=["garden"])

PLOTS = 9
STAGE_LABELS = gc.STAGE_LABELS
READY_STAGE = gc.READY_STAGE
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


class HarvestInput(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=80)


class BuyInput(BaseModel):
    """No price: the price is the catalog's. Anything else sent (a price, a reward) is ignored."""
    item_id: str = Field(max_length=40)
    quantity: int = Field(ge=1, le=999)
    client_request_id: str = Field(min_length=8, max_length=80)


# ---------------------------------------------------------------------------- growing
def grow_seconds(plot: GardenPlot) -> int:
    return plot.grow_seconds if plot.grow_seconds is not None else gc.plant_of(plot.item_id)["grow_seconds"]


def rewards_of(plot: GardenPlot) -> tuple[int, int]:
    """(EXP, coins) of harvesting this planting: what it was planted with, else what the catalog says now."""
    plant = gc.plant_of(plot.item_id)
    return (plot.reward_exp if plot.reward_exp is not None else plant["harvest_exp"],
            plot.reward_coins if plot.reward_coins is not None else plant["harvest_coins"])


def stage_of(plot: GardenPlot, now: datetime | None = None) -> int:
    return gc.stage_at(as_utc(plot.planted_at), grow_seconds(plot), now or utcnow())[0]


def is_ready(plot: GardenPlot, now: datetime | None = None) -> bool:
    return stage_of(plot, now) == READY_STAGE


def care_view(row: GardenCare | None, names: dict[int, str], viewer_id: int) -> dict:
    if row is None:
        return {"done": False, "by": None, "at": None}
    return {"done": True, "at": as_utc(row.created_at).isoformat(),
            "by": {"id": row.carer_id, "display_name": names.get(row.carer_id, ""), "me": row.carer_id == viewer_id}}


def plot_view(index: int, plot: GardenPlot | None, now, care: dict[str, dict] | None = None) -> dict:
    if plot is None or plot.item_id not in cat.ITEMS:
        return {"plot": index, "empty": True}
    plant = gc.plant_of(plot.item_id)
    planted, grow = as_utc(plot.planted_at), grow_seconds(plot)
    stage, nxt = gc.stage_at(planted, grow, now)
    exp, coins = rewards_of(plot)
    ready = stage == READY_STAGE
    return {"plot": index, "empty": False, "item_id": plot.item_id, "variant": plot.variant,
            "name": plant["name"], "rarity": cat.ITEMS[plot.item_id]["rarity"],
            "plant_id": plant["id"], "art": plant["art"], "tier": plant["tier"], "tier_label": gc.TIERS[plant["tier"]]["label"],
            "planted_at": planted.isoformat(), "grow_seconds": grow, "ready_at": (planted + timedelta(seconds=grow)).isoformat(),
            "progress": round(min(1.0, max(0.0, (now - planted).total_seconds() / grow)), 4),
            "stage": stage, "stage_count": len(STAGE_LABELS), "stage_label": STAGE_LABELS[stage],
            # `grown` is what apps from before harvests read: ready.
            "grown": ready, "ready": ready, "next_stage_at": nxt.isoformat() if nxt else None,
            "harvest": {"exp": exp, "coins": coins},
            "care": care or {k: {"done": False, "by": None, "at": None} for k in CARE_KINDS}}


def garden_exp(db: Session, user: User) -> dict:
    """Today's EXP from harvests against its daily cap (days.py's day)."""
    cap = source_daily_cap("garden")
    left = daily_exp_remaining(user, db, source="garden", daily_cap=cap)
    return {"daily_cap": cap, "earned_today": cap - left, "left": left}


def seed_view(seed: dict) -> dict:
    return {**seed, "plant": gc.plant_view(gc.plant_of(seed["id"]))}


def garden_view(db: Session, user: User, viewer: User | None = None) -> dict:
    """`user`'s garden. Seen by its owner it lists their seeds, coins and today's harvest EXP too; seen by a friend
    (`viewer`) only the plots."""
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
            "stages": list(STAGE_LABELS), "server_now": now.isoformat()}
    if viewer.id == user.id:
        view["seeds"] = [seed_view(s) for s in inv.inventory_view(db, user.id) if s["group"] == "seed" and s["available"] > 0]
        view["coins"] = wallet.balance(db, user.id)
        view["garden_exp"] = garden_exp(db, user)
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
    grown_as = gc.plant_of(data.item_id)
    try:
        with db.begin_nested():
            db.add(GardenPlot(user_id=user.id, plot=plot, item_id=data.item_id, variant=data.variant,
                              request_id=data.client_request_id, planted_at=utcnow(), grow_seconds=grown_as["grow_seconds"],
                              reward_exp=grown_as["harvest_exp"], reward_coins=grown_as["harvest_coins"]))
            db.flush()
    except IntegrityError:
        db.rollback()
        raise APIError(409, "plot_taken", "Something is already growing in this plot")
    inv.record(db, user.id, data.item_id, data.variant, kind="plant", delta=-1, ref=f"garden:{plot}", event_key=event_key)
    db.commit()
    return {"planted": True, "replayed": False, "garden": garden_view(db, user)}


# ---------------------------------------------------------------------------- harvesting
def harvest_view(h: GardenHarvest) -> dict:
    plant = gc.PLANTS.get(h.plant_id, gc.FALLBACK)
    return {"plot": h.plot, "item_id": h.item_id, "plant_id": h.plant_id, "name": plant["name"], "art": plant["art"],
            "tier": plant["tier"], "tier_label": gc.TIERS[plant["tier"]]["label"], "coins": h.coins, "exp": h.exp_granted,
            "exp_requested": h.exp_requested, "exp_capped": h.exp_granted < h.exp_requested,
            "harvested_at": as_utc(h.harvested_at).isoformat()}


def harvest_plot(db: Session, user: User, plot: int, request_id: str) -> tuple[GardenHarvest, bool]:
    """Harvest the ready plant of `plot`: (the harvest, whether this request made it). Commits."""
    same = select(GardenHarvest).where(GardenHarvest.user_id == user.id, GardenHarvest.client_request_id == request_id)
    if (h := db.scalar(same)) is not None:
        return h, False
    inv.lock_user(db, user.id)  # before any other row: coins, EXP and the plot change together, one request at a time
    if (h := db.scalar(same.execution_options(populate_existing=True))) is not None:
        db.commit()
        return h, False
    row = db.scalar(select(GardenPlot).where(GardenPlot.user_id == user.id, GardenPlot.plot == plot)
                    .execution_options(populate_existing=True))
    if row is None or row.item_id not in cat.ITEMS:
        db.rollback()
        raise APIError(409, "plot_empty", "Nothing grows in this plot")
    if not is_ready(row):
        db.rollback()
        raise APIError(409, "not_ready", "The plant isn't ready to harvest yet")
    plant = gc.plant_of(row.item_id)
    exp, coins = rewards_of(row)
    h = GardenHarvest(user_id=user.id, plot=plot, planting_ref=row.request_id, item_id=row.item_id, plant_id=plant["id"],
                      planted_at=row.planted_at, harvested_at=utcnow(), exp_requested=exp, exp_granted=0, coins=coins,
                      client_request_id=request_id)
    try:
        with db.begin_nested():
            db.add(h)
            db.flush()
    except IntegrityError:  # this planting was harvested by another request a moment ago
        db.rollback()
        raise APIError(409, "plot_empty", "Nothing grows in this plot")
    if wallet.earn(db, user.id, coins, kind="garden_harvest", ref=f"garden:{plot}", event_key=f"harvest:{row.request_id}") is None:
        db.rollback()
        raise APIError(409, "plot_empty", "Nothing grows in this plot")
    h.exp_granted = award_exp(user, db, source="garden", reference_id=f"harvest:{row.request_id}", requested=exp,
                              daily_cap=source_daily_cap("garden"))
    db.execute(delete(GardenCare).where(GardenCare.planting_id == row.id))
    db.delete(row)
    db.commit()
    return h, True


@router.post("/plots/{plot}/harvest")
def harvest(data: HarvestInput, plot: int = Path(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Harvest a ready plant: its coins and its EXP (under the day's cap) are decided here, and the plot is free again.
    The same request id answers as the first time did (`replayed`)."""
    _plot_index(plot)
    h, made = harvest_plot(db, user, plot, data.client_request_id)
    db.refresh(user)
    return {"harvested": made, "replayed": not made, "harvest": harvest_view(h), "coins": wallet.balance(db, user.id),
            "pet_level": user.level, "xp": user.xp, "garden": garden_view(db, user)}


@router.post("/plots/{plot}/clear")
def clear(plot: int = Path(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    """"Dọn ô" of the apps from before harvests: a ready plant is harvested (its reward is never lost), a growing one
    stays. Idempotent: an empty plot stays empty."""
    _plot_index(plot)
    row = db.scalar(select(GardenPlot).where(GardenPlot.user_id == user.id, GardenPlot.plot == plot))
    done = None
    if row is not None:
        if not is_ready(row):
            raise APIError(409, "not_grown", "The plant is still growing")
        # One request id per planting (it fits the column whatever the planting's own id is), so a repeated "Dọn ô" pays once.
        request_id = "clear:" + hashlib.sha256(row.request_id.encode()).hexdigest()[:40]
        done = harvest_view(harvest_plot(db, user, plot, request_id)[0])
    return {"garden": garden_view(db, user), "harvest": done}


# ---------------------------------------------------------------------------- the seed shop
def shop_view(db: Session, user: User) -> dict:
    owned = inv.totals(db, user.id)
    level = user.level or 0
    items = []
    for plant in gc.for_sale():
        view = gc.plant_view(plant)
        items.append({**view, "unlocked": level >= view["unlock_level"], "owned": owned.get(plant["seed_item"], 0)})
    return {"coins": wallet.balance(db, user.id), "pet_level": level, "max_quantity": settings.garden_buy_max_quantity,
            "tiers": [{"id": t, "label": gc.TIERS[t]["label"], "unlock_level": gc.TIERS[t]["unlock_level"]} for t in gc.TIER_ORDER],
            "items": items, "garden_exp": garden_exp(db, user)}


@router.get("/shop")
def get_shop(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The seeds on sale, their prices, growing times and rewards (all from the catalog), and what the user has."""
    return shop_view(db, user)


@router.post("/shop/buy")
def buy(data: BuyInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Buy `quantity` seeds at the catalog's price: the coins leave and the seeds arrive together, or neither does."""
    key = f"seed:{data.client_request_id}"

    def replay():
        event = wallet.recorded(db, user.id, key)
        if event is None:
            return None
        db.commit()
        return {"bought": False, "replayed": True, "spent": -event.delta, "coins": wallet.balance(db, user.id),
                "shop": shop_view(db, user)}

    if (answer := replay()) is not None:
        return answer
    plant = gc.BY_SEED.get(data.item_id)
    if plant is None or plant.get("seed_price") is None:
        raise APIError(404, "not_for_sale", "This seed isn't sold in the shop")
    if data.quantity > settings.garden_buy_max_quantity:
        raise APIError(422, "too_many", f"At most {settings.garden_buy_max_quantity} seeds at a time")
    if (user.level or 0) < gc.unlock_level(plant):
        raise APIError(403, "seed_locked", "This seed opens at a higher pet level")
    inv.lock_user(db, user.id)
    if (answer := replay()) is not None:  # the same purchase from another device, while this one waited
        return answer
    total = plant["seed_price"] * data.quantity
    paid = wallet.spend(db, user.id, total, kind="garden_seed", ref=f"{data.item_id} x{data.quantity}", event_key=key)
    if not paid:
        db.rollback()
        if paid is None and (answer := replay()) is not None:
            return answer
        raise APIError(409, "insufficient_coins", "Not enough coins")
    inv.grant(db, user.id, data.item_id, "default", data.quantity, kind="buy", ref=f"shop:{plant['seed_price']}",
              event_key=f"buy:{data.client_request_id}")
    db.commit()
    return {"bought": True, "replayed": False, "item_id": data.item_id, "quantity": data.quantity, "spent": total,
            "coins": wallet.balance(db, user.id), "shop": shop_view(db, user)}


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
