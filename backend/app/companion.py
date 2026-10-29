"""Daily quests and the companion's daily walk (Pet Adventure).

When every goal of the (UTC) day is done, the pet automatically starts one eight-hour walk. Today's goals are the
daily quests plus the user's own tasks scheduled for today (the Home "Nhiệm vụ hằng ngày" card): a task added before
the walk starts must be done too; once the walk has started, nothing added later changes it or starts another one
that day. The check reads the database under a per-user lock that adding a task also takes, so the two never
interleave.
Each walk goes to a place (items_catalog.LOCATIONS). When it ends, the backend rolls and grants its rewards exactly
once, even if the app is closed: one main item, and maybe a bonus of seeds or materials, into the inventory
(inventory.py). The roll is kept (walk_rewards), so a retry never gives something else. The app then shows the pet
coming back with its gift bag until the user closes it ("Đóng" or "Xem kho đồ"), which only records that it was seen.

Hatching and walking never overlap. An egg with the EXP to hatch waits ("chờ nở") until the app has shown the hatch and
the user closed its congratulations (POST /api/pet/hatch). While it waits at home the walk doesn't start, even with every
goal done ("waiting_hatch"); the hatch then re-checks today's goals and starts the walk, timed from that moment. An egg
that gets there during a walk stays an egg until the pet is back and its gift popup is confirmed.
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
from . import inventory as inv
from . import items_catalog as cat
from .models import Activity, CommunityPost, ExpEvent, PetEvolution, PetWalk, StudySession, User, WalkReward, as_utc, utcnow
from .schemas import PetRoomUpdate
from .security import current_user
from .progression import awaiting_hatch, award_exp, daily_exp_remaining, hatch, level_for_exp, SYSTEM_TASK_EXP
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
# Walks started before the catalog picked one gift when they started (pet_walks.item_id): ADVENTURE_EXP, or one of
# REWARD_ITEMS; they still bring back exactly that. Walks since then store CATALOG_GIFT there and roll their rewards
# from the catalog when they end (roll_rewards).
EXP_GIFT = "exp"  # pet_walks.item_id when the walk's gift is EXP
CATALOG_GIFT = "catalog"  # pet_walks.item_id of a walk whose rewards come from items_catalog
ADVENTURE_EXP = 30
# What the app shows for an item it has no picture for.
GROUP_EMOJI = {"seed": "🌱", "plant": "🪴", "study": "📚", "toy": "🧸", "furniture": "🪑", "decor": "🖼️",
               "fabric": "🧶", "material": "🪵", "element": "✨", "keepsake": "🐚"}
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

def walk_status(walk: PetWalk | None, goals: list[dict], egg_waiting: bool = False) -> str:
    """locked -> ready -> walking -> returned -> rested (until tomorrow). `goals` only matter before the day's walk:
    an empty list never makes it ready. With every goal done, an egg waiting to hatch (`egg_waiting`) holds the walk
    back: "waiting_hatch" until it has hatched."""
    if walk and walk.collected_at is None:
        return "walking" if as_utc(walk.returns_at) > utcnow() else "returned"
    if walk and as_utc(walk.started_at) >= day_start():
        return "rested"
    if not (goals and all(g["progress"] >= g["target"] for g in goals)):
        return "locked"
    return "waiting_hatch" if egg_waiting else "ready"

def pet_progress(user: User, db: Session, fresh: bool = False) -> PetEvolution | None:
    """The active pet's evolution row, read without creating it (none before adoption). `fresh` re-reads it from the
    database, for decisions taken under lock_daily_goals."""
    if user.pet_name is None:
        return None
    query = select(PetEvolution).where(PetEvolution.user_id == user.id, PetEvolution.pet_id == user.pet)
    return db.scalar(query.execution_options(populate_existing=True) if fresh else query)

def current_walk_status(user: User, db: Session, walk: PetWalk | None) -> str:
    return walk_status(walk, today_goals(user, db), awaiting_hatch(pet_progress(user, db)))

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
    if current_walk_status(user, db, current) != "ready":
        return current
    # Looks ready: decide again from the latest data, under the lock a new task and a hatch also take. A task added a
    # moment ago, an egg that just reached its hatching EXP (or a walk started by another request or device) is seen here.
    lock_daily_goals(db, user.id)
    current = db.scalar(select(PetWalk).where(PetWalk.user_id == user.id).order_by(PetWalk.id.desc()).limit(1)
                        .execution_options(populate_existing=True))
    if walk_status(current, today_goals(user, db), awaiting_hatch(pet_progress(user, db, fresh=True))) != "ready":
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
    walk = PetWalk(user_id=user.id, item_id=CATALOG_GIFT, location_id=pick_location(), started_at=now,
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

def pick_location(rng: random.Random | None = None) -> str:
    """Where the walk goes, chosen when it starts (shown once the pet is back)."""
    return (rng or random.Random()).choice(sorted(cat.LOCATIONS))


def walk_location(walk: PetWalk) -> str:
    """The walk's place; a walk from before places existed is read as one, the same one every time."""
    return walk.location_id if walk.location_id in cat.LOCATIONS else sorted(cat.LOCATIONS)[walk.id % len(cat.LOCATIONS)]


