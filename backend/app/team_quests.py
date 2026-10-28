"""Team quests: cooperative goals for a study room, created from fixed templates.

Progress only comes from finalized group sessions (`record_session`), never from the client. Each member's share of a
session is written once to `team_quest_events` (unique per quest and session/member), so retries and repeated
finalization can't count twice. Completion is a conditional status change, so the reward is paid exactly once, through
the EXP ledger with its own daily cap. Quests are cooperative on purpose: there is no ranking between members.
"""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock
from .config import settings
from .db import get_db
from .errors import APIError
from .friends import profiles_for, public_user, shares_stats
from .models import (StudyRoom, StudyRoomMember, StudyRoomParticipant, StudyRoomSession, TeamQuest, TeamQuestEvent,
                     TeamQuestMember, User, as_utc)
from .notifications import notify
from .progression import award_exp
from .security import current_user

router = APIRouter(prefix="/api", tags=["team-quests"])

TEMPLATES: dict[str, dict] = {
    "daily_hour": {"title": "Một giờ học cùng nhau", "description": "Cả nhóm cùng góp 60 phút tập trung trong 24 giờ.",
                   "unit": "minutes", "target": 60, "days": 1, "reward_exp": 10},
    "focus_minutes": {"title": "Cùng nhau tập trung 300 phút",
                      "description": "Mỗi phút tập trung hợp lệ của thành viên trong phòng đều được tính.",
                      "unit": "minutes", "target": 300, "days": 7, "reward_exp": 15},
    "focus_cycles": {"title": "Hoàn thành 12 chu kỳ Pomodoro",
                     "description": "Mỗi chu kỳ tập trung mà một thành viên hoàn thành cùng phòng đều được tính.",
                     "unit": "cycles", "target": 12, "days": 7, "reward_exp": 15},
}


class QuestCreate(BaseModel):
    template_key: Literal["daily_hour", "focus_minutes", "focus_cycles"]


def template_view(key: str) -> dict:
    tpl = TEMPLATES[key]
    return {"key": key, "title": tpl["title"], "description": tpl["description"], "unit": tpl["unit"],
            "target": tpl["target"], "days": tpl["days"], "reward_exp": tpl["reward_exp"]}


def _expire(db: Session, quest: TeamQuest) -> None:
    if quest.status == "active" and as_utc(quest.ends_at) <= clock.now():
        if db.execute(update(TeamQuest).where(TeamQuest.id == quest.id, TeamQuest.status == "active")
                      .values(status="expired")).rowcount:
            db.refresh(quest)


def expire_due(db: Session) -> None:
    db.execute(update(TeamQuest).where(TeamQuest.status == "active", TeamQuest.ends_at <= clock.now())
               .values(status="expired"))


def _members(db: Session, quest_id: int) -> list[TeamQuestMember]:
    return list(db.scalars(select(TeamQuestMember).where(TeamQuestMember.quest_id == quest_id)
                           .order_by(TeamQuestMember.joined_at, TeamQuestMember.id)))


def room_quests_brief(db: Session, room_id: int) -> list[dict]:
    """Active quests shown inside the room snapshot (same for every member)."""
    quests = db.scalars(select(TeamQuest).where(TeamQuest.room_id == room_id, TeamQuest.status == "active",
                                                TeamQuest.ends_at > clock.now()).order_by(TeamQuest.id))
    return [{"id": q.id, "template_key": q.template_key, "title": TEMPLATES[q.template_key]["title"],
             "unit": TEMPLATES[q.template_key]["unit"], "progress": q.progress, "target": q.target, "status": q.status,
             "ends_at": as_utc(q.ends_at), "member_ids": [m.user_id for m in _members(db, q.id)]} for q in quests]


