"""Personal scheduled tasks with per-occurrence completion records.

Work Quest (work.py) uses these same tasks: a work task is a task with category "work", usually a project, a priority,
a deadline, an estimate and a few steps. There is no second task system: every task, whatever its category, joins the
day's walk goals the same way (companion.today_goals), earns EXP through the same capped ledger, and completes once
per occurrence.
"""
import json
import calendar
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from . import days
from .db import get_db
from .errors import APIError
from .models import User, UserTask, UserTaskCompletion, UserTaskStep, UserTaskStepCompletion, WorkProject, as_utc, utcnow
from .schemas import TaskStepCreate, TaskStepToggle, UserTaskComplete, UserTaskCreate, UserTaskUpdate
from .security import current_user
from .companion import daily_quests, lock_daily_goals, maybe_start_walk
from .config import settings
from .progression import award_exp, daily_exp_remaining, task_exp

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

MAX_STEPS = 20
# A deadline a little in the past is still accepted (a slow network, a clock a minute off).
DUE_GRACE = timedelta(minutes=5)

def _occurs(task: UserTask, day: date) -> bool:
    if day < task.scheduled_date:
        return False
    if task.repeat == "none":
        return day == task.scheduled_date
    if task.repeat_until and day > task.repeat_until:
        return False
    if not _matches(task, day):
        return False
    if task.repeat_count:
        occurrences = sum(1 for candidate in _candidate_dates(task, day) if _matches(task, candidate))
        return occurrences <= task.repeat_count
    return True

def _matches(task: UserTask, day: date) -> bool:
    frequency = task.repeat_frequency if task.repeat == "custom" else task.repeat
    interval = max(1, task.repeat_interval or 1)
    if frequency == "daily":
        matches = (day - task.scheduled_date).days % interval == 0
    elif frequency == "weekly":
        weeks = ((day - task.scheduled_date).days + task.scheduled_date.weekday()) // 7
        weekdays = json.loads(task.repeat_weekdays or "[]")
        matches = weeks % interval == 0 and (day.weekday() in weekdays if weekdays else day.weekday() == task.scheduled_date.weekday())
    elif frequency == "monthly":
        months = (day.year - task.scheduled_date.year) * 12 + day.month - task.scheduled_date.month
        if months % interval:
            return False
        if task.repeat_month_week and task.repeat_month_weekday is not None:
            matches = day.weekday() == task.repeat_month_weekday and (day.day - 1) // 7 + 1 == task.repeat_month_week
            if task.repeat_month_week == 5:
                matches = day.weekday() == task.repeat_month_weekday and day.day + 7 > calendar.monthrange(day.year, day.month)[1]
        else:
            month_day = task.repeat_month_day or task.scheduled_date.day
            matches = day.day == month_day
    elif frequency == "yearly":
        years = day.year - task.scheduled_date.year
        matches = years % interval == 0 and day.month == task.scheduled_date.month and day.day == task.scheduled_date.day
    else:
        return False
    return matches

def _candidate_dates(task: UserTask, end: date):
    current = task.scheduled_date
    while current <= end:
        yield current
        current += timedelta(days=1)

def _iso(value: datetime | None) -> str | None:
    return as_utc(value).isoformat() if value else None

def _task_view(task: UserTask, day: date, completed: bool, steps: list[dict] | None = None) -> dict:
    return {"id": task.id, "occurrence_id": f"{task.id}:{day.isoformat()}", "title": task.title,
            "category": task.category, "difficulty": task.difficulty,
            "scheduled_date": day.isoformat(), "repeat": task.repeat,
            "description": task.description, "start_time": task.start_time, "end_time": task.end_time,
            "all_day": task.all_day, "repeat_interval": task.repeat_interval,
            "repeat_frequency": task.repeat_frequency, "repeat_weekdays": json.loads(task.repeat_weekdays or "[]"),
            "repeat_month_day": task.repeat_month_day, "repeat_month_week": task.repeat_month_week,
            "repeat_month_weekday": task.repeat_month_weekday, "repeat_until": task.repeat_until.isoformat() if task.repeat_until else None,
            "repeat_count": task.repeat_count,
            "project_id": task.project_id, "priority": task.priority or "medium", "due_at": _iso(task.due_at),
            "estimated_minutes": task.estimated_minutes, "exp": task_exp(task.priority),
            "steps": steps if steps is not None else [],
            "completed": completed, "kind": "scheduled"}

