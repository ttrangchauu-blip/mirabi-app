from datetime import timedelta
from datetime import date, datetime
import pytest
from sqlalchemy import select
from conftest import bearer, signup
from app.companion import REWARD_ITEMS
from app.models import PetWalk

@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])

def finish_quests(client, auth):
    client.post("/api/study/sessions", json={"duration_seconds": 1500}, headers=auth)
    client.post("/api/campus/courses/c1/explore", headers=auth)
    client.post("/api/community/posts", json={"body": "Hôm nay vui ghê"}, headers=auth)

def space(client, auth):
    return client.get("/api/pet/space", headers=auth).json()

def bring_pet_home(db, gift="shell"):
    """End the walk now, carrying `gift` (an item id or "exp")."""
    walk = db.scalars(select(PetWalk)).one()
    walk.item_id = gift
    walk.returns_at = walk.started_at - timedelta(seconds=1)
    db.commit()

def test_quests_track_real_activity(client, auth):
    assert [q["progress"] for q in client.get("/api/dashboard", headers=auth).json()["daily_quests"]] == [0, 0, 0]
    finish_quests(client, auth)
    dashboard = client.get("/api/dashboard", headers=auth).json()
    assert [q["progress"] for q in dashboard["daily_quests"]] == [1, 1, 1]
    assert dashboard["pet_walk"] == "walking"

def test_daily_quests_are_in_calendar_for_the_device_local_date(client, auth):
    # Simulate a client calendar date that differs from the server's UTC date.
    res = client.get("/api/tasks?start_date=2030-05-10&end_date=2030-05-10&quest_date=2030-05-10", headers=auth)
    assert res.status_code == 200
    quests = [task for task in res.json() if task["kind"] == "daily_quest"]
    assert len(quests) == 3
    assert {task["scheduled_date"] for task in quests} == {"2030-05-10"}
    assert {task["category"] for task in quests} == {"daily"}

def test_explore_unknown_course_is_404(client, auth):
    assert client.post("/api/campus/courses/nope/explore", headers=auth).status_code == 404

def test_walk_is_locked_until_every_quest_is_done(client, auth):
    assert space(client, auth)["status"] == "locked"
    res = client.post("/api/pet/walk", headers=auth)
    assert res.status_code == 409 and res.json()["code"] == "quests_incomplete"

def test_walk_returns_with_a_find_once_a_day(client, auth, db):
    finish_quests(client, auth)
    automatic = space(client, auth)
    assert automatic["status"] == "walking"
    started = client.post("/api/pet/walk", headers=auth).json()
    assert started["status"] == "walking" and started["walk_minutes"] == 480
    assert (datetime.fromisoformat(started["return_at"]) - datetime.fromisoformat(started["started_at"])).total_seconds() == 8 * 60 * 60
    assert 0 < started["seconds_left"] <= 8 * 60 * 60
    again = client.post("/api/pet/walk", headers=auth).json()
    assert again["status"] == "walking" and again["started_at"] == started["started_at"]
    assert client.post("/api/pet/walk/collect", headers=auth).json()["code"] == "walk_not_returned"

    # Tasks added after departure belong to the user's task list, not the active walk cycle.
    task = client.post("/api/tasks", headers=auth, json={"title": "Nhiệm vụ phát sinh", "category": "personal",
        "scheduled_date": date.today().isoformat(), "repeat": "none"}).json()
    client.post(f"/api/tasks/{task['id']}/complete", headers=auth,
                json={"occurrence_date": date.today().isoformat()})
    after_task = space(client, auth)
    assert after_task["status"] == "walking" and after_task["started_at"] == started["started_at"]

    bring_pet_home(db)
    assert space(client, auth)["status"] == "returned"
    collected = client.post("/api/pet/walk/collect", headers=auth).json()
    assert collected["found"]["id"] in REWARD_ITEMS
    assert collected["status"] == "rested" and collected["last_find"] == collected["found"]
    assert collected["inventory"] == [{**collected["found"], "quantity": 1}]

    assert client.post("/api/pet/walk/collect", headers=auth).json()["code"] == "nothing_to_collect"
    assert client.post("/api/pet/walk", headers=auth).json()["code"] == "already_walked"

def test_pet_space_requires_auth(client):
    assert client.get("/api/pet/space").status_code == 401

def test_avatar_must_be_a_preset(client, auth):
    res = client.patch("/api/profile", json={"avatar_theme": "fox"}, headers=auth)
    assert res.status_code == 200 and res.json()["avatar_theme"] == "fox"
    assert client.patch("/api/profile", json={"avatar_theme": "https://evil.example/x.png"}, headers=auth).status_code == 422
