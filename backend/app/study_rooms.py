"""Study Together rooms: membership, invitations and the group Pomodoro session.

The backend is the only clock. A session is a fixed sequence of focus and break phases; `sync_session` advances it to
"now" (on every read, every change and from the background tick) and credits focus time to members who were present.
A member is present from joining or their latest heartbeat until they leave, or until `study_room_away_grace_seconds`
after their last heartbeat (a locked screen or a short network loss doesn't cost minutes; disappearing does).

When a session ends, `finalize_session` runs exactly once: each participant's valid minutes become a row in
`study_sessions` (pomodoro_cycle "room<id>", unique per user), so group study follows the personal study EXP rules and
shares their daily cap. A small "learning together" bonus has its own cap.

Room changes are serialized per room (`locked_room`: a process lock, plus SELECT ... FOR UPDATE on databases that
support it) and seats are claimed with a conditional UPDATE, so concurrent joins never exceed `max_members`.
"""
import logging
import threading
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Annotated, Iterator, Literal, Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field
from sqlalchemy import and_, exists, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from . import clock, team_quests
from .config import settings
from .db import SessionLocal, get_db
from .errors import APIError
from .friends import (are_friends, blocked_ids, ensure_profile, friend_ids, no_control_chars, normalize_code,
                      profiles_for, public_user, random_code, shares_stats, touch_active)
from .models import (StudyRoom, StudyRoomInvitation, StudyRoomMember, StudyRoomParticipant, StudyRoomSession,
                     StudySession, User, as_utc)
from .notifications import notify
from .progression import award_exp, award_study_exp
from .ratelimit import client_ip, enforce
from .realtime import hub, queue_room
from .security import current_user
from .study_statistics import preferences

log = logging.getLogger("refmi.study_rooms")
router = APIRouter(prefix="/api/study-rooms", tags=["study-rooms"])
invitations_router = APIRouter(prefix="/api/room-invitations", tags=["study-rooms"])
sessions_router = APIRouter(prefix="/api/group-sessions", tags=["study-rooms"])

ROOM_CODE_LENGTH = 8
GROUP_BONUS_EXP_PER_CYCLE = 2
REACTIONS = ("cheer", "clap", "star", "fire", "coffee", "heart")
Subject = Literal["general", "math", "literature", "english", "science", "coding", "language", "exam", "reading",
                  "work", "other"]


def _strip(value):
    return value.strip() if isinstance(value, str) else value


RoomName = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=60), AfterValidator(no_control_chars)]
RoomGoal = Annotated[str, BeforeValidator(_strip), Field(max_length=160), AfterValidator(no_control_chars)]


class RoomCreate(BaseModel):
    name: RoomName
    goal: Optional[RoomGoal] = None
    subject: Subject = "general"
    focus_minutes: int = Field(default=25, ge=5, le=90)
    break_minutes: int = Field(default=5, ge=1, le=30)
    cycles: int = Field(default=4, ge=1, le=8)
    max_members: int = Field(default=4, ge=2, le=8)
    visibility: Literal["private", "code"] = "private"
    invitee_ids: list[int] = Field(default_factory=list, max_length=7)


class RoomPatch(BaseModel):
    name: Optional[RoomName] = None
    goal: Optional[RoomGoal] = None
    subject: Optional[Subject] = None
    focus_minutes: Optional[int] = Field(default=None, ge=5, le=90)
    break_minutes: Optional[int] = Field(default=None, ge=1, le=30)
    cycles: Optional[int] = Field(default=None, ge=1, le=8)
    max_members: Optional[int] = Field(default=None, ge=2, le=8)
    visibility: Optional[Literal["private", "code"]] = None


class CodeInput(BaseModel):
    code: Annotated[str, BeforeValidator(_strip), Field(min_length=4, max_length=20)]


class InviteInput(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=7)


class ReactionInput(BaseModel):
    reaction: Literal["cheer", "clap", "star", "fire", "coffee", "heart"]


# ---------------------------------------------------------------------------- locking and lookup
_locks: dict[int, threading.RLock] = defaultdict(threading.RLock)
_locks_guard = threading.Lock()


@contextmanager
def locked_room(db: Session, room_id: int) -> Iterator[StudyRoom | None]:
    """Serialize changes to one room. Commit inside the block so the next writer sees them."""
    with _locks_guard:
        lock = _locks[room_id]
    with lock:
        room = db.scalar(select(StudyRoom).where(StudyRoom.id == room_id).with_for_update()
                         .execution_options(populate_existing=True))
        yield room


def _not_found() -> APIError:
    # Rooms you have no access to look exactly like rooms that don't exist (no probing of private rooms by id).
    return APIError(404, "room_not_found", "Room not found")


def _member(db: Session, room_id: int, user_id: int, active_only: bool = True) -> StudyRoomMember | None:
    query = select(StudyRoomMember).where(StudyRoomMember.room_id == room_id, StudyRoomMember.user_id == user_id)
    if active_only:
        query = query.where(StudyRoomMember.status == "active")
    return db.scalar(query)


def _active_members(db: Session, room_id: int) -> list[StudyRoomMember]:
    return list(db.scalars(select(StudyRoomMember).where(StudyRoomMember.room_id == room_id,
                                                         StudyRoomMember.status == "active")
                           .order_by(StudyRoomMember.joined_at, StudyRoomMember.id)))


def _require_member(db: Session, room: StudyRoom | None, user: User) -> StudyRoomMember:
    member = _member(db, room.id, user.id) if room is not None else None
    if member is None:
        raise _not_found()
    return member


def _require_host(db: Session, room: StudyRoom | None, user: User) -> StudyRoomMember:
    member = _require_member(db, room, user)
    if room.host_id != user.id:
        raise APIError(403, "not_room_host", "Only the host can do this")
    return member


def _require_open(room: StudyRoom) -> None:
    if room.status != "open":
        raise APIError(409, "room_closed", "This room is closed")


def _current_session(db: Session, room: StudyRoom) -> StudyRoomSession | None:
    return db.get(StudyRoomSession, room.current_session_id) if room.current_session_id else None


def _participants(db: Session, session: StudyRoomSession) -> list[StudyRoomParticipant]:
    return list(db.scalars(select(StudyRoomParticipant).where(StudyRoomParticipant.session_id == session.id)
                           .order_by(StudyRoomParticipant.id)))


def _ms(delta: timedelta) -> int:
    return int(delta.total_seconds() * 1000)


def _grace() -> timedelta:
    return timedelta(seconds=settings.study_room_away_grace_seconds)