def active_tasks(db: Session, user_id: int, *where) -> list[UserTask]:
    """The user's tasks that haven't been removed."""
    return list(db.scalars(select(UserTask).where(UserTask.user_id == user_id, UserTask.archived_at.is_(None), *where)))

def steps_by_occurrence(db: Session, task_ids: list[int], start_date: date, end_date: date):
    """Each task's steps and, per (step, day), whether it was ticked; two queries for any number of tasks."""
    steps: dict[int, list[UserTaskStep]] = {}
    if not task_ids:
        return steps, set()
    for step in db.scalars(select(UserTaskStep).where(UserTaskStep.task_id.in_(task_ids))
                           .order_by(UserTaskStep.position, UserTaskStep.id)):
        steps.setdefault(step.task_id, []).append(step)
    step_ids = [s.id for group in steps.values() for s in group]
    ticked = set()
    if step_ids:
        ticked = {(row.step_id, row.occurrence_date) for row in db.scalars(select(UserTaskStepCompletion).where(
            UserTaskStepCompletion.step_id.in_(step_ids), UserTaskStepCompletion.occurrence_date >= start_date,
            UserTaskStepCompletion.occurrence_date <= end_date))}
    return steps, ticked

def step_views(steps: list[UserTaskStep], ticked: set, day: date) -> list[dict]:
    return [{"id": s.id, "title": s.title, "done": (s.id, day) in ticked} for s in steps]

def scheduled_occurrences(user: User, start_date: date, end_date: date, db: Session) -> list[dict]:
    """The user's own tasks on each day of the range (no built-in daily quests), with their completion."""
    tasks = active_tasks(db, user.id, UserTask.scheduled_date <= end_date)
    task_ids = [task.id for task in tasks]
    completions = db.scalars(select(UserTaskCompletion).where(
        UserTaskCompletion.task_id.in_(task_ids), UserTaskCompletion.occurrence_date >= start_date,
        UserTaskCompletion.occurrence_date <= end_date,
    ))
    completed = {(entry.task_id, entry.occurrence_date) for entry in completions}
    steps, ticked = steps_by_occurrence(db, task_ids, start_date, end_date)
    result = []
    for task in tasks:
        day = max(start_date, task.scheduled_date)
        while day <= end_date:
            if _occurs(task, day):
                result.append(_task_view(task, day, (task.id, day) in completed, step_views(steps.get(task.id, []), ticked, day)))
            day += timedelta(days=1)
    return result

def list_occurrences(user: User, start_date: date, end_date: date, db: Session,
                     quest_date: date | None = None) -> list[dict]:
    if end_date < start_date:
        raise APIError(422, "invalid_date_range", "End date must not be before start date")
    if (end_date - start_date).days > 92:
        raise APIError(422, "date_range_too_large", "Task views are limited to 93 days at a time")
    result = scheduled_occurrences(user, start_date, end_date, db)
    # The built-in daily quests use Activity/StudySession records rather than user_tasks.
    # Include them in today's calendar as all-day entries so completed quests remain visible.
    # The mobile calendar uses the device's local date. Accept it as a display
    # date so built-in daily quests don't disappear when it differs from the server's day.
    today = quest_date or days.today()
    if start_date <= today <= end_date:
        for quest in daily_quests(user, db):
            result.append({"id": quest["id"], "occurrence_id": f"quest:{quest['id']}:{today.isoformat()}",
                           "title": quest["title"], "category": "daily", "scheduled_date": today.isoformat(),
                           "repeat": "daily", "completed": quest["progress"] >= quest["target"],
                           "kind": "daily_quest"})
    return sorted(result, key=lambda item: (item["scheduled_date"], not item.get("start_time"), item.get("start_time") or "", item["title"].casefold()))

def owned_task(db: Session, user: User, task_id: int) -> UserTask:
    """The user's own task, not removed; anyone else's (or a removed one) is "not found", never "forbidden"."""
    task = db.scalar(select(UserTask).where(UserTask.id == task_id, UserTask.user_id == user.id, UserTask.archived_at.is_(None)))
    if task is None:
        raise APIError(404, "task_not_found", "Task not found")
    return task

def check_project(db: Session, user: User, project_id: int | None) -> None:
    if project_id is None:
        return
    project = db.scalar(select(WorkProject).where(WorkProject.id == project_id, WorkProject.user_id == user.id))
    if project is None:
        raise APIError(404, "project_not_found", "Project not found")
    if project.status == "archived":
        raise APIError(409, "project_archived", "This project was archived")

