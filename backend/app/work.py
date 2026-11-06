"""Work Quest: projects, the work dashboard, statistics and the reward chests.

Work Quest is built on the existing tasks (tasks.py): a work task is a task of category "work" or one filed in a
project. Creating, editing, completing and removing tasks, and their steps, all go through /api/tasks, so a work task
earns EXP through the same capped ledger (progression.award_exp, task/learning pool, at most 15 EXP per task) and
joins the day's walk goals like every other task (companion.today_goals). This module adds what tasks didn't have:

- projects: an island each on the project map, built up as its one-time tasks are done;
- the dashboard the Work Quest world draws (today's quests, overdue ones, the next days, projects, chests, the walk);
- statistics per day, week or month;
- reward chests opened at milestones of completed work quests. A chest grants room items once (WorkRewardClaim +
  inventory event keys), never EXP, so it can't push anyone past the daily EXP cap. At most CHEST_DAILY_COUNT
  completions a day count toward the chests, so creating and ticking empty tasks can't rush them.
"""
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import days
from . import inventory as inv
from . import items_catalog as cat
from . import tasks as task_api
from .companion import current_walk_status, latest_walk, lock_daily_goals, today_goals
from .config import settings
from .db import get_db
from .errors import APIError
from .models import User, UserTask, UserTaskCompletion, WorkProject, WorkRewardClaim, as_utc, utcnow
from .progression import daily_exp_remaining
from .schemas import WorkProjectCreate, WorkProjectUpdate
from .life_access import life_user
from .study_statistics import preferences, statistics, valid_timezone

router = APIRouter(prefix="/api/work", tags=["work"])

MAX_ACTIVE_PROJECTS = 30
CHEST_DAILY_COUNT = 10
# The island's build stages (0 = bare island .. 5 = finished, lit up); see build_stage.
BUILD_STAGES = 5
CHESTS = [
    {"code": "first_quest", "name": "Rương khởi đầu", "required": 1, "rewards": [("pocket_notebook", 1)]},
    {"code": "quest_5", "name": "Rương gỗ", "required": 5, "rewards": [("pencil_case", 1)]},
    {"code": "quest_15", "name": "Rương đồng", "required": 15, "rewards": [("note_board", 1)]},
    {"code": "quest_30", "name": "Rương bạc", "required": 30, "rewards": [("desk_globe", 1)]},
    {"code": "quest_60", "name": "Rương vàng", "required": 60, "rewards": [("fairy_lights", 1), ("cuckoo_clock", 1)]},
    {"code": "quest_100", "name": "Rương pha lê", "required": 100, "rewards": [("wind_chime", 1), ("story_book", 1)]},
]
CHEST_BY_CODE = {c["code"]: c for c in CHESTS}


def is_work(task: UserTask) -> bool:
    return task.category == "work" or task.project_id is not None


def work_filter():
    return or_(UserTask.category == "work", UserTask.project_id.is_not(None))


def local_now(db: Session, user: User, tz: str | None) -> datetime:
    zone = valid_timezone(tz or preferences(db, user.id).timezone)
    return utcnow().astimezone(zone)


def owned_project(db: Session, user: User, project_id: int) -> WorkProject:
    project = db.scalar(select(WorkProject).where(WorkProject.id == project_id, WorkProject.user_id == user.id))
    if project is None:
        raise APIError(404, "project_not_found", "Project not found")
    return project


