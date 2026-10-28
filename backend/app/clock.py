"""The one clock for Study Together. Tests replace `now` to move time without sleeping."""
from datetime import datetime

from .models import utcnow


def now() -> datetime:
    return utcnow()
