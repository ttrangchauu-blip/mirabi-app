"""Friend visits to the personal pet room (Ghé thăm): a friend's saved room, read only, and three interactions.

Only accepted friends visit, never across a block, and only while the host allows visits (social_profiles). The visit
reads the host's saved room and pet through pet_room (never a copy, never the owner's unsaved changes) and returns
nothing else about them: no tasks, notes, schedule, statistics, email or friend code.

Interactions are stored in room_visit_interactions, which also enforces the limits: the same kind to the same friend
once per `visit_interaction_cooldown_minutes`, at most `visit_interaction_daily_limit` a day, plus a burst limit.
A retry with the same `client_request_id` returns what the first request did. These three never award EXP.

- "Chào pet" (hello): a greeting; while the host's pet is out walking it is left for them.
- "Động viên" (cheer): one of the preset CHEERS, never free text.
- "Rủ học" (study_invite): a real Study Together invitation, into the visitor's current room or a new private room
  with the chosen subject and Pomodoro rhythm. Accepting it goes through the usual room join checks.

Greetings and cheers of one kind are merged into one notification while it is unread (notifications.replace).

Playing with the host's pet (a tap on it) is the one thing that gives EXP: `friend_pet_exp_per_friend` from each friend
once per host day, at most `friend_pet_exp_daily_cap` per pet and day from all friends, never while the pet is out
walking and never to oneself. The limits are unique keys of friend_pet_exp_grants, so they hold under retries, fast
taps, several devices and concurrent visitors; the EXP goes through progression.award_exp (evolution included).
"""
import json
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock
from .config import settings
from .db import get_db
from .errors import APIError
from .friends import _visible_user, are_friends, ensure_profile, is_blocked_between
from .models import (FriendPetExpGrant, PomodoroSettings, RoomVisitInteraction, SocialNotification,
                     StudyRoom, StudyRoomInvitation, User, as_utc)
from .notifications import latest_unread, notify, replace
from .pet_room import activity, ensure_room, layout, walk_view
from .progression import award_exp
from .ratelimit import enforce
from .security import current_user
from .study_rooms import (RoomCreate, Subject, _current_membership, _invite, _member, create_room_for, locked_room,
                          snapshot)

router = APIRouter(prefix="/api/personal-room/visit", tags=["room visits"])

KINDS = ("hello", "cheer", "study_invite")
# Preset cheers (keys are stable, the app shows the same texts). Keep in sync with CHEERS in mobile/src/room/visit.ts.
CHEERS = {
    "study_well": "Học tốt nhé!",
    "keep_going": "Cùng cố gắng nào!",
    "take_break": "Nhớ nghỉ ngơi nhé!",
    "believe": "Mình tin bạn làm được!",
    "proud": "Bạn đang làm rất tốt!",
}
CheerKey = Literal["study_well", "keep_going", "take_break", "believe", "proud"]
# Same labels as SUBJECTS in mobile/src/screens/together/labels.ts, for the invitation text.
SUBJECT_LABELS = {"general": "Tự học", "math": "Toán", "literature": "Ngữ văn", "english": "Tiếng Anh",
                  "science": "Khoa học", "coding": "Lập trình", "language": "Ngoại ngữ", "exam": "Ôn thi",
                  "reading": "Đọc sách", "work": "Công việc", "other": "Khác"}


class GreetingInput(BaseModel):
    kind: Literal["hello", "cheer"]
    message: Optional[CheerKey] = None
    client_request_id: Optional[str] = Field(default=None, min_length=8, max_length=64)

    @model_validator(mode="after")
    def message_for_cheers_only(self):
        if self.kind == "cheer" and self.message is None:
            raise ValueError("Choose a cheer message")
        if self.kind == "hello" and self.message is not None:
            raise ValueError("A greeting has no message")
        return self


class PetPlayInput(BaseModel):
    client_request_id: str = Field(min_length=8, max_length=64)


class StudyInviteInput(BaseModel):
    subject: Subject = "general"
    focus_minutes: int = Field(default=25, ge=5, le=90)
    break_minutes: int = Field(default=5, ge=1, le=30)
    cycles: int = Field(default=2, ge=1, le=8)
    client_request_id: str = Field(min_length=8, max_length=64)