def roll_rewards(walk: PetWalk) -> list[dict]:
    """What the walk brings back: [{slot, item_id, variant, quantity}]. Seeded by the walk, so rolling it again gives
    the same; it is also stored when granted (walk_rewards). A walk from before the catalog brings its one gift."""
    if walk.item_id == EXP_GIFT:
        return []
    if walk.item_id != CATALOG_GIFT:
        return [{"slot": "main", "item_id": walk.item_id, "variant": "default", "quantity": 1}] if walk.item_id in cat.ITEMS else []
    rng = random.Random(f"walk:{walk.id}")
    location = walk_location(walk)
    rarity = rng.choices(list(cat.MAIN_ODDS), weights=list(cat.MAIN_ODDS.values()))[0]
    main = rng.choice(cat.pool(location, rarity))
    out = [{"slot": "main", "item_id": main, "variant": rng.choice(inv.variants_of(main)), "quantity": 1}]
    if rng.random() < cat.BONUS_CHANCE:
        bonus = rng.choice(cat.LOCATIONS[location]["bonus"])
        out.append({"slot": "bonus", "item_id": bonus, "variant": rng.choice(inv.variants_of(bonus)),
                    "quantity": rng.randint(*cat.BONUS_QUANTITY)})
    return out


def keepsake_memory(db: Session, user: User, walk: PetWalk, item_id: str, location: str):
    """A keepsake goes into the album with the walk it came from. Shown in the gift popup, so no "new memory" notice."""
    from .memories import record_event
    name, place = cat.ITEMS[item_id]["name"], cat.LOCATIONS[location]["name"]
    row = record_event(db, user, "walk_keepsake", f"keepsake:walk:{walk.id}", at=as_utc(walk.returns_at),
                       title=f"{name} từ {place}", result=f"{user.pet_name or 'Pet'} mang về {name} từ {place}")
    if row is not None:
        row.notified_at = utcnow()
    return row