def build_stage(done: int, total: int, status: str) -> int:
    """0..5: how much of the island is built. A finished project is fully built and lit up."""
    if status == "completed":
        return BUILD_STAGES
    if total == 0:
        return 0
    return min(BUILD_STAGES, done * BUILD_STAGES // total)


def project_views(db: Session, user: User, include_archived: bool = False) -> list[dict]:
    query = select(WorkProject).where(WorkProject.user_id == user.id)
    if not include_archived:
        query = query.where(WorkProject.status != "archived")
    projects = list(db.scalars(query.order_by(WorkProject.created_at, WorkProject.id)))
    if not projects:
        return []
    ids = [p.id for p in projects]
    tasks = task_api.active_tasks(db, user.id, UserTask.project_id.in_(ids))
    completions = Counter()
    if tasks:
        for task_id, count in db.execute(select(UserTaskCompletion.task_id, func.count()).where(
                UserTaskCompletion.task_id.in_([t.id for t in tasks])).group_by(UserTaskCompletion.task_id)):
            completions[task_id] = count
    per_project = defaultdict(lambda: {"total": 0, "done": 0, "recurring": 0, "completions": 0})
    for task in tasks:
        entry = per_project[task.project_id]
        entry["completions"] += completions[task.id]
        if task.repeat == "none":
            entry["total"] += 1
            entry["done"] += completions[task.id] > 0
        else:
            entry["recurring"] += 1
    out = []
    for p in projects:
        entry = per_project[p.id]
        out.append({"id": p.id, "name": p.name, "description": p.description, "theme": p.theme, "status": p.status,
                    "tasks_total": entry["total"], "tasks_done": entry["done"], "recurring_tasks": entry["recurring"],
                    "completions": entry["completions"],
                    "progress": 1.0 if p.status == "completed" else (entry["done"] / entry["total"] if entry["total"] else 0.0),
                    "build_stage": build_stage(entry["done"], entry["total"], p.status),
                    # Every one-time task is done: the user can mark the project finished (the island lights up).
                    "ready_to_complete": p.status == "active" and entry["total"] > 0 and entry["done"] == entry["total"],
                    "completed_at": as_utc(p.completed_at).isoformat() if p.completed_at else None,
                    "created_at": as_utc(p.created_at).isoformat()})
    return out


@router.get("/projects")
def list_projects(include_archived: bool = False, user: User = Depends(life_user), db: Session = Depends(get_db)):
    return project_views(db, user, include_archived)


@router.post("/projects", status_code=201)
def create_project(data: WorkProjectCreate, user: User = Depends(life_user), db: Session = Depends(get_db)):
    active = db.scalar(select(func.count()).select_from(WorkProject).where(
        WorkProject.user_id == user.id, WorkProject.status == "active")) or 0
    if active >= MAX_ACTIVE_PROJECTS:
        raise APIError(409, "too_many_projects", f"At most {MAX_ACTIVE_PROJECTS} active projects")
    project = WorkProject(user_id=user.id, name=data.name, description=data.description, theme=data.theme)
    db.add(project)
    db.commit()
    return next(p for p in project_views(db, user) if p["id"] == project.id)


@router.patch("/projects/{project_id}")
def update_project(project_id: int, data: WorkProjectUpdate, user: User = Depends(life_user),
                   db: Session = Depends(get_db)):
    project = owned_project(db, user, project_id)
    fields = data.model_fields_set
    if "name" in fields and data.name is None:
        raise APIError(422, "field_required", "name cannot be empty")
    for name in ("name", "description", "theme"):
        if name in fields and (name == "description" or getattr(data, name) is not None):
            setattr(project, name, getattr(data, name))
    if data.status is not None and data.status != project.status:
        if data.status == "active" and project.status == "archived":
            active = db.scalar(select(func.count()).select_from(WorkProject).where(
                WorkProject.user_id == user.id, WorkProject.status == "active")) or 0
            if active >= MAX_ACTIVE_PROJECTS:
                raise APIError(409, "too_many_projects", f"At most {MAX_ACTIVE_PROJECTS} active projects")
        project.status = data.status
        project.completed_at = utcnow() if data.status == "completed" else None
    project.updated_at = utcnow()
    db.commit()
    return next(p for p in project_views(db, user, include_archived=True) if p["id"] == project.id)


def overdue_tasks(db: Session, user: User, today: date, now: datetime) -> list[dict]:
    """One-time work tasks not done whose day has passed, or whose deadline has."""
    candidates = [t for t in task_api.active_tasks(db, user.id, UserTask.repeat == "none", work_filter())
                  if t.scheduled_date < today or (t.due_at is not None and as_utc(t.due_at) < now)]
    if not candidates:
        return []
    done = set(db.scalars(select(UserTaskCompletion.task_id).where(
        UserTaskCompletion.task_id.in_([t.id for t in candidates]))))
    late = [t for t in candidates if t.id not in done]
    late.sort(key=lambda t: (as_utc(t.due_at) if t.due_at else datetime.combine(t.scheduled_date, datetime.min.time(), now.tzinfo)))
    views = []
    for task in late[:20]:
        views.append({**task_api.task_detail(db, task, task.scheduled_date), "overdue": True})
    return views


def counted_completions(db: Session, user: User) -> int:
    """Completed work quests toward the chests: every completion ever (removed tasks included), at most
    CHEST_DAILY_COUNT per day of the server's calendar (days.py)."""
    rows = db.execute(select(UserTaskCompletion.completed_at).join(UserTask, UserTask.id == UserTaskCompletion.task_id)
                      .where(UserTask.user_id == user.id, work_filter())).all()
    per_day = Counter(days.today(as_utc(at)) for (at,) in rows)
    return sum(min(CHEST_DAILY_COUNT, n) for n in per_day.values())


def chest_views(db: Session, user: User) -> list[dict]:
    progress = counted_completions(db, user)
    claimed = {row.chest: row for row in db.scalars(select(WorkRewardClaim).where(WorkRewardClaim.user_id == user.id))}
    out = []
    for chest in CHESTS:
        claim = claimed.get(chest["code"])
        out.append({"code": chest["code"], "name": chest["name"], "required": chest["required"],
                    "progress": min(progress, chest["required"]),
                    "status": "opened" if claim else "ready" if progress >= chest["required"] else "locked",
                    "opened_at": as_utc(claim.claimed_at).isoformat() if claim else None,
                    "rewards": [{**inv.item_meta(item), "quantity": qty} for item, qty in chest["rewards"]]})
    return out


def pet_line(done: int, total: int, overdue: int, walk: str) -> str:
    if walk == "walking":
        return "Mình đang đi khám phá, bạn cứ tập trung nhé!"
    if total == 0:
        return "Hôm nay mình lên kế hoạch cùng nhau nhé?"
    if done >= total:
        return "Xong hết nhiệm vụ rồi! Bạn giỏi quá!"
    if overdue:
        return "Có vài việc đang chờ, mình làm từng việc nhỏ thôi nhé."
    if done == 0:
        return "Bắt đầu với việc nhỏ nhất trước nhé!"
    return f"Còn {total - done} nhiệm vụ nữa thôi, cố lên!"


@router.get("/dashboard")
def dashboard(tz: str | None = Query(default=None, max_length=80), user: User = Depends(life_user),
              db: Session = Depends(get_db)):
    """Everything the Work Quest world draws, in one read."""
    now = local_now(db, user, tz)
    today = now.date()
    occurrences = task_api.scheduled_occurrences(user, today, today + timedelta(days=6), db)
    work_ids = {t.id for t in task_api.active_tasks(db, user.id, work_filter())}
    work = [o for o in occurrences if o["id"] in work_ids]
    today_iso = today.isoformat()
    todays = [o for o in work if o["scheduled_date"] == today_iso]
    # Occurrences come task by task: the nearest ones first, or one daily task would fill the list.
    upcoming = sorted((o for o in work if o["scheduled_date"] != today_iso and not o["completed"]),
                      key=lambda o: o["scheduled_date"])[:20]
    overdue = overdue_tasks(db, user, today, now)
    goals = today_goals(user, db)
    walk = current_walk_status(user, db, latest_walk(user, db))
    done = sum(1 for o in todays if o["completed"])
    study = statistics(db, user.id)
    db.commit()  # preferences() may have created the user's settings row
    return {
        "today": today_iso,
        "tasks_today": todays,
        "overdue": overdue,
        "upcoming": upcoming,
        "projects": project_views(db, user),
        "chests": chest_views(db, user),
        "summary": {"today_total": len(todays), "today_done": done,
                    "focus_minutes_today": study["today_seconds"] // 60,
                    "exp_remaining_today": daily_exp_remaining(user, db, source="task", daily_cap=settings.task_daily_exp_cap)},
        # The pet explores once every goal of the day (daily quests and all of today's tasks, work or not) is done.
        "walk": {"status": walk, "goals_total": len(goals), "goals_done": sum(1 for g in goals if g["progress"] >= g["target"])},
        "pet_line": pet_line(done, len(todays), len(overdue), walk),
    }


@router.get("/statistics")
def work_statistics(period: Literal["day", "week", "month"] = "week", tz: str | None = Query(default=None, max_length=80),
                    user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Completed work quests per local day of the period, on time vs late, by priority and by project."""
    now = local_now(db, user, tz)
    zone = now.tzinfo
    today = now.date()
    start = {"day": today, "week": today - timedelta(days=today.weekday()), "month": today.replace(day=1)}[period]
    rows = db.execute(select(UserTaskCompletion.completed_at, UserTask.priority, UserTask.project_id, UserTask.due_at)
                      .join(UserTask, UserTask.id == UserTaskCompletion.task_id)
                      .where(UserTask.user_id == user.id, work_filter(),
                                                          # Stored as UTC: compare in UTC (a day early, the exact local days are picked below).
                             UserTaskCompletion.completed_at >= datetime.combine(start - timedelta(days=1), datetime.min.time(), zone)
                             .astimezone(timezone.utc))).all()
    per_day = Counter()
    priorities = Counter()
    projects = Counter()
    on_time = late = 0
    for completed_at, priority, project_id, due_at in rows:
        local = as_utc(completed_at).astimezone(zone)
        if not (start <= local.date() <= today):
            continue
        per_day[local.date()] += 1
        priorities[priority or "medium"] += 1
        if project_id is not None:
            projects[project_id] += 1
        if due_at is not None:
            if as_utc(completed_at) <= as_utc(due_at):
                on_time += 1
            else:
                late += 1
    days = [(start + timedelta(days=i)) for i in range((today - start).days + 1)]
    names = {p.id: p.name for p in db.scalars(select(WorkProject).where(WorkProject.user_id == user.id))}
    db.commit()
    return {"period": period, "start": start.isoformat(), "end": today.isoformat(),
            "completed": sum(per_day.values()),
            "days": [{"date": d.isoformat(), "completed": per_day[d]} for d in days],
            "on_time": on_time, "late": late,
            "by_priority": {p: priorities[p] for p in ("low", "medium", "high", "urgent")},
            "by_project": [{"project_id": pid, "name": names.get(pid, ""), "completed": n} for pid, n in projects.most_common()],
            "best_day": max(per_day, key=per_day.get).isoformat() if per_day else None}


@router.get("/rewards")
def list_rewards(user: User = Depends(life_user), db: Session = Depends(get_db)):
    return {"progress": counted_completions(db, user), "daily_count_limit": CHEST_DAILY_COUNT, "chests": chest_views(db, user)}


@router.post("/rewards/{code}/claim")
def claim_reward(code: str, user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Open a chest that is ready. Idempotent: a retry, a double tap or another device gets the same chest back."""
    chest = CHEST_BY_CODE.get(code)
    if chest is None:
        raise APIError(404, "chest_not_found", "Chest not found")
    # One user's chest openings happen one after the other (the per-user lock the walk and the inventory take).
    lock_daily_goals(db, user.id)
    existing = db.scalar(select(WorkRewardClaim).where(WorkRewardClaim.user_id == user.id, WorkRewardClaim.chest == code))
    if existing is not None:
        db.commit()
    if existing is None:
        if counted_completions(db, user) < chest["required"]:
            raise APIError(409, "chest_locked", "Complete more work quests to open this chest")
        now = utcnow()
        granted = []
        try:
            with db.begin_nested():
                db.add(WorkRewardClaim(user_id=user.id, chest=code, claimed_at=now, rewards="[]"))
                db.flush()
                for item_id, quantity in chest["rewards"]:
                    variant = inv.variants_of(item_id)[0]
                    inv.grant(db, user.id, item_id, variant, quantity, kind="work_chest", ref=f"work:{code}",
                              event_key=f"work_chest:{code}:{item_id}", at=now)
                    granted.append({"item_id": item_id, "variant": variant, "quantity": quantity})
            claim = db.scalar(select(WorkRewardClaim).where(WorkRewardClaim.user_id == user.id, WorkRewardClaim.chest == code))
            claim.rewards = json.dumps(granted)
            db.commit()
            already = False
        except IntegrityError:
            db.rollback()  # opened by a concurrent request: nothing was granted twice
            already = True
    else:
        already = True
    chests = chest_views(db, user)
    return {"chest": next(c for c in chests if c["code"] == code), "already_opened": already, "chests": chests}


def _check_catalog() -> None:
    """Chest rewards must be real catalog items (checked at import, so a typo fails the tests, not a user)."""
    for chest in CHESTS:
        for item_id, _ in chest["rewards"]:
            assert item_id in cat.ITEMS, f"Unknown chest reward {item_id}"


_check_catalog()
