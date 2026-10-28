"""Daily quests and the companion's daily walk (Pet Adventure).

When every goal of the (UTC) day is done, the pet automatically starts one eight-hour walk. Today's goals are the
daily quests plus the user's own tasks scheduled for today (the Home "Nhiệm vụ hằng ngày" card): a task added before
the walk starts must be done too; once the walk has started, nothing added later changes it or starts another one
that day. The check reads the database under a per-user lock that adding a task also takes, so the two never
interleave.
When it ends, the backend grants its rewards (EXP and items into the inventory) exactly once, even if the
app is closed. The app then shows a gift popup until the user confirms it with "Nhận quà", which only
records that the popup was seen.
"""
import logging
import math
import json
import random
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from .config import settings
from .db import get_db
from .errors import APIError
from .models import Activity, CommunityPost, ExpEvent, InventoryItem, PetWalk, StudySession, User, as_utc, utcnow
from .schemas import PetRoomUpdate
from .security import current_user
from .progression import award_exp, daily_exp_remaining, SYSTEM_TASK_EXP
from .profile import DAILY_TASK_BY_ID

log = logging.getLogger("refmi.companion")
router = APIRouter(prefix="/api/pet", tags=["pet"])
legacy_room_router = APIRouter(prefix="/api/room", tags=["pet"])

QUESTS = [("focus", "Hoàn thành một phiên tập trung"), ("lesson", "Khám phá một bài học"), ("share", "Chia sẻ một điều tích cực")]

# What a pet can bring back from a walk. Ids are stored in pet_walks.item_id, so only ever add to this list.
PET_FINDS = [
    {"id": "shell", "name": "Vỏ sò lấp lánh", "emoji": "🐚", "rarity": "rare"},
    {"id": "clover", "name": "Cỏ bốn lá", "emoji": "🍀", "rarity": "rare"},
    {"id": "flower", "name": "Bông hoa dại", "emoji": "🌼", "rarity": "common"},
    {"id": "acorn", "name": "Quả sồi nhỏ", "emoji": "🌰", "rarity": "common"},
    {"id": "feather", "name": "Lông vũ cầu vồng", "emoji": "🪶", "rarity": "rare"},
    {"id": "pebble", "name": "Viên sỏi tròn", "emoji": "🪨", "rarity": "common"},
    {"id": "star", "name": "Mảnh sao băng", "emoji": "🌠", "rarity": "epic"},
    {"id": "crystal", "name": "Mảnh pha lê xanh", "emoji": "💎", "rarity": "epic"},
]
FIND_BY_ID = {x["id"]: x for x in PET_FINDS}
# Everything a walk can put in the inventory (user_inventory_items.item_id); only ever add to this.
# `emoji` is the item's picture in the app.
REWARD_ITEMS = {
    **{x["id"]: {**x, "kind": "find"} for x in PET_FINDS},
    "seedling": {"id": "seedling", "name": "Mầm cây", "emoji": "🌱", "rarity": "common", "kind": "seedling"},
    "small_pot": {"id": "small_pot", "name": "Chậu cây nhỏ", "emoji": "🪴", "rarity": "rare", "kind": "decoration"},
    "moon_lantern": {"id": "moon_lantern", "name": "Đèn lồng trăng", "emoji": "🏮", "rarity": "epic", "kind": "decoration"},
}
# Each walk brings back exactly one gift: ADVENTURE_EXP, or one item. For an item, a rarity tier is drawn by
# GIFT_ODDS first, then an item of that tier.
EXP_GIFT = "exp"  # pet_walks.item_id when the walk's gift is EXP
EXP_GIFT_CHANCE = 0.4
GIFT_ODDS = {"common": 55, "rare": 35, "epic": 10}
ADVENTURE_EXP = 30
UNLIMITED_ADVENTURE_EXP_CAP = 1_000_000  # one award per walk; the walk itself is limited to one a day
ROOM_ITEMS = [
    {"id": "plant", "name": "Cây bạc hà", "category": "Thiên nhiên", "cost": 120},
    {"id": "lamp", "name": "Đèn mặt trăng", "category": "Ánh sáng", "cost": 250},
    {"id": "crystal", "name": "Pha lê trang trí", "category": "Phép thuật", "cost": 400},
    {"id": "poster", "name": "Tranh mơ ước", "category": "Treo tường", "cost": 180},
]