def check_due(due_at: datetime | None) -> datetime | None:
    if due_at is None:
        return None
    due_at = due_at if due_at.tzinfo else due_at.replace(tzinfo=timezone.utc)
    if due_at < utcnow() - DUE_GRACE:
        raise APIError(422, "due_in_past", "The deadline must not be in the past")
    return due_at

def task_detail(db: Session, task: UserTask, day: date) -> dict:
    """One occurrence of a task, as the lists show it."""
    completed = db.scalar(select(UserTaskCompletion.id).where(UserTaskCompletion.task_id == task.id,
                                                              UserTaskCompletion.occurrence_date == day)) is not None
    steps, ticked = steps_by_occurrence(db, [task.id], day, day)
    return _task_view(task, day, completed, step_views(steps.get(task.id, []), ticked, day))

@router.get("")
def get_tasks(start_date: date | None = Query(default=None), end_date: date | None = Query(default=None),
              quest_date: date | None = Query(default=None),
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = days.today()
    start = start_date or today
    end = end_date or start
    return list_occurrences(user, start, end, db, quest_date)

@router.post("")
def create_task(data: UserTaskCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    check_project(db, user, data.project_id)
    due_at = check_due(data.due_at)
    task = UserTask(user_id=user.id, title=data.title, category=data.category,
                    difficulty="medium", scheduled_date=data.scheduled_date, repeat=data.repeat,
                    description=data.description, start_time=None if data.all_day else data.start_time,
                    end_time=None if data.all_day else data.end_time, all_day=data.all_day,
                    repeat_interval=data.repeat_interval, repeat_frequency=data.repeat_frequency,
                    repeat_weekdays=json.dumps(data.repeat_weekdays), repeat_month_day=data.repeat_month_day,
                    repeat_month_week=data.repeat_month_week, repeat_month_weekday=data.repeat_month_weekday,
                    repeat_until=data.repeat_until, repeat_count=data.repeat_count,
                    project_id=data.project_id, priority=data.priority,
                    # A deadline belongs to a one-time task: a recurring task is due on each of its days.
                    due_at=due_at if data.repeat == "none" else None,
                    estimated_minutes=data.estimated_minutes)
    # A task for today joins the walk's goals unless the walk has already started: taking the same lock as the walk's
    # start makes the two happen one after the other, never interleaved.
    lock_daily_goals(db, user.id)
    db.add(task)
    db.flush()
    for position, title in enumerate(data.steps):
        db.add(UserTaskStep(task_id=task.id, title=title, position=position))
    db.commit()
    db.refresh(task)
    return {"id": task.id, "title": task.title, "category": task.category,
            "difficulty": task.difficulty, "scheduled_date": task.scheduled_date.isoformat(), "repeat": task.repeat,
            "project_id": task.project_id, "priority": task.priority, "due_at": _iso(task.due_at),
            "estimated_minutes": task.estimated_minutes, "exp": task_exp(task.priority),
            "steps": [{"id": s.id, "title": s.title, "done": False} for s in
                      db.scalars(select(UserTaskStep).where(UserTaskStep.task_id == task.id).order_by(UserTaskStep.position))]}

@router.patch("/{task_id}")
def update_task(task_id: int, data: UserTaskUpdate, occurrence_date: date | None = Query(default=None),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Edit a task's details. Its EXP for occurrences already done stays as it was granted."""
    task = owned_task(db, user, task_id)
    fields = data.model_fields_set
    for name in ("title", "category", "priority"):
        if name in fields and getattr(data, name) is None:
            raise APIError(422, "field_required", f"{name} cannot be empty")
    if "project_id" in fields:
        check_project(db, user, data.project_id)
    if "due_at" in fields:
        if data.due_at is not None and task.repeat != "none":
            raise APIError(422, "due_on_recurring", "A recurring task has no single deadline")
        # Keeping the deadline it already has is fine even once it has passed.
        unchanged = data.due_at is not None and task.due_at is not None and as_utc(task.due_at) == (
            data.due_at if data.due_at.tzinfo else data.due_at.replace(tzinfo=timezone.utc))
        task.due_at = task.due_at if unchanged else check_due(data.due_at)
    for name in ("title", "description", "category", "project_id", "priority", "estimated_minutes"):
        if name in fields:
            setattr(task, name, getattr(data, name))
    task.updated_at = utcnow()
    db.commit()
    db.refresh(task)
    return task_detail(db, task, occurrence_date or task.scheduled_date)

@router.delete("/{task_id}")
def delete_task(task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Remove a task. It is archived, not erased: done occurrences and their EXP stay in the history and the
    statistics. If it was the last unfinished goal of today, the walk may start now."""
    task = owned_task(db, user, task_id)
    task.archived_at = utcnow()
    db.commit()
    maybe_start_walk(user, db)
    return {"id": task.id, "deleted": True}

@router.post("/{task_id}/complete")
def complete_task(task_id: int, data: UserTaskComplete, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = owned_task(db, user, task_id)
    if not _occurs(task, data.occurrence_date):
        raise APIError(409, "task_not_scheduled", "Task is not scheduled for this date")
    # Under the per-user lock: of several taps or devices at once, one completes it and the others see it done.
    lock_daily_goals(db, user.id)
    completion = db.scalar(select(UserTaskCompletion).where(
        UserTaskCompletion.task_id == task.id,
        UserTaskCompletion.occurrence_date == data.occurrence_date,
    ))
    already_completed = completion is not None
    if completion is None:
        db.add(UserTaskCompletion(task_id=task.id, occurrence_date=data.occurrence_date))
        awarded = award_exp(
            user, db, source="task", reference_id=f"task:{task.id}:{data.occurrence_date.isoformat()}",
            requested=task_exp(task.priority), daily_cap=settings.task_daily_exp_cap,
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            awarded = 0
            already_completed = True
        maybe_start_walk(user, db)  # this may have been the last goal of today
    else:
        db.commit()  # releases the lock
        awarded = 0
    detail = task_detail(db, task, data.occurrence_date)
    return {**detail, "completed": True, "awarded_exp": awarded,
            "already_completed": already_completed,
            "daily_exp_remaining": daily_exp_remaining(user, db, source="task", daily_cap=settings.task_daily_exp_cap)}

@router.post("/{task_id}/steps")
def add_step(task_id: int, data: TaskStepCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = owned_task(db, user, task_id)
    count = db.scalar(select(func.count()).select_from(UserTaskStep).where(UserTaskStep.task_id == task.id)) or 0
    if count >= MAX_STEPS:
        raise APIError(409, "too_many_steps", f"A task has at most {MAX_STEPS} steps")
    step = UserTaskStep(task_id=task.id, title=data.title, position=count)
    db.add(step)
    db.commit()
    return {"id": step.id, "title": step.title, "done": False}

@router.put("/{task_id}/steps/{step_id}")
def toggle_step(task_id: int, step_id: int, data: TaskStepToggle, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    """Tick or untick a step on one occurrence. Idempotent; steps never earn EXP."""
    task = owned_task(db, user, task_id)
    step = db.scalar(select(UserTaskStep).where(UserTaskStep.id == step_id, UserTaskStep.task_id == task.id))
    if step is None:
        raise APIError(404, "step_not_found", "Step not found")
    if not _occurs(task, data.occurrence_date):
        raise APIError(409, "task_not_scheduled", "Task is not scheduled for this date")
    existing = db.scalar(select(UserTaskStepCompletion).where(UserTaskStepCompletion.step_id == step.id,
                                                              UserTaskStepCompletion.occurrence_date == data.occurrence_date))
    if data.done and existing is None:
        db.add(UserTaskStepCompletion(step_id=step.id, occurrence_date=data.occurrence_date))
    elif not data.done and existing is not None:
        db.delete(existing)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the same tick from another device got there first: same result
    return task_detail(db, task, data.occurrence_date)

@router.delete("/{task_id}/steps/{step_id}")
def delete_step(task_id: int, step_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = owned_task(db, user, task_id)
    step = db.scalar(select(UserTaskStep).where(UserTaskStep.id == step_id, UserTaskStep.task_id == task.id))
    if step is None:
        raise APIError(404, "step_not_found", "Step not found")
    # SQLite runs without foreign-key enforcement here, so the ticks go explicitly rather than by cascade.
    db.execute(delete(UserTaskStepCompletion).where(UserTaskStepCompletion.step_id == step.id))
    db.delete(step)
    db.commit()
    return {"id": step_id, "deleted": True}
