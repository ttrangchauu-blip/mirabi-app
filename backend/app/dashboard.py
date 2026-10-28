from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from . import tasks
from .companion import daily_quests, latest_walk, settle_returned_walks, today_goals, walk_status
from .db import get_db
from .friends import incoming_request_count, online_friends
from .models import User, utcnow
from .notifications import unread_count
from .study_statistics import statistics
from .schemas import UserOut
from .security import current_user

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    # A walk that ended while the app was closed adds its EXP before the numbers below are read.
    settle_returned_walks(db, user.id)
    # Same numbers as the focus space: local days, completed Pomodoro sessions only.
    study = statistics(db, user.id)
    friends_online = online_friends(db, user)
    db.commit()
    today = utcnow().date()
    quests = daily_quests(user, db)
    return {
        "user": UserOut.model_validate(user).model_dump(),
        "study": {
            "total_minutes": study["total_seconds"] // 60,
            "today_minutes": study["today_seconds"] // 60,
            "today_sessions": study["today_sessions"],
            "current_streak": study["current_streak"],
            "longest_streak": study["longest_streak"],
            "daily_goal_minutes": study["daily_goal_minutes"],
            "goal_progress": study["goal_progress"],
        },
        "daily_quests": quests,
        "scheduled_tasks": tasks.list_occurrences(user, today, today, db),
        "pet_walk": walk_status(latest_walk(user, db), today_goals(user, db)),
        # Real friends who are online or studying and share their status (was placeholder data before Study Together).
        "online_friends": friends_online,
        # In-app inbox (friend requests, room invitations, visits, greetings), shown on the Home bell.
        "unread_notifications": unread_count(db, user.id),
        # Friend requests waiting for an answer: the badge on the Home "Bạn bè" button.
        "pending_friend_requests": incoming_request_count(db, user.id),
    }
