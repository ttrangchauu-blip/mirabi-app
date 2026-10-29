"""Kho đồ: what a user owns of the walk finds (items_catalog), and every change of it.

A stack is one item in one variant (InventoryStack); its `quantity` is everything owned, placed copies included. A
decoration copy placed in a room is a PlacedItem row (pet_room.py), so what is still free is the quantity minus the
placed rows, and placing or storing a copy never changes what is owned. Planting a seed (garden.py) uses one up. Every
change is an InventoryEvent; grants and uses carry an `event_key`, so a retried or repeated request changes nothing
twice. Rewards are granted by the backend only (companion.settle_walk); the app reads this and shows it.
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import items_catalog as cat
from .db import get_db
from .errors import APIError
from .models import (CatalogEntry, InventoryEvent, InventoryItem, InventoryStack, PetWalk, PlacedItem, User, WalkReward,
                     as_utc, utcnow)
from .security import current_user

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def lock_user(db: Session, user_id: int) -> None:
    """Serialize a user's inventory changes (the same per-user lock the walk takes). Held until commit or rollback."""
    from .companion import lock_daily_goals
    lock_daily_goals(db, user_id)


def variants_of(item_id: str) -> list[str]:
    """The item's variants: its own list, a decoration's colours from the room artwork, else just "default"."""
    item = cat.ITEMS[item_id]
    if item["variants"]:
        return list(item["variants"])
    if item["art"]:
        from .pet_room import art
        meta = art()["items"].get(item["art"])
        if meta:
            return [v["id"] for v in meta["variants"]]
    return ["default"]


def seed_catalog(db: Session) -> None:
    """Write the catalog to its table (startup). Rows of items no longer in the code are kept: ids are only added."""
    existing = {row.id: row for row in db.scalars(select(CatalogEntry))}
    for item_id, item in cat.ITEMS.items():
        values = {"group_id": item["group"], "name": item["name"], "description": item["description"],
                  "rarity": item["rarity"], "use": cat.use_of(item_id), "art": item["art"],
                  "variants_json": json.dumps(variants_of(item_id)), "drop": item["drop"]}
        row = existing.get(item_id)
        if row is None:
            db.add(CatalogEntry(id=item_id, **values))
        elif any(getattr(row, k) != v for k, v in values.items()):
            for k, v in values.items():
                setattr(row, k, v)


# ---------------------------------------------------------------------------- changes
def record(db: Session, user_id: int, item_id: str, variant: str, *, kind: str, delta: int = 0, placed_delta: int = 0,
           ref: str | None = None, event_key: str | None = None, at: datetime | None = None) -> bool:
    """Write one change to the history; False (and nothing written) when `event_key` was recorded already."""
    try:
        with db.begin_nested():
            db.add(InventoryEvent(user_id=user_id, item_id=item_id, variant=variant, delta=delta, placed_delta=placed_delta,
                                  kind=kind, ref=ref, event_key=event_key, created_at=at or utcnow()))
            db.flush()
        return True
    except IntegrityError:
        return False


def grant(db: Session, user_id: int, item_id: str, variant: str, quantity: int, *, kind: str, ref: str | None,
          event_key: str, at: datetime | None = None) -> bool | None:
    """Add `quantity` to a stack, once per `event_key`, inside the caller's transaction. True when the user had never
    owned this item in this variant, False when they had, None when the grant was made already."""
    at = at or utcnow()
    first = db.scalar(select(InventoryStack.id).where(InventoryStack.user_id == user_id, InventoryStack.item_id == item_id,
                                                      InventoryStack.variant == variant)) is None
    if not record(db, user_id, item_id, variant, kind=kind, delta=quantity, ref=ref, event_key=event_key, at=at):
        return None

    def increment():
        return db.execute(update(InventoryStack).where(
            InventoryStack.user_id == user_id, InventoryStack.item_id == item_id, InventoryStack.variant == variant,
        ).values(quantity=InventoryStack.quantity + quantity, last_obtained_at=at)
                          .execution_options(synchronize_session=False)).rowcount

    if not increment():
        try:
            with db.begin_nested():
                db.add(InventoryStack(user_id=user_id, item_id=item_id, variant=variant, quantity=quantity,
                                      first_obtained_at=at, last_obtained_at=at))
                db.flush()
        except IntegrityError:  # created by a concurrent grant of another item event
            increment()
            first = False
    return first


