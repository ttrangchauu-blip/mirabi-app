"""Phiêu lưu cuộc sống (Life Adventure): real-life activities that move the pet across an adventure map.

An activity started from the map is an ordinary task (tasks.py) for the chosen day, tagged with its activity code
(`user_tasks.adventure_activity`). It is completed with /api/tasks/{id}/complete like any task: the same capped EXP,
the same walk goals. That is the only way a region progresses, so the backend, not the app, decides progress.

- Progress of a region = completed occurrences of its activities' tasks (removed tasks included: what was done stays
  done), at most REGION_DAILY_COUNT a day, so ticking many copies of an activity can't rush the map.
- Regions unlock in order once the previous one has UNLOCK_AFTER progress; the mountain also needs every other region
  explored a little.
- Milestones give room items (inventory) once (adventure_reward_claims unique per user + milestone, inventory event
  keys). No EXP, so the daily EXP cap is never bypassed.
- This is not the pet's automatic eight-hour walk (companion.py), which is unchanged: the map is the user's own
  journey; the walk is the pet's daily trip.

Regions, activities and milestones are versioned with the code (adding is safe; codes are stored, never rename them).
"""
import json
from collections import Counter, defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import inventory as inv
from . import items_catalog as cat
from . import tasks as task_api
from .companion import lock_daily_goals
from .db import get_db
from .errors import APIError
from .life_access import life_user
from .models import AdventureRewardClaim, User, UserTask, UserTaskCompletion, as_utc, utcnow
from .schemas import AdventureStart

router = APIRouter(prefix="/api/adventure", tags=["adventure"])

REGION_DAILY_COUNT = 3
UNLOCK_AFTER = 3

REGIONS = [
    {"code": "green_valley", "name": "Thung lũng Xanh", "theme": "Sức khỏe", "emoji": "🌿",
     "description": "Đồng cỏ đầy gió, nơi mỗi bước chân giúp cơ thể khỏe hơn.",
     "activities": [("walk_20", "Đi bộ 20 phút", "health", "🚶"), ("stretch", "Giãn cơ 10 phút", "health", "🤸"),
                    ("water_goal", "Uống đủ nước theo mục tiêu", "health", "💧"), ("exercise_30", "Tập thể dục 30 phút", "health", "🏃")],
     "milestones": [(3, [("seed_daisy", 2)]), (7, [("cactus_mini", 1)]), (12, [("bonsai", 1)])]},
    {"code": "cozy_village", "name": "Làng Ấm Áp", "theme": "Gia đình & cuộc sống", "emoji": "🏡",
     "description": "Những mái nhà nhỏ ấm cúng, nơi việc nhà hóa thành niềm vui.",
     "activities": [("tidy_room", "Dọn dẹp phòng", "habit", "🧹"), ("cook_meal", "Nấu một món ăn", "personal", "🍳"),
                    ("call_family", "Gọi điện cho gia đình", "personal", "📞"), ("meet_friends", "Gặp gỡ bạn bè", "personal", "🤝")],
     "milestones": [(3, [("seat_cushion", 1)]), (7, [("tea_table", 1)]), (12, [("woven_basket", 1), ("knit_rug_round", 1)])]},
    {"code": "knowledge_forest", "name": "Rừng Tri Thức", "theme": "Đọc sách & phát triển bản thân", "emoji": "📚",
     "description": "Khu rừng cổ thụ thì thầm những câu chuyện hay.",
     "activities": [("read_20", "Đọc sách 20 phút", "study", "📖"), ("learn_new", "Học một điều mới", "study", "💡"),
                    ("online_lesson", "Học một bài online", "study", "💻"), ("write_ideas", "Ghi lại ý tưởng", "personal", "✍️")],
     "milestones": [(3, [("story_book", 1)]), (7, [("mini_bookshelf", 1)]), (12, [("desk_globe", 1)])]},
    {"code": "dream_lake", "name": "Hồ Mộng Mơ", "theme": "Nghỉ ngơi & chăm sóc bản thân", "emoji": "🌙",
     "description": "Mặt hồ phẳng lặng phản chiếu ánh trăng dịu dàng.",
     "activities": [("sleep_on_time", "Ngủ đúng giờ", "health", "😴"), ("meditate", "Thiền 10 phút", "health", "🧘"),
                    ("screen_break", "Một giờ không màn hình", "habit", "📵"), ("self_care", "Dành thời gian cho bản thân", "personal", "🛁")],
     "milestones": [(3, [("star_pillow", 1)]), (7, [("small_blanket", 1)]), (12, [("moon_lantern", 1)])]},
    {"code": "adventure_mountain", "name": "Núi Phiêu Lưu", "theme": "Thử thách dài hạn", "emoji": "⛰️",
     "description": "Đỉnh núi cao dành cho những thử thách lớn của bạn.",
     "activities": [("personal_goal", "Hoàn thành một mục tiêu cá nhân", "personal", "🏆"), ("new_hobby", "Thử một sở thích mới", "personal", "🎨"),
                    ("run_5k", "Chạy bộ 5 km", "health", "🏅"), ("kind_act", "Làm một việc tốt", "personal", "💝")],
     "milestones": [(3, [("snow_globe", 1)]), (7, [("framed_painting", 1)]), (12, [("mini_statue", 1)])]},
]
REGION_BY_CODE = {r["code"]: r for r in REGIONS}
ACTIVITIES = {code: {"code": code, "name": name, "category": category, "emoji": emoji, "region": r["code"]}
              for r in REGIONS for code, name, category, emoji in r["activities"]}