# ---------------------------------------------------------------------------- session engine
def _credit(participants: list[StudyRoomParticipant], session: StudyRoomSession, start: datetime, end: datetime) -> None:
    """Credit [start, end) of a running focus phase to each participant who was present for it."""
    if session.status != "active" or session.phase != "focus" or end <= start:
        return
    for p in participants:
        if not p.present:
            continue
        lo = max(start, as_utc(p.present_since) if p.present_since else start)
        hi = min(end, as_utc(p.last_seen_at) + _grace())
        if hi > lo:
            p.focus_ms += _ms(hi - lo)


def sync_session(db: Session, session: StudyRoomSession, t: datetime) -> bool:
    """Advance the session to `t`. Returns True when phase, cycle, status or someone's presence changed."""
    if session.status != "active":
        return False
    participants = _participants(db, session)
    changed = False
    while session.status == "active" and as_utc(session.phase_ends_at) <= t:
        boundary = as_utc(session.phase_ends_at)
        _credit(participants, session, as_utc(session.accrued_until), boundary)
        session.accrued_until = boundary
        changed = True
        if session.phase == "focus":
            session.completed_cycles = session.cycle
            for p in participants:
                # A cycle counts for someone who was there at its end, having studied at least half of it.
                there = p.present and as_utc(p.last_seen_at) + _grace() >= boundary
                if there and p.focus_ms - p.phase_start_focus_ms >= session.focus_seconds * 500:
                    p.cycles_completed += 1
            if session.cycle >= session.total_cycles:
                session.status, session.ended_at, session.end_reason = "completed", boundary, "completed"
                break
            session.phase = "break"
            session.phase_started_at = boundary
            session.phase_ends_at = boundary + timedelta(seconds=session.break_seconds)
        else:
            session.cycle += 1
            session.phase = "focus"
            session.phase_started_at = boundary
            session.phase_ends_at = boundary + timedelta(seconds=session.focus_seconds)
            for p in participants:
                p.phase_start_focus_ms = p.focus_ms
    if session.status == "active" and t > as_utc(session.accrued_until):
        _credit(participants, session, as_utc(session.accrued_until), t)
        session.accrued_until = t
    for p in participants:
        cutoff = as_utc(p.last_seen_at) + _grace()
        if p.present and cutoff < t:
            p.present, p.left_at = False, cutoff
            changed = True
    return changed


def _new_participant(session: StudyRoomSession, user_id: int, t: datetime, seen: datetime | None = None) -> StudyRoomParticipant:
    present = seen is None or seen + _grace() >= t
    return StudyRoomParticipant(session_id=session.id, user_id=user_id, present=present,
                                present_since=t if present else None, last_seen_at=t if seen is None else seen,
                                joined_at=t, focus_ms=0, phase_start_focus_ms=0, cycles_completed=0)


def finalize_session(db: Session, session: StudyRoomSession) -> list[int]:
    """Write rewards for an ended session exactly once. Returns the participants' user ids (for follow-up work)."""
    t = clock.now()
    claimed = db.execute(update(StudyRoomSession).where(
        StudyRoomSession.id == session.id, StudyRoomSession.finalized_at.is_(None),
        StudyRoomSession.status.in_(("completed", "cancelled"))).values(finalized_at=t)).rowcount
    if claimed != 1:
        return []
    participants = _participants(db, session)
    together = sum(1 for p in participants if p.cycles_completed > 0) >= 2
    room = db.get(StudyRoom, session.room_id)
    ended = as_utc(session.ended_at or t)
    rewarded = []
    for p in participants:
        user = db.get(User, p.user_id)
        if user is None or user.status != "active":
            continue
        seconds = p.focus_ms // 1000
        if seconds >= 60:
            completed = p.cycles_completed > 0
            row = StudySession(user_id=user.id, mode="pomodoro", study_type="together", pomodoro_cycle=f"room{session.id}", completed=completed,
                               status="completed" if completed else "cancelled", duration_seconds=seconds,
                               started_at=as_utc(p.joined_at), ended_at=ended, timezone=preferences(db, user.id).timezone,
                               created_at=ended)
            try:
                with db.begin_nested():
                    db.add(row)
                p.study_exp = award_study_exp(user, db, row)
            except IntegrityError:
                log.warning("Group session %s was already recorded for user %s", session.id, user.id)
        if together and p.cycles_completed > 0:
            p.bonus_exp = award_exp(user, db, source="group", reference_id=f"room_session:{session.id}",
                                    requested=GROUP_BONUS_EXP_PER_CYCLE * p.cycles_completed,
                                    daily_cap=settings.group_daily_exp_cap)
        p.rewarded_at = t
        if p.cycles_completed > 0:
            from .memories import record_event
            record_event(db, user, "first_group_session", "first:group", at=ended,
                         result="Hoàn thành buổi học nhóm đầu tiên")
        rewarded.append(user.id)
        minutes = seconds // 60
        notify(db, user.id, "session_completed", "Phiên học nhóm đã kết thúc",
               f"Bạn đã tập trung {minutes} phút cùng nhóm “{room.name if room else ''}”.",
               {"session_id": session.id, "room_id": session.room_id})
    team_quests.record_session(db, session, participants)
    return rewarded


def _end_current_session(db: Session, room: StudyRoom, session: StudyRoomSession) -> list[int]:
    room.current_session_id = None
    room.last_session_id = session.id
    db.flush()
    return finalize_session(db, session)


def advance_room(db: Session, room: StudyRoom, t: datetime) -> tuple[str | None, list[int]]:
    """Bring the room's session up to date. Returns (event name or None, users who just got rewards)."""
    session = _current_session(db, room)
    if session is None:
        return None, []
    before = (session.status, session.phase, session.cycle)
    changed = sync_session(db, session, t)
    if session.status in ("completed", "cancelled"):
        return "session_completed", _end_current_session(db, room, session)
    if (session.status, session.phase, session.cycle) != before:
        return "phase_changed", []
    return ("member_status_changed" if changed else None), []


def _cancel_session(db: Session, room: StudyRoom, t: datetime, reason: str) -> list[int]:
    session = _current_session(db, room)
    if session is None:
        return []
    sync_session(db, session, t)
    if session.status in ("active", "paused"):
        session.status, session.ended_at, session.end_reason = "cancelled", t, reason
    return _end_current_session(db, room, session)


# ---------------------------------------------------------------------------- snapshots and publishing
def _session_view(session: StudyRoomSession | None, t: datetime) -> dict | None:
    if session is None:
        return None
    if session.status == "paused":
        remaining = session.paused_remaining_ms or 0
    elif session.status == "active":
        remaining = max(0, _ms(as_utc(session.phase_ends_at) - t))
    else:
        remaining = 0
    return {"id": session.id, "status": session.status, "phase": session.phase, "cycle": session.cycle,
            "total_cycles": session.total_cycles, "completed_cycles": session.completed_cycles,
            "focus_seconds": session.focus_seconds, "break_seconds": session.break_seconds,
            "phase_seconds": session.focus_seconds if session.phase == "focus" else session.break_seconds,
            "remaining_ms": remaining, "started_at": as_utc(session.started_at),
            "phase_ends_at": as_utc(session.phase_ends_at) if session.status == "active" else None}


