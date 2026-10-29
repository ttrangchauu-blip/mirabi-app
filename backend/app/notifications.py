"""In-app notifications for Study Together (friend requests, room invitations, session and team quest results) and
friend room visits (greetings and cheers, merged per kind while unread: see room_visits.py) and friends caring for
the garden (merged while unread: see garden.py).

`notify` stores the notification and, after commit, pushes it to the user's open sockets. Push notifications to the
device (APNs/FCM via Expo) are not wired up: the backend has no device-token registry yet.
"""
import json
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from . import clock
from .db import get_db
from .errors import APIError
from .models import RoomVisitInteraction, SocialNotification, User, as_utc
from .realtime import queue_user
from .security import current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

KINDS = {"friend_request", "friend_accepted", "room_invitation", "session_started", "session_completed",
         "team_quest_completed", "room_visit", "garden_care"}
RETENTION_DAYS = 90


def view(n: SocialNotification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "data": json.loads(n.data_json or "{}"),
            "read": n.read_at is not None, "created_at": as_utc(n.created_at)}


def unread_count(db: Session, user_id: int) -> int:
    return db.scalar(select(func.count()).select_from(SocialNotification).where(
        SocialNotification.user_id == user_id, SocialNotification.read_at.is_(None))) or 0


def notify(db: Session, user_id: int, kind: str, title: str, body: str, data: dict | None = None) -> SocialNotification:
    assert kind in KINDS, kind
    n = SocialNotification(user_id=user_id, kind=kind, title=title[:120], body=body[:300],
                           data_json=json.dumps(data or {}), created_at=clock.now())
    db.add(n)
    db.flush()
    queue_user(db, user_id, {"type": "notification", "notification": view(n)})
    return n


def latest_unread(db: Session, user_id: int, kind: str, group: str, since) -> SocialNotification | None:
    """The newest unread notification of `kind` whose data has this `group` key, created after `since`."""
    for n in db.scalars(select(SocialNotification).where(
            SocialNotification.user_id == user_id, SocialNotification.kind == kind,
            SocialNotification.read_at.is_(None), SocialNotification.created_at >= since)
            .order_by(SocialNotification.id.desc()).limit(20)):
        if json.loads(n.data_json or "{}").get("group") == group:
            return n
    return None


def replace(db: Session, old: SocialNotification, title: str, body: str, data: dict) -> SocialNotification:
    """Merge into an unread notification: the old row is removed and a new one takes its place at the top of the inbox
    (ids order the inbox). Open apps get the new one with `replaces`, so they drop the old one."""
    user_id, kind = old.user_id, old.kind
    db.delete(old)
    db.flush()
    n = SocialNotification(user_id=user_id, kind=kind, title=title[:120], body=body[:300],
                           data_json=json.dumps(data), created_at=clock.now())
    db.add(n)
    db.flush()
    queue_user(db, user_id, {"type": "notification", "notification": view(n), "replaces": old.id})
    return n


def _mark_interactions_seen(db: Session, user_id: int, notification_ids: list[int] | None) -> None:
    """Greetings, cheers and study invites carried by notifications the host has now read."""
    query = update(RoomVisitInteraction).where(RoomVisitInteraction.host_id == user_id,
                                               RoomVisitInteraction.seen_at.is_(None))
    if notification_ids is not None:
        query = query.where(RoomVisitInteraction.notification_id.in_(notification_ids))
    db.execute(query.values(seen_at=clock.now()))


def purge_old(db: Session) -> None:
    db.execute(delete(SocialNotification).where(
        SocialNotification.created_at < clock.now() - timedelta(days=RETENTION_DAYS)))


@router.get("")
def list_notifications(limit: int = Query(default=20, ge=1, le=50), before_id: int | None = Query(default=None, ge=1),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = select(SocialNotification).where(SocialNotification.user_id == user.id)
    if before_id is not None:
        query = query.where(SocialNotification.id < before_id)
    rows = list(db.scalars(query.order_by(SocialNotification.id.desc()).limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    return {"items": [view(n) for n in rows], "unread_count": unread_count(db, user.id),
            "next_before_id": rows[-1].id if more else None}


@router.post("/read-all")
def mark_all_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(SocialNotification).where(SocialNotification.user_id == user.id,
                                                SocialNotification.read_at.is_(None)).values(read_at=clock.now()))
    _mark_interactions_seen(db, user.id, None)
    db.commit()
    return {"unread_count": 0}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.get(SocialNotification, notification_id)
    if n is None or n.user_id != user.id:
        raise APIError(404, "notification_not_found", "Notification not found")
    if n.read_at is None:
        n.read_at = clock.now()
        _mark_interactions_seen(db, user.id, [n.id])
        db.commit()
    return {"notification": view(n), "unread_count": unread_count(db, user.id)}
