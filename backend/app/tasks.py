"""Personal scheduled tasks with per-occurrence completion records."""
import json
import calendar
from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from .errors import APIError
from .models import User, UserTask, UserTaskCompletion, utcnow
from .schemas import UserTaskComplete, UserTaskCreate
from .security import current_user
from .companion import daily_quests, lock_daily_goals, maybe_start_walk
from .config import settings
from .progression import CUSTOM_TASK_EXP, award_exp, daily_exp_remaining

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

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

def _task_view(task: UserTask, day: date, completed: bool) -> dict:
    return {"id": task.id, "occurrence_id": f"{task.id}:{day.isoformat()}", "title": task.title,
            "category": task.category, "difficulty": task.difficulty,
            "scheduled_date": day.isoformat(), "repeat": task.repeat,
            "description": task.description, "start_time": task.start_time, "end_time": task.end_time,
            "all_day": task.all_day, "repeat_interval": task.repeat_interval,
            "repeat_frequency": task.repeat_frequency, "repeat_weekdays": json.loads(task.repeat_weekdays or "[]"),
            "repeat_month_day": task.repeat_month_day, "repeat_month_week": task.repeat_month_week,
            "repeat_month_weekday": task.repeat_month_weekday, "repeat_until": task.repeat_until.isoformat() if task.repeat_until else None,
            "repeat_count": task.repeat_count,
            "completed": completed, "kind": "scheduled"}

def scheduled_occurrences(user: User, start_date: date, end_date: date, db: Session) -> list[dict]:
    """The user's own tasks on each day of the range (no built-in daily quests), with their completion."""
    tasks = list(db.scalars(select(UserTask).where(UserTask.user_id == user.id, UserTask.scheduled_date <= end_date)))
    task_ids = [task.id for task in tasks]
    completions = db.scalars(select(UserTaskCompletion).where(
        UserTaskCompletion.task_id.in_(task_ids), UserTaskCompletion.occurrence_date >= start_date,
        UserTaskCompletion.occurrence_date <= end_date,
    ))
    completed = {(entry.task_id, entry.occurrence_date) for entry in completions}
    result = []
    for task in tasks:
        day = max(start_date, task.scheduled_date)
        while day <= end_date:
            if _occurs(task, day):
                result.append(_task_view(task, day, (task.id, day) in completed))
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
    # date so built-in daily quests don't disappear around UTC midnight.
    today = quest_date or utcnow().date()
    if start_date <= today <= end_date:
        for quest in daily_quests(user, db):
            result.append({"id": quest["id"], "occurrence_id": f"quest:{quest['id']}:{today.isoformat()}",
                           "title": quest["title"], "category": "daily", "scheduled_date": today.isoformat(),
                           "repeat": "daily", "completed": quest["progress"] >= quest["target"],
                           "kind": "daily_quest"})
    return sorted(result, key=lambda item: (item["scheduled_date"], not item.get("start_time"), item.get("start_time") or "", item["title"].casefold()))

@router.get("")
def get_tasks(start_date: date | None = Query(default=None), end_date: date | None = Query(default=None),
              quest_date: date | None = Query(default=None),
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = utcnow().date()
    start = start_date or today
    end = end_date or start
    return list_occurrences(user, start, end, db, quest_date)

@router.post("")
def create_task(data: UserTaskCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = UserTask(user_id=user.id, title=data.title, category=data.category,
                    difficulty="medium", scheduled_date=data.scheduled_date, repeat=data.repeat,
                    description=data.description, start_time=None if data.all_day else data.start_time,
                    end_time=None if data.all_day else data.end_time, all_day=data.all_day,
                    repeat_interval=data.repeat_interval, repeat_frequency=data.repeat_frequency,
                    repeat_weekdays=json.dumps(data.repeat_weekdays), repeat_month_day=data.repeat_month_day,
                    repeat_month_week=data.repeat_month_week, repeat_month_weekday=data.repeat_month_weekday,
                    repeat_until=data.repeat_until, repeat_count=data.repeat_count)
    # A task for today joins the walk's goals unless the walk has already started: taking the same lock as the walk's
    # start makes the two happen one after the other, never interleaved.
    lock_daily_goals(db, user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return {"id": task.id, "title": task.title, "category": task.category,
            "difficulty": task.difficulty, "scheduled_date": task.scheduled_date.isoformat(), "repeat": task.repeat}

@router.post("/{task_id}/complete")
def complete_task(task_id: int, data: UserTaskComplete, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = db.scalar(select(UserTask).where(UserTask.id == task_id, UserTask.user_id == user.id))
    if task is None:
        raise APIError(404, "task_not_found", "Task not found")
    if not _occurs(task, data.occurrence_date):
        raise APIError(409, "task_not_scheduled", "Task is not scheduled for this date")
    completion = db.scalar(select(UserTaskCompletion).where(
        UserTaskCompletion.task_id == task.id,
        UserTaskCompletion.occurrence_date == data.occurrence_date,
    ))
    already_completed = completion is not None
    if completion is None:
        db.add(UserTaskCompletion(task_id=task.id, occurrence_date=data.occurrence_date))
        awarded = award_exp(
            user, db, source="task", reference_id=f"task:{task.id}:{data.occurrence_date.isoformat()}",
            requested=CUSTOM_TASK_EXP, daily_cap=settings.task_daily_exp_cap,
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            awarded = 0
        maybe_start_walk(user, db)  # this may have been the last goal of today
    else:
        awarded = 0
    return {**_task_view(task, data.occurrence_date, True), "awarded_exp": awarded,
            "already_completed": already_completed,
            "daily_exp_remaining": daily_exp_remaining(user, db, source="task", daily_cap=settings.task_daily_exp_cap)}
