"""Friends, blocking, reports and social privacy settings for Study Together.

A friendship is one row per pair (user_low_id < user_high_id, unique), so two people sending each other a request at
the same moment can't create two contradictory rows: the loser of the insert race finds the other request and accepts
it. Search and every public view expose only display name, avatar, pet and public code: never email or other data.
Blocking is mutual in effect: neither side can find, befriend or invite the other.
"""
import re
import secrets
from datetime import timedelta
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, model_validator
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock
from .config import settings
from .db import get_db
from .errors import APIError
from .models import (Friendship, SocialProfile, StudyRoom, StudyRoomInvitation, StudyRoomMember, StudyRoomMessage,
                     StudyRoomParticipant, StudyRoomSession, User, UserBlock, UserReport, as_utc)
from .notifications import notify
from .ratelimit import client_ip, enforce
from .security import admin_user, current_user

router = APIRouter(prefix="/api", tags=["friends"])

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, easy to read aloud
PUBLIC_CODE_LENGTH = 8
ONLINE_SECONDS = 180
QR_PREFIX = "MIRABI-FRIEND:"  # what the app's friend QR code holds, followed by the public code
ACTIVE_TOUCH_SECONDS = 60


def random_code(length: int = PUBLIC_CODE_LENGTH) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_code(value: str) -> str:
    return re.sub(r"[\s\-]", "", value or "").upper()


def _strip(value):
    return value.strip() if isinstance(value, str) else value


def no_control_chars(value: str | None) -> str | None:
    if value is not None and any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("Text must not contain control characters")
    return value


def pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


# ---------------------------------------------------------------------------- profiles
def ensure_profile(db: Session, user_id: int) -> SocialProfile:
    profile = db.get(SocialProfile, user_id)
    if profile is not None:
        return profile
    for _ in range(5):
        candidate = SocialProfile(user_id=user_id, public_code=random_code())
        try:
            with db.begin_nested():
                db.add(candidate)
            return candidate
        except IntegrityError:  # code collision, or a concurrent request created the profile
            existing = db.get(SocialProfile, user_id)
            if existing is not None:
                return existing
    raise APIError(503, "try_again", "Please try again")


def profiles_for(db: Session, user_ids: set[int]) -> dict[int, SocialProfile]:
    found = {p.user_id: p for p in db.scalars(select(SocialProfile).where(SocialProfile.user_id.in_(user_ids)))} if user_ids else {}
    for user_id in user_ids - set(found):
        found[user_id] = ensure_profile(db, user_id)
    return found


def touch_active(db: Session, user_id: int) -> None:
    """Record activity for the friends' "online" dot; written at most once a minute."""
    profile = ensure_profile(db, user_id)
    t = clock.now()
    if profile.last_active_at is None or as_utc(profile.last_active_at) < t - timedelta(seconds=ACTIVE_TOUCH_SECONDS):
        profile.last_active_at = t


def public_user(user: User, profile: SocialProfile | None = None) -> dict:
    """Everything another user may see about someone. Never add email, role or private study content here."""
    return {"id": user.id, "display_name": user.display_name, "avatar_theme": user.avatar_theme, "pet": user.pet,
            "pet_name": user.pet_name, "pet_level": user.level,
            "public_code": profile.public_code if profile else None}


def shares_stats(profile: SocialProfile | None) -> bool:
    return profile is None or bool(profile.share_study_stats)


# ---------------------------------------------------------------------------- relationships
def blocked_ids(db: Session, user_id: int) -> set[int]:
    """Users this user blocked or was blocked by."""
    rows = db.execute(select(UserBlock.blocker_id, UserBlock.blocked_id).where(
        or_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == user_id))).all()
    return {b if a == user_id else a for a, b in rows}


def is_blocked_between(db: Session, a: int, b: int) -> bool:
    return db.scalar(select(UserBlock.id).where(or_(
        and_(UserBlock.blocker_id == a, UserBlock.blocked_id == b),
        and_(UserBlock.blocker_id == b, UserBlock.blocked_id == a))).limit(1)) is not None


def friendship(db: Session, a: int, b: int) -> Friendship | None:
    low, high = pair(a, b)
    return db.scalar(select(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high))


def are_friends(db: Session, a: int, b: int) -> bool:
    row = friendship(db, a, b)
    return row is not None and row.status == "accepted"