def grant_rewards(db: Session, walk: PetWalk, user: User, now: datetime) -> list[dict]:
    """Add the walk's rolled rewards to the inventory once and keep the roll. Inside the caller's transaction."""
    location = walk_location(walk)
    stored = {r.slot: r for r in db.scalars(select(WalkReward).where(WalkReward.walk_id == walk.id))}
    granted = []
    for entry in roll_rewards(walk):
        reward = stored.get(entry["slot"])
        if reward is None:
            first = inv.grant(db, user.id, entry["item_id"], entry["variant"], entry["quantity"], kind="walk_reward",
                              ref=f"walk:{walk.id}", event_key=f"walk:{walk.id}:{entry['slot']}", at=now)
            reward = WalkReward(walk_id=walk.id, user_id=user.id, slot=entry["slot"], item_id=entry["item_id"],
                                variant=entry["variant"], quantity=entry["quantity"], location_id=location,
                                first_time=bool(first), created_at=now)
            if cat.ITEMS[entry["item_id"]]["group"] == "keepsake":
                memory = keepsake_memory(db, user, walk, entry["item_id"], location)
                reward.memory_id = memory.id if memory is not None else None
            db.add(reward)
            db.flush()
        granted.append({"slot": reward.slot, "item_id": reward.item_id, "variant": reward.variant, "quantity": reward.quantity})
    return granted


def settle_walk(db: Session, walk_id: int, now: datetime | None = None) -> bool:
    """Grant a finished walk's rewards in one transaction. False if it isn't back or was already granted."""
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
        inv.migrate_legacy(db, user.id)  # so "Mới" is decided against everything the user had
        walk.reward_exp = award_exp(user, db, source="pet_adventure", reference_id=f"walk:{walk.id}",
                                    requested=ADVENTURE_EXP, daily_cap=UNLIMITED_ADVENTURE_EXP_CAP) \
            if walk.item_id == EXP_GIFT else 0
        walk.location_id = walk_location(walk)
        walk.rewards = json.dumps(grant_rewards(db, walk, user, now))
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

def reward_item(item_id: str, variant: str, quantity: int, slot: str, first_time: bool) -> dict:
    item = cat.ITEMS[item_id]
    legacy = REWARD_ITEMS.get(item_id, {})
    return {**inv.item_meta(item_id), "variant": variant, "quantity": quantity, "slot": slot, "is_new": first_time,
            "emoji": legacy.get("emoji", GROUP_EMOJI[item["group"]]), "kind": legacy.get("kind", item["group"])}

def walk_rewards(db: Session, walk: PetWalk) -> dict:
    """What the walk brought back, as the app shows it when the pet is back."""
    rows = sorted(db.scalars(select(WalkReward).where(WalkReward.walk_id == walk.id)), key=lambda r: r.slot != "main")
    if rows:
        items = [reward_item(r.item_id, r.variant, r.quantity, r.slot, r.first_time) for r in rows if r.item_id in cat.ITEMS]
    else:  # granted before rolls were stored
        items = [reward_item(e["item_id"], e.get("variant", "default"), e["quantity"], e.get("slot", "main"), False)
                 for e in json.loads(walk.rewards or "[]") if e.get("item_id") in cat.ITEMS]
    return {"walk_id": walk.id, "returned_at": as_utc(walk.returns_at).isoformat(), "exp": walk.reward_exp,
            "location": inv.location_view(walk_location(walk)), "items": items}

def pending_reward(user: User, db: Session) -> dict | None:
    """The oldest granted walk whose gift popup the user hasn't confirmed yet."""
    walk = db.scalar(select(PetWalk).where(PetWalk.user_id == user.id, PetWalk.rewarded_at.is_not(None),
                                           PetWalk.collected_at.is_(None)).order_by(PetWalk.id).limit(1))
    return walk_rewards(db, walk) if walk else None

def inventory(user: User, db: Session) -> dict[str, int]:
    """Quantity owned per item (every variant together)."""
    return inv.totals(db, user.id)

def last_find(db: Session, walk: PetWalk) -> dict | None:
    reward = db.scalar(select(WalkReward).where(WalkReward.walk_id == walk.id, WalkReward.slot == "main"))
    item_id = reward.item_id if reward else walk.item_id
    if item_id not in cat.ITEMS:
        return None
    return {"id": item_id, "name": cat.ITEMS[item_id]["name"], "rarity": cat.ITEMS[item_id]["rarity"],
            "emoji": REWARD_ITEMS.get(item_id, {}).get("emoji", GROUP_EMOJI[cat.ITEMS[item_id]["group"]])}

