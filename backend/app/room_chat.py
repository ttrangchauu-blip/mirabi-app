"""Room chat: members of a study room message each other while they study.

- Only active members read or send, and each member sees messages sent since they (last) joined the room, so someone
  joining by code never reads the earlier conversation.
- People who blocked each other (either way) never see each other's messages or typing, neither in the history nor
  live: the realtime fan-out skips them.
- Text only (1-500 characters, line breaks allowed, other control characters refused), rate limited per user. A retry
  with the same `client_id` returns the original message instead of posting twice.
- The sender can unsend a message and the host can remove any message in their room; both leave a "removed" marker.
  A report (`POST /api/users/{id}/report` with `message_id`) copies the text so the evidence outlives the unsend.
- Messages are purged `study_room_message_retention_days` after they were sent (by the study room sweep).

New messages are queued on the database session and pushed as `room.message` only after commit (see realtime.py).
"""
import re
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock
from .config import settings
from .db import SessionLocal, get_db
from .errors import APIError
from .friends import blocked_ids, profiles_for, public_user
from .models import StudyRoom, StudyRoomMessage, User, as_utc
from .ratelimit import enforce
from .realtime import queue_room
from .security import current_user
from .study_rooms import _require_member, _require_open

router = APIRouter(prefix="/api/study-rooms", tags=["room-chat"])

MAX_MESSAGE_LENGTH = 500


def _clean_body(value):
    """Normalize line endings, trim, and fold runs of blank lines so a message can't be mostly empty space."""
    if not isinstance(value, str):
        return value
    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    return re.sub(r"\n{3,}", "\n\n", value)


def _text_only(value: str) -> str:
    if any((ord(ch) < 32 and ch != "\n") or ord(ch) == 127 for ch in value):
        raise ValueError("Text must not contain control characters")
    return value


MessageBody = Annotated[str, BeforeValidator(_clean_body), Field(min_length=1, max_length=MAX_MESSAGE_LENGTH),
                        AfterValidator(_text_only)]


class MessageInput(BaseModel):
    body: MessageBody
    client_id: Optional[Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]] = None


def hidden_from(user_id: int) -> frozenset[int]:
    """Users whose chat `user_id` must not see, and who must not see theirs (blocks either way)."""
    with SessionLocal() as db:
        return frozenset(blocked_ids(db, user_id))


def message_views(db: Session, messages: list[StudyRoomMessage]) -> list[dict]:
    sender_ids = {m.sender_id for m in messages}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(sender_ids)))} if sender_ids else {}
    profiles = profiles_for(db, set(users))
    views = []
    for m in messages:
        user = users.get(m.sender_id)
        removed = None if m.deleted_at is None else "sender" if m.deleted_by_id == m.sender_id else "host"
        views.append({"id": m.id, "room_id": m.room_id, "client_id": m.client_id,
                      "sender": public_user(user, profiles.get(user.id)) if user else None,
                      "body": None if removed else m.body, "deleted": removed is not None, "removed_by": removed,
                      "created_at": as_utc(m.created_at)})
    return views


def _room_member(db: Session, room_id: int, user: User):
    room = db.get(StudyRoom, room_id)
    return room, _require_member(db, room, user)


@router.get("/{room_id}/messages")
def list_messages(room_id: int, before_id: int | None = Query(default=None, ge=1),
                  limit: int = Query(default=30, ge=1, le=50),
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Newest page first by cursor; items are returned oldest → newest for display."""
    _, member = _room_member(db, room_id, user)
    query = select(StudyRoomMessage).where(StudyRoomMessage.room_id == room_id,
                                           StudyRoomMessage.created_at >= member.joined_at)
    hidden = blocked_ids(db, user.id)
    if hidden:
        query = query.where(StudyRoomMessage.sender_id.not_in(hidden))
    if before_id is not None:
        query = query.where(StudyRoomMessage.id < before_id)
    rows = list(db.scalars(query.order_by(StudyRoomMessage.id.desc()).limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    items = message_views(db, list(reversed(rows)))
    db.commit()  # profiles_for may have created missing social profiles
    return {"items": items, "next_before_id": rows[-1].id if more else None}


@router.post("/{room_id}/messages", status_code=201)
def send_message(room_id: int, data: MessageInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room, _ = _room_member(db, room_id, user)
    _require_open(room)
    if data.client_id:
        existing = db.scalar(select(StudyRoomMessage).where(StudyRoomMessage.room_id == room_id,
                                                            StudyRoomMessage.sender_id == user.id,
                                                            StudyRoomMessage.client_id == data.client_id))
        if existing is not None:
            return {"message": message_views(db, [existing])[0], "replayed": True}
    enforce("room-message", settings.rate_limit_room_message, str(user.id))
    message = StudyRoomMessage(room_id=room_id, sender_id=user.id, body=data.body, client_id=data.client_id,
                               created_at=clock.now())
    try:
        with db.begin_nested():
            db.add(message)
    except IntegrityError:  # the same client_id raced in from a parallel retry
        existing = db.scalar(select(StudyRoomMessage).where(StudyRoomMessage.room_id == room_id,
                                                            StudyRoomMessage.sender_id == user.id,
                                                            StudyRoomMessage.client_id == data.client_id))
        return {"message": message_views(db, [existing])[0], "replayed": True}
    view = message_views(db, [message])[0]
    queue_room(db, room_id, {"type": "room.message", "room_id": room_id, "message": view},
               skip=frozenset(blocked_ids(db, user.id)))
    db.commit()
    return {"message": view, "replayed": False}


@router.delete("/{room_id}/messages/{message_id}")
def delete_message(room_id: int, message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Unsend your own message, or (host) remove anyone's message in your room. Retry-safe."""
    room, _ = _room_member(db, room_id, user)
    message = db.get(StudyRoomMessage, message_id)
    if message is None or message.room_id != room_id or message.sender_id in blocked_ids(db, user.id):
        raise APIError(404, "message_not_found", "Message not found")
    if message.sender_id != user.id and room.host_id != user.id:
        raise APIError(403, "not_message_owner", "You can only remove your own messages")
    if message.deleted_at is None:
        message.deleted_at, message.deleted_by_id = clock.now(), user.id
        removed_by = "sender" if user.id == message.sender_id else "host"
        queue_room(db, room_id, {"type": "room.message_deleted", "room_id": room_id, "message_id": message.id,
                                 "removed_by": removed_by})
        db.commit()
    return {"deleted": True}


def purge_old(db: Session) -> None:
    db.execute(delete(StudyRoomMessage).where(
        StudyRoomMessage.created_at < clock.now() - timedelta(days=settings.study_room_message_retention_days)))