def quest_view(db: Session, quest: TeamQuest, viewer_id: int) -> dict:
    _expire(db, quest)
    tpl = TEMPLATES[quest.template_key]
    members = _members(db, quest.id)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_([m.user_id for m in members])))} if members else {}
    profiles = profiles_for(db, set(users))
    room = db.get(StudyRoom, quest.room_id)
    mine = next((m for m in members if m.user_id == viewer_id), None)
    member_views = []
    for m in members:
        user = users.get(m.user_id)
        if user is None:
            continue
        shared = m.user_id == viewer_id or shares_stats(profiles.get(m.user_id))
        member_views.append({**public_user(user, profiles.get(m.user_id)), "user_id": user.id,
                             "contribution": m.contribution if shared else None, "rewarded": m.rewarded_at is not None})
    return {"id": quest.id, "room_id": quest.room_id, "room_name": room.name if room else "",
            "template_key": quest.template_key, "title": tpl["title"], "description": tpl["description"],
            "unit": tpl["unit"], "target": quest.target, "progress": min(quest.progress, quest.target),
            "status": quest.status, "reward_exp": quest.reward_exp, "starts_at": as_utc(quest.starts_at),
            "ends_at": as_utc(quest.ends_at), "completed_at": as_utc(quest.completed_at) if quest.completed_at else None,
            "joined": mine is not None, "my_contribution": mine.contribution if mine else 0,
            "my_reward_exp": mine.reward_exp if mine else 0, "members": member_views}


def _complete(db: Session, quest: TeamQuest) -> None:
    t = clock.now()
    if db.execute(update(TeamQuest).where(TeamQuest.id == quest.id, TeamQuest.status == "active")
                  .values(status="completed", completed_at=t)).rowcount != 1:
        return
    db.refresh(quest)
    title = TEMPLATES[quest.template_key]["title"]
    for m in _members(db, quest.id):
        user = db.get(User, m.user_id)
        if user is None or user.status != "active" or m.contribution <= 0:
            continue
        m.reward_exp = award_exp(user, db, source="team_quest", reference_id=f"team_quest:{quest.id}",
                                 requested=quest.reward_exp, daily_cap=settings.team_quest_daily_exp_cap)
        m.rewarded_at = t
        notify(db, user.id, "team_quest_completed", "Nhiệm vụ nhóm hoàn thành",
               f"Cả nhóm đã hoàn thành “{title}”.", {"quest_id": quest.id, "room_id": quest.room_id})


def record_session(db: Session, session: StudyRoomSession, participants: list[StudyRoomParticipant]) -> None:
    """Add a finalized session's valid minutes/cycles to the room's active quests, once per member."""
    ended = as_utc(session.ended_at or clock.now())
    quests = list(db.scalars(select(TeamQuest).where(TeamQuest.room_id == session.room_id, TeamQuest.status == "active")))
    for quest in quests:
        if not as_utc(quest.starts_at) <= ended <= as_utc(quest.ends_at):
            continue
        unit = TEMPLATES[quest.template_key]["unit"]
        members = {m.user_id: m for m in _members(db, quest.id)}
        added = 0
        for p in participants:
            member = members.get(p.user_id)
            if member is None or as_utc(member.joined_at) > ended:
                continue
            amount = p.focus_ms // 60000 if unit == "minutes" else p.cycles_completed
            if amount <= 0:
                continue
            try:
                with db.begin_nested():
                    db.add(TeamQuestEvent(quest_id=quest.id, user_id=p.user_id, amount=amount, created_at=clock.now(),
                                          source_ref=f"session:{session.id}:user:{p.user_id}"))
            except IntegrityError:
                continue  # already counted
            member.contribution += amount
            added += amount
        if added:
            db.execute(update(TeamQuest).where(TeamQuest.id == quest.id, TeamQuest.status == "active")
                       .values(progress=TeamQuest.progress + added))
            db.flush()
            db.refresh(quest)
            if quest.progress >= quest.target:
                _complete(db, quest)


def quests_for_session(db: Session, session: StudyRoomSession, user_id: int) -> list[dict]:
    """The viewer's quests in that room, with what this session added for them."""
    added = {e.quest_id: e.amount for e in db.scalars(select(TeamQuestEvent).where(
        TeamQuestEvent.source_ref == f"session:{session.id}:user:{user_id}"))}
    quests = db.scalars(select(TeamQuest).join(TeamQuestMember, TeamQuestMember.quest_id == TeamQuest.id).where(
        TeamQuest.room_id == session.room_id, TeamQuestMember.user_id == user_id).order_by(TeamQuest.id.desc()).limit(10))
    return [{"id": q.id, "title": TEMPLATES[q.template_key]["title"], "unit": TEMPLATES[q.template_key]["unit"],
             "progress": min(q.progress, q.target), "target": q.target, "status": q.status,
             "added": added.get(q.id, 0)} for q in quests]