def day_start():
    return utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

def daily_quests(user: User, db: Session) -> list[dict]:
    since = day_start()
    if user.daily_tasks_selected:
        selected = json.loads(user.daily_task_ids or "[]")
        marked = {row for row in db.scalars(select(Activity.kind).where(
            Activity.user_id == user.id, Activity.created_at >= since, Activity.kind.like("quest_%")
        ))}
        return [{"id": task_id, "title": DAILY_TASK_BY_ID[task_id]["title"],
                 "description": DAILY_TASK_BY_ID[task_id]["description"], "group": DAILY_TASK_BY_ID[task_id]["group"],
                 "exp": DAILY_TASK_BY_ID[task_id]["exp"], "progress": int(f"quest_{task_id}" in marked), "target": 1}
                for task_id in selected if task_id in DAILY_TASK_BY_ID]
    def count(model, *where):
        return db.scalar(select(func.count()).select_from(model).where(model.user_id == user.id, model.created_at >= since, *where)) or 0
    done = {
        "focus": count(StudySession, StudySession.completed.is_(True)),
        "lesson": count(Activity, Activity.kind == "lesson"),
        "share": count(CommunityPost),
    }
    # The user may also mark a task complete from the home screen. Store that as
    # a daily activity so completion survives navigation and app restarts.
    marked = {row for row in db.scalars(select(Activity.kind).where(
        Activity.user_id == user.id, Activity.created_at >= since, Activity.kind.like("quest_%")
    ))}
    for key in done:
        if f"quest_{key}" in marked:
            done[key] = 1
    return [{"id": key, "title": title, "progress": min(done[key], 1), "target": 1} for key, title in QUESTS]