def use_one(db: Session, user_id: int, item_id: str, variant: str) -> bool:
    """Take one free copy out of a stack (a seed being planted); False when there is none. Never goes below zero."""
    placed = placed_counts(db, user_id).get((item_id, variant), 0)
    return db.execute(update(InventoryStack).where(
        InventoryStack.user_id == user_id, InventoryStack.item_id == item_id, InventoryStack.variant == variant,
        InventoryStack.quantity >= placed + 1,
    ).values(quantity=InventoryStack.quantity - 1).execution_options(synchronize_session=False)).rowcount == 1


def migrate_legacy(db: Session, user_id: int) -> None:
    """Finds kept in user_inventory_items before stacks existed: moved into stacks once (inside the caller's
    transaction). The old rows are left as they were."""
    for row in db.scalars(select(InventoryItem).where(InventoryItem.user_id == user_id, InventoryItem.quantity > 0)).all():
        if row.item_id in cat.ITEMS:
            grant(db, user_id, row.item_id, variants_of(row.item_id)[0], row.quantity, kind="legacy", ref=None,
                  event_key=f"legacy:{row.item_id}", at=as_utc(row.updated_at) if row.updated_at else None)


# ---------------------------------------------------------------------------- reading
def placed_counts(db: Session, user_id: int) -> dict[tuple[str, str], int]:
    rows = db.execute(select(PlacedItem.item_id, PlacedItem.variant, func.count()).where(PlacedItem.user_id == user_id)
                      .group_by(PlacedItem.item_id, PlacedItem.variant)).all()
    return {(item_id, variant): n for item_id, variant, n in rows}


def owned_stacks(db: Session, user_id: int) -> list[InventoryStack]:
    return list(db.scalars(select(InventoryStack).where(InventoryStack.user_id == user_id, InventoryStack.quantity > 0)
                           .execution_options(populate_existing=True)))


def item_meta(item_id: str) -> dict:
    item = cat.ITEMS[item_id]
    group, tab, use = cat.GROUPS[item["group"]]
    return {"id": item_id, "name": item["name"], "description": item["description"], "group": item["group"],
            "group_label": group, "tab": tab, "rarity": item["rarity"], "rarity_label": cat.RARITY_LABELS[item["rarity"]],
            "use": use, "use_label": cat.USES[use], "rooms": list(cat.ROOM_KINDS) if use == "room" else [],
            "art": item["art"]}


def stack_view(stack: InventoryStack, placed: int) -> dict:
    return {**item_meta(stack.item_id), "variant": stack.variant, "owned": stack.quantity, "placed": placed,
            "available": max(0, stack.quantity - placed),
            "is_new": stack.seen_at is None,
            "first_obtained_at": as_utc(stack.first_obtained_at).isoformat(),
            "last_obtained_at": as_utc(stack.last_obtained_at).isoformat()}


def inventory_view(db: Session, user_id: int) -> list[dict]:
    placed = placed_counts(db, user_id)
    return [stack_view(s, placed.get((s.item_id, s.variant), 0)) for s in owned_stacks(db, user_id) if s.item_id in cat.ITEMS]


def totals(db: Session, user_id: int) -> dict[str, int]:
    """Quantity owned per item, all variants together."""
    out: dict[str, int] = {}
    for s in owned_stacks(db, user_id):
        out[s.item_id] = out.get(s.item_id, 0) + s.quantity
    return out


def catalog_view() -> dict:
    return {"tabs": [{"id": t, "label": label} for t, label in cat.TABS],
            "rarities": [{"id": r, "label": cat.RARITY_LABELS[r]} for r in cat.RARITIES],
            "uses": [{"id": u, "label": label} for u, label in cat.USES.items()]}