def snapshot(db: Session, room: StudyRoom, t: datetime | None = None) -> dict:
    """The room as every member sees it. The same payload goes to all members, so it holds nothing per-viewer."""
    t = t or clock.now()
    session = _current_session(db, room)
    members = _active_members(db, room.id)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([m.user_id for m in members])))} if members else {}
    profiles = profiles_for(db, set(users))
    participants = {p.user_id: p for p in _participants(db, session)} if session else {}
    state = "closed" if room.status != "open" else "waiting" if session is None else (
        "paused" if session.status == "paused" else session.phase)
    member_views = []
    for m in members:
        user = users.get(m.user_id)
        if user is None:
            continue
        p = participants.get(m.user_id)
        shared = shares_stats(profiles.get(m.user_id))
        member_views.append({**public_user(user, profiles.get(m.user_id)), "user_id": user.id, "role": m.role,
                             "presence": m.presence, "joined_at": as_utc(m.joined_at), "in_session": bool(p and p.present),
                             "focus_seconds": (p.focus_ms // 1000 if p else 0) if shared else None,
                             "cycles_completed": (p.cycles_completed if p else 0) if shared else None})
    return {"id": room.id, "code": room.code, "name": room.name, "goal": room.goal, "subject": room.subject,
            "visibility": room.visibility, "status": room.status, "state": state, "host_id": room.host_id,
            "focus_minutes": room.focus_minutes, "break_minutes": room.break_minutes, "cycles": room.cycles,
            "max_members": room.max_members, "member_count": room.member_count, "version": room.version,
            "members": member_views, "session": _session_view(session, t), "last_session_id": room.last_session_id,
            "team_quests": team_quests.room_quests_brief(db, room.id), "server_time": t}


def _publish(db: Session, room: StudyRoom, event: str, revoke: tuple[int, ...] = (), close: bool = False) -> dict:
    """Bump the room version and queue the new snapshot; it is sent to subscribers only if the transaction commits."""
    room.version = StudyRoom.version + 1
    db.flush()
    db.refresh(room)
    snap = snapshot(db, room)
    queue_room(db, room.id, {"type": "room.updated", "room_id": room.id, "version": room.version, "event": event,
                             "room": snap}, revoke=revoke, close=close)
    return snap


def preview(db: Session, room: StudyRoom, viewer: User, via_code: bool = False) -> dict:
    """What someone outside the room may see before joining: no code, no member stats."""
    host = db.get(User, room.host_id)
    can_join, reason = _join_check(db, room, viewer, via_code=via_code)
    return {"id": room.id, "name": room.name, "goal": room.goal, "subject": room.subject, "visibility": room.visibility,
            "status": room.status, "state": "closed" if room.status != "open" else
            ("waiting" if room.current_session_id is None else "in_session"),
            "focus_minutes": room.focus_minutes, "break_minutes": room.break_minutes, "cycles": room.cycles,
            "member_count": room.member_count, "max_members": room.max_members,
            "host": public_user(host, ensure_profile(db, host.id)) if host else None,
            "can_join": can_join, "reason": reason}


def _after_rewards(user_ids: list[int]) -> None:
    """A completed group session can finish today's focus quest; start the pet's walk like a personal session does."""
    if not user_ids:
        return
    from .companion import maybe_start_walk
    with SessionLocal() as db:
        for user_id in user_ids:
            user = db.get(User, user_id)
            if user is not None:
                try:
                    maybe_start_walk(user, db)
                except Exception:
                    db.rollback()
                    log.exception("Pet walk could not start for user %s", user_id)


# ---------------------------------------------------------------------------- membership
def _join_check(db: Session, room: StudyRoom, user: User, invitation: StudyRoomInvitation | None = None,
                via_code: bool = False) -> tuple[bool, str | None]:
    if room.status != "open":
        return False, "room_closed"
    if _member(db, room.id, user.id) is not None:
        return True, "already_member"
    member_ids = {m.user_id for m in _active_members(db, room.id)} | {room.host_id}
    if member_ids & blocked_ids(db, user.id):
        return False, "room_unavailable"
    if invitation is None:
        invitation = _pending_invitation(db, room.id, user.id)
    allowed = invitation is not None or (room.visibility == "code" and (via_code or are_friends(db, room.host_id, user.id)))
    if not allowed:
        return False, "room_invite_only"
    if room.member_count >= room.max_members:
        return False, "room_full"
    return True, None


JOIN_ERRORS = {
    "room_closed": (409, "This room is closed"),
    "room_unavailable": (403, "You can't join this room"),
    "room_invite_only": (403, "This room is invitation only"),
    "room_full": (409, "This room is full"),
}


def _join(db: Session, room: StudyRoom, user: User, t: datetime, invitation: StudyRoomInvitation | None = None,
          via_code: bool = False) -> tuple[StudyRoomMember, bool]:
    """Add `user` to `room` (caller holds the room lock). Returns (membership, joined_now)."""
    ok, reason = _join_check(db, room, user, invitation, via_code)
    if reason == "already_member":
        return _member(db, room.id, user.id), False
    if not ok:
        status, detail = JOIN_ERRORS[reason]
        raise APIError(status, reason, detail)
    other = db.scalar(select(StudyRoomMember).where(StudyRoomMember.user_id == user.id, StudyRoomMember.status == "active"))
    if other is not None:
        raise APIError(409, "already_in_another_room", "Leave your current room first")
    seat = db.execute(update(StudyRoom).where(StudyRoom.id == room.id, StudyRoom.status == "open",
                                              StudyRoom.member_count < StudyRoom.max_members)
                      .values(member_count=StudyRoom.member_count + 1)).rowcount
    if seat != 1:
        raise APIError(409, "room_full", "This room is full")
    member = _member(db, room.id, user.id, active_only=False)
    try:
        with db.begin_nested():
            if member is None:
                member = StudyRoomMember(room_id=room.id, user_id=user.id, role="member", status="active",
                                         presence="online", joined_at=t, last_seen_at=t)
                db.add(member)
            else:
                member.status, member.role, member.presence = "active", "member", "online"
                member.joined_at, member.left_at, member.last_seen_at = t, None, t
    except IntegrityError:
        # Lost a race with a join to another room (one active room per user).
        raise APIError(409, "already_in_another_room", "Leave your current room first")
    db.refresh(room)
    if invitation is not None:
        invitation.status, invitation.responded_at = "accepted", t
    else:
        pending = _pending_invitation(db, room.id, user.id)
        if pending is not None:
            pending.status, pending.responded_at = "accepted", t
    _touch(db, room, member, t)
    return member, True


def _touch(db: Session, room: StudyRoom, member: StudyRoomMember, t: datetime) -> bool:
    """A heartbeat from `member`. Returns True if their visible presence changed."""
    changed = member.presence != "online"
    member.presence = "online"
    member.last_seen_at = t
    session = _current_session(db, room)
    if session is not None and session.status in ("active", "paused"):
        sync_session(db, session, t)  # credit everyone up to now before this presence changes
        p = db.scalar(select(StudyRoomParticipant).where(StudyRoomParticipant.session_id == session.id,
                                                         StudyRoomParticipant.user_id == member.user_id))
        if p is None:
            db.add(_new_participant(session, member.user_id, t))
            db.flush()  # the session factory doesn't autoflush; snapshots must see the new participant
            changed = True
        else:
            if not p.present:
                p.present, p.present_since, p.left_at = True, t, None
                changed = True
            p.last_seen_at = t
    return changed


def _transfer_host(db: Session, room: StudyRoom, leaving_user_id: int | None = None) -> StudyRoomMember | None:
    """Hand the room to the member who has been there longest, preferring someone online."""
    candidates = [m for m in _active_members(db, room.id) if m.user_id != leaving_user_id and m.user_id != room.host_id]
    if not candidates:
        return None
    new_host = sorted(candidates, key=lambda m: (m.presence != "online", as_utc(m.joined_at), m.id))[0]
    old = _member(db, room.id, room.host_id)
    if old is not None:
        old.role = "member"
    new_host.role = "host"
    room.host_id = new_host.user_id
    return new_host


def _close_room(db: Session, room: StudyRoom, t: datetime, reason: str) -> list[int]:
    rewarded = _cancel_session(db, room, t, reason)
    room.status, room.closed_at = "closed", t
    for m in _active_members(db, room.id):
        m.status, m.left_at = "left", t
    room.member_count = 0
    db.execute(update(StudyRoomInvitation).where(StudyRoomInvitation.room_id == room.id,
                                                 StudyRoomInvitation.status == "pending")
               .values(status="cancelled", responded_at=t))
    return rewarded


def _leave(db: Session, room: StudyRoom, member: StudyRoomMember, t: datetime) -> tuple[str, list[int]]:
    """Remove a member. Returns (event, rewarded users). The last one out closes the room."""
    session = _current_session(db, room)
    if session is not None:
        sync_session(db, session, t)
        p = db.scalar(select(StudyRoomParticipant).where(StudyRoomParticipant.session_id == session.id,
                                                         StudyRoomParticipant.user_id == member.user_id))
        if p is not None and p.present:
            p.present, p.left_at = False, t
    was_host = room.host_id == member.user_id
    new_host = _transfer_host(db, room, member.user_id) if was_host else None
    member.status, member.left_at, member.role = "left", t, "member"
    db.execute(update(StudyRoom).where(StudyRoom.id == room.id, StudyRoom.member_count > 0)
               .values(member_count=StudyRoom.member_count - 1))
    db.flush()
    db.refresh(room)
    if was_host and new_host is None:
        return "room_closed", _close_room(db, room, t, "host_left")
    return ("host_changed" if new_host else "member_left"), []


def _pending_invitation(db: Session, room_id: int, user_id: int) -> StudyRoomInvitation | None:
    invitation = db.scalar(select(StudyRoomInvitation).where(
        StudyRoomInvitation.room_id == room_id, StudyRoomInvitation.invitee_id == user_id,
        StudyRoomInvitation.status == "pending"))
    if invitation is not None and as_utc(invitation.expires_at) <= clock.now():
        return None
    return invitation


def _current_membership(db: Session, user_id: int) -> StudyRoomMember | None:
    return db.scalar(select(StudyRoomMember).where(StudyRoomMember.user_id == user_id, StudyRoomMember.status == "active"))


# ---------------------------------------------------------------------------- invitations
def _invite(db: Session, room: StudyRoom, inviter: User, user_ids: list[int], t: datetime, *,
            body: str | None = None, extra: dict | None = None) -> dict:
    """Invite friends of `inviter` into `room` (caller holds the room lock). `body` and `extra` replace the default
    notification text and add to its data ("Rủ học" from a pet room says which mode and how long)."""
    invited, skipped = [], []
    friends = friend_ids(db, inviter.id)
    hidden = blocked_ids(db, inviter.id) | (blocked_ids(db, room.host_id) if room.host_id != inviter.id else set())
    wanted = list(dict.fromkeys(user_ids))
    profiles = profiles_for(db, {u for u in wanted if u in friends and u not in hidden})
    for user_id in wanted:
        if user_id not in friends or user_id in hidden:
            skipped.append({"user_id": user_id, "reason": "not_friends"})
            continue
        if _member(db, room.id, user_id) is not None:
            skipped.append({"user_id": user_id, "reason": "already_member"})
            continue
        if not profiles[user_id].allow_study_invites:
            skipped.append({"user_id": user_id, "reason": "invites_disabled"})
            continue
        enforce("room-invite", settings.rate_limit_room_invite, str(inviter.id))
        invitation = db.scalar(select(StudyRoomInvitation).where(StudyRoomInvitation.room_id == room.id,
                                                                 StudyRoomInvitation.invitee_id == user_id))
        expires = t + timedelta(hours=settings.room_invitation_hours)
        if invitation is None:
            invitation = StudyRoomInvitation(room_id=room.id, inviter_id=inviter.id, invitee_id=user_id,
                                             status="pending", expires_at=expires, created_at=t)
            db.add(invitation)
            db.flush()
        else:
            invitation.inviter_id, invitation.status, invitation.expires_at = inviter.id, "pending", expires
            invitation.created_at, invitation.responded_at = t, None
        notify(db, user_id, "room_invitation", "Lời mời vào phòng học",
               body or f"{inviter.display_name} mời bạn cùng học trong phòng “{room.name}”.",
               {"invitation_id": invitation.id, "room_id": room.id, **(extra or {})})
        invited.append(user_id)
    return {"invited": invited, "skipped": skipped}


def invitation_state(invitation: StudyRoomInvitation, room: StudyRoom) -> str:
    """What the invitee can do now: pending (can answer), expired, room_closed, or the answer already given
    (accepted | declined | cancelled: withdrawn by an unfriend or block). Closing a room cancels its open invitations."""
    if invitation.status in ("pending", "cancelled") and room.status != "open":
        return "room_closed"
    if invitation.status == "pending" and as_utc(invitation.expires_at) <= clock.now():
        return "expired"
    return invitation.status


def invitation_view(db: Session, invitation: StudyRoomInvitation, viewer: User) -> dict | None:
    room = db.get(StudyRoom, invitation.room_id)
    inviter = db.get(User, invitation.inviter_id)
    if room is None or inviter is None:
        return None
    return {"id": invitation.id, "status": invitation.status, "state": invitation_state(invitation, room),
            "expires_at": as_utc(invitation.expires_at),
            "created_at": as_utc(invitation.created_at), "inviter": public_user(inviter, ensure_profile(db, inviter.id)),
            "room": preview(db, room, viewer)}


def pending_invitations(db: Session, user: User) -> list[dict]:
    hidden = blocked_ids(db, user.id)
    rows = db.scalars(select(StudyRoomInvitation).where(
        StudyRoomInvitation.invitee_id == user.id, StudyRoomInvitation.status == "pending",
        StudyRoomInvitation.expires_at > clock.now()).order_by(StudyRoomInvitation.created_at.desc()).limit(20))
    items = []
    for row in rows:
        if row.inviter_id in hidden:
            continue
        view = invitation_view(db, row, user)
        if view is not None and view["room"]["status"] == "open":
            items.append(view)
    return items


def eligible_rooms(db: Session, user: User) -> list[dict]:
    """Open rooms the user can enter now: their current room, rooms they're invited to, and friends' code rooms."""
    items: dict[int, dict] = {}
    current = _current_membership(db, user.id)
    if current is not None:
        room = db.get(StudyRoom, current.room_id)
        if room is not None and room.status == "open":
            items[room.id] = {**preview(db, room, user), "relation": "member", "invitation_id": None}
    for invitation in pending_invitations(db, user):
        room_id = invitation["room"]["id"]
        items.setdefault(room_id, {**invitation["room"], "relation": "invited", "invitation_id": invitation["id"]})
    friends = friend_ids(db, user.id) - blocked_ids(db, user.id)
    if friends:
        for room in db.scalars(select(StudyRoom).where(StudyRoom.status == "open", StudyRoom.visibility == "code",
                                                       StudyRoom.host_id.in_(friends))
                               .order_by(StudyRoom.updated_at.desc()).limit(20)):
            items.setdefault(room.id, {**preview(db, room, user), "relation": "friend_room", "invitation_id": None})
    return list(items.values())


# ---------------------------------------------------------------------------- room endpoints
def create_room_for(db: Session, user: User, data: RoomCreate, idempotency_key: str | None) -> tuple[StudyRoom, bool]:
    """Open a room hosted by `user` (not committed). Returns (room, replayed): a known idempotency key returns the
    room it created before. Also used by "Rủ học" in a friend's pet room."""
    if user.pet_name is None:
        raise APIError(409, "pet_not_adopted", "Adopt a pet before studying together")
    if idempotency_key:
        existing = db.scalar(select(StudyRoom).where(StudyRoom.host_id == user.id,
                                                     StudyRoom.idempotency_key == idempotency_key))
        if existing is not None:
            return existing, True
    enforce("room-create", settings.rate_limit_room_create, str(user.id))
    if _current_membership(db, user.id) is not None:
        raise APIError(409, "already_in_another_room", "Leave your current room first")
    t = clock.now()
    room = None
    for _ in range(5):
        candidate = StudyRoom(code=random_code(ROOM_CODE_LENGTH), host_id=user.id, name=data.name, goal=data.goal or None,
                              subject=data.subject, visibility=data.visibility, focus_minutes=data.focus_minutes,
                              break_minutes=data.break_minutes, cycles=data.cycles, max_members=data.max_members,
                              member_count=1, status="open", version=1, idempotency_key=idempotency_key,
                              created_at=t, updated_at=t)
        try:
            with db.begin_nested():
                db.add(candidate)
                db.flush()
                db.add(StudyRoomMember(room_id=candidate.id, user_id=user.id, role="host", status="active",
                                       presence="online", joined_at=t, last_seen_at=t))
            room = candidate
            break
        except IntegrityError:
            if _current_membership(db, user.id) is not None:
                raise APIError(409, "already_in_another_room", "Leave your current room first")
            if idempotency_key and (existing := db.scalar(select(StudyRoom).where(
                    StudyRoom.host_id == user.id, StudyRoom.idempotency_key == idempotency_key))) is not None:
                return existing, True
    if room is None:
        raise APIError(503, "try_again", "Please try again")
    return room, False


@router.post("", status_code=201)
def create_room(data: RoomCreate, user: User = Depends(current_user), db: Session = Depends(get_db),
                idempotency_key: Annotated[str | None, Header(max_length=64)] = None):
    room, replayed = create_room_for(db, user, data, idempotency_key)
    if replayed:
        return {"room": snapshot(db, room), "invitations": {"invited": [], "skipped": []}, "replayed": True}
    t = clock.now()
    invitations = _invite(db, room, user, data.invitee_ids, t) if data.invitee_ids else {"invited": [], "skipped": []}
    snap = snapshot(db, room, t)
    db.commit()
    return {"room": snap, "invitations": invitations, "replayed": False}


@router.get("")
def list_rooms(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = eligible_rooms(db, user)
    db.commit()
    return {"items": items}


@router.get("/current")
def get_current_room(user: User = Depends(current_user), db: Session = Depends(get_db)):
    member = _current_membership(db, user.id)
    if member is None:
        return {"room": None}
    return {"room": _read_room(db, member.room_id, user)}


@router.post("/lookup")
def lookup_room(data: CodeInput, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = _room_by_code(db, data.code, user, request)
    result = preview(db, room, user, via_code=True)
    db.commit()
    return result


def _room_by_code(db: Session, raw: str, user: User, request: Request) -> StudyRoom:
    enforce("room-code", settings.rate_limit_room_code, str(user.id))
    enforce("room-code-ip", settings.rate_limit_room_code_ip, client_ip(request))
    code = normalize_code(raw)
    if len(code) != ROOM_CODE_LENGTH:
        raise APIError(404, "room_not_found", "No room has this code")
    room = db.scalar(select(StudyRoom).where(StudyRoom.code == code))
    if room is None:
        raise APIError(404, "room_not_found", "No room has this code")
    return room


def _joined(db: Session, room: StudyRoom, joined: bool) -> dict:
    snap = _publish(db, room, "member_joined") if joined else snapshot(db, room)
    db.commit()
    return {"room": snap, "already_member": not joined}


@router.post("/join")
def join_by_code(data: CodeInput, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    found = _room_by_code(db, data.code, user, request)
    with locked_room(db, found.id) as room:
        _, joined = _join(db, room, user, clock.now(), via_code=True)
        return _joined(db, room, joined)


@router.get("/{room_id}")
def get_room(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _read_room(db, room_id, user)


def _read_room(db: Session, room_id: int, user: User) -> dict:
    with locked_room(db, room_id) as room:
        _require_member(db, room, user)
        event, rewarded = advance_room(db, room, clock.now())
        snap = _publish(db, room, event) if event else snapshot(db, room)
        db.commit()
    _after_rewards(rewarded)
    return snap


@router.get("/{room_id}/preview")
def get_room_preview(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    room = db.get(StudyRoom, room_id)
    if room is None:
        raise _not_found()
    visible = (_member(db, room.id, user.id, active_only=False) is not None
               or _pending_invitation(db, room.id, user.id) is not None
               or (room.visibility == "code" and are_friends(db, room.host_id, user.id)))
    if not visible or room.host_id in blocked_ids(db, user.id):
        raise _not_found()
    result = preview(db, room, user)
    db.commit()
    return result


@router.post("/{room_id}/join")
def join_room(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Join from an invitation or a friend's code room listed on the Study Together home."""
    with locked_room(db, room_id) as room:
        if room is None:
            raise _not_found()
        invitation = _pending_invitation(db, room.id, user.id)
        friend_room = room.visibility == "code" and are_friends(db, room.host_id, user.id)
        if invitation is None and not friend_room and _member(db, room.id, user.id) is None:
            raise _not_found()
        _, joined = _join(db, room, user, clock.now(), invitation=invitation)
        return _joined(db, room, joined)


@router.post("/{room_id}/leave")
def leave_room(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with locked_room(db, room_id) as room:
        if room is None:
            raise _not_found()
        member = _member(db, room.id, user.id)
        if member is None:
            if _member(db, room.id, user.id, active_only=False) is not None:
                return {"left": True, "room_closed": room.status != "open"}  # already left: retry-safe
            raise _not_found()
        event, rewarded = _leave(db, room, member, clock.now())
        _publish(db, room, event, revoke=(user.id,), close=event == "room_closed")
        db.commit()
        closed = room.status != "open"
    _after_rewards(rewarded)
    return {"left": True, "room_closed": closed, "last_session_id": room.last_session_id}


PROTECTED_SETTINGS = {"focus_minutes", "break_minutes", "cycles"}


@router.patch("/{room_id}")
def update_room(room_id: int, data: RoomPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    changes = data.model_dump(exclude_unset=True)
    with locked_room(db, room_id) as room:
        _require_host(db, room, user)
        _require_open(room)
        if room.current_session_id and PROTECTED_SETTINGS & {k for k, v in changes.items() if v != getattr(room, k)}:
            raise APIError(409, "session_in_progress", "Timer settings can't change during a session")
        if changes.get("max_members") is not None and changes["max_members"] < room.member_count:
            raise APIError(422, "max_members_too_low", "The room already has more members than that")
        for key, value in changes.items():
            if key == "goal":
                room.goal = value or None
            elif value is not None:
                setattr(room, key, value)
        snap = _publish(db, room, "settings_changed")
        db.commit()
        return snap


@router.post("/{room_id}/invitations")
def invite_to_room(room_id: int, data: InviteInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with locked_room(db, room_id) as room:
        _require_member(db, room, user)
        _require_open(room)
        result = _invite(db, room, user, data.user_ids, clock.now())
        db.commit()
        return result


@router.post("/{room_id}/start")
def start_session(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with locked_room(db, room_id) as room:
        _require_host(db, room, user)
        _require_open(room)
        t = clock.now()
        if room.current_session_id:  # double tap or retry: the session is already running
            event, rewarded = advance_room(db, room, t)
            if room.current_session_id:
                snap = _publish(db, room, event) if event else snapshot(db, room)
                db.commit()
                return {"room": snap, "already_started": True}
        session = StudyRoomSession(room_id=room.id, started_by_id=user.id, status="active", phase="focus", cycle=1,
                                   total_cycles=room.cycles, completed_cycles=0, focus_seconds=room.focus_minutes * 60,
                                   break_seconds=room.break_minutes * 60, started_at=t, phase_started_at=t,
                                   phase_ends_at=t + timedelta(minutes=room.focus_minutes), accrued_until=t, created_at=t)
        db.add(session)
        db.flush()
        claimed = db.execute(update(StudyRoom).where(StudyRoom.id == room.id, StudyRoom.current_session_id.is_(None),
                                                     StudyRoom.status == "open")
                             .values(current_session_id=session.id)).rowcount
        if claimed != 1:
            db.rollback()
            raise APIError(409, "session_in_progress", "A session is already running")
        db.refresh(room)
        for m in _active_members(db, room.id):
            db.add(_new_participant(session, m.user_id, t, seen=as_utc(m.last_seen_at)))
            if m.user_id != user.id:
                notify(db, m.user_id, "session_started", "Phiên học nhóm bắt đầu",
                       f"Phòng “{room.name}” đã bắt đầu {room.focus_minutes} phút tập trung.", {"room_id": room.id})
        snap = _publish(db, room, "session_started")
        db.commit()
        return {"room": snap, "already_started": False}


def _session_control(room_id: int, user: User, db: Session, action: str) -> dict:
    with locked_room(db, room_id) as room:
        _require_host(db, room, user)
        _require_open(room)
        t = clock.now()
        event, rewarded = advance_room(db, room, t)
        session = _current_session(db, room)
        if session is None:
            if action == "end" and room.last_session_id:  # already over: ending again is harmless
                snap = _publish(db, room, event) if event else snapshot(db, room)
                db.commit()
                _after_rewards(rewarded)
                return {"room": snap, "session_id": room.last_session_id}
            raise APIError(409, "no_active_session", "No session is running")
        if action == "pause":
            if session.status != "active":
                raise APIError(409, "session_not_running", "The session is not running")
            session.status, session.paused_at = "paused", t
            session.paused_remaining_ms = max(0, _ms(as_utc(session.phase_ends_at) - t))
            event = "session_paused"
        elif action == "resume":
            if session.status != "paused":
                raise APIError(409, "session_not_paused", "The session is not paused")
            session.status = "active"
            session.phase_ends_at = t + timedelta(milliseconds=session.paused_remaining_ms or 0)
            session.accrued_until, session.paused_at, session.paused_remaining_ms = t, None, None
            event = "session_resumed"
        else:
            rewarded = _cancel_session(db, room, t, "ended_by_host")
            event = "session_completed"
        snap = _publish(db, room, event)
        db.commit()
        session_id = session.id
    _after_rewards(rewarded)
    return {"room": snap, "session_id": session_id}


@router.post("/{room_id}/pause")
def pause_session(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _session_control(room_id, user, db, "pause")


@router.post("/{room_id}/resume")
def resume_session(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _session_control(room_id, user, db, "resume")


@router.post("/{room_id}/end")
def end_session(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _session_control(room_id, user, db, "end")


@router.post("/{room_id}/close")
def close_room(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with locked_room(db, room_id) as room:
        if room is not None and room.status != "open" and _member(db, room.id, user.id, active_only=False) is not None:
            return {"closed": True, "last_session_id": room.last_session_id}  # retry-safe
        _require_host(db, room, user)
        rewarded = _close_room(db, room, clock.now(), "room_closed")
        _publish(db, room, "room_closed", close=True)
        db.commit()
        last = room.last_session_id
    _after_rewards(rewarded)
    return {"closed": True, "last_session_id": last}


@router.post("/{room_id}/heartbeat")
def heartbeat(room_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Presence for clients without a WebSocket; returns the snapshot so it doubles as the polling fallback."""
    with locked_room(db, room_id) as room:
        member = _require_member(db, room, user)
        t = clock.now()
        event, rewarded = advance_room(db, room, t)
        if _touch(db, room, member, t) and not event:
            event = "member_status_changed"
        touch_active(db, user.id)
        snap = _publish(db, room, event) if event else snapshot(db, room, t)
        db.commit()
    _after_rewards(rewarded)
    return snap


@router.post("/{room_id}/reactions", status_code=202)
def send_reaction(room_id: int, data: ReactionInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Pet emotes and quick cheers: a fixed set (no free text), never stored, rate limited."""
    room = db.get(StudyRoom, room_id)
    _require_member(db, room, user)
    _require_open(room)
    enforce("reaction", settings.rate_limit_reaction, str(user.id))
    hub.publish("room", room.id, {"type": "room.reaction", "room_id": room.id, "user_id": user.id,
                                  "reaction": data.reaction, "at": clock.now()})
    return {"sent": True}


# ---------------------------------------------------------------------------- invitations endpoints
@invitations_router.get("")
def list_invitations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = pending_invitations(db, user)
    db.commit()
    return {"items": items}


def _own_invitation(db: Session, invitation_id: int, user: User) -> StudyRoomInvitation:
    invitation = db.get(StudyRoomInvitation, invitation_id)
    if invitation is None or invitation.invitee_id != user.id or invitation.inviter_id in blocked_ids(db, user.id):
        raise APIError(404, "invitation_not_found", "Invitation not found")
    return invitation


@invitations_router.get("/{invitation_id}")
def get_invitation(invitation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """One invitation with its current `state`, also after it expired or its room closed (opened from a notification)."""
    view = invitation_view(db, _own_invitation(db, invitation_id, user), user)
    if view is None:
        raise APIError(404, "invitation_not_found", "Invitation not found")
    db.commit()
    return view


@invitations_router.post("/{invitation_id}/accept")
def accept_invitation(invitation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    invitation = _own_invitation(db, invitation_id, user)
    with locked_room(db, invitation.room_id) as room:
        db.refresh(invitation)
        if invitation.status == "accepted" and _member(db, room.id, user.id) is not None:
            return {"room": snapshot(db, room), "already_member": True}
        if room.status != "open" and invitation.status in ("pending", "cancelled"):
            raise APIError(409, "room_closed", "This room is closed")
        if invitation.status != "pending":
            raise APIError(409, "invitation_not_pending", "This invitation is no longer open")
        if as_utc(invitation.expires_at) <= clock.now():
            raise APIError(410, "invitation_expired", "This invitation has expired")
        # Checked again now, not when it was sent: the two may have stopped being friends since.
        if not are_friends(db, invitation.inviter_id, user.id):
            invitation.status, invitation.responded_at = "cancelled", clock.now()
            db.commit()
            raise APIError(409, "invitation_not_pending", "This invitation is no longer open")
        _, joined = _join(db, room, user, clock.now(), invitation=invitation)
        return _joined(db, room, joined)


@invitations_router.post("/{invitation_id}/decline")
def decline_invitation(invitation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    invitation = _own_invitation(db, invitation_id, user)
    if invitation.status == "pending":
        invitation.status, invitation.responded_at = "declined", clock.now()
        db.commit()
    return {"id": invitation.id, "status": invitation.status}


# ---------------------------------------------------------------------------- session history and summary
def _session_brief(db: Session, session: StudyRoomSession, p: StudyRoomParticipant) -> dict:
    room = db.get(StudyRoom, session.room_id)
    count = len(_participants(db, session))
    return {"id": session.id, "room_id": session.room_id, "room_name": room.name if room else "", "status": session.status,
            "started_at": as_utc(session.started_at), "ended_at": as_utc(session.ended_at) if session.ended_at else None,
            "total_cycles": session.total_cycles, "completed_cycles": session.completed_cycles,
            "focus_seconds": p.focus_ms // 1000, "cycles_completed": p.cycles_completed,
            "exp_awarded": p.study_exp + p.bonus_exp, "participant_count": count}


def session_history(db: Session, user: User, limit: int = 20, before_id: int | None = None) -> tuple[list[dict], int | None]:
    query = (select(StudyRoomSession, StudyRoomParticipant)
             .join(StudyRoomParticipant, StudyRoomParticipant.session_id == StudyRoomSession.id)
             .where(StudyRoomParticipant.user_id == user.id,
                    StudyRoomSession.status.in_(("completed", "cancelled"))))
    if before_id is not None:
        query = query.where(StudyRoomSession.id < before_id)
    rows = db.execute(query.order_by(StudyRoomSession.id.desc()).limit(limit + 1)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return [_session_brief(db, s, p) for s, p in rows], (rows[-1][0].id if more else None)


@sessions_router.get("/history")
def get_session_history(limit: int = Query(default=20, ge=1, le=50), before_id: int | None = Query(default=None, ge=1),
                        user: User = Depends(current_user), db: Session = Depends(get_db)):
    items, next_before = session_history(db, user, limit, before_id)
    return {"items": items, "next_before_id": next_before}


@sessions_router.get("/{session_id}/summary")
def get_session_summary(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = db.get(StudyRoomSession, session_id)
    mine = db.scalar(select(StudyRoomParticipant).where(StudyRoomParticipant.session_id == session_id,
                                                        StudyRoomParticipant.user_id == user.id)) if session else None
    if session is None or mine is None:
        raise APIError(404, "session_not_found", "Session not found")
    room = db.get(StudyRoom, session.room_id)
    if session.status in ("active", "paused") and room is not None and _member(db, room.id, user.id):
        _read_room(db, room.id, user)  # brings the timer and the credited minutes up to now
        db.refresh(session)
        db.refresh(mine)
    participants = _participants(db, session)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([p.user_id for p in participants])))}
    profiles = profiles_for(db, set(users))
    people = []
    for p in participants:
        u = users.get(p.user_id)
        if u is None:
            continue
        shared = p.user_id == user.id or shares_stats(profiles.get(p.user_id))
        people.append({**public_user(u, profiles.get(p.user_id)), "user_id": u.id,
                       "focus_seconds": p.focus_ms // 1000 if shared else None,
                       "cycles_completed": p.cycles_completed if shared else None})
    db.commit()
    return {"id": session.id, "status": session.status, "end_reason": session.end_reason,
            "finalized": session.finalized_at is not None,
            "started_at": as_utc(session.started_at), "ended_at": as_utc(session.ended_at) if session.ended_at else None,
            "total_cycles": session.total_cycles, "completed_cycles": session.completed_cycles,
            "focus_minutes": session.focus_seconds // 60, "break_minutes": session.break_seconds // 60,
            "room": {"id": room.id, "name": room.name, "goal": room.goal, "status": room.status} if room else None,
            "me": {"focus_seconds": mine.focus_ms // 1000, "cycles_completed": mine.cycles_completed,
                   "study_exp": mine.study_exp, "bonus_exp": mine.bonus_exp,
                   "exp_awarded": mine.study_exp + mine.bonus_exp, "rewarded": mine.rewarded_at is not None},
            "participants": people,
            "team_quests": team_quests.quests_for_session(db, session, user.id)}


# ---------------------------------------------------------------------------- realtime hooks (called off the event loop)
def realtime_join(user_id: int, room_id: int) -> bool:
    """WebSocket subscribe: only active members of the room, on an account that is still active; marks them online."""
    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None or user.status != "active":
            return False
        with locked_room(db, room_id) as room:
            member = _member(db, room_id, user_id) if room is not None else None
            if member is None or room.status != "open":
                return False
            t = clock.now()
            event, rewarded = advance_room(db, room, t)
            if _touch(db, room, member, t) and not event:
                event = "member_status_changed"
            if event:
                _publish(db, room, event)
            db.commit()
    _after_rewards(rewarded)
    return True


def realtime_leave(user_id: int, room_id: int) -> None:
    """The user's last socket for this room closed: show them as away. Focus credit follows the grace rule instead."""
    with SessionLocal() as db:
        with locked_room(db, room_id) as room:
            member = _member(db, room_id, user_id) if room is not None else None
            if member is None or member.presence == "away":
                return
            member.presence = "away"
            _publish(db, room, "member_status_changed")
            db.commit()


def heartbeat_user(user_id: int, room_ids: tuple[int, ...]) -> None:
    with SessionLocal() as db:
        touch_active(db, user_id)
        db.commit()
        for room_id in room_ids:
            rewarded: list[int] = []
            with locked_room(db, room_id) as room:
                member = _member(db, room_id, user_id) if room is not None else None
                if member is None:
                    continue
                t = clock.now()
                event, rewarded = advance_room(db, room, t)
                if _touch(db, room, member, t) and not event:
                    event = "member_status_changed"
                if event:
                    _publish(db, room, event)
                db.commit()
            _after_rewards(rewarded)


def load_snapshot(room_id: int) -> dict | None:
    with SessionLocal() as db:
        room = db.get(StudyRoom, room_id)
        result = snapshot(db, room) if room is not None else None
        db.commit()
        return result


# ---------------------------------------------------------------------------- background tick
_sweep_count = 0


def sweep(t: datetime | None = None, full: bool | None = None) -> None:
    """Advance due timers, mark silent members away, hand over rooms whose host vanished and close idle rooms."""
    global _sweep_count
    _sweep_count += 1
    t = t or clock.now()
    with SessionLocal() as db:
        due = set(db.scalars(select(StudyRoom.id).join(StudyRoomSession, StudyRoomSession.id == StudyRoom.current_session_id)
                             .where(StudyRoomSession.status == "active", StudyRoomSession.phase_ends_at <= t)))
        stale = t - timedelta(seconds=settings.study_room_presence_seconds)
        due |= set(db.scalars(select(StudyRoomMember.room_id).where(
            StudyRoomMember.status == "active", StudyRoomMember.presence == "online", StudyRoomMember.last_seen_at < stale)))
        host, other = aliased(StudyRoomMember), aliased(StudyRoomMember)
        due |= set(db.scalars(  # host gone past the grace period while someone else is still here
            select(StudyRoom.id).join(host, and_(host.room_id == StudyRoom.id, host.user_id == StudyRoom.host_id))
            .where(StudyRoom.status == "open", host.last_seen_at < t - _grace(),
                   exists().where(other.room_id == StudyRoom.id, other.status == "active",
                                  other.user_id != StudyRoom.host_id, other.presence == "online"))))
        if full if full is not None else _sweep_count % 15 == 1:  # slower checks: every ~30 s with the default tick
            due |= set(db.scalars(select(StudyRoom.id).where(StudyRoom.status == "open")))
            from . import room_chat
            from .notifications import purge_old
            purge_old(db)
            room_chat.purge_old(db)
            team_quests.expire_due(db)
            db.commit()
    for room_id in sorted(due):
        try:
            _sweep_room(room_id, t)
        except Exception:
            log.exception("Study room sweep failed for room %s", room_id)


def _sweep_room(room_id: int, t: datetime) -> None:
    rewarded: list[int] = []
    with SessionLocal() as db:
        with locked_room(db, room_id) as room:
            if room is None or room.status != "open":
                return
            event, rewarded = advance_room(db, room, t)
            members = _active_members(db, room.id)
            stale = t - timedelta(seconds=settings.study_room_presence_seconds)
            for m in members:
                if m.presence == "online" and as_utc(m.last_seen_at) < stale:
                    m.presence = "away"
                    event = event or "member_status_changed"
            idle = t - timedelta(minutes=settings.study_room_idle_close_minutes)
            if members and all(as_utc(m.last_seen_at) < idle for m in members):
                rewarded += _close_room(db, room, t, "idle")
                _publish(db, room, "room_closed", close=True)
                db.commit()
                return
            host = next((m for m in members if m.user_id == room.host_id), None)
            host_gone = host is None or as_utc(host.last_seen_at) + _grace() < t
            if host_gone and any(m.presence == "online" and m.user_id != room.host_id for m in members):
                if _transfer_host(db, room) is not None:
                    event = "host_changed"
            if event:
                _publish(db, room, event)
            db.commit()
    _after_rewards(rewarded)
