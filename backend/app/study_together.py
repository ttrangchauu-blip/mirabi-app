"""One call for the Study Together home screen, so the app opens with a single round trip."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import friends, study_rooms, team_quests
from .db import get_db
from .models import Friendship, User
from .notifications import unread_count
from .security import current_user

router = APIRouter(prefix="/api/study-together", tags=["study-together"])


@router.get("/home")
def home(user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = friends.ensure_profile(db, user.id)
    friends.touch_active(db, user.id)
    db.commit()
    member = study_rooms._current_membership(db, user.id)
    current_room = study_rooms._read_room(db, member.room_id, user) if member is not None else None
    hidden = friends.blocked_ids(db, user.id)
    incoming = [friends.request_view(db, row, user.id) for row in db.scalars(
        select(Friendship).where(Friendship.status == "pending", Friendship.requester_id != user.id,
                                 or_(Friendship.user_low_id == user.id, Friendship.user_high_id == user.id))
        .order_by(Friendship.created_at.desc()).limit(20))]
    outgoing = db.scalar(select(func.count()).select_from(Friendship).where(
        Friendship.status == "pending", Friendship.requester_id == user.id)) or 0
    history, _ = study_rooms.session_history(db, user, limit=5)
    result = {
        "me": {**friends.public_user(user, profile)},
        "current_room": current_room,
        "friends": friends.list_friends(db, user),
        "incoming_requests": [r for r in incoming if r["user"] and r["user"]["id"] not in hidden],
        "outgoing_request_count": outgoing,
        "invitations": study_rooms.pending_invitations(db, user),
        "rooms": study_rooms.eligible_rooms(db, user),
        "team_quests": [q for q in team_quests.list_for_user(db, user) if q["status"] == "active"],
        "recent_sessions": history,
        "unread_notifications": unread_count(db, user.id),
    }
    db.commit()
    return result
