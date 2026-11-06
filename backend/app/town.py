"""Thị trấn Mirabi (Mirabi Town): the friends system as a small town.

Built on what exists: friendships, blocks and reports (friends.py), room visits and pet play with their capped EXP
(room_visits.py), the inventory (inventory.py) and the in-app inbox (notifications.py). This module adds:

- the town map: Friends Street (houses of friends), the Community Garden and other shared buildings, events, and the
  Achievement Hall (only friends who share their stats);
- community projects built together with in-game coins (never real money): coins are taken with a conditional update
  (never below zero), the building grows with an atomic add, and `client_ref` makes a retry count once. Contributions
  earn no EXP, so nothing here can be farmed;
- gifts: one free (not placed) copy of an inventory item goes to a friend, once per `client_ref`. Keepsakes (album
  memories) can't be given;
- visit history (visit_logs, written when a friend's room is opened).

Safety: the town only ever shows and reaches accounts that may use Mirabi Life (aged 16 and over, life_access.py),
friends only, never across a block. Nothing financial or from the private journal is ever part of it.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import inventory as inv
from . import items_catalog as cat
from .db import get_db
from .errors import APIError
from .friends import are_friends, blocked_ids, is_blocked_between, list_friends, profiles_for, shares_stats
from .life_access import life_eligible, life_user
from .models import (CommunityContribution, CommunityProject, GiftTransfer, TownEvent, User, UserCareerAchievement,
                     VisitLog, WorkRewardClaim, as_utc, utcnow)
from .notifications import notify
from .schemas import TownContribution, TownGift

router = APIRouter(prefix="/api/town", tags=["town"])

DAILY_CONTRIBUTION_LIMIT = 1000
DAILY_GIFT_LIMIT = 10
VISIT_LOG_GAP = timedelta(minutes=10)
PROJECTS = [
    ("square_fountain", "Đài phun nước Quảng trường", "Cả thị trấn cùng xây đài phun nước lấp lánh giữa quảng trường.", 50_000),
    ("community_garden", "Vườn Cộng đồng", "Những luống hoa chung, ai đi ngang cũng có thể ngắm.", 30_000),
    ("lantern_street", "Phố Đèn lồng", "Thắp sáng con phố bằng hàng trăm chiếc đèn lồng.", 40_000),
]
EVENTS = [
    ("harvest_festival", "Lễ hội Mùa vàng", "Góp xu xây Vườn Cộng đồng trước khi lễ hội kết thúc!", "community_garden", 30),
    ("lantern_week", "Tuần lễ Đèn lồng", "Cùng nhau thắp sáng Phố Đèn lồng.", "lantern_street", 14),
]
AREAS = [
    {"code": "town_square", "name": "Quảng trường"}, {"code": "friends_street", "name": "Phố Bạn bè"},
    {"code": "community_garden", "name": "Vườn Cộng đồng"}, {"code": "event_plaza", "name": "Sân Sự kiện"},
    {"code": "gift_shop", "name": "Tiệm Quà tặng"}, {"code": "achievement_hall", "name": "Sảnh Thành tựu"},
]


def seed_town(db: Session) -> None:
    """Projects and events, once each (by code); safe at every start. Events start when first seeded."""
    have = set(db.scalars(select(CommunityProject.code)))
    for code, name, description, target in PROJECTS:
        if code not in have:
            db.add(CommunityProject(code=code, name=name, description=description, target_contribution=target))
    have = set(db.scalars(select(TownEvent.code)))
    now = utcnow()
    for code, title, description, project, days in EVENTS:
        if code not in have:
            db.add(TownEvent(code=code, title=title, description=description, project_code=project,
                             start_at=now - timedelta(hours=1), end_at=now + timedelta(days=days)))


def eligible_friends(db: Session, user: User) -> list[dict]:
    """Friends who may use the town too (16+), as friends.list_friends shows them (privacy settings respected)."""
    friends = list_friends(db, user)
    if not friends:
        return []
    ages = dict(db.execute(select(User.id, User.age).where(User.id.in_([f["id"] for f in friends]))).all())
    return [f for f in friends if ages.get(f["id"]) is not None and ages[f["id"]] >= 16]


def project_view(db: Session, row: CommunityProject, user: User) -> dict:
    mine = db.scalar(select(func.coalesce(func.sum(CommunityContribution.amount), 0)).where(
        CommunityContribution.project_id == row.id, CommunityContribution.user_id == user.id)) or 0
    people = db.scalar(select(func.count(func.distinct(CommunityContribution.user_id))).where(
        CommunityContribution.project_id == row.id)) or 0
    percent = min(100, int(row.current_contribution) * 100 // int(row.target_contribution))
    return {"id": row.id, "code": row.code, "name": row.name, "description": row.description,
            "target": int(row.target_contribution), "current": int(row.current_contribution), "percent": percent,
            # 0..4: how much of the building stands (drawn by the app).
            "stage": min(4, percent // 25), "status": row.status, "my_contribution": int(mine), "contributors": people,
            "completed_at": as_utc(row.completed_at).isoformat() if row.completed_at else None}


def event_view(row: TownEvent) -> dict:
    now = utcnow()
    status = "upcoming" if as_utc(row.start_at) > now else "ended" if as_utc(row.end_at) <= now else "active"
    return {"id": row.id, "code": row.code, "title": row.title, "description": row.description, "project_code": row.project_code,
            "start_at": as_utc(row.start_at).isoformat(), "end_at": as_utc(row.end_at).isoformat(), "status": status}


def contributed_today(db: Session, user: User) -> int:
    since = utcnow() - timedelta(days=1)
    return int(db.scalar(select(func.coalesce(func.sum(CommunityContribution.amount), 0)).where(
        CommunityContribution.user_id == user.id, CommunityContribution.created_at >= since)) or 0)


def achievements(db: Session, user: User, friends: list[dict]) -> list[dict]:
    """The Achievement Hall: me, and friends who share their stats (social settings)."""
    ids = [user.id] + [f["id"] for f in friends]
    profiles = profiles_for(db, set(ids))
    shown = [user.id] + [f["id"] for f in friends if shares_stats(profiles.get(f["id"]))]
    chests = dict(db.execute(select(WorkRewardClaim.user_id, func.count()).where(WorkRewardClaim.user_id.in_(shown))
                             .group_by(WorkRewardClaim.user_id)).all())
    badges = dict(db.execute(select(UserCareerAchievement.user_id, func.count()).where(UserCareerAchievement.user_id.in_(shown))
                             .group_by(UserCareerAchievement.user_id)).all())
    names = {f["id"]: f for f in friends}
    out = []
    for uid in shown:
        person = names.get(uid) or {"id": user.id, "display_name": user.display_name, "pet": user.pet, "pet_level": user.level,
                                     "avatar_theme": user.avatar_theme}
        out.append({"user_id": uid, "display_name": person["display_name"], "pet": person["pet"], "pet_level": person["pet_level"],
                    "avatar_theme": person.get("avatar_theme"), "me": uid == user.id,
                    "chests_opened": int(chests.get(uid, 0)), "career_badges": int(badges.get(uid, 0))})
    return sorted(out, key=lambda x: (-x["pet_level"], -x["career_badges"], -x["chests_opened"]))


@router.get("/map")
def town_map(user: User = Depends(life_user), db: Session = Depends(get_db)):
    friends = eligible_friends(db, user)
    projects = [project_view(db, p, user) for p in db.scalars(select(CommunityProject).order_by(CommunityProject.id))]
    events = [event_view(e) for e in db.scalars(select(TownEvent).where(TownEvent.status == "published").order_by(TownEvent.start_at))]
    db.commit()  # list_friends may create social profiles
    return {"areas": AREAS, "me": {"id": user.id, "display_name": user.display_name, "pet": user.pet, "pet_name": user.pet_name,
                                   "pet_level": user.level, "coins": user.coins},
            "friends": friends, "projects": projects, "events": [e for e in events if e["status"] != "ended"],
            "achievements": achievements(db, user, friends),
            "contribution_left_today": max(0, DAILY_CONTRIBUTION_LIMIT - contributed_today(db, user)),
            "gifts_left_today": max(0, DAILY_GIFT_LIMIT - gifts_today(db, user))}


@router.get("/events")
def list_events(include_ended: bool = False, user: User = Depends(life_user), db: Session = Depends(get_db)):
    events = [event_view(e) for e in db.scalars(select(TownEvent).where(TownEvent.status == "published").order_by(TownEvent.start_at))]
    return events if include_ended else [e for e in events if e["status"] != "ended"]


@router.get("/projects")
def list_projects(user: User = Depends(life_user), db: Session = Depends(get_db)):
    return [project_view(db, p, user) for p in db.scalars(select(CommunityProject).order_by(CommunityProject.id))]


@router.post("/projects/{project_id}/contribute")
def contribute(project_id: int, data: TownContribution, response: Response, user: User = Depends(life_user),
               db: Session = Depends(get_db)):
    previous = db.scalar(select(CommunityContribution).where(CommunityContribution.user_id == user.id,
                                                             CommunityContribution.client_ref == data.client_ref))
    project = db.get(CommunityProject, project_id)
    if project is None:
        raise APIError(404, "project_not_found", "Project not found")
    if previous is None:
        if project.status != "active":
            raise APIError(409, "project_completed", "This building is already finished")
        inv.lock_user(db, user.id)
        # What this user's other requests finished while this one waited: the same contribution, or today's limit.
        previous = db.scalar(select(CommunityContribution).where(CommunityContribution.user_id == user.id,
                                                                 CommunityContribution.client_ref == data.client_ref))
    if previous is None:
        if contributed_today(db, user) + data.amount > DAILY_CONTRIBUTION_LIMIT:
            db.rollback()
            raise APIError(429, "contribution_limit", f"At most {DAILY_CONTRIBUTION_LIMIT} coins a day")
        paid = db.execute(update(User).where(User.id == user.id, User.coins >= data.amount)
                          .values(coins=User.coins - data.amount).execution_options(synchronize_session=False)).rowcount
        if paid != 1:
            db.rollback()
            raise APIError(409, "insufficient_coins", "Not enough coins")
        db.execute(update(CommunityProject).where(CommunityProject.id == project.id)
                   .values(current_contribution=CommunityProject.current_contribution + data.amount)
                   .execution_options(synchronize_session=False))
        db.execute(update(CommunityProject).where(CommunityProject.id == project.id, CommunityProject.status == "active",
                                                  CommunityProject.current_contribution >= CommunityProject.target_contribution)
                   .values(status="completed", completed_at=utcnow()).execution_options(synchronize_session=False))
        db.add(CommunityContribution(user_id=user.id, project_id=project.id, amount=data.amount, client_ref=data.client_ref))
        try:
            db.commit()
        except IntegrityError:  # the same request from another device: nothing taken twice
            db.rollback()
            previous = True
    else:
        db.commit()  # lets go of the lock
        response.status_code = 200
    db.refresh(user)
    db.refresh(project)
    return {"project": project_view(db, project, user), "coins": user.coins, "already_recorded": previous is not None,
            "contribution_left_today": max(0, DAILY_CONTRIBUTION_LIMIT - contributed_today(db, user))}


def gifts_today(db: Session, user: User) -> int:
    since = utcnow() - timedelta(days=1)
    return db.scalar(select(func.count()).select_from(GiftTransfer).where(GiftTransfer.sender_id == user.id,
                                                                          GiftTransfer.created_at >= since)) or 0


def gift_view(row: GiftTransfer, me: int, names: dict[int, str]) -> dict:
    other = row.receiver_id if row.sender_id == me else row.sender_id
    return {"id": row.id, "direction": "sent" if row.sender_id == me else "received", "other_id": other,
            "other_name": names.get(other, ""), "item": inv.item_meta(row.item_id) if row.item_id in cat.ITEMS else None,
            "variant": row.variant, "created_at": as_utc(row.created_at).isoformat()}


@router.post("/gifts", status_code=201)
def send_gift(data: TownGift, response: Response, user: User = Depends(life_user), db: Session = Depends(get_db)):
    previous = db.scalar(select(GiftTransfer).where(GiftTransfer.sender_id == user.id, GiftTransfer.client_ref == data.client_ref))
    if previous is not None:
        response.status_code = 200
        return {"gift": gift_view(previous, user.id, {}), "already_sent": True}
    receiver = db.get(User, data.receiver_id)
    # A missing user, a non-friend, a block either way, a younger account: all look the same.
    if receiver is None or receiver.id == user.id or receiver.status != "active" or not life_eligible(receiver) \
            or is_blocked_between(db, user.id, receiver.id) or not are_friends(db, user.id, receiver.id):
        raise APIError(404, "friend_not_found", "Friend not found")
    item = cat.ITEMS.get(data.item_id)
    if item is None or item["group"] == "keepsake":
        raise APIError(422, "item_not_giftable", "This item can't be given")
    inv.lock_user(db, user.id)
    # The same gift sent a moment ago by another request (it held the lock first): answer as a repeat.
    previous = db.scalar(select(GiftTransfer).where(GiftTransfer.sender_id == user.id, GiftTransfer.client_ref == data.client_ref))
    if previous is not None:
        db.commit()
        response.status_code = 200
        return {"gift": gift_view(previous, user.id, {}), "already_sent": True}
    if gifts_today(db, user) >= DAILY_GIFT_LIMIT:  # under the lock, so gifts sent at once can't pass it together
        db.rollback()
        raise APIError(429, "gift_limit", f"At most {DAILY_GIFT_LIMIT} gifts a day")
    if not inv.use_one(db, user.id, data.item_id, data.variant):
        db.rollback()
        raise APIError(409, "item_not_available", "You don't have a free copy of this item")
    row = GiftTransfer(sender_id=user.id, receiver_id=receiver.id, item_id=data.item_id, variant=data.variant,
                       client_ref=data.client_ref)
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:  # sent a moment ago by another request: give the copy back
        db.rollback()
        previous = db.scalar(select(GiftTransfer).where(GiftTransfer.sender_id == user.id, GiftTransfer.client_ref == data.client_ref))
        response.status_code = 200
        return {"gift": gift_view(previous, user.id, {}), "already_sent": True}
    now = utcnow()
    inv.record(db, user.id, data.item_id, data.variant, kind="gift_out", delta=-1, ref=f"gift:{row.id}", event_key=f"gift:{row.id}:out", at=now)
    inv.grant(db, receiver.id, data.item_id, data.variant, 1, kind="gift_in", ref=f"gift:{row.id}", event_key=f"gift:{row.id}:in", at=now)
    notify(db, receiver.id, "town_gift", f"{user.display_name} gửi quà cho bạn!", f"Bạn nhận được {item['name']}. Xem trong Kho đồ nhé.",
           {"gift_id": row.id, "user_id": user.id})
    db.commit()
    return {"gift": gift_view(row, user.id, {receiver.id: receiver.display_name}), "already_sent": False}


@router.get("/gifts")
def list_gifts(user: User = Depends(life_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(GiftTransfer).where((GiftTransfer.sender_id == user.id) | (GiftTransfer.receiver_id == user.id))
                           .order_by(GiftTransfer.id.desc()).limit(50)))
    other = {r.receiver_id if r.sender_id == user.id else r.sender_id for r in rows}
    names = dict(db.execute(select(User.id, User.display_name).where(User.id.in_(other))).all()) if other else {}
    return [gift_view(r, user.id, names) for r in rows]


@router.get("/giftable")
def giftable_items(user: User = Depends(life_user), db: Session = Depends(get_db)):
    """Free copies the user can give (not placed in a room, not keepsakes)."""
    placed = inv.placed_counts(db, user.id)
    out = []
    for stack in inv.owned_stacks(db, user.id):
        item = cat.ITEMS.get(stack.item_id)
        free = stack.quantity - placed.get((stack.item_id, stack.variant), 0)
        if item and item["group"] != "keepsake" and free > 0:
            out.append({**inv.item_meta(stack.item_id), "variant": stack.variant, "free": free})
    return out


def log_visit(db: Session, visitor_id: int, owner_id: int) -> None:
    """Called when a friend's room is opened (room_visits.visit_room); at most one row per pair and VISIT_LOG_GAP. A
    visit with someone under 16 is not the town's to keep: it only shows and reaches accounts that may use Mirabi Life."""
    if not all(person is not None and life_eligible(person) for person in (db.get(User, visitor_id), db.get(User, owner_id))):
        return
    since = utcnow() - VISIT_LOG_GAP
    if db.scalar(select(VisitLog.id).where(VisitLog.visitor_id == visitor_id, VisitLog.owner_id == owner_id,
                                           VisitLog.visited_at >= since).limit(1)) is None:
        db.add(VisitLog(visitor_id=visitor_id, owner_id=owner_id))


@router.get("/visits/history")
def visit_history(days: int = Query(default=30, ge=1, le=90), user: User = Depends(life_user), db: Session = Depends(get_db)):
    since = utcnow() - timedelta(days=days)
    rows = list(db.scalars(select(VisitLog).where((VisitLog.visitor_id == user.id) | (VisitLog.owner_id == user.id),
                                                  VisitLog.visited_at >= since).order_by(VisitLog.visited_at.desc()).limit(100)))
    hidden = blocked_ids(db, user.id)
    other = {r.owner_id if r.visitor_id == user.id else r.visitor_id for r in rows} - hidden
    # Only accounts of 16 and over, also for visits logged before they (or the rule) said otherwise.
    names = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(other))) if life_eligible(u)} if other else {}
    return [{"direction": "out" if r.visitor_id == user.id else "in",
             "user_id": r.owner_id if r.visitor_id == user.id else r.visitor_id,
             "display_name": names[r.owner_id if r.visitor_id == user.id else r.visitor_id],
             "visited_at": as_utc(r.visited_at).isoformat()} for r in rows
            if (r.owner_id if r.visitor_id == user.id else r.visitor_id) in names]
