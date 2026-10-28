"""Calendar-day login streaks, the once-a-day streak popup and automatic pet XP rewards."""
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import LoginStreakDay, User
from .progression import award_exp
from .schemas import LoginStreakOut
from .security import current_user

router = APIRouter(prefix="/api", tags=["streaks"])
UNLIMITED_DAILY_STREAK_CAP = 1_000_000
MILESTONES = ((7, 10), (14, 20), (30, 50), (60, 100), (100, 200))
CLAIM_KEY = re.compile(r"[A-Za-z0-9_-]{8,64}")


def local_today() -> date:
    return datetime.now(ZoneInfo(settings.login_streak_timezone)).date()


def daily_reward(streak: int) -> int:
    if streak >= 30:
        return 10
    if streak >= 7:
        return 8
    if streak >= 3:
        return 5
    return 2


def _longest(user_id: int, db: Session) -> int:
    # The record is the best streak ever reached, so it only moves when the current streak passes it.
    return db.scalar(select(func.coalesce(func.max(LoginStreakDay.streak_count), 0))
                     .where(LoginStreakDay.user_id == user_id)) or 0


def _claim(day: LoginStreakDay, user_id: int, db: Session, *, show_popup: bool) -> dict:
    return {"current_streak": day.streak_count, "longest_streak": _longest(user_id, db),
            "last_login_date": day.login_date.isoformat(), "should_show_popup": show_popup,
            "daily_exp_awarded": day.daily_exp if show_popup else 0,
            "milestone_exp_awarded": day.milestone_exp if show_popup else 0,
            "already_claimed": not show_popup}


def record_successful_login(user: User, db: Session, claim_key: str | None = None) -> dict:
    """Record at most one check-in (login or app open) and reward per local calendar day.

    Only the request that records the day is told to show the popup. A retry of that same request
    (same idempotency key, e.g. after its response was lost) gets the same answer again; any other
    login that day, concurrent or later, does not.
    """
    claim_key = claim_key if claim_key and CLAIM_KEY.fullmatch(claim_key) else None
    today = local_today()

    def replay(existing: LoginStreakDay) -> dict:
        return _claim(existing, user.id, db, show_popup=bool(claim_key and existing.popup_claim_key == claim_key))

    existing = db.scalar(select(LoginStreakDay).where(
        LoginStreakDay.user_id == user.id, LoginStreakDay.login_date == today,
    ))
    if existing:
        return replay(existing)

    previous = db.scalar(select(LoginStreakDay).where(LoginStreakDay.user_id == user.id)
                         .order_by(LoginStreakDay.login_date.desc()).limit(1))
    streak = previous.streak_count + 1 if previous and previous.login_date == today - timedelta(days=1) else 1
    milestone = dict(MILESTONES).get(streak, 0)
    day = LoginStreakDay(user_id=user.id, login_date=today, streak_count=streak, popup_claim_key=claim_key)
    try:
        # The unique user/date constraint makes simultaneous login requests idempotent.
        with db.begin_nested():
            db.add(day)
            db.flush()
    except IntegrityError:
        existing = db.scalar(select(LoginStreakDay).where(
            LoginStreakDay.user_id == user.id, LoginStreakDay.login_date == today,
        ))
        if existing is None:
            raise
        return replay(existing)

    day.daily_exp = award_exp(
        user, db, source="login_streak", reference_id=f"daily:{today.isoformat()}",
        requested=daily_reward(streak), daily_cap=UNLIMITED_DAILY_STREAK_CAP,
    )
    day.milestone_exp = award_exp(
        user, db, source="login_streak", reference_id=f"milestone:{today.isoformat()}:{streak}",
        requested=milestone, daily_cap=UNLIMITED_DAILY_STREAK_CAP,
    ) if milestone else 0
    db.flush()
    return _claim(day, user.id, db, show_popup=True)


@router.post("/streak/check-in", response_model=LoginStreakOut)
def check_in(user: User = Depends(current_user), db: Session = Depends(get_db),
             idempotency_key: str | None = Header(default=None)):
    """Opening the app with a valid session counts as that day's login, exactly like POST /api/auth/login."""
    claim = record_successful_login(user, db, idempotency_key)
    db.commit()
    return claim


@router.get("/streak")
def get_streak(user: User = Depends(current_user), db: Session = Depends(get_db)):
    today = local_today()
    latest = db.scalar(select(LoginStreakDay).where(LoginStreakDay.user_id == user.id)
                       .order_by(LoginStreakDay.login_date.desc()).limit(1))
    today_row = db.scalar(select(LoginStreakDay).where(
        LoginStreakDay.user_id == user.id, LoginStreakDay.login_date == today,
    ))
    is_active = bool(latest and latest.login_date >= today - timedelta(days=1))
    current = latest.streak_count if latest and is_active else 0
    longest = _longest(user.id, db)
    next_streak = current + 1 if latest and latest.login_date == today - timedelta(days=1) else 1

    start = today - timedelta(days=6)
    records = db.scalars(select(LoginStreakDay).where(
        LoginStreakDay.user_id == user.id, LoginStreakDay.login_date >= start,
        LoginStreakDay.login_date <= today,
    ).order_by(LoginStreakDay.login_date)).all()
    by_date = {row.login_date: row for row in records}
    calendar = []
    for offset in range(7):
        day_date = start + timedelta(days=offset)
        row = by_date.get(day_date)
        calendar.append({"date": day_date.isoformat(), "checked_in": row is not None,
                         "is_today": day_date == today,
                         "streak_count": row.streak_count if row else None,
                         "daily_exp": row.daily_exp if row else 0})

    cycle_start = latest.login_date - timedelta(days=latest.streak_count - 1) if is_active and latest else None
    milestones = []
    for days, exp in MILESTONES:
        milestone_day = cycle_start + timedelta(days=days - 1) if cycle_start else None
        milestone_row = by_date.get(milestone_day) if milestone_day else None
        if milestone_day and milestone_row is None:
            milestone_row = db.scalar(select(LoginStreakDay).where(
                LoginStreakDay.user_id == user.id, LoginStreakDay.login_date == milestone_day,
                LoginStreakDay.streak_count == days,
            ))
        milestones.append({"days": days, "exp": exp, "reached": bool(current >= days),
                           "claimed": bool(milestone_row and milestone_row.milestone_exp > 0)})

    return {
        "current_streak": current,
        "longest_streak": longest,
        "last_login_date": latest.login_date.isoformat() if latest else None,
        "today_claimed": today_row is not None,
        "today_exp": today_row.daily_exp if today_row else daily_reward(next_streak),
        "today_milestone_exp": today_row.milestone_exp if today_row else 0,
        "calendar": calendar,
        "milestones": milestones,
    }
