"""Hatching and the daily walk never overlap: the egg hatches first, the walk starts after it, and an egg that gets its
EXP during a walk hatches once the pet is back and its gift is confirmed."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import companion
from app.db import engine
from app.main import app
from app.migrations import upgrade_schema
from app.models import Memory, PetEvolution, PetWalk, User, utcnow
from app.progression import award_exp
from conftest import bearer, signup
from test_companion import bring_pet_home, finish_quests
from test_pet_walk_goals import add_task, complete_task


@pytest.fixture()
def auth(client):
    headers = bearer(signup(client).json()["access_token"])
    assert client.put("/api/pet", headers=headers, json={"pet": "dolphin", "name": "Aqua"}).status_code == 200
    return headers


def me(db):
    return db.scalar(select(User).where(User.email == "aqua@example.com"))


def set_exp(db, total):
    """The adopted egg's EXP, as if earned already."""
    db.expire_all()
    user = me(db)
    progress = db.scalar(select(PetEvolution).where(PetEvolution.user_id == user.id, PetEvolution.pet_id == user.pet))
    progress.total_xp = user.xp = total
    db.commit()


def earn(db, amount, ref):
    db.expire_all()
    award_exp(me(db), db, source="test", reference_id=ref, requested=amount, daily_cap=10_000)
    db.commit()


def space(client, auth):
    return client.get("/api/pet/space", headers=auth).json()


def level(client, auth):
    return client.get("/api/profile", headers=auth).json()["level"]


def walks(db):
    db.expire_all()
    return db.scalar(select(func.count()).select_from(PetWalk))


def hatch_memories(db):
    db.expire_all()
    return db.scalar(select(func.count()).select_from(Memory).where(Memory.event_type == "pet_hatched"))


def test_the_egg_hatches_before_the_walk_when_both_are_due_at_once(client, auth, db):
    set_exp(db, 295)
    finish_quests(client, auth)  # the focus session's EXP reaches 300, and the last quest is done right after
    waiting = space(client, auth)
    assert waiting["hatch"] == {"status": "ready", "level": 1}
    assert waiting["status"] == "waiting_hatch" and walks(db) == 0
    assert level(client, auth) == 0 and hatch_memories(db) == 0
    assert client.get("/api/dashboard", headers=auth).json()["pet_walk"] == "waiting_hatch"
    res = client.post("/api/pet/walk", headers=auth)
    assert res.status_code == 409 and res.json()["code"] == "hatch_first"
    # Reloading, or closing the app mid-hatch and opening it again, keeps both waiting.
    for _ in range(3):
        assert space(client, auth)["status"] == "waiting_hatch"
    assert walks(db) == 0

    confirmed_at = utcnow().replace(microsecond=0)
    hatched = client.post("/api/pet/hatch", headers=auth).json()
    assert hatched["hatched"] is True and hatched["pet_level"] == 1 and hatched["hatch"]["status"] == "none"
    assert hatched["status"] == "walking" and walks(db) == 1 and hatch_memories(db) == 1
    # Eight hours from the hatch being confirmed: the wait and the animation don't count.
    started, returns = datetime.fromisoformat(hatched["started_at"]), datetime.fromisoformat(hatched["return_at"])
    assert started >= confirmed_at and returns - started == timedelta(hours=8)
    assert level(client, auth) == 1


def test_goals_finished_while_the_egg_hatches_start_the_walk_after_it(client, auth, db):
    set_exp(db, 300)
    assert space(client, auth)["status"] == "locked" and space(client, auth)["hatch"]["status"] == "ready"
    finish_quests(client, auth)
    assert space(client, auth)["status"] == "waiting_hatch" and walks(db) == 0
    assert client.post("/api/pet/hatch", headers=auth).json()["status"] == "walking"
    assert walks(db) == 1


def test_a_task_added_before_the_walk_holds_it_back_and_one_added_after_does_not(client, auth, db):
    set_exp(db, 300)
    finish_quests(client, auth)
    assert space(client, auth)["status"] == "waiting_hatch"
    task = add_task(client, auth, "Đọc sách")
    assert space(client, auth)["status"] == "locked"
    hatched = client.post("/api/pet/hatch", headers=auth).json()
    assert hatched["hatched"] is True and hatched["status"] == "locked" and walks(db) == 0
    complete_task(client, auth, task)  # the last goal starts the walk
    assert space(client, auth)["status"] == "walking" and walks(db) == 1
    add_task(client, auth, "Thêm sau khi đi")
    assert space(client, auth)["status"] == "walking" and walks(db) == 1


