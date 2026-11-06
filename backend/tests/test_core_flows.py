"""What every flow relies on: one calendar for the daily loop, one EXP per event under its cap, and a pet that doesn't
change while it is out."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import days
from app.config import settings
from app.db import SessionLocal
from app.models import ExpEvent, Memory, PetEvolution, PetWalk, User
from app.progression import award_exp
from conftest import bearer, signup
from test_companion import finish_quests


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def adopt(client, auth):
    assert client.put("/api/pet", headers=auth, json={"pet": "cat", "name": "Mây"}).status_code == 200


def pick_daily_tasks(client, auth, *task_ids):
    assert client.put("/api/onboarding/daily-tasks", headers=auth, json={"task_ids": list(task_ids)}).status_code == 200


def at_once(calls):
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [f.result() for f in [pool.submit(call) for call in calls]]


def task_exp_events(db, reference_prefix=""):
    db.expire_all()
    return list(db.scalars(select(ExpEvent).where(ExpEvent.source == "task", ExpEvent.reference_id.like(f"{reference_prefix}%"))))


def set_exp(db, xp):
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    progress = db.scalar(select(PetEvolution).where(PetEvolution.user_id == user.id, PetEvolution.pet_id == user.pet))
    progress.total_xp, progress.level, progress.hatched_at = xp, 1, datetime.now(timezone.utc)
    user.xp, user.level = xp, 1
    db.commit()
    return user, progress


def give_exp(user_id, amount, reference):
    with SessionLocal() as session:
        user = session.get(User, user_id)
        granted = award_exp(user, session, source="group", reference_id=reference, requested=amount, daily_cap=1_000_000)
        session.commit()
        return granted


def far_zone():
    """A zone whose date differs from UTC's right now, whatever the time of day."""
    return "Etc/GMT-14" if datetime.now(timezone.utc).hour >= 10 else "Etc/GMT+12"


# ------------------------------------------------------------------------------------------------- one calendar
def test_the_day_starts_at_midnight_in_the_configured_zone(monkeypatch):
    monkeypatch.setattr(settings, "daily_reset_timezone", "Asia/Ho_Chi_Minh")
    before = datetime(2026, 11, 4, 16, 59, tzinfo=timezone.utc)  # 23:59 on the 4th in Vietnam
    after = datetime(2026, 11, 4, 17, 1, tzinfo=timezone.utc)  # 00:01 on the 5th
    assert days.today(before).isoformat() == "2026-11-04" and days.today(after).isoformat() == "2026-11-05"
    assert days.day_start(after) == after - timedelta(minutes=1)


def test_home_and_the_walk_use_the_same_day_as_the_calendar(client, auth, db, monkeypatch):
    monkeypatch.setattr(settings, "daily_reset_timezone", far_zone())
    local, utc = days.today(), datetime.now(timezone.utc).date()
    assert local != utc
    adopt(client, auth)
    for title, day in (("Hôm nay", local), ("Ngày theo UTC", utc)):
        assert client.post("/api/tasks", headers=auth, json={"title": title, "category": "study",
                                                             "scheduled_date": day.isoformat()}).status_code == 200
    dashboard = client.get("/api/dashboard", headers=auth).json()
    assert dashboard["today"] == local.isoformat()
    assert [t["title"] for t in dashboard["scheduled_tasks"] if t["kind"] == "scheduled"] == ["Hôm nay"]
    # Only today's own task holds the walk back.
    finish_quests(client, auth)
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "locked"
    task_id = dashboard["scheduled_tasks"][0]["id"] if dashboard["scheduled_tasks"][0]["kind"] == "scheduled" else None
    task_id = task_id or next(t["id"] for t in dashboard["scheduled_tasks"] if t["kind"] == "scheduled")
    client.post(f"/api/tasks/{task_id}/complete", headers=auth, json={"occurrence_date": local.isoformat()})
    space = client.get("/api/pet/space", headers=auth).json()
    assert space["status"] == "walking" and space["task_cycle_id"] == local.isoformat()


def test_a_quest_done_before_midnight_is_open_again_after_it(client, auth, db, monkeypatch):
    monkeypatch.setattr(settings, "daily_reset_timezone", far_zone())
    adopt(client, auth)
    pick_daily_tasks(client, auth, "health")
    assert client.post("/api/pet/quests/health/complete", headers=auth).json()["awarded_exp"] == 10
    from app.models import Activity
    for row in db.scalars(select(Activity)):
        row.created_at = days.day_start() - timedelta(minutes=1)
    for row in db.scalars(select(ExpEvent).where(ExpEvent.source == "task")):
        row.created_at, row.reference_id = days.day_start() - timedelta(minutes=1), "quest:health:yesterday"
    db.commit()
    assert client.get("/api/dashboard", headers=auth).json()["daily_quests"][0]["progress"] == 0
    assert client.post("/api/pet/quests/health/complete", headers=auth).json()["awarded_exp"] == 10