@router.post("/quests/{quest_id}/complete")
def complete_quest(quest_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    selected_ids = json.loads(user.daily_task_ids or "[]") if user.daily_tasks_selected else []
    is_selected_task = user.daily_tasks_selected and quest_id in selected_ids and quest_id in DAILY_TASK_BY_ID
    is_legacy_task = not user.daily_tasks_selected and quest_id in {key for key, _ in QUESTS}
    if not (is_selected_task or is_legacy_task):
        raise APIError(404, "quest_not_found", "Quest not found")
    since = day_start()
    exists = db.scalar(select(Activity.id).where(Activity.user_id == user.id,
        Activity.kind == f"quest_{quest_id}", Activity.created_at >= since).limit(1))
    awarded = 0
    if not exists:
        db.add(Activity(user_id=user.id, kind=f"quest_{quest_id}"))
        awarded = award_exp(
            user, db, source="task", reference_id=f"quest:{quest_id}:{utcnow().date().isoformat()}",
            requested=DAILY_TASK_BY_ID[quest_id]["exp"] if is_selected_task else SYSTEM_TASK_EXP,
            daily_cap=settings.task_daily_exp_cap,
        )
        db.commit()
        maybe_start_walk(user, db)
    return {"quests": daily_quests(user, db), "awarded_exp": awarded, "already_completed": bool(exists),
            "daily_exp_remaining": daily_exp_remaining(user, db, source="task", daily_cap=settings.task_daily_exp_cap)}

def latest_walk(user: User, db: Session) -> PetWalk | None:
    return db.scalar(select(PetWalk).where(PetWalk.user_id == user.id).order_by(PetWalk.id.desc()).limit(1))

def today_goals(user: User, db: Session) -> list[dict]:
    """What the walk waits for today: the daily quests and the user's own tasks scheduled for today (UTC day, like the
    quests and the Home card). Tasks of other days never count."""
    from .tasks import scheduled_occurrences  # tasks imports this module
    day = day_start().date()
    own = [{"id": f"task:{t['occurrence_id']}", "progress": int(t["completed"]), "target": 1}
           for t in scheduled_occurrences(user, day, day, db)]
    return daily_quests(user, db) + own

def walk_status(walk: PetWalk | None, goals: list[dict]) -> str:
    """locked -> ready -> walking -> returned -> rested (until tomorrow). `goals` only matter before the day's walk:
    an empty list never makes it ready."""
    if walk and walk.collected_at is None:
        return "walking" if as_utc(walk.returns_at) > utcnow() else "returned"
    if walk and as_utc(walk.started_at) >= day_start():
        return "rested"
    return "ready" if goals and all(g["progress"] >= g["target"] for g in goals) else "locked"

def lock_daily_goals(db: Session, user_id: int) -> None:
    """Serialize, per user, what decides the day's walk: adding a task and starting the walk. Held until the next
    commit or rollback. PostgreSQL locks the user's row; SQLite has no row locks, so a write that changes nothing
    takes its database write lock instead."""
    if db.get_bind().dialect.name == "sqlite":
        db.execute(update(User).where(User.id == user_id).values(id=User.id).execution_options(synchronize_session=False))
    else:
        db.scalar(select(User.id).where(User.id == user_id).with_for_update())

def maybe_start_walk(user: User, db: Session) -> PetWalk | None:
    """Start the day's eight-hour walk once every goal of today is done; safe to call repeatedly, concurrently, on
    retries and from several devices. Callers commit their own changes first."""
    current = latest_walk(user, db)
    if walk_status(current, today_goals(user, db)) != "ready":
        return current
    # Looks ready: decide again from the latest data, under the lock a new task also takes. A task added a moment ago
    # (or a walk started by another request or device) is seen here.
    lock_daily_goals(db, user.id)
    current = db.scalar(select(PetWalk).where(PetWalk.user_id == user.id).order_by(PetWalk.id.desc()).limit(1)
                        .execution_options(populate_existing=True))
    if walk_status(current, today_goals(user, db)) != "ready":
        db.commit()  # releases the lock; nothing was changed
        return current

    now = utcnow()
    day = now.date().isoformat()
    # This path is shared by explicit quest completion, focus, lesson and share,
    # so the milestone cannot be missed depending on which screen finishes last.
    if not db.scalar(select(ExpEvent.id).where(ExpEvent.user_id == user.id,
                                               ExpEvent.reference_id == f"all_quests:{day}")):
        db.add(ExpEvent(user_id=user.id, pet_id=user.pet, source="milestone",
                        reference_id=f"all_quests:{day}", amount=0))
    from .memories import record_event
    record_event(db, user, "first_daily_quests", "first:daily-quests", at=now,
                 result="Hoàn thành toàn bộ nhiệm vụ trong ngày")
    walk = PetWalk(user_id=user.id, item_id=pick_gift(), started_at=now,
                   returns_at=now + timedelta(minutes=settings.pet_walk_minutes), task_cycle_id=now.date().isoformat())
    db.add(walk)
    try:
        # A unique user/cycle index protects against overlapping task-completion requests.
        db.commit()
        db.refresh(walk)
        return walk
    except IntegrityError:
        db.rollback()
        return latest_walk(user, db)

def pick_gift(rng: random.Random | None = None) -> str:
    """The walk's one gift (EXP_GIFT or an item id), chosen when it starts: a surprise until the pet returns."""
    rng = rng or random.Random()
    if rng.random() < EXP_GIFT_CHANCE:
        return EXP_GIFT
    tier = rng.choices(list(GIFT_ODDS), weights=list(GIFT_ODDS.values()))[0]
    return rng.choice([item_id for item_id, item in REWARD_ITEMS.items() if item["rarity"] == tier])

def roll_rewards(walk: PetWalk) -> list[dict]:
    """Items the walk adds to the inventory: its gift if that is an item, nothing if it is EXP."""
    return [] if walk.item_id == EXP_GIFT else [{"item_id": walk.item_id, "quantity": 1}]

def add_to_inventory(db: Session, user_id: int, item_id: str, quantity: int) -> None:
    def increment():
        return db.execute(update(InventoryItem).where(InventoryItem.user_id == user_id, InventoryItem.item_id == item_id)
                          .values(quantity=InventoryItem.quantity + quantity, updated_at=utcnow())
                          .execution_options(synchronize_session=False)).rowcount
    if increment():
        return
    try:
        with db.begin_nested():
            db.add(InventoryItem(user_id=user_id, item_id=item_id, quantity=quantity))
            db.flush()
    except IntegrityError:  # another grant created the row first
        increment()

def settle_walk(db: Session, walk_id: int, now: datetime | None = None) -> bool:
    """Grant a finished walk's gift in one transaction. False if it isn't back or was already granted."""
    now = now or utcnow()
    with db.begin_nested():
        # Claiming the walk first makes the grant happen once, however many requests or workers race here.
        claimed = db.execute(update(PetWalk).where(
            PetWalk.id == walk_id, PetWalk.rewarded_at.is_(None), PetWalk.returns_at <= now,
        ).values(rewarded_at=now).execution_options(synchronize_session=False))
        if claimed.rowcount != 1:
            return False
        walk = db.get(PetWalk, walk_id, populate_existing=True)
        user = db.get(User, walk.user_id)
        items = roll_rewards(walk)
        walk.reward_exp = award_exp(user, db, source="pet_adventure", reference_id=f"walk:{walk.id}",
                                    requested=ADVENTURE_EXP, daily_cap=UNLIMITED_ADVENTURE_EXP_CAP) \
            if walk.item_id == EXP_GIFT else 0
        for item in items:
            add_to_inventory(db, walk.user_id, item["item_id"], item["quantity"])
        walk.rewards = json.dumps(items)
    db.commit()
    return True

def settle_returned_walks(db: Session, user_id: int | None = None) -> int:
    """Grant every walk that has ended but not been rewarded yet (one user's, or everyone's). Commits."""
    now = utcnow()
    query = select(PetWalk.id).where(PetWalk.rewarded_at.is_(None), PetWalk.returns_at <= now).order_by(PetWalk.id)
    if user_id is not None:
        query = query.where(PetWalk.user_id == user_id)
    settled = 0
    for walk_id in db.scalars(query).all():
        try:
            settled += settle_walk(db, walk_id, now)
        except Exception:
            # Nothing of this walk was granted; the next sweep or read tries again.
            db.rollback()
            log.exception("Could not grant rewards for pet walk %s", walk_id)
    return settled

def sweep_returned_walks() -> int:
    """Background pass: rewards don't wait for the user to open the app."""
    from .db import SessionLocal
    with SessionLocal() as db:
        return settle_returned_walks(db)

def walk_rewards(walk: PetWalk) -> dict:
    items = [{**REWARD_ITEMS[entry["item_id"]], "quantity": entry["quantity"]}
             for entry in json.loads(walk.rewards or "[]") if entry.get("item_id") in REWARD_ITEMS]
    return {"walk_id": walk.id, "returned_at": as_utc(walk.returns_at).isoformat(), "exp": walk.reward_exp, "items": items}

def pending_reward(user: User, db: Session) -> dict | None:
    """The oldest granted walk whose gift popup the user hasn't confirmed yet."""
    walk = db.scalar(select(PetWalk).where(PetWalk.user_id == user.id, PetWalk.rewarded_at.is_not(None),
                                           PetWalk.collected_at.is_(None)).order_by(PetWalk.id).limit(1))
    return walk_rewards(walk) if walk else None

def inventory(user: User, db: Session) -> dict[str, int]:
    return {row.item_id: row.quantity for row in db.scalars(select(InventoryItem).where(
        InventoryItem.user_id == user.id, InventoryItem.quantity > 0))}

def pet_space(user: User, db: Session) -> dict:
    settle_returned_walks(db, user.id)
    walk = maybe_start_walk(user, db)
    quests = daily_quests(user, db)
    status = walk_status(walk, today_goals(user, db))
    server_now = utcnow()
    owned = inventory(user, db)
    return {
        "status": status,
        # Rounded up so "walking" never reports 0 seconds left.
        "seconds_left": math.ceil((as_utc(walk.returns_at) - server_now).total_seconds()) if status == "walking" else 0,
        "server_now": server_now.isoformat(),
        "walk_minutes": settings.pet_walk_minutes,
        # SQLite hands back naive UTC; always send the offset so clients don't read it as local time.
        "started_at": as_utc(walk.started_at).isoformat() if walk else None,
        "return_at": as_utc(walk.returns_at).isoformat() if walk else None,
        "task_cycle_id": walk.task_cycle_id if walk else None,
        "quests": quests,
        # The find stays a surprise until it is collected.
        "last_find": REWARD_ITEMS.get(walk.item_id) if status == "rested" else None,
        # Already granted; shown in the gift popup until the user confirms it.
        "pending_reward": pending_reward(user, db),
        "collection": [{**x, "count": owned[x["id"]]} for x in PET_FINDS if x["id"] in owned],
        "total_finds": len(PET_FINDS),
        "inventory": [{**item, "quantity": owned[item_id]} for item_id, item in REWARD_ITEMS.items() if item_id in owned],
        "room": {"pet": user.pet, "pet_name": user.pet_name, "equipped_item": user.equipped_item,
                 "items": ROOM_ITEMS},
    }

@router.get("/room")
def get_pet_room(user: User = Depends(current_user)):
    """Return the authenticated user's companion room and the decor catalog."""
    return {"pet": user.pet, "pet_name": user.pet_name, "equipped_item": user.equipped_item,
            "items": ROOM_ITEMS}

@router.put("/room")
def update_pet_room(data: PetRoomUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Equip a room decoration and persist the choice on the user's profile."""
    item = next((entry for entry in ROOM_ITEMS if entry["id"] == data.equipped_item), None)
    if item is None:
        raise APIError(404, "room_item_not_found", "Room item not found")
    user.equipped_item = item["name"]
    db.commit()
    db.refresh(user)
    return {"pet": user.pet, "pet_name": user.pet_name, "equipped_item": user.equipped_item,
            "items": ROOM_ITEMS}


# Retain the original room URLs while the mobile client migrates to /api/pet/room.
@legacy_room_router.get("/items", include_in_schema=False)
def legacy_room_items():
    return ROOM_ITEMS


@legacy_room_router.post("/equip", include_in_schema=False)
def legacy_equip_item(item_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = next((entry for entry in ROOM_ITEMS if entry["id"] == item_id), None)
    if item is None:
        raise APIError(404, "room_item_not_found", "Room item not found")
    user.equipped_item = item["name"]
    db.commit()
    return {"equipped_item": user.equipped_item}

@router.get("/space")
def get_space(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return pet_space(user, db)

@router.post("/walk")
def start_walk(user: User = Depends(current_user), db: Session = Depends(get_db)):
    walk = maybe_start_walk(user, db)
    status = walk_status(walk, today_goals(user, db))
    if status == "locked":
        raise APIError(409, "quests_incomplete", "Finish today's quests and tasks before the walk")
    if status == "rested":
        raise APIError(409, "already_walked", "The pet already went for a walk today")
    # Kept for older clients; active walks are returned idempotently.
    return pet_space(user, db)

@router.get("/inventory")
def get_inventory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    settle_returned_walks(db, user.id)
    owned = inventory(user, db)
    return [{**item, "quantity": owned[item_id]} for item_id, item in REWARD_ITEMS.items() if item_id in owned]

def _confirm_popup(walk: PetWalk, db: Session) -> bool:
    """Record that the gift popup was seen. Grants nothing: the rewards were added when the walk ended."""
    confirmed = db.execute(update(PetWalk).where(PetWalk.id == walk.id, PetWalk.rewarded_at.is_not(None),
                                                 PetWalk.collected_at.is_(None))
                           .values(collected_at=utcnow()).execution_options(synchronize_session=False))
    db.commit()
    return confirmed.rowcount == 1

@router.post("/walks/{walk_id}/acknowledge")
def acknowledge_walk_rewards(walk_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The "Nhận quà" button. Idempotent: repeated taps, retries and other devices all get the same answer."""
    settle_returned_walks(db, user.id)
    walk = db.scalar(select(PetWalk).where(PetWalk.id == walk_id, PetWalk.user_id == user.id))
    if walk is None:
        raise APIError(404, "walk_not_found", "Walk not found")
    if walk.rewarded_at is None:
        raise APIError(409, "walk_not_returned", "The pet is not back yet")
    rewards = walk_rewards(walk)
    _confirm_popup(walk, db)
    return {"acknowledged": rewards, **pet_space(user, db)}

# Older clients confirm the latest walk here; the find is already in the inventory either way.
@router.post("/walk/collect")
def collect_find(user: User = Depends(current_user), db: Session = Depends(get_db)):
    settle_returned_walks(db, user.id)
    walk = latest_walk(user, db)
    status = walk_status(walk, [])
    if status == "walking":
        raise APIError(409, "walk_not_returned", "The pet is not back yet")
    if status != "returned" or walk.rewarded_at is None or not _confirm_popup(walk, db):
        raise APIError(409, "nothing_to_collect", "There is no find waiting")
    return {"found": REWARD_ITEMS.get(walk.item_id), **pet_space(user, db)}