# ---------------------------------------------------------------------------- access
def visitable_host(db: Session, visitor: User, host_id: int) -> User:
    """Only accepted friends may visit, never across a block. Anything else looks like a missing room. A friend who
    turned visits off says so (`room_visits_disabled`), so the app can explain instead of failing."""
    host = _visible_user(db, host_id)
    if host is None or host.id == visitor.id or is_blocked_between(db, visitor.id, host.id) \
            or not are_friends(db, visitor.id, host.id):
        raise APIError(404, "room_not_found", "Room not found")
    if not ensure_profile(db, host.id).allow_room_visits:
        raise APIError(403, "room_visits_disabled", "This friend doesn't take visitors right now")
    return host


def owner_view(host: User) -> dict:
    """The host as the visit screen shows them. No friend code, email or anything private."""
    return {"id": host.id, "display_name": host.display_name, "avatar_theme": host.avatar_theme, "pet": host.pet,
            "pet_name": host.pet_name, "pet_level": host.level}


# ---------------------------------------------------------------------------- limits
def _cooldown() -> timedelta:
    return timedelta(minutes=settings.visit_interaction_cooldown_minutes)


def available_at(db: Session, visitor: User, host: User) -> dict[str, str | None]:
    """When each interaction can be sent to this friend again (None: now)."""
    since = clock.now() - _cooldown()
    rows = db.execute(select(RoomVisitInteraction.kind, func.max(RoomVisitInteraction.created_at)).where(
        RoomVisitInteraction.visitor_id == visitor.id, RoomVisitInteraction.host_id == host.id,
        RoomVisitInteraction.created_at >= since).group_by(RoomVisitInteraction.kind)).all()
    latest = {kind: as_utc(at) for kind, at in rows}
    return {kind: (latest[kind] + _cooldown()).isoformat() if kind in latest else None for kind in KINDS}


def check_limits(db: Session, visitor: User, host: User, kind: str) -> None:
    enforce("visit-interaction", settings.rate_limit_visit_interaction, str(visitor.id))
    now = clock.now()
    last = db.scalar(select(func.max(RoomVisitInteraction.created_at)).where(
        RoomVisitInteraction.visitor_id == visitor.id, RoomVisitInteraction.host_id == host.id,
        RoomVisitInteraction.kind == kind))
    if last is not None and as_utc(last) > now - _cooldown():
        wait = int((as_utc(last) + _cooldown() - now).total_seconds()) + 1
        raise APIError(429, "greeting_cooldown", "This was sent a moment ago", headers={"Retry-After": str(wait)})
    today = db.scalar(select(func.count()).select_from(RoomVisitInteraction).where(
        RoomVisitInteraction.visitor_id == visitor.id, RoomVisitInteraction.created_at >= now - timedelta(days=1)))
    if today >= settings.visit_interaction_daily_limit:
        raise APIError(429, "visit_daily_limit", "That's enough visits for today")


def _previous(db: Session, visitor: User, client_request_id: str | None) -> RoomVisitInteraction | None:
    if not client_request_id:
        return None
    return db.scalar(select(RoomVisitInteraction).where(RoomVisitInteraction.visitor_id == visitor.id,
                                                        RoomVisitInteraction.client_request_id == client_request_id))


def _store(db: Session, row: RoomVisitInteraction) -> RoomVisitInteraction | None:
    """Insert the interaction; None when a concurrent retry with the same client_request_id stored it first."""
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
        return row
    except IntegrityError:
        return None


# ---------------------------------------------------------------------------- playing with the host's pet
def host_day(db: Session, host: User) -> date:
    """Today in the host's account timezone (never a zone sent by the visitor's device)."""
    from .learning import local_day_bounds
    prefs = db.get(PomodoroSettings, host.id)
    try:
        return local_day_bounds(clock.now(), prefs.timezone if prefs else "UTC")[0]
    except APIError:  # an unreadable stored zone: fall back to UTC rather than refuse the tap
        return local_day_bounds(clock.now(), "UTC")[0]