MILESTONES = {f"{r['code']}:{need}": {"code": f"{r['code']}:{need}", "region": r["code"], "required": need, "rewards": rewards}
              for r in REGIONS for need, rewards in r["milestones"]}


def region_progress(db: Session, user: User) -> dict[str, int]:
    """Counted completions per region (at most REGION_DAILY_COUNT a day each)."""
    rows = db.execute(select(UserTask.adventure_activity, UserTaskCompletion.completed_at)
                      .join(UserTaskCompletion, UserTaskCompletion.task_id == UserTask.id)
                      .where(UserTask.user_id == user.id, UserTask.adventure_activity.is_not(None))).all()
    per_day: Counter = Counter()
    for activity, at in rows:
        if activity in ACTIVITIES:
            per_day[(ACTIVITIES[activity]["region"], as_utc(at).date())] += 1
    out: dict[str, int] = defaultdict(int)
    for (region, _), n in per_day.items():
        out[region] += min(REGION_DAILY_COUNT, n)
    return {r["code"]: out[r["code"]] for r in REGIONS}


def unlocked(progress: dict[str, int]) -> dict[str, bool]:
    """Each region opens after UNLOCK_AFTER in the one before it; the mountain also needs a step in every region."""
    out = {}
    for i, region in enumerate(REGIONS):
        if i == 0:
            out[region["code"]] = True
        elif region["code"] == "adventure_mountain":
            out[region["code"]] = progress[REGIONS[i - 1]["code"]] >= UNLOCK_AFTER and all(progress[r["code"]] >= 1 for r in REGIONS[:i])
        else:
            out[region["code"]] = progress[REGIONS[i - 1]["code"]] >= UNLOCK_AFTER
    return out


def unlock_hint(code: str) -> str | None:
    i = next(i for i, r in enumerate(REGIONS) if r["code"] == code)
    if i == 0:
        return None
    previous = REGIONS[i - 1]["name"]
    if code == "adventure_mountain":
        return f"Hoàn thành {UNLOCK_AFTER} hoạt động ở {previous} và ít nhất 1 hoạt động ở mỗi vùng"
    return f"Hoàn thành {UNLOCK_AFTER} hoạt động ở {previous}"


def rewards_view(rewards) -> list[dict]:
    return [{**inv.item_meta(item_id), "quantity": qty} for item_id, qty in rewards]


