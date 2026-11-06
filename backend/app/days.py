"""What "today" means for the daily loop: quests, the user's tasks on Home, the walk, and the daily EXP caps.

There is one calendar for all of them, in DAILY_RESET_TIMEZONE, decided by the server. A device's clock or zone never
moves it. The login streak has its own setting (LOGIN_STREAK_TIMEZONE) with the same default, so it turns at the same
moment. Records that belong to where the user was keep their own zone: focus sessions, moods and money entries.
"""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from .config import settings
from .models import utcnow


def today(now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(ZoneInfo(settings.daily_reset_timezone)).date()


def day_start(now: datetime | None = None) -> datetime:
    """The UTC instant today began, for comparing with stored timestamps (always UTC)."""
    zone = ZoneInfo(settings.daily_reset_timezone)
    return datetime.combine(today(now), time.min, tzinfo=zone).astimezone(timezone.utc)