def friend_ids(db: Session, user_id: int) -> set[int]:
    rows = db.execute(select(Friendship.user_low_id, Friendship.user_high_id).where(
        Friendship.status == "accepted",
        or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id))).all()
    return {high if low == user_id else low for low, high in rows}


def relationship(row: Friendship | None, me: int) -> str:
    if row is None or row.status == "declined":
        return "none"
    if row.status == "accepted":
        return "friend"
    return "outgoing" if row.requester_id == me else "incoming"


def _visible_user(db: Session, user_id: int) -> User | None:
    """Users that can take part in Study Together: active accounts that have adopted their pet."""
    user = db.get(User, user_id)
    return user if user is not None and user.status == "active" and user.pet_name is not None else None


# ---------------------------------------------------------------------------- presence
def presence_for(db: Session, viewer_id: int, user_ids: set[int]) -> dict[int, dict]:
    """What friends may see: studying (in a running focus phase), online, offline or hidden by their settings.

    A friend's room is included only when the viewer could join it (a code room); private rooms stay private.
    """
    if not user_ids:
        return {}
    t = clock.now()
    profiles = profiles_for(db, user_ids)
    memberships = {m.user_id: m for m in db.scalars(select(StudyRoomMember).where(
        StudyRoomMember.user_id.in_(user_ids), StudyRoomMember.status == "active"))}
    rooms = {r.id: r for r in db.scalars(select(StudyRoom).where(
        StudyRoom.id.in_({m.room_id for m in memberships.values()}))) } if memberships else {}
    session_ids = {r.current_session_id for r in rooms.values() if r.current_session_id}
    sessions = {s.id: s for s in db.scalars(select(StudyRoomSession).where(StudyRoomSession.id.in_(session_ids)))} if session_ids else {}
    present = {(p.session_id, p.user_id) for p in db.scalars(select(StudyRoomParticipant).where(
        StudyRoomParticipant.session_id.in_(session_ids), StudyRoomParticipant.present.is_(True)))} if session_ids else set()
    result = {}
    for user_id in user_ids:
        profile = profiles[user_id]
        if profile.presence_visibility == "nobody":
            result[user_id] = {"status": "hidden", "room": None}
            continue
        member = memberships.get(user_id)
        room = rooms.get(member.room_id) if member else None
        session = sessions.get(room.current_session_id) if room and room.current_session_id else None
        if session and session.status == "active" and session.phase == "focus" and (session.id, user_id) in present:
            status = "studying"
        elif (profile.last_active_at and as_utc(profile.last_active_at) >= t - timedelta(seconds=ONLINE_SECONDS)) or (
                member and member.presence == "online"):
            status = "online"
        else:
            status = "offline"
        joinable = room is not None and room.status == "open" and room.visibility == "code"
        result[user_id] = {"status": status,
                           "room": {"id": room.id, "name": room.name, "member_count": room.member_count,
                                    "max_members": room.max_members} if joinable else None}
    return result


def list_friends(db: Session, user: User) -> list[dict]:
    ids = friend_ids(db, user.id) - blocked_ids(db, user.id)
    users = [u for u in db.scalars(select(User).where(User.id.in_(ids), User.status == "active"))] if ids else []
    profiles = profiles_for(db, {u.id for u in users})
    presence = presence_for(db, user.id, {u.id for u in users})
    order = {"studying": 0, "online": 1, "offline": 2, "hidden": 3}
    items = [{**public_user(u, profiles[u.id]), "presence": presence[u.id]["status"], "room": presence[u.id]["room"],
              "can_visit": bool(profiles[u.id].allow_room_visits),
              "accepts_study_invites": bool(profiles[u.id].allow_study_invites)} for u in users]
    return sorted(items, key=lambda f: (order[f["presence"]], f["display_name"].lower()))


def online_friends(db: Session, user: User) -> list[dict]:
    """Friends currently online or studying, for the home dashboard."""
    return [{"id": f["id"], "name": f["display_name"], "status": f["presence"]}
            for f in list_friends(db, user) if f["presence"] in ("online", "studying")]


# ---------------------------------------------------------------------------- social settings
class SocialSettingsPatch(BaseModel):
    presence_visibility: Optional[Literal["friends", "nobody"]] = None
    share_study_stats: Optional[bool] = None
    discoverable: Optional[bool] = None
    allow_room_visits: Optional[bool] = None
    allow_study_invites: Optional[bool] = None