def _active_member(db: Session, room_id: int, user_id: int) -> StudyRoomMember | None:
    return db.scalar(select(StudyRoomMember).where(StudyRoomMember.room_id == room_id,
                                                   StudyRoomMember.user_id == user_id,
                                                   StudyRoomMember.status == "active"))


def _visible_quest(db: Session, quest_id: int, user: User) -> TeamQuest:
    quest = db.get(TeamQuest, quest_id)
    if quest is None or (_active_member(db, quest.room_id, user.id) is None and db.scalar(
            select(TeamQuestMember.id).where(TeamQuestMember.quest_id == quest.id,
                                             TeamQuestMember.user_id == user.id)) is None):
        raise APIError(404, "quest_not_found", "Quest not found")
    return quest


def list_for_user(db: Session, user: User) -> list[dict]:
    since = clock.now() - timedelta(days=30)
    joined = set(db.scalars(select(TeamQuestMember.quest_id).where(TeamQuestMember.user_id == user.id)))
    current = db.scalar(select(StudyRoomMember.room_id).where(StudyRoomMember.user_id == user.id,
                                                              StudyRoomMember.status == "active"))
    query = select(TeamQuest).where(TeamQuest.created_at >= since)
    if current is not None:
        query = query.where((TeamQuest.id.in_(joined)) | ((TeamQuest.room_id == current) & (TeamQuest.status == "active")))
    else:
        query = query.where(TeamQuest.id.in_(joined))
    quests = list(db.scalars(query.order_by(TeamQuest.id.desc()).limit(30))) if joined or current else []
    order = {"active": 0, "completed": 1, "expired": 2}
    views = [quest_view(db, q, user.id) for q in quests]
    return sorted(views, key=lambda v: (order[v["status"]], -v["id"]))


@router.get("/team-quests/templates")
def list_templates(user: User = Depends(current_user)):
    return {"items": [template_view(key) for key in TEMPLATES]}


@router.get("/team-quests")
def list_quests(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = list_for_user(db, user)
    db.commit()
    return {"items": items}


@router.get("/team-quests/{quest_id}")
def get_quest(quest_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    quest = _visible_quest(db, quest_id, user)
    result = quest_view(db, quest, user.id)
    db.commit()
    return result


@router.post("/team-quests/{quest_id}/join")
def join_quest(quest_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .study_rooms import _publish, locked_room

    quest = _visible_quest(db, quest_id, user)
    with locked_room(db, quest.room_id) as room:
        if _active_member(db, quest.room_id, user.id) is None:
            raise APIError(403, "not_room_member", "Join the room to take part in its quests")
        _expire(db, quest)
        if quest.status != "active":
            raise APIError(409, "quest_not_active", "This quest is over")
        exists = db.scalar(select(TeamQuestMember.id).where(TeamQuestMember.quest_id == quest.id,
                                                            TeamQuestMember.user_id == user.id))
        if exists is None:
            try:
                with db.begin_nested():
                    db.add(TeamQuestMember(quest_id=quest.id, user_id=user.id, joined_at=clock.now()))
            except IntegrityError:
                pass  # joined concurrently
            _publish(db, room, "team_quest_updated")
        result = quest_view(db, quest, user.id)
        db.commit()
        return result


@router.post("/study-rooms/{room_id}/team-quests", status_code=201)
def create_quest(room_id: int, data: QuestCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .study_rooms import _publish, _require_host, _require_open, locked_room

    with locked_room(db, room_id) as room:
        _require_host(db, room, user)
        _require_open(room)
        expire_due(db)
        if db.scalar(select(TeamQuest.id).where(TeamQuest.room_id == room.id, TeamQuest.template_key == data.template_key,
                                                TeamQuest.status == "active")) is not None:
            raise APIError(409, "quest_already_active", "This quest is already running in the room")
        tpl = TEMPLATES[data.template_key]
        t = clock.now()
        quest = TeamQuest(room_id=room.id, template_key=data.template_key, created_by_id=user.id, target=tpl["target"],
                          progress=0, reward_exp=tpl["reward_exp"], status="active", starts_at=t,
                          ends_at=t + timedelta(days=tpl["days"]), created_at=t)
        db.add(quest)
        db.flush()
        db.add(TeamQuestMember(quest_id=quest.id, user_id=user.id, joined_at=t))
        db.flush()
        _publish(db, room, "team_quest_created")
        result = quest_view(db, quest, user.id)
        db.commit()
        return result