def pet_gift_state(db: Session, visitor: User, host: User) -> dict:
    """What a tap on the host's pet would give now: `available` and the EXP, or why not (`reason`)."""
    per_friend, cap = settings.friend_pet_exp_per_friend, settings.friend_pet_exp_daily_cap
    base = {"exp": per_friend, "daily_cap": cap}
    if walk_view(db, host)["away"]:
        return {**base, "available": False, "reason": "pet_away"}
    day = host_day(db, host)
    mine = db.scalar(select(FriendPetExpGrant.id).where(
        FriendPetExpGrant.host_id == host.id, FriendPetExpGrant.pet_id == host.pet, FriendPetExpGrant.local_date == day,
        FriendPetExpGrant.visitor_id == visitor.id))
    if mine is not None:
        return {**base, "available": False, "reason": "already_given"}
    received = db.scalar(select(func.coalesce(func.sum(FriendPetExpGrant.amount), 0)).where(
        FriendPetExpGrant.host_id == host.id, FriendPetExpGrant.pet_id == host.pet, FriendPetExpGrant.local_date == day)) or 0
    if received >= cap or per_friend <= 0:
        return {**base, "available": False, "reason": "pet_full"}
    return {**base, "exp": min(per_friend, cap - received), "available": True, "reason": None}


def _play_result(grant: FriendPetExpGrant | None, host: User, reason: str | None, replayed: bool) -> dict:
    return {"granted": grant.amount if grant else 0, "reason": "granted" if grant else reason, "pet_name": host.pet_name,
            "pet_level": host.level, "replayed": replayed}