def settings_view(user: User, profile: SocialProfile) -> dict:
    return {**public_user(user, profile), "presence_visibility": profile.presence_visibility,
            "share_study_stats": profile.share_study_stats, "discoverable": profile.discoverable,
            "allow_room_visits": profile.allow_room_visits, "allow_study_invites": profile.allow_study_invites}


@router.get("/social/me")
def get_social_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = ensure_profile(db, user.id)
    db.commit()
    return settings_view(user, profile)


@router.patch("/social/me")
def update_social_settings(data: SocialSettingsPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = ensure_profile(db, user.id)
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(profile, key, value)
    db.commit()
    return settings_view(user, profile)


# ---------------------------------------------------------------------------- search
@router.get("/users/search")
def search_users(q: Annotated[str, Query(min_length=2, max_length=40)], limit: int = Query(default=20, ge=1, le=20),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    enforce("user-search", settings.rate_limit_user_search, str(user.id))
    term = q.strip()
    if len(term) < 2:
        raise APIError(422, "query_too_short", "Search needs at least 2 characters")
    hidden = blocked_ids(db, user.id) | {user.id}
    found: list[User] = []
    code = normalize_code(term)
    if len(code) == PUBLIC_CODE_LENGTH:
        match = db.scalar(select(User).join(SocialProfile, SocialProfile.user_id == User.id).where(
            SocialProfile.public_code == code))
        if match is not None and match.id not in hidden and _visible_user(db, match.id):
            found.append(match)
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    by_name = db.scalars(
        select(User).outerjoin(SocialProfile, SocialProfile.user_id == User.id).where(
            User.display_name.ilike(f"%{escaped}%", escape="\\"), User.status == "active", User.pet_name.is_not(None),
            User.id.not_in(hidden), or_(SocialProfile.discoverable.is_(None), SocialProfile.discoverable.is_(True)),
        ).order_by(func.lower(User.display_name), User.id).limit(limit))
    for candidate in by_name:
        if all(candidate.id != u.id for u in found):
            found.append(candidate)
    found = found[:limit]
    profiles = profiles_for(db, {u.id for u in found})
    rows = {(f.user_low_id, f.user_high_id): f for f in db.scalars(select(Friendship).where(or_(
        and_(Friendship.user_low_id == user.id, Friendship.user_high_id.in_([u.id for u in found])),
        and_(Friendship.user_high_id == user.id, Friendship.user_low_id.in_([u.id for u in found])))))} if found else {}
    db.commit()
    results = []
    for candidate in found:
        row = rows.get(pair(user.id, candidate.id))
        results.append({**public_user(candidate, profiles[candidate.id]), "relationship": relationship(row, user.id),
                        "request_id": row.id if row is not None and row.status == "pending" else None})
    return {"results": results}


class CodeLookupInput(BaseModel):
    public_code: Annotated[str, BeforeValidator(_strip), Field(min_length=4, max_length=40)]


@router.post("/users/lookup")
def lookup_user(data: CodeLookupInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The short profile behind an exact friend code (typed, or read from a friend QR code "MIRABI-FRIEND:<code>").
    The code goes in the body, not the URL, so it stays out of access logs."""
    enforce("friend-lookup", settings.rate_limit_friend_lookup, str(user.id))
    raw = data.public_code.strip()
    if raw.upper().startswith(QR_PREFIX):
        raw = raw[len(QR_PREFIX):]
    profile = db.scalar(select(SocialProfile).where(SocialProfile.public_code == normalize_code(raw)))
    target = _visible_user(db, profile.user_id) if profile else None
    if target is None or (target.id != user.id and target.id in blocked_ids(db, user.id)):
        raise APIError(404, "user_not_found", "User not found")
    if target.id == user.id:
        return {**public_user(target, profile), "relationship": "self", "request_id": None}
    row = friendship(db, user.id, target.id)
    return {**public_user(target, profile), "relationship": relationship(row, user.id),
            "request_id": row.id if row is not None and row.status == "pending" else None}


# ---------------------------------------------------------------------------- friend requests
class FriendRequestInput(BaseModel):
    user_id: Optional[int] = Field(default=None, ge=1)
    public_code: Optional[Annotated[str, BeforeValidator(_strip), Field(min_length=4, max_length=20)]] = None

    @model_validator(mode="after")
    def one_target(self):
        if (self.user_id is None) == (self.public_code is None):
            raise ValueError("Provide either user_id or public_code")
        return self


def request_view(db: Session, row: Friendship, me: int) -> dict:
    other_id = row.user_high_id if row.user_low_id == me else row.user_low_id
    other = db.get(User, other_id)
    return {"id": row.id, "status": row.status, "direction": "outgoing" if row.requester_id == me else "incoming",
            "user": public_user(other, ensure_profile(db, other_id)) if other else None, "created_at": as_utc(row.created_at)}


def _accept(db: Session, row: Friendship, accepter: User) -> bool:
    accepted = db.execute(update(Friendship).where(Friendship.id == row.id, Friendship.status == "pending").values(
        status="accepted", responded_at=clock.now(), updated_at=clock.now())).rowcount == 1
    if accepted:
        db.refresh(row)
        notify(db, row.requester_id, "friend_accepted", "Đã trở thành bạn bè",
               f"{accepter.display_name} đã chấp nhận lời mời kết bạn.", {"user_id": accepter.id})
    return accepted


def _resolve_target(db: Session, data: FriendRequestInput) -> User | None:
    if data.user_id is not None:
        return _visible_user(db, data.user_id)
    profile = db.scalar(select(SocialProfile).where(SocialProfile.public_code == normalize_code(data.public_code)))
    return _visible_user(db, profile.user_id) if profile else None


@router.post("/friend-requests", status_code=201)
def send_friend_request(data: FriendRequestInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    enforce("friend-request", settings.rate_limit_friend_request, str(user.id))
    target = _resolve_target(db, data)
    if target is not None and target.id == user.id:
        raise APIError(422, "cannot_friend_self", "You cannot send a friend request to yourself")
    if target is None or db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == target.id,
                                                               UserBlock.blocked_id == user.id)):
        # Someone who blocked you looks exactly like someone who doesn't exist.
        raise APIError(404, "user_not_found", "User not found")
    if db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == target.id)):
        raise APIError(409, "user_blocked", "Unblock this user before sending a friend request")
    low, high = pair(user.id, target.id)
    for _ in range(2):
        row = friendship(db, user.id, target.id)
        if row is None:
            row = Friendship(user_low_id=low, user_high_id=high, requester_id=user.id, status="pending",
                             created_at=clock.now())
            try:
                with db.begin_nested():
                    db.add(row)
            except IntegrityError:
                continue  # the other person asked at the same moment: handle their request below
            notify(db, target.id, "friend_request", "Lời mời kết bạn",
                   f"{user.display_name} muốn kết bạn để cùng học.", {"request_id": row.id, "user_id": user.id})
            db.commit()
            return {**request_view(db, row, user.id), "auto_accepted": False}
        if row.status == "accepted":
            raise APIError(409, "already_friends", "You are already friends")
        if row.status == "pending" and row.requester_id == user.id:
            raise APIError(409, "friend_request_exists", "You already sent a friend request")
        if row.status == "pending":
            _accept(db, row, user)  # they already asked you: sending back means yes
            db.commit()
            return {**request_view(db, row, user.id), "auto_accepted": True}
        # Declined earlier: the requester may ask again after a cooldown; the person who declined may ask any time.
        cooldown = timedelta(hours=settings.friend_request_cooldown_hours)
        if row.requester_id == user.id and row.responded_at and as_utc(row.responded_at) > clock.now() - cooldown:
            raise APIError(409, "friend_request_cooldown", "Please wait before sending another request")
        reopened = db.execute(update(Friendship).where(Friendship.id == row.id, Friendship.status == "declined").values(
            status="pending", requester_id=user.id, responded_at=None, created_at=clock.now(),
            updated_at=clock.now())).rowcount
        if reopened:
            db.refresh(row)
            notify(db, target.id, "friend_request", "Lời mời kết bạn",
                   f"{user.display_name} muốn kết bạn để cùng học.", {"request_id": row.id, "user_id": user.id})
            db.commit()
            return {**request_view(db, row, user.id), "auto_accepted": False}
    raise APIError(409, "conflict", "Please try again")


def incoming_request_count(db: Session, user_id: int) -> int:
    """Pending friend requests waiting for this user's answer (the Home "Bạn bè" badge). Blocked senders don't count."""
    senders = db.scalars(select(Friendship.requester_id).where(
        Friendship.status == "pending", Friendship.requester_id != user_id,
        or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id)))
    hidden = blocked_ids(db, user_id)
    return sum(1 for sender in senders if sender not in hidden)


@router.get("/friend-requests")
def list_friend_requests(direction: Literal["incoming", "outgoing"] = "incoming",
                         user: User = Depends(current_user), db: Session = Depends(get_db)):
    mine = or_(Friendship.user_low_id == user.id, Friendship.user_high_id == user.id)
    who = Friendship.requester_id == user.id if direction == "outgoing" else Friendship.requester_id != user.id
    rows = list(db.scalars(select(Friendship).where(mine, who, Friendship.status == "pending")
                           .order_by(Friendship.created_at.desc()).limit(100)))
    hidden = blocked_ids(db, user.id)
    items = [request_view(db, row, user.id) for row in rows
             if (row.user_high_id if row.user_low_id == user.id else row.user_low_id) not in hidden]
    db.commit()
    return {"items": [i for i in items if i["user"] is not None]}


def _own_request(db: Session, request_id: int, user: User) -> Friendship:
    row = db.get(Friendship, request_id)
    if row is None or user.id not in (row.user_low_id, row.user_high_id) or row.status == "declined":
        raise APIError(404, "friend_request_not_found", "Friend request not found")
    return row


@router.post("/friend-requests/{request_id}/accept")
def accept_friend_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _own_request(db, request_id, user)
    if row.status == "pending" and row.requester_id == user.id:
        raise APIError(403, "not_request_recipient", "Only the recipient can accept this request")
    if row.status == "pending":
        _accept(db, row, user)
        db.commit()
    return request_view(db, row, user.id)


@router.post("/friend-requests/{request_id}/decline")
def decline_friend_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _own_request(db, request_id, user)
    if row.status != "pending" or row.requester_id == user.id:
        raise APIError(409, "friend_request_not_pending", "This request can no longer be declined")
    db.execute(update(Friendship).where(Friendship.id == row.id, Friendship.status == "pending").values(
        status="declined", responded_at=clock.now(), updated_at=clock.now()))
    db.commit()
    return {"id": row.id, "status": "declined"}


@router.delete("/friend-requests/{request_id}", status_code=204)
def cancel_friend_request(request_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _own_request(db, request_id, user)
    if row.status != "pending" or row.requester_id != user.id:
        raise APIError(409, "friend_request_not_pending", "Only a pending request you sent can be cancelled")
    db.execute(delete(Friendship).where(Friendship.id == row.id, Friendship.status == "pending"))
    db.commit()


# ---------------------------------------------------------------------------- friends
@router.get("/friends")
def get_friends(user: User = Depends(current_user), db: Session = Depends(get_db)):
    touch_active(db, user.id)
    items = list_friends(db, user)
    db.commit()
    return {"items": items}


@router.delete("/friends/{user_id}", status_code=204)
def remove_friend(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = friendship(db, user.id, user_id)
    if row is None or row.status != "accepted":
        raise APIError(404, "not_friends", "You are not friends with this user")
    db.delete(row)
    # Visits check the friendship on every request; pending study invitations between the two end here.
    _cancel_invitations_between(db, user.id, user_id)
    db.commit()


# ---------------------------------------------------------------------------- blocking
def _cancel_invitations_between(db: Session, a: int, b: int) -> None:
    db.execute(update(StudyRoomInvitation).where(
        StudyRoomInvitation.status == "pending",
        or_(and_(StudyRoomInvitation.inviter_id == a, StudyRoomInvitation.invitee_id == b),
            and_(StudyRoomInvitation.inviter_id == b, StudyRoomInvitation.invitee_id == a)),
    ).values(status="cancelled", responded_at=clock.now()))


@router.post("/users/{user_id}/block", status_code=201)
def block_user(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user_id == user.id:
        raise APIError(422, "cannot_block_self", "You cannot block yourself")
    if db.get(User, user_id) is None:
        raise APIError(404, "user_not_found", "User not found")
    if not db.scalar(select(UserBlock.id).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id)):
        try:
            with db.begin_nested():
                db.add(UserBlock(blocker_id=user.id, blocked_id=user_id, created_at=clock.now()))
        except IntegrityError:
            pass  # a concurrent identical request already blocked
    low, high = pair(user.id, user_id)
    db.execute(delete(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high))
    _cancel_invitations_between(db, user.id, user_id)
    db.commit()
    return {"user_id": user_id, "blocked": True}


@router.delete("/users/{user_id}/block", status_code=204)
def unblock_user(user_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id))
    db.commit()


@router.get("/blocks")
def list_blocks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = list(db.scalars(select(UserBlock.blocked_id).where(UserBlock.blocker_id == user.id)))
    users = list(db.scalars(select(User).where(User.id.in_(ids)))) if ids else []
    profiles = profiles_for(db, {u.id for u in users})
    db.commit()
    return {"items": [public_user(u, profiles[u.id]) for u in users]}


# ---------------------------------------------------------------------------- reports
class ReportInput(BaseModel):
    reason: Literal["spam", "harassment", "inappropriate", "impersonation", "other"]
    details: Optional[Annotated[str, BeforeValidator(_strip), Field(max_length=500), AfterValidator(no_control_chars)]] = None
    room_id: Optional[int] = Field(default=None, ge=1)
    message_id: Optional[int] = Field(default=None, ge=1)  # a room chat message written by the reported user


@router.post("/users/{user_id}/report", status_code=201)
def report_user(user_id: int, data: ReportInput, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    enforce("report", settings.rate_limit_report, str(user.id))
    enforce("report-ip", settings.rate_limit_report, client_ip(request))
    if user_id == user.id:
        raise APIError(422, "cannot_report_self", "You cannot report yourself")
    if db.get(User, user_id) is None:
        raise APIError(404, "user_not_found", "User not found")
    message = db.get(StudyRoomMessage, data.message_id) if data.message_id is not None else None
    if data.message_id is not None and (message is None or message.sender_id != user_id
                                        or (data.room_id is not None and message.room_id != data.room_id)):
        raise APIError(404, "message_not_found", "Message not found")
    room_id = message.room_id if message is not None else data.room_id
    # Only someone who is (or was) in the room may point at it, or at one of its messages.
    if room_id is not None and not db.scalar(select(StudyRoomMember.id).where(
            StudyRoomMember.room_id == room_id, StudyRoomMember.user_id == user.id)):
        raise APIError(404, "message_not_found" if message is not None else "room_not_found",
                       "Message not found" if message is not None else "Room not found")
    report = UserReport(reporter_id=user.id, reported_id=user_id, reason=data.reason, details=data.details or None,
                        room_id=room_id, message_id=message.id if message else None,
                        message_body=message.body if message else None, created_at=clock.now())
    db.add(report)
    db.commit()
    return {"id": report.id, "status": report.status}


class ResolveReportInput(BaseModel):
    action: Literal["dismiss", "disable_user"]


@router.get("/admin/social/reports")
def admin_list_reports(status: Literal["open", "dismissed", "actioned"] = "open",
                       admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(UserReport).where(UserReport.status == status).order_by(UserReport.id.desc()).limit(100)))
    users = {u.id: u for u in db.scalars(select(User).where(
        User.id.in_({r.reporter_id for r in rows} | {r.reported_id for r in rows})))} if rows else {}
    return {"items": [{"id": r.id, "reason": r.reason, "details": r.details, "room_id": r.room_id,
                       "message": {"id": r.message_id, "body": r.message_body} if r.message_id else None, "status": r.status,
                       "created_at": as_utc(r.created_at),
                       "reporter": public_user(users[r.reporter_id]) if r.reporter_id in users else None,
                       "reported": public_user(users[r.reported_id]) if r.reported_id in users else None,
                       "reported_open_reports": db.scalar(select(func.count()).select_from(UserReport).where(
                           UserReport.reported_id == r.reported_id, UserReport.status == "open"))}
                      for r in rows]}


@router.post("/admin/social/reports/{report_id}/resolve")
def admin_resolve_report(report_id: int, data: ResolveReportInput, admin: User = Depends(admin_user),
                         db: Session = Depends(get_db)):
    report = db.get(UserReport, report_id)
    if report is None:
        raise APIError(404, "report_not_found", "Report not found")
    if data.action == "disable_user":
        reported = db.get(User, report.reported_id)
        if reported is not None and reported.role != "admin":
            reported.status = "disabled"
            reported.token_version = (reported.token_version or 0) + 1  # ends their sessions immediately
    report.status = "actioned" if data.action == "disable_user" else "dismissed"
    report.resolved_by_id = admin.id
    report.resolved_at = clock.now()
    db.commit()
    return {"id": report.id, "status": report.status}