def region_view(code: str, progress: dict[str, int], open_: dict[str, bool], claimed: set[str], today_tasks: list[dict]) -> dict:
    region = REGION_BY_CODE[code]
    milestones = []
    for need, rewards in region["milestones"]:
        key = f"{code}:{need}"
        milestones.append({"code": key, "required": need, "rewards": rewards_view(rewards),
                           "status": "claimed" if key in claimed else "ready" if progress[code] >= need else "locked"})
    return {"code": code, "name": region["name"], "theme": region["theme"], "emoji": region["emoji"],
            "description": region["description"], "progress": progress[code], "unlocked": open_[code],
            "unlock_hint": None if open_[code] else unlock_hint(code),
            "next_milestone": next((m["required"] for m in milestones if m["status"] == "locked"), None),
            "milestones": milestones,
            "activities": [{"code": c, "name": ACTIVITIES[c]["name"], "emoji": ACTIVITIES[c]["emoji"]} for c, *_ in region["activities"]],
            "tasks_today": [t for t in today_tasks if ACTIVITIES.get(t.get("adventure_activity") or "", {}).get("region") == code]}


def adventure_tasks(db: Session, user: User, day: date) -> list[dict]:
    """The day's tasks started from the map, with their activity."""
    occurrences = task_api.scheduled_occurrences(user, day, day, db)
    activity_of = {t.id: t.adventure_activity for t in task_api.active_tasks(db, user.id, UserTask.adventure_activity.is_not(None))}
    return [{**o, "adventure_activity": activity_of[o["id"]]} for o in occurrences if o["id"] in activity_of]


def map_view(db: Session, user: User, day: date) -> dict:
    progress = region_progress(db, user)
    open_ = unlocked(progress)
    claimed = set(db.scalars(select(AdventureRewardClaim.milestone).where(AdventureRewardClaim.user_id == user.id)))
    today = adventure_tasks(db, user, day)
    regions = [region_view(r["code"], progress, open_, claimed, today) for r in REGIONS]
    # The pet stands in the furthest open region.
    here = [r["code"] for r in regions if r["unlocked"]][-1]
    return {"day": day.isoformat(), "regions": regions, "pet_region": here, "total_progress": sum(progress.values()),
            "daily_count_limit": REGION_DAILY_COUNT}


@router.get("/map")
def get_map(day: date | None = Query(default=None), user: User = Depends(life_user), db: Session = Depends(get_db)):
    return map_view(db, user, day or utcnow().date())


@router.get("/regions/{code}")
def get_region(code: str, day: date | None = Query(default=None), user: User = Depends(life_user), db: Session = Depends(get_db)):
    if code not in REGION_BY_CODE:
        raise APIError(404, "region_not_found", "Region not found")
    return next(r for r in map_view(db, user, day or utcnow().date())["regions"] if r["code"] == code)


@router.get("/progress")
def get_progress(user: User = Depends(life_user), db: Session = Depends(get_db)):
    progress = region_progress(db, user)
    open_ = unlocked(progress)
    return [{"code": c, "progress": n, "unlocked": open_[c]} for c, n in progress.items()]