def give_pet_exp(db: Session, visitor: User, host: User, client_request_id: str) -> tuple[FriendPetExpGrant | None, str | None]:
    """One grant if this friend has not given today and the pet's cap has room: the next free slot, retried when a
    concurrent visitor took it. The pet's EXP is added atomically by award_exp."""
    per_friend, cap = settings.friend_pet_exp_per_friend, settings.friend_pet_exp_daily_cap
    slots = -(-cap // per_friend) if per_friend > 0 else 0
    day = host_day(db, host)
    for _ in range(slots + 2):
        state = pet_gift_state(db, visitor, host)
        if not state["available"]:
            return None, state["reason"]
        used = db.scalar(select(func.coalesce(func.max(FriendPetExpGrant.slot), 0)).where(
            FriendPetExpGrant.host_id == host.id, FriendPetExpGrant.pet_id == host.pet, FriendPetExpGrant.local_date == day)) or 0
        if used >= slots:
            return None, "pet_full"
        grant = FriendPetExpGrant(host_id=host.id, visitor_id=visitor.id, pet_id=host.pet, local_date=day, slot=used + 1,
                                  amount=state["exp"], client_request_id=client_request_id, created_at=clock.now())
        try:
            with db.begin_nested():
                db.add(grant)
                db.flush()
        except IntegrityError:
            continue  # another friend took this slot, or this friend's other device gave first: look again
        db.refresh(host)
        award_exp(host, db, source="friend_pet", reference_id=f"friend_pet:{grant.id}", requested=grant.amount,
                  daily_cap=grant.amount, already_earned=0)
        return grant, None
    return None, "pet_full"


# ---------------------------------------------------------------------------- notifications
def _greeting_text(kind: str, visitor: User, host: User, count: int, actors: int, message: str | None,
                   away: bool) -> tuple[str, str]:
    pet = host.pet_name or "pet"
    name = visitor.display_name
    if kind == "hello":
        if actors > 1:
            return f"{name} và {actors - 1} bạn khác ghé thăm phòng", f"{pet} nhận được {count} lời chào từ bạn bè."
        if count > 1:
            return f"{name} ghé thăm phòng", f"{name} đã ghé chào {pet} {count} lần."
        if away:
            return f"{name} để lại lời chào", f"{name} ghé phòng lúc {pet} đang đi dạo và để lại lời chào."
        return f"{name} ghé thăm phòng", f"{name} đã ghé phòng và chào {pet}."
    if actors > 1:
        return f"{name} và {actors - 1} bạn khác động viên bạn", f"{count} lời động viên, mới nhất: “{message}”"
    if count > 1:
        return f"{name} gửi lời động viên", f"{count} lời động viên, mới nhất: “{message}”"
    return f"{name} gửi lời động viên", f"“{message}” Gửi bạn và {pet}."


def _notify_greeting(db: Session, host: User, visitor: User, row: RoomVisitInteraction) -> SocialNotification:
    """One notification per kind while unread: a new greeting or cheer joins the unread one from the last hours."""
    message = CHEERS.get(row.message_key) if row.message_key else None
    since = clock.now() - timedelta(hours=settings.visit_notification_group_hours)
    old = latest_unread(db, host.id, "room_visit", row.kind, since)
    previous = json.loads(old.data_json) if old is not None else {}
    actor_ids = [visitor.id] + [a for a in previous.get("actor_ids", []) if a != visitor.id]
    count = previous.get("count", 0) + 1
    title, body = _greeting_text(row.kind, visitor, host, count, len(actor_ids), message, row.host_away)
    data = {"group": row.kind, "action": row.kind, "user_id": visitor.id, "actor_ids": actor_ids[:20], "count": count,
            "message": row.message_key, "host_away": row.host_away}
    if old is None:
        return notify(db, host.id, "room_visit", title, body, data)
    old_id = old.id
    n = replace(db, old, title, body, data)
    db.execute(update(RoomVisitInteraction).where(RoomVisitInteraction.notification_id == old_id)
               .values(notification_id=n.id))
    return n


def greeting_result(row: RoomVisitInteraction, replayed: bool) -> dict:
    return {"sent": True, "id": row.id, "kind": row.kind, "message": row.message_key, "host_away": row.host_away,
            "available_at": (as_utc(row.created_at) + _cooldown()).isoformat(), "replayed": replayed}


# ---------------------------------------------------------------------------- endpoints
@router.get("/{user_id}")
def visit_room(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A friend's saved room, read only: its name and layout, their pet and whether it is home. Unsaved changes on the
    owner's screen are never part of it, and opening it changes nothing (no walk is settled, no EXP)."""
    host = visitable_host(db, user, user_id)
    profile = ensure_profile(db, host.id)
    room = ensure_room(db, host)
    return {"owner": owner_view(host), "room": {"name": room.name, "layout": layout(room)},
            "pet": {"id": host.pet, "name": host.pet_name, "level": host.level},
            "activity": activity(db, host, viewer_id=user.id), "walk": {"away": walk_view(db, host)["away"]},
            "guest_pet": {"id": user.pet, "name": user.pet_name, "level": user.level},
            "can_invite_study": bool(profile.allow_study_invites), "available_at": available_at(db, user, host),
            "pet_gift": pet_gift_state(db, user, host)}


@router.post("/{user_id}/pet-play")
def play_with_pet(user_id: int, data: PetPlayInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A tap on the friend's pet. The pet always reacts in the app; this decides whether the tap also gives it EXP
    (`granted`, else `reason`: already_given, pet_full or pet_away). Friendship, the pet's state and both limits are
    checked here; the same `client_request_id` returns the first answer. Your own pet cannot be visited."""
    host = visitable_host(db, user, user_id)
    enforce("pet-play", settings.rate_limit_pet_play, str(user.id))
    same = select(FriendPetExpGrant).where(FriendPetExpGrant.visitor_id == user.id,
                                           FriendPetExpGrant.client_request_id == data.client_request_id)
    previous = db.scalar(same)
    if previous is not None:
        return _play_result(previous, host, None, replayed=True)
    grant, reason = give_pet_exp(db, user, host, data.client_request_id)
    if grant is None and (previous := db.scalar(same)) is not None:
        # A retry that arrived while the first request was still giving: the first one's answer, not "already given".
        return _play_result(previous, host, None, replayed=True)
    db.commit()
    if grant is not None:
        db.refresh(host)
    return _play_result(grant, host, reason, replayed=False)


@router.post("/{user_id}/greetings", status_code=201)
def send_greeting(user_id: int, data: GreetingInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """"Chào pet" or "Động viên": a notification to the host, also while their pet is out walking (it waits for them)."""
    host = visitable_host(db, user, user_id)
    if (previous := _previous(db, user, data.client_request_id)) is not None:
        return greeting_result(previous, replayed=True)
    check_limits(db, user, host, data.kind)
    row = _store(db, RoomVisitInteraction(
        visitor_id=user.id, host_id=host.id, kind=data.kind, message_key=data.message,
        host_away=walk_view(db, host)["away"], client_request_id=data.client_request_id, created_at=clock.now()))
    if row is None:
        return greeting_result(_previous(db, user, data.client_request_id), replayed=True)
    row.notification_id = _notify_greeting(db, host, user, row).id
    db.commit()
    return greeting_result(row, replayed=False)


def _invite_result(db: Session, row: RoomVisitInteraction, created_room: bool, replayed: bool) -> dict:
    room = db.get(StudyRoom, row.room_id) if row.room_id else None
    invitation = db.get(StudyRoomInvitation, row.invitation_id) if row.invitation_id else None
    return {"sent": True, "id": row.id, "replayed": replayed, "created_room": created_room,
            "room": snapshot(db, room) if room is not None and room.status == "open" else None,
            "invitation": {"id": invitation.id, "status": invitation.status,
                           "expires_at": as_utc(invitation.expires_at).isoformat()} if invitation else None,
            "available_at": (as_utc(row.created_at) + _cooldown()).isoformat()}


INVITE_REFUSALS = {
    "not_friends": (404, "room_not_found", "Room not found"),
    "invites_disabled": (403, "study_invites_disabled", "This friend doesn't take study invitations right now"),
    "already_member": (409, "already_member", "Your friend is already in this room"),
}


@router.post("/{user_id}/study-invite", status_code=201)
def invite_to_study(user_id: int, data: StudyInviteInput, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """"Rủ học": invite the host into the visitor's current study room, or into a new private room with the chosen
    subject and rhythm (the room's own settings win when the visitor is already in one). Retry-safe."""
    host = visitable_host(db, user, user_id)
    if not ensure_profile(db, host.id).allow_study_invites:
        raise APIError(403, "study_invites_disabled", "This friend doesn't take study invitations right now")
    if (previous := _previous(db, user, data.client_request_id)) is not None:
        return _invite_result(db, previous, created_room=False, replayed=True)
    check_limits(db, user, host, "study_invite")
    current = _current_membership(db, user.id)
    created = False
    if current is not None:
        room_id = current.room_id
    else:
        room, replayed = create_room_for(db, user, RoomCreate(
            name=f"Học cùng {user.display_name}"[:60], subject=data.subject, focus_minutes=data.focus_minutes,
            break_minutes=data.break_minutes, cycles=data.cycles, max_members=4, visibility="private"),
            idempotency_key=f"visit:{data.client_request_id}")
        room_id, created = room.id, not replayed
        db.flush()
    with locked_room(db, room_id) as room:
        if room is None or room.status != "open":
            raise APIError(409, "room_closed", "This room is closed")
        if _member(db, room.id, host.id) is not None:
            raise APIError(409, "already_member", "Your friend is already in this room")
        if room.member_count >= room.max_members:
            raise APIError(409, "room_full", "This room is full")
        rhythm = f"{SUBJECT_LABELS.get(room.subject, 'Tự học')} · {room.focus_minutes} phút × {room.cycles} lượt"
        result = _invite(db, room, user, [host.id], clock.now(),
                         body=f"{user.display_name} ghé phòng và rủ bạn cùng học: {rhythm}.", extra={"source": "visit"})
        if result["skipped"]:
            status, code, detail = INVITE_REFUSALS[result["skipped"][0]["reason"]]
            raise APIError(status, code, detail)
        invitation = db.scalar(select(StudyRoomInvitation).where(StudyRoomInvitation.room_id == room.id,
                                                                 StudyRoomInvitation.invitee_id == host.id))
        notification_id = db.scalar(select(SocialNotification.id).where(
            SocialNotification.user_id == host.id, SocialNotification.kind == "room_invitation")
            .order_by(SocialNotification.id.desc()).limit(1))
        row = _store(db, RoomVisitInteraction(
            visitor_id=user.id, host_id=host.id, kind="study_invite", host_away=walk_view(db, host)["away"],
            room_id=room.id, invitation_id=invitation.id, notification_id=notification_id,
            client_request_id=data.client_request_id, created_at=clock.now()))
        if row is None:  # a concurrent retry finished first; drop this attempt's duplicate notification
            db.rollback()
            return _invite_result(db, _previous(db, user, data.client_request_id), created_room=False, replayed=True)
        db.commit()
        return _invite_result(db, row, created_room=created, replayed=False)