def test_repeated_and_concurrent_hatch_requests_hatch_once_and_start_one_walk(client, auth, db):
    set_exp(db, 300)
    finish_quests(client, auth)
    # SQLite allows one writer, so a parallel request may fail with "database is locked"; none may hatch twice.
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(lambda _: racer.post("/api/pet/hatch", headers=auth), range(5)))
    assert any(r.status_code == 200 for r in responses) and all(r.status_code in (200, 500) for r in responses)
    assert sum(r.json()["hatched"] for r in responses if r.status_code == 200) <= 1
    again = client.post("/api/pet/hatch", headers=auth).json()
    assert again["hatched"] is False and again["pet_level"] == 1 and again["status"] == "walking"
    assert client.post("/api/pet/walk", headers=auth).json()["status"] == "walking"
    assert walks(db) == 1 and hatch_memories(db) == 1


def test_an_egg_that_gets_its_exp_on_a_walk_hatches_after_the_pet_is_back(client, auth, db):
    set_exp(db, 100)
    finish_quests(client, auth)
    walk = db.scalars(select(PetWalk)).one()
    returns_at = walk.returns_at
    earn(db, 250, "while-walking")
    walking = space(client, auth)
    # The EXP counts at once; the egg keeps its shape, and the walk is neither stopped nor shortened.
    assert walking["status"] == "walking" and walking["hatch"] == {"status": "waiting_return", "level": 1}
    assert level(client, auth) == 0 and client.get("/api/profile", headers=auth).json()["xp"] >= 300
    db.expire_all()
    assert db.scalars(select(PetWalk)).one().returns_at == returns_at
    res = client.post("/api/pet/hatch", headers=auth)
    assert res.status_code == 409 and res.json()["code"] == "pet_away"

    bring_pet_home(db, "shell")
    back = space(client, auth)
    # The pet comes back first: the gift popup, then the hatch.
    assert back["status"] == "returned" and back["hatch"]["status"] == "waiting_return" and back["pending_reward"]
    assert client.post("/api/pet/hatch", headers=auth).json()["code"] == "pet_away"
    acknowledged = client.post(f"/api/pet/walks/{back['pending_reward']['walk_id']}/acknowledge", headers=auth).json()
    assert acknowledged["status"] == "rested" and acknowledged["hatch"]["status"] == "ready"

    hatched = client.post("/api/pet/hatch", headers=auth).json()
    # No second walk, and today's walk isn't given back.
    assert hatched["hatched"] is True and hatched["pet_level"] == 1 and hatched["status"] == "rested"
    assert walks(db) == 1 and companion.inventory(me(db), db) == {"shell": 1}


def test_the_walks_own_exp_gift_can_be_what_hatches_the_egg(client, auth, db):
    set_exp(db, 270)
    finish_quests(client, auth)  # +10 from the focus session: 280
    assert space(client, auth)["hatch"]["status"] == "none"
    bring_pet_home(db, companion.EXP_GIFT)
    back = space(client, auth)
    assert back["pending_reward"]["exp"] == companion.ADVENTURE_EXP
    assert back["hatch"] == {"status": "waiting_return", "level": 1} and level(client, auth) == 0
    client.post(f"/api/pet/walks/{back['pending_reward']['walk_id']}/acknowledge", headers=auth)
    assert space(client, auth)["hatch"]["status"] == "ready"
    hatched = client.post("/api/pet/hatch", headers=auth).json()
    assert hatched["hatched"] is True and hatched["xp"] == 310 and hatched["pet_level"] == 1


def test_an_egg_without_enough_exp_cannot_hatch(client, auth):
    res = client.post("/api/pet/hatch", headers=auth)
    assert res.status_code == 409 and res.json()["code"] == "not_ready_to_hatch"
    assert space(client, auth)["hatch"] == {"status": "none", "level": None}


def test_a_restart_keeps_a_waiting_egg_an_egg_and_older_grown_pets_hatched(client, auth, db):
    set_exp(db, 350)
    user = me(db)
    db.add(PetEvolution(user_id=user.id, pet_id="cat", total_xp=900, level=2))  # grown before hatching was tracked
    db.commit()
    upgrade_schema(engine)
    upgrade_schema(engine)  # idempotent
    assert level(client, auth) == 0 and space(client, auth)["hatch"]["status"] == "ready"
    db.expire_all()
    assert db.scalar(select(PetEvolution).where(PetEvolution.pet_id == "cat")).hatched_at is not None
    assert client.patch("/api/profile", headers=auth, json={"pet": "cat"}).json()["level"] == 2
