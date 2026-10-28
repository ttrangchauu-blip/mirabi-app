import json
from datetime import datetime, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .models import StudySession, User, as_utc, utcnow
from .study_statistics import preferences, settings_dict, statistics, valid_timezone
from .ai_client import call_ai_engine, AIServiceError
from .schemas import StudyInput
from .security import current_user
from .progression import award_study_exp
from .companion import maybe_start_walk

router = APIRouter(prefix="/api/study", tags=["study"])

class PomodoroPreferencesInput(BaseModel):
    timezone: str = Field(max_length=80)
    daily_goal_minutes: int = Field(default=120, ge=1, le=1440)
    focus_minutes: int = Field(default=25, ge=1, le=180)
    short_break_minutes: int = Field(default=5, ge=1, le=60)
    long_break_minutes: int = Field(default=15, ge=1, le=120)
    long_break_every: int = Field(default=4, ge=2, le=12)


@router.get("/pomodoro-settings")
def get_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = preferences(db, user.id)
    db.commit()
    return settings_dict(row)


@router.put("/pomodoro-settings")
def save_preferences(data: PomodoroPreferencesInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    valid_timezone(data.timezone)
    row = preferences(db, user.id)
    for key, value in data.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return settings_dict(row)


@router.get("/pomodoro-statistics")
def get_statistics(period: Literal["day", "week", "month"] = "week",
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = statistics(db, user.id, period)
    db.commit()
    return result


Period = Literal["day", "week", "month"]


def _stats(db, user, period="week"):
    result = statistics(db, user.id, period)
    db.commit()
    return result


def _pick(result, *keys):
    return {key: result[key] for key in keys}


@router.get("/summary")
def get_summary(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The three numbers on the focus-space strip."""
    return _pick(_stats(db, user), "timezone", "today_seconds", "today_sessions", "current_streak")


@router.get("/minutes")
def get_minutes(period: Period = "week", user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = _stats(db, user, period)
    return {**_pick(result, "period", "timezone", "today_seconds", "week_seconds", "month_seconds", "total_seconds",
                    "seconds", "average_daily_seconds", "previous_week_seconds", "daily_goal_minutes", "goal_progress"),
            "days": [{"date": day["date"], "seconds": day["seconds"]} for day in result["days"]]}


@router.get("/completed-sessions")
def get_completed_sessions(period: Period = "week", user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = _stats(db, user, period)
    return {**_pick(result, "period", "timezone", "today_sessions", "started", "completed", "completion_rate",
                    "rate_completed", "cancelled", "in_progress", "history_completed", "hours", "duration_counts"),
            "days": [{"date": day["date"], "started": day["started"], "completed": day["completed"]} for day in result["days"]]}


@router.get("/streak")
def get_study_streak(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Consecutive local days with a completed focus session (separate from the login streak at /api/streak)."""
    return _pick(_stats(db, user), "timezone", "current_streak", "longest_streak", "active_days")


@router.get("/dashboard")
def get_study_dashboard(period: Period = "week", user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _stats(db, user, period)


class PomodoroEvent(BaseModel):
    event: Literal["started", "cancelled", "completed"]
    duration_seconds: int = Field(default=0, ge=0, le=10800)
    timezone: str = Field(default="UTC", max_length=80)
    occurred_at: datetime | None = None


@router.put("/pomodoro/{cycle}")
def record_pomodoro(cycle: str, data: PomodoroEvent, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not 8 <= len(cycle) <= 64 or not cycle.isalnum():
        raise HTTPException(422, detail={"code": "invalid_pomodoro_cycle"})
    valid_timezone(data.timezone)
    occurred = as_utc(data.occurred_at) if data.occurred_at else utcnow()
    if occurred > utcnow() + timedelta(seconds=5) or occurred < utcnow() - timedelta(days=30):
        raise HTTPException(422, detail={"code": "invalid_event_time"})
    row = db.scalar(select(StudySession).where(StudySession.user_id == user.id, StudySession.pomodoro_cycle == cycle))
    if row is None:
        if data.event != "started":
            raise HTTPException(409, detail={"code": "pomodoro_not_started"})
        row = StudySession(user_id=user.id, mode="pomodoro", pomodoro_cycle=cycle, completed=False,
                           status="started", duration_seconds=0, started_at=occurred, timezone=data.timezone)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = db.scalar(select(StudySession).where(StudySession.user_id == user.id, StudySession.pomodoro_cycle == cycle))
        return {"id": row.id, "status": row.status, "xp_awarded": 0}
    if row.status in ("completed", "cancelled") or row.completed or data.event == "started":
        return {"id": row.id, "status": row.status, "xp_awarded": 0,
                "statistics": statistics(db, user.id)}
    elapsed = max(0, int((occurred - as_utc(row.started_at)).total_seconds()))
    if data.duration_seconds > elapsed + 2 or (data.event == "completed" and data.duration_seconds < 60):
        raise HTTPException(422, detail={"code": "invalid_focus_duration"})
    # Conditional transition makes competing completion requests award only once.
    from sqlalchemy import update
    changed = db.execute(update(StudySession).where(StudySession.id == row.id, StudySession.status == "started")
                         .values(status=data.event, completed=data.event == "completed", ended_at=occurred,
                                 duration_seconds=data.duration_seconds)).rowcount
    awarded = 0
    if changed:
        db.refresh(row)
        awarded = award_study_exp(user, db, row)
    db.commit()
    if changed and data.event == "completed":
        maybe_start_walk(user, db)
    return {"id": row.id, "status": row.status, "xp_awarded": awarded, "statistics": statistics(db, user.id)}


@router.post("/pomodoro-insights")
async def pomodoro_insights(user: User = Depends(current_user), db: Session = Depends(get_db)):
    facts = statistics(db, user.id, "month")
    db.commit()
    if facts["history_completed"] < 5 or facts["active_days"] < 3:
        return {"sufficient_data": False, "message": "Chưa đủ dữ liệu. Hãy hoàn thành ít nhất 5 phiên trong 3 ngày học.",
                "suggested_minutes": None}
    durations = facts["duration_counts"]
    suggested = max(durations, key=lambda item: item["completed"])["minutes"] if durations else None
    try:
        result = await call_ai_engine({"user_id": user.id, "feature_key": "pomodoro_coach",
                                       "user_input": "Phân tích thói quen học tập từ dữ liệu tổng hợp đã xác thực.",
                                       "context": {"study_facts": json.dumps(facts, ensure_ascii=False)}})
    except AIServiceError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code})
    return {"sufficient_data": True, "message": result["text"], "suggested_minutes": suggested,
            "run_id": result["run_id"], "facts": facts}


@router.post("/pomodoro/{cycle}")
def complete_pomodoro_cycle(cycle: str, duration_seconds: int = Query(default=1500, ge=60, le=10800),
                            user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Record a completed focus cycle once, using the existing study XP cap/rules."""
    if not 8 <= len(cycle) <= 64 or not cycle.isalnum():
        raise HTTPException(422, detail={"code": "invalid_pomodoro_cycle"})
    existing = db.scalar(select(StudySession).where(StudySession.user_id == user.id,
                                                   StudySession.pomodoro_cycle == cycle))
    if existing:
        return {"id": existing.id, "already_recorded": True, "xp_awarded": 0}
    session = StudySession(user_id=user.id, mode="pomodoro", duration_seconds=duration_seconds,
                           completed=True, pomodoro_cycle=cycle)
    try:
        db.add(session)
        db.flush()
        awarded = award_study_exp(user, db, session)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(StudySession).where(StudySession.user_id == user.id,
                                                        StudySession.pomodoro_cycle == cycle))
        if existing:
            return {"id": existing.id, "already_recorded": True, "xp_awarded": 0}
        raise
    db.refresh(session)
    maybe_start_walk(user, db)
    return {"id": session.id, "already_recorded": False, "xp_awarded": awarded}


@router.post("/sessions")
def create_study_session(data: StudyInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = StudySession(
        user_id=user.id, mode=data.mode, duration_seconds=data.duration_seconds,
        completed=data.completed,
    )
    db.add(session)
    db.flush()
    awarded = award_study_exp(user, db, session)
    db.commit()
    db.refresh(session)
    if data.completed:
        maybe_start_walk(user, db)
    return {
        "id": session.id, "mode": session.mode,
        "duration_seconds": session.duration_seconds, "completed": session.completed,
        "xp_awarded": awarded,
    }


@router.get("/sessions")
def list_study_sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(StudySession).where(StudySession.user_id == user.id)
        .order_by(desc(StudySession.created_at)).limit(50)
    )
    return [
        {"id": item.id, "mode": item.mode, "duration_seconds": item.duration_seconds,
         "completed": item.completed, "created_at": item.created_at}
        for item in items
    ]