def hatch_view(progress: PetEvolution | None, status: str) -> dict:
    """"ready": the app plays the hatch now, then confirms it. "waiting_return": the egg has the EXP but the pet is out
    (or its gift popup is still open), so it hatches afterwards. "none": nothing to hatch. `level` is the pet's level
    once hatched."""
    if not awaiting_hatch(progress):
        return {"status": "none", "level": None}
    return {"status": "waiting_return" if status in ("walking", "returned") else "ready",
            "level": level_for_exp(progress.total_xp)}

def pet_space(user: User, db: Session) -> dict:
    settle_returned_walks(db, user.id)
    inv.migrate_legacy(db, user.id)
    db.commit()
    walk = maybe_start_walk(user, db)
    quests = daily_quests(user, db)
    status = current_walk_status(user, db, walk)
    server_now = utcnow()
    owned = inventory(user, db)
    return {
        "status": status,
        "hatch": hatch_view(pet_progress(user, db), status),
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
        "last_find": last_find(db, walk) if status == "rested" else None,
        # Already granted; shown in the gift popup until the user confirms it.
        "pending_reward": pending_reward(user, db),
        "collection": [{**x, "count": owned[x["id"]]} for x in PET_FINDS if x["id"] in owned],
        "total_finds": len(PET_FINDS),
        "inventory": inv.inventory_view(db, user.id),
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
    status = current_walk_status(user, db, walk)
    if status == "locked":
        raise APIError(409, "quests_incomplete", "Finish today's quests and tasks before the walk")
    if status == "waiting_hatch":
        raise APIError(409, "hatch_first", "The egg hatches before the walk")
    if status == "rested":
        raise APIError(409, "already_walked", "The pet already went for a walk today")
    # Kept for older clients; active walks are returned idempotently.
    return pet_space(user, db)

def complete_hatch(user: User, db: Session) -> bool:
    """Hatch the waiting egg, once: True if this call hatched it, False if it had hatched already. Under the lock that
    starting a walk takes, so a walk and a hatch never both go ahead."""
    lock_daily_goals(db, user.id)
    progress = pet_progress(user, db, fresh=True)
    if progress is not None and progress.hatched_at is not None:
        db.commit()  # releases the lock
        return False
    if not awaiting_hatch(progress):
        db.rollback()
        raise APIError(409, "not_ready_to_hatch", "The egg doesn't have enough EXP to hatch")
    walk = db.scalar(select(PetWalk).where(PetWalk.user_id == user.id).order_by(PetWalk.id.desc()).limit(1)
                     .execution_options(populate_existing=True))
    if walk_status(walk, []) in ("walking", "returned"):
        db.rollback()
        raise APIError(409, "pet_away", "The egg hatches once the pet is back and its gift is confirmed")
    now = utcnow()
    # Claiming the hatch first makes it happen once, however many requests race here.
    claimed = db.execute(update(PetEvolution).where(PetEvolution.id == progress.id, PetEvolution.hatched_at.is_(None))
                         .values(hatched_at=now).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        db.rollback()
        return False
    hatch(user, db, progress, now)
    db.commit()
    return True

@router.post("/hatch")
def confirm_hatch(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The hatch was shown and its congratulations closed. Idempotent (retries, reloads, other devices). Today's goals
    are then checked again: with all of them done the walk starts now, timed from this moment."""
    settle_returned_walks(db, user.id)
    hatched = complete_hatch(user, db)
    maybe_start_walk(user, db)
    db.refresh(user)
    return {"hatched": hatched, "pet_level": user.level, "xp": user.xp, **pet_space(user, db)}

@router.get("/inventory")
def get_inventory(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Older clients; the inventory screen reads /api/inventory."""
    inv.refresh(db, user)
    return inv.inventory_view(db, user.id)

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
    rewards = walk_rewards(db, walk)
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
    return {"found": last_find(db, walk), **pet_space(user, db)}
