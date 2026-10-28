"""The walk waits for every goal of today: the daily quests and the user's own tasks added before it starts."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import companion
from app.db import SessionLocal
from app.models import Activity, CommunityPost, PetWalk, StudySession, UserTask
from conftest import bearer, signup
from test_companion import bring_pet_home, finish_quests


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def today():
    return datetime.now(timezone.utc).date()


def add_task(client, auth, title="Đọc sách", day=None, **extra):
    response = client.post("/api/tasks", headers=auth, json={
        "title": title, "category": "study", "scheduled_date": (day or today()).isoformat(), **extra})
    assert response.status_code == 200, response.json()
    return response.json()["id"]


def complete_task(client, auth, task_id, day=None):
    response = client.post(f"/api/tasks/{task_id}/complete", headers=auth, json={"occurrence_date": (day or today()).isoformat()})
    assert response.status_code == 200, response.json()
    return response.json()


def status(client, auth):
    return client.get("/api/pet/space", headers=auth).json()["status"]


def walks(db):
    db.expire_all()
    return db.scalar(select(func.count()).select_from(PetWalk))


def test_tasks_added_before_the_walk_must_all_be_done(client, auth, db):
    # 3 daily quests + 2 own tasks: the walk starts with the 5th, not the 3rd.
    first, second = add_task(client, auth, "Đọc sách"), add_task(client, auth, "Tập thể dục")
    finish_quests(client, auth)
    space = client.get("/api/pet/space", headers=auth).json()
    assert all(q["progress"] >= q["target"] for q in space["quests"])
    assert space["status"] == "locked" and walks(db) == 0
    assert client.post("/api/pet/walk", headers=auth).json()["code"] == "quests_incomplete"
    complete_task(client, auth, first)
    assert status(client, auth) == "locked"
    assert client.get("/api/dashboard", headers=auth).json()["pet_walk"] == "locked"
    complete_task(client, auth, second)  # the last goal starts the walk itself
    assert walks(db) == 1
    assert status(client, auth) == "walking"
    assert client.get("/api/dashboard", headers=auth).json()["pet_walk"] == "walking"


def test_a_task_added_after_the_quests_but_before_the_walk_counts(client, auth, db):
    client.post("/api/study/sessions", json={"duration_seconds": 1500}, headers=auth)
    client.post("/api/campus/courses/c1/explore", headers=auth)
    task = add_task(client, auth)  # added while one quest is still open
    client.post("/api/community/posts", json={"body": "Hôm nay vui ghê"}, headers=auth)
    assert status(client, auth) == "locked" and walks(db) == 0
    complete_task(client, auth, task)
    assert status(client, auth) == "walking"


def test_open_tasks_of_other_days_do_not_count(client, auth, db):
    add_task(client, auth, "Hôm qua", day=today() - timedelta(days=1))
    add_task(client, auth, "Ngày mai", day=today() + timedelta(days=1))
    add_task(client, auth, "Thứ ba tuần sau", day=today() + timedelta(days=7), repeat="weekly")
    finish_quests(client, auth)
    assert status(client, auth) == "walking"


def test_a_repeating_task_counts_on_the_days_it_occurs(client, auth, db):
    task = add_task(client, auth, "Ôn từ", day=today() - timedelta(days=3), repeat="daily")
    finish_quests(client, auth)
    assert status(client, auth) == "locked"
    complete_task(client, auth, task, day=today() - timedelta(days=1))  # another day's occurrence: not today's
    assert status(client, auth) == "locked"
    complete_task(client, auth, task)
    assert status(client, auth) == "walking"


def test_after_the_walk_has_started_new_tasks_change_nothing(client, auth, db):
    finish_quests(client, auth)
    walking = client.get("/api/pet/space", headers=auth).json()
    assert walking["status"] == "walking"
    task = add_task(client, auth, "Thêm sau")
    later = client.get("/api/pet/space", headers=auth).json()
    # Not cancelled, not called back, same return time.
    assert later["status"] == "walking" and later["return_at"] == walking["return_at"] and later["started_at"] == walking["started_at"]
    complete_task(client, auth, task)
    assert status(client, auth) == "walking" and walks(db) == 1
    # Back home, gift confirmed: finishing more tasks the same day starts no second walk.
    bring_pet_home(db)
    walk_id = client.get("/api/pet/space", headers=auth).json()["pending_reward"]["walk_id"]
    assert client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth).status_code == 200
    complete_task(client, auth, add_task(client, auth, "Thêm nữa"))
    assert status(client, auth) == "rested" and walks(db) == 1
    assert client.post("/api/pet/walk", headers=auth).json()["code"] == "already_walked"


def test_an_empty_goal_list_never_starts_a_walk(client, auth, db, monkeypatch):
    # The app always has quests (the chosen ones or the 3 built-in ones); should the list ever be empty, no walk.
    assert companion.walk_status(None, []) == "locked"
    monkeypatch.setattr(companion, "daily_quests", lambda user, db: [])
    assert status(client, auth) == "locked"
    assert client.post("/api/pet/walk", headers=auth).json()["code"] == "quests_incomplete"
    assert walks(db) == 0


def test_a_new_day_brings_new_goals_and_leaves_yesterdays_open_tasks_behind(client, auth, db):
    finish_quests(client, auth)
    bring_pet_home(db)
    walk_id = client.get("/api/pet/space", headers=auth).json()["pending_reward"]["walk_id"]
    client.post(f"/api/pet/walks/{walk_id}/acknowledge", headers=auth)
    yesterday = today() - timedelta(days=1)
    add_task(client, auth, "Chưa xong hôm qua", day=yesterday)
    # Move yesterday's walk and activity back a day: it is now the next morning.
    one_day = timedelta(days=1)
    for model in (Activity, StudySession, CommunityPost):
        for row in db.scalars(select(model)):
            row.created_at -= one_day
    walk = db.scalars(select(PetWalk)).one()
    walk.started_at, walk.returns_at, walk.task_cycle_id = walk.started_at - one_day, walk.returns_at - one_day, yesterday.isoformat()
    db.commit()
    assert status(client, auth) == "locked"  # today's quests start again
    task = add_task(client, auth, "Hôm nay")
    finish_quests(client, auth)
    assert status(client, auth) == "locked"  # today's own task is still open
    complete_task(client, auth, task)
    assert status(client, auth) == "walking" and walks(db) == 2


def test_a_task_added_while_the_walk_is_about_to_start_is_still_checked(client, auth, db, monkeypatch):
    """The quests look done; between that first read and the walk's start another device adds a task for today. The
    decision is taken again from the database under the lock, so the task counts."""
    original = companion.lock_daily_goals
    added = []

    def add_then_lock(session, user_id):
        if not added:
            with SessionLocal() as other:  # another request, committed first
                other.add(UserTask(user_id=user_id, title="Từ máy khác", category="study", scheduled_date=today(),
                                   repeat="none", repeat_weekdays=json.dumps([])))
                other.commit()
            added.append(True)
        original(session, user_id)

    monkeypatch.setattr(companion, "lock_daily_goals", add_then_lock)
    finish_quests(client, auth)
    assert added and walks(db) == 0
    assert status(client, auth) == "locked"
    task_id = db.scalar(select(UserTask.id))
    complete_task(client, auth, task_id)
    assert status(client, auth) == "walking" and walks(db) == 1


def test_retries_and_several_devices_start_one_walk(client, auth, db):
    tasks = [add_task(client, auth, f"Việc {i}") for i in range(2)]
    finish_quests(client, auth)
    complete_task(client, auth, tasks[0])

    def finish_last():
        return client.post(f"/api/tasks/{tasks[1]}/complete", headers=auth, json={"occurrence_date": today().isoformat()}).status_code

    def read_space():
        return client.get("/api/pet/space", headers=auth).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(lambda f: f(), [finish_last, finish_last, read_space, read_space, read_space, finish_last]))
    assert set(codes) == {200}
    assert walks(db) == 1
    assert status(client, auth) == "walking"


def test_adding_tasks_and_finishing_the_last_goal_at_once_stays_consistent(client, auth, db):
    """Whatever the order, either the walk started (and the new task changed nothing), or the new task was there first
    (and the walk waits for it). Never a walk that skipped a task added before it."""
    last = add_task(client, auth, "Cuối cùng")
    finish_quests(client, auth)

    def finish_last():
        client.post(f"/api/tasks/{last}/complete", headers=auth, json={"occurrence_date": today().isoformat()})

    def add_new():
        add_task(client, auth, "Thêm cùng lúc")

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda f: f(), [finish_last, add_new]))
    db.expire_all()
    walk = db.scalar(select(PetWalk))
    added = db.scalar(select(UserTask).where(UserTask.title == "Thêm cùng lúc"))
    if walk is None:
        assert status(client, auth) == "locked"  # the new task came first: it must be done too
        complete_task(client, auth, added.id)
        assert status(client, auth) == "walking"
    else:
        assert companion.as_utc(added.created_at) >= companion.as_utc(walk.started_at)  # added after the walk began
        assert status(client, auth) == "walking"
    assert walks(db) == 1
