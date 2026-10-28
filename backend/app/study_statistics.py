"""User-scoped Pomodoro aggregates. Dates belong to the session's recorded timezone."""
from collections import Counter, defaultdict
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .models import PomodoroSettings, StudySession, as_utc, utcnow


def valid_timezone(value):
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise HTTPException(422, detail={"code": "invalid_timezone"})


def preferences(db, user_id):
    row = db.get(PomodoroSettings, user_id)
    if row is None:
        try:
            # The app loads settings and statistics in parallel; the first request to arrive creates the row.
            with db.begin_nested():
                row = PomodoroSettings(user_id=user_id, timezone="UTC", daily_goal_minutes=120,
                                       focus_minutes=25, short_break_minutes=5, long_break_minutes=15,
                                       long_break_every=4)
                db.add(row)
        except IntegrityError:
            row = db.get(PomodoroSettings, user_id, populate_existing=True)
    return row


def settings_dict(row):
    return {key: getattr(row, key) for key in ("timezone", "daily_goal_minutes", "focus_minutes",
            "short_break_minutes", "long_break_minutes", "long_break_every")}


def statistics(db, user_id, period="week", now=None):
    prefs = preferences(db, user_id)
    today = (now or utcnow()).astimezone(valid_timezone(prefs.timezone)).date()
    week = today - timedelta(days=today.weekday())
    month = today.replace(day=1)
    start = {"day": today, "week": week, "month": month}[period]
    rows = db.scalars(select(StudySession).where(StudySession.user_id == user_id,
                                                StudySession.mode == "pomodoro")).all()
    daily = defaultdict(lambda: {"seconds": 0, "completed": 0, "started": 0})
    hours = defaultdict(lambda: {"started": 0, "completed": 0})
    durations = Counter()
    cohort_started = cohort_completed = cancelled = in_progress = 0
    for row in rows:
        zone = valid_timezone(row.timezone or prefs.timezone)
        began = as_utc(row.started_at or row.created_at).astimezone(zone)
        ended = as_utc(row.ended_at or row.created_at).astimezone(zone)
        if began.date() <= today:
            daily[began.date()]["started"] += 1
        valid = row.completed and row.duration_seconds >= 60 and row.status in (None, "completed")
        # A session ended early still adds the minutes actually studied, but is not a completed session.
        studied = row.duration_seconds if valid or (row.status == "cancelled" and row.duration_seconds >= 60) else 0
        if start <= began.date() <= today:
            cohort_started += 1
            cohort_completed += int(valid)
            cancelled += int(row.status == "cancelled")
            in_progress += int(row.status == "started")
        if studied and ended.date() <= today:
            daily[ended.date()]["seconds"] += studied
        if valid and ended.date() <= today:
            daily[ended.date()]["completed"] += 1
            durations[row.duration_seconds // 60] += 1
        if week <= began.date() <= today:
            hours[began.hour]["started"] += 1
            if valid:
                hours[began.hour]["completed"] += 1
    dates = sorted(day for day, value in daily.items() if value["completed"])
    longest = run = 0
    previous = None
    for day in dates:
        run = run + 1 if previous and day == previous + timedelta(days=1) else 1
        longest = max(longest, run)
        previous = day
    current = 0
    cursor = today if today in dates else today - timedelta(days=1)
    days = set(dates)
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)
    series = [{"date": (start + timedelta(days=i)).isoformat(), **daily[start + timedelta(days=i)]}
              for i in range((today - start).days + 1)]
    seconds = sum(item["seconds"] for item in series)
    started = sum(item["started"] for item in series)
    completed = sum(item["completed"] for item in series)
    total = lambda since: sum(v["seconds"] for d, v in daily.items() if since <= d <= today)
    return {"period": period, "timezone": prefs.timezone, "today_seconds": daily[today]["seconds"],
            "today_sessions": daily[today]["completed"], "week_seconds": total(week),
            "month_seconds": total(month), "seconds": seconds, "started": started, "completed": completed,
            "completion_rate": cohort_completed / cohort_started if cohort_started else 0,
            "rate_completed": cohort_completed, "cancelled": cancelled, "in_progress": in_progress,
            "average_daily_seconds": seconds / len(series),
            "current_streak": current, "longest_streak": longest,
            "daily_goal_minutes": prefs.daily_goal_minutes,
            "goal_progress": min(1, daily[today]["seconds"] / (prefs.daily_goal_minutes * 60)),
            "days": series, "hours": [{"hour": hour, **value} for hour, value in sorted(hours.items())],
            "duration_counts": [{"minutes": minutes, "completed": count} for minutes, count in sorted(durations.items())],
            "total_seconds": sum(v["seconds"] for v in daily.values()),
            "history_completed": sum(v["completed"] for v in daily.values()),
            "active_days": len(dates),
            "previous_week_seconds": sum(v["seconds"] for d, v in daily.items() if week - timedelta(days=7) <= d < week)}
