from sqlalchemy import func, select

from app import study_rooms
from app.db import SessionLocal
from app.models import ExpEvent, StudyRoomSession, TeamQuestEvent
from together import create_room, heartbeat, join, person, room


def study(client, clock, people, room_id, minutes, step=5):
    for _ in range(minutes // step):
        clock.advance(minutes=step)
        for who in people:
            heartbeat(client, who, room_id)


def run_session(client, clock, host, people, room_id, minutes):
    assert client.post(f"/api/study-rooms/{room_id}/start", headers=host.headers).status_code == 200
    study(client, clock, people, room_id, minutes)
    return room(client, host, room_id)["last_session_id"]


def quest_exp(user_id):
    with SessionLocal() as db:
        return db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(
            ExpEvent.user_id == user_id, ExpEvent.source == "team_quest"))


def test_templates_and_creation_rules(client):
    host, binh, outsider = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    templates = client.get("/api/team-quests/templates", headers=host.headers).json()["items"]
    assert {t["key"] for t in templates} == {"daily_hour", "focus_minutes", "focus_cycles"}
    room_id = create_room(client, host)["id"]
    join(client, binh, room(client, host, room_id)["code"])
    created = client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "daily_hour"}, headers=host.headers)
    assert created.status_code == 201
    quest = created.json()
    assert quest["joined"] is True and quest["target"] == 60 and quest["progress"] == 0 and quest["status"] == "active"
    again = client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "daily_hour"}, headers=host.headers)
    assert again.status_code == 409 and again.json()["code"] == "quest_already_active"
    assert client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "focus_cycles"},
                       headers=binh.headers).json()["code"] == "not_room_host"
    assert client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "x"}, headers=host.headers).status_code == 422
    # The room snapshot shows the shared goal.
    assert [q["id"] for q in room(client, binh, room_id)["team_quests"]] == [quest["id"]]
    assert client.get(f"/api/team-quests/{quest['id']}", headers=outsider.headers).status_code == 404
    assert client.post(f"/api/team-quests/{quest['id']}/join", headers=outsider.headers).status_code == 404
    joined = client.post(f"/api/team-quests/{quest['id']}/join", headers=binh.headers).json()
    assert joined["joined"] is True and len(joined["members"]) == 2
    assert client.post(f"/api/team-quests/{quest['id']}/join", headers=binh.headers).status_code == 200  # idempotent


def test_progress_comes_from_sessions_and_completion_pays_once(client, clock):
    host, binh = person(client, "Ana"), person(client, "Binh")
    room_id = create_room(client, host, focus_minutes=25, break_minutes=5, cycles=1)["id"]
    join(client, binh, room(client, host, room_id)["code"])
    quest = client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "daily_hour"}, headers=host.headers).json()
    client.post(f"/api/team-quests/{quest['id']}/join", headers=binh.headers)
    first = run_session(client, clock, host, [host, binh], room_id, 25)
    detail = client.get(f"/api/team-quests/{quest['id']}", headers=binh.headers).json()
    assert detail["progress"] == 50 and detail["status"] == "active" and detail["my_contribution"] == 25
    summary = client.get(f"/api/group-sessions/{first}/summary", headers=binh.headers).json()
    assert summary["team_quests"] == [{"id": quest["id"], "title": quest["title"], "unit": "minutes", "progress": 50,
                                       "target": 60, "status": "active", "added": 25}]
    # Reprocessing the same session adds nothing.
    with SessionLocal() as db:
        from app import team_quests
        session = db.get(StudyRoomSession, first)
        team_quests.record_session(db, session, study_rooms._participants(db, session))
        db.commit()
        assert db.scalar(select(func.count()).select_from(TeamQuestEvent)) == 2
    assert client.get(f"/api/team-quests/{quest['id']}", headers=host.headers).json()["progress"] == 50
    run_session(client, clock, host, [host, binh], room_id, 25)
    done = client.get(f"/api/team-quests/{quest['id']}", headers=binh.headers).json()
    assert done["status"] == "completed" and done["progress"] == 60 and done["my_reward_exp"] == 10
    assert quest_exp(binh.id) == 10 and quest_exp(host.id) == 10
    notes = client.get("/api/notifications", headers=binh.headers).json()["items"]
    assert any(n["kind"] == "team_quest_completed" for n in notes)
    # A completed quest takes no more progress or rewards.
    run_session(client, clock, host, [host, binh], room_id, 25)
    assert client.get(f"/api/team-quests/{quest['id']}", headers=binh.headers).json()["progress"] == 60
    assert quest_exp(binh.id) == 10


def test_only_quest_members_contribute_and_private_stats_stay_hidden(client, clock):
    host, binh = person(client, "Ana"), person(client, "Binh")
    room_id = create_room(client, host, focus_minutes=25, cycles=1)["id"]
    join(client, binh, room(client, host, room_id)["code"])
    quest = client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "focus_cycles"},
                        headers=host.headers).json()
    run_session(client, clock, host, [host, binh], room_id, 25)
    detail = client.get(f"/api/team-quests/{quest['id']}", headers=host.headers).json()
    assert detail["progress"] == 1  # Binh studied but hadn't joined the quest
    client.post(f"/api/team-quests/{quest['id']}/join", headers=binh.headers)
    client.patch("/api/social/me", json={"share_study_stats": False}, headers=host.headers)
    run_session(client, clock, host, [host, binh], room_id, 25)
    seen_by_binh = client.get(f"/api/team-quests/{quest['id']}", headers=binh.headers).json()
    assert seen_by_binh["progress"] == 3
    contributions = {m["user_id"]: m["contribution"] for m in seen_by_binh["members"]}
    assert contributions == {host.id: None, binh.id: 1}
    listed = client.get("/api/team-quests", headers=binh.headers).json()["items"]
    assert [q["id"] for q in listed] == [quest["id"]]


def test_expired_quests_take_no_progress(client, clock):
    host = person(client, "Ana")
    room_id = create_room(client, host, focus_minutes=25, cycles=1)["id"]
    quest = client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "daily_hour"}, headers=host.headers).json()
    clock.advance(days=1, minutes=1)
    heartbeat(client, host, room_id)
    run_session(client, clock, host, [host], room_id, 25)
    detail = client.get(f"/api/team-quests/{quest['id']}", headers=host.headers).json()
    assert detail["status"] == "expired" and detail["progress"] == 0
    # An expired quest can be started again.
    assert client.post(f"/api/study-rooms/{room_id}/team-quests", json={"template_key": "daily_hour"},
                       headers=host.headers).status_code == 201