def test_the_task_cap_starts_over_with_the_day(client, auth, db, monkeypatch):
    monkeypatch.setattr(settings, "daily_reset_timezone", far_zone())
    adopt(client, auth)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    db.add(ExpEvent(user_id=user.id, pet_id=user.pet, source="task", reference_id="task:old", amount=60,
                    created_at=days.day_start() - timedelta(minutes=1)))
    db.commit()
    day = days.today().isoformat()
    task = client.post("/api/tasks", headers=auth, json={"title": "Mới", "category": "study", "scheduled_date": day}).json()
    done = client.post(f"/api/tasks/{task['id']}/complete", headers=auth, json={"occurrence_date": day}).json()
    assert done["awarded_exp"] == 5 and done["daily_exp_remaining"] == 55


# ------------------------------------------------------------------------------------------------- one EXP per event
def test_tapping_a_quest_again_and_again_at_once_rewards_once(client, auth, db):
    adopt(client, auth)
    pick_daily_tasks(client, auth, "health")
    responses = at_once([lambda: client.post("/api/pet/quests/health/complete", headers=auth) for _ in range(6)])
    assert [r.status_code for r in responses] == [200] * 6
    assert sum(r.json()["awarded_exp"] for r in responses) == 10
    assert len(task_exp_events(db, "quest:health")) == 1


def test_completing_a_task_again_and_again_at_once_rewards_once(client, auth, db):
    adopt(client, auth)
    day = days.today().isoformat()
    task = client.post("/api/tasks", headers=auth, json={"title": "Một", "category": "study", "scheduled_date": day}).json()
    responses = at_once([lambda: client.post(f"/api/tasks/{task['id']}/complete", headers=auth, json={"occurrence_date": day})
                         for _ in range(6)])
    assert [r.status_code for r in responses] == [200] * 6
    assert sum(r.json()["awarded_exp"] for r in responses) == 5
    assert len(task_exp_events(db, "task:")) == 1


def test_two_tasks_finished_at_once_stay_within_the_daily_cap(client, auth, db):
    adopt(client, auth)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    db.add(ExpEvent(user_id=user.id, pet_id=user.pet, source="task", reference_id="task:earlier", amount=55))
    db.commit()
    day = days.today().isoformat()
    ids = [client.post("/api/tasks", headers=auth, json={"title": f"T{i}", "category": "study", "scheduled_date": day}).json()["id"]
           for i in range(6)]
    responses = at_once([lambda i=i: client.post(f"/api/tasks/{i}/complete", headers=auth, json={"occurrence_date": day}) for i in ids])
    assert [r.status_code for r in responses] == [200] * 6
    assert sum(r.json()["awarded_exp"] for r in responses) == 5
    db.expire_all()
    assert db.scalar(select(func.sum(ExpEvent.amount)).where(ExpEvent.source == "task")) == 60


# ------------------------------------------------------------------------------------------------- away from home
def evolved_memories(db):
    db.expire_all()
    return db.scalar(select(func.count()).select_from(Memory).where(Memory.event_type == "pet_evolved"))


def end_walk(db):
    db.expire_all()
    walk = db.scalars(select(PetWalk)).one()
    walk.returns_at = walk.started_at - timedelta(seconds=1)
    db.commit()
    return walk.id


def test_a_pet_out_on_its_walk_evolves_only_once_it_is_back_and_its_gift_is_seen(client, auth, db):
    adopt(client, auth)
    user, _ = set_exp(db, 750)
    finish_quests(client, auth)
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "walking"
    xp_before = client.get("/api/profile", headers=auth).json()["xp"]

    assert give_exp(user.id, 800, "during-walk") == 800
    profile = client.get("/api/profile", headers=auth).json()
    assert profile["xp"] == xp_before + 800  # the EXP counts at once...
    assert profile["level"] == 1 and evolved_memories(db) == 0  # ...the evolution waits

    walk_id = end_walk(db)
    returned = client.get("/api/pet/space", headers=auth).json()
    assert returned["status"] == "returned" and client.get("/api/profile", headers=auth).json()["level"] == 1

    client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth)
    profile = client.get("/api/profile", headers=auth).json()
    assert profile["level"] == 3 and evolved_memories(db) == 2  # Lv.2 and Lv.3, each recorded once
    client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth)
    client.get("/api/pet/space", headers=auth)
    assert client.get("/api/profile", headers=auth).json()["level"] == 3 and evolved_memories(db) == 2


def test_a_pet_at_home_still_evolves_at_once(client, auth, db):
    adopt(client, auth)
    user, _ = set_exp(db, 790)
    assert give_exp(user.id, 20, "at-home") == 20
    assert client.get("/api/profile", headers=auth).json()["level"] == 2 and evolved_memories(db) == 1


def test_a_level_left_behind_catches_up_when_the_space_is_read(client, auth, db):
    adopt(client, auth)
    _, progress = set_exp(db, 900)  # 900 EXP is Lv.2, stored at Lv.1
    assert client.get("/api/pet/space", headers=auth).status_code == 200
    assert client.get("/api/profile", headers=auth).json()["level"] == 2 and evolved_memories(db) == 1