@router.post("/activities/{code}/start", status_code=201)
def start_activity(code: str, data: AdventureStart, user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Take on an activity for a day: a task the user completes once it's done in real life. Starting the same
    activity again for the same day returns the task already there."""
    activity = ACTIVITIES.get(code)
    if activity is None:
        raise APIError(404, "activity_not_found", "Activity not found")
    today = utcnow().date()
    # The device's day may be a day off UTC either way; further back or more than a week ahead is refused.
    if not today - timedelta(days=1) <= data.scheduled_date <= today + timedelta(days=7):
        raise APIError(422, "invalid_day", "Pick today or a day in the coming week")
    if not unlocked(region_progress(db, user))[activity["region"]]:
        raise APIError(409, "region_locked", "This region isn't open yet")
    existing = db.scalar(select(UserTask).where(UserTask.user_id == user.id, UserTask.adventure_activity == code,
                                                UserTask.archived_at.is_(None), UserTask.repeat == "none",
                                                UserTask.scheduled_date == data.scheduled_date))
    if existing is None:
        # Like any new task: it joins the day's walk goals unless the walk has already started (same lock).
        lock_daily_goals(db, user.id)
        existing = UserTask(user_id=user.id, title=activity["name"], category=activity["category"], difficulty="medium",
                            scheduled_date=data.scheduled_date, repeat="none", all_day=True, repeat_weekdays="[]",
                            priority="medium", adventure_activity=code)
        db.add(existing)
        db.commit()
        db.refresh(existing)
    return {**task_api.task_detail(db, existing, data.scheduled_date), "adventure_activity": code, "region": activity["region"]}


@router.post("/rewards/{milestone}/claim")
def claim_milestone(milestone: str, day: date | None = Query(default=None), user: User = Depends(life_user),
                    db: Session = Depends(get_db)):
    """Take a reached milestone's items, once (a retry or another device gets `already_claimed`)."""
    entry = MILESTONES.get(milestone)
    if entry is None:
        raise APIError(404, "milestone_not_found", "Milestone not found")
    # Claims of one user happen one after the other (the per-user lock the walk and the inventory take), so a double tap
    # never reads "not claimed" twice.
    lock_daily_goals(db, user.id)
    already = db.scalar(select(AdventureRewardClaim.id).where(AdventureRewardClaim.user_id == user.id,
                                                              AdventureRewardClaim.milestone == milestone)) is not None
    if already:
        db.commit()
    else:
        if region_progress(db, user)[entry["region"]] < entry["required"]:
            raise APIError(409, "milestone_locked", "Do more activities in this region first")
        now = utcnow()
        try:
            with db.begin_nested():
                granted = []
                for item_id, qty in entry["rewards"]:
                    variant = inv.variants_of(item_id)[0]
                    inv.grant(db, user.id, item_id, variant, qty, kind="adventure", ref=f"adventure:{entry['region']}",
                              event_key=f"adventure:{milestone}:{item_id}", at=now)
                    granted.append({"item_id": item_id, "variant": variant, "quantity": qty})
                db.add(AdventureRewardClaim(user_id=user.id, milestone=milestone, rewards=json.dumps(granted), claimed_at=now))
                db.flush()
            db.commit()
        except IntegrityError:
            db.rollback()
            already = True
    view = map_view(db, user, day or utcnow().date())
    region = next(r for r in view["regions"] if r["code"] == entry["region"])
    return {"milestone": next(m for m in region["milestones"] if m["code"] == milestone), "already_claimed": already,
            "rewards": rewards_view(entry["rewards"]), "map": view}


@router.get("/history")
def history(days: int = Query(default=30, ge=1, le=365), user: User = Depends(life_user), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=days)
    rows = db.execute(select(UserTask.adventure_activity, UserTask.title, UserTaskCompletion.occurrence_date,
                             UserTaskCompletion.completed_at)
                      .join(UserTaskCompletion, UserTaskCompletion.task_id == UserTask.id)
                      .where(UserTask.user_id == user.id, UserTask.adventure_activity.is_not(None),
                             UserTaskCompletion.completed_at >= since)
                      .order_by(UserTaskCompletion.completed_at.desc()).limit(100)).all()
    return [{"activity": a, "title": title, "region": ACTIVITIES.get(a, {}).get("region"), "emoji": ACTIVITIES.get(a, {}).get("emoji"),
             "occurrence_date": d.isoformat(), "completed_at": as_utc(at).isoformat()} for a, title, d, at in rows]


def _check() -> None:
    """Rewards must be catalog items and activity codes unique (checked at import: a mistake fails the tests)."""
    codes = [c for r in REGIONS for c, *_ in r["activities"]]
    assert len(codes) == len(set(codes)), "Duplicate adventure activity"
    for m in MILESTONES.values():
        for item_id, _ in m["rewards"]:
            assert item_id in cat.ITEMS, f"Unknown adventure reward {item_id}"


_check()