def refresh(db: Session, user: User) -> None:
    """Grant what is due first (a walk that has just ended, finds from before stacks), so reads are up to date."""
    from .companion import settle_returned_walks
    settle_returned_walks(db, user.id)
    migrate_legacy(db, user.id)
    db.commit()


def location_view(location_id: str | None) -> dict | None:
    if location_id not in cat.LOCATIONS:
        return None
    return {"id": location_id, "name": cat.LOCATIONS[location_id]["name"]}


# ---------------------------------------------------------------------------- endpoints
@router.get("")
def get_inventory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything the user owns, with what is placed and what is free. No capacity limit."""
    refresh(db, user)
    return {**catalog_view(), "items": inventory_view(db, user.id), "server_now": utcnow().isoformat()}


def _stack(db: Session, user_id: int, item_id: str, variant: str) -> InventoryStack:
    stack = db.scalar(select(InventoryStack).where(InventoryStack.user_id == user_id, InventoryStack.item_id == item_id,
                                                   InventoryStack.variant == variant))
    if stack is None or item_id not in cat.ITEMS:
        raise APIError(404, "item_not_owned", "This item is not in the inventory")
    return stack


@router.get("/items/{item_id}")
def get_item(item_id: str, variant: str = "default", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One stack: its description, totals, where its copies are placed and when it was received (and from which walk)."""
    refresh(db, user)
    stack = _stack(db, user.id, item_id, variant)
    placed = list(db.scalars(select(PlacedItem).where(PlacedItem.user_id == user.id, PlacedItem.item_id == item_id,
                                                      PlacedItem.variant == variant).order_by(PlacedItem.id)))
    events = list(db.scalars(select(InventoryEvent).where(
        InventoryEvent.user_id == user.id, InventoryEvent.item_id == item_id, InventoryEvent.variant == variant,
    ).order_by(InventoryEvent.created_at.desc(), InventoryEvent.id.desc()).limit(50)))
    walk_ids = [int(e.ref.split(":")[1]) for e in events if e.ref and e.ref.startswith("walk:")]
    rewards = {(r.walk_id, r.slot): r for r in db.scalars(select(WalkReward).where(
        WalkReward.user_id == user.id, WalkReward.walk_id.in_(walk_ids or [0]), WalkReward.item_id == item_id))}
    walks = {w.id: w for w in db.scalars(select(PetWalk).where(PetWalk.id.in_(walk_ids or [0])))}
    history = []
    for e in events:
        entry = {"kind": e.kind, "delta": e.delta, "placed_delta": e.placed_delta, "ref": e.ref,
                 "at": as_utc(e.created_at).isoformat(), "walk_id": None, "location": None, "memory_id": None}
        if e.ref and e.ref.startswith("walk:"):
            walk_id = int(e.ref.split(":")[1])
            slot = (e.event_key or "").rsplit(":", 1)[-1]
            reward = rewards.get((walk_id, slot))
            walk = walks.get(walk_id)
            entry.update(walk_id=walk_id, location=location_view(reward.location_id if reward else walk and walk.location_id),
                         memory_id=reward.memory_id if reward else None)
        history.append(entry)
    memory_id = next((h["memory_id"] for h in history if h["memory_id"]), None)
    return {"item": stack_view(stack, len(placed)),
            "placements": [{"uid": f"p{p.id}", "room": p.room, "x": p.x, "y": p.y,
                            "placed_at": as_utc(p.placed_at).isoformat()} for p in placed],
            "history": history, "memory_id": memory_id,
            "walk_id": next((h["walk_id"] for h in history if h["walk_id"]), None)}


class SeenInput(BaseModel):
    variant: str = Field(default="default", max_length=24)


@router.post("/items/{item_id}/seen")
def mark_seen(item_id: str, data: SeenInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The stack's detail was opened: it is no longer "Mới". Idempotent."""
    stack = _stack(db, user.id, item_id, data.variant)
    if stack.seen_at is None:
        db.execute(update(InventoryStack).where(InventoryStack.id == stack.id, InventoryStack.seen_at.is_(None))
                   .values(seen_at=utcnow()).execution_options(synchronize_session=False))
        db.commit()
    return {"ok": True}
