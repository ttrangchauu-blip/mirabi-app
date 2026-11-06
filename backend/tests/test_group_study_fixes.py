"""Regressions from the group study audit (flow E): realtime delivery, access after moderation, late joins, rewards."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app import realtime, study, study_rooms
from app.db import SessionLocal
from app.models import SocialProfile, StudySession, User
from app.realtime import hub, queue_user
from together import befriend, create_room, heartbeat, join, member, person, receive, receive_until, room, socket


# ---------------------------------------------------------------------------- outbox and savepoints
def _recording(monkeypatch) -> list:
    sent = []
    monkeypatch.setattr(realtime.hub, "publish", lambda kind, target, message, *a, **k: sent.append(message))
    return sent


def test_savepoints_neither_send_nor_drop_queued_events(client, monkeypatch):
    sent = _recording(monkeypatch)
    with SessionLocal() as db:
        queue_user(db, 1, {"n": 1})
        with db.begin_nested():
            pass
        assert sent == []  # releasing a savepoint is not the commit: nobody may see this yet
        try:
            with db.begin_nested():
                raise ValueError
        except ValueError:
            pass
        db.commit()
    assert sent == [{"n": 1}]  # still queued after a savepoint rolled back, and sent once by the real commit


def test_a_real_rollback_drops_queued_events(client, monkeypatch):
    sent = _recording(monkeypatch)
    with SessionLocal() as db:
        queue_user(db, 1, {"n": 1})
        with db.begin_nested():
            pass
        db.rollback()
        db.commit()
    assert sent == []


# ---------------------------------------------------------------------------- disabled accounts
def _subscribed(ws, room_id):
    receive(ws)
    ws.send_json({"type": "subscribe", "room_id": room_id})
    receive_until(ws, lambda m: m["type"] == "room.snapshot")


def test_disabling_an_account_closes_its_open_sockets(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    with SessionLocal() as db:
        db.get(User, ana.id).role = "admin"
        db.commit()
    report = client.post(f"/api/users/{binh.id}/report", json={"reason": "spam"}, headers=ana.headers).json()
    with socket(client, binh) as ws:
        _subscribed(ws, snap["id"])
        resolved = client.post(f"/api/admin/social/reports/{report['id']}/resolve", json={"action": "disable_user"},
                               headers=ana.headers)
        assert resolved.status_code == 200
        with pytest.raises(WebSocketDisconnect) as closed:
            receive_until(ws, lambda m: False)
        assert closed.value.code == realtime.CLOSE_UNAUTHORIZED


def test_a_ping_from_an_account_disabled_elsewhere_ends_the_socket(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    with socket(client, binh) as ws:
        _subscribed(ws, snap["id"])
        with SessionLocal() as db:
            db.get(User, binh.id).status = "disabled"
            db.commit()
        before = next(m for m in room(client, ana, snap["id"])["members"] if m["user_id"] == binh.id)["presence"]
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect) as closed:
            receive_until(ws, lambda m: False)
        assert closed.value.code == realtime.CLOSE_UNAUTHORIZED
        assert before == "online"
    with SessionLocal() as db:
        assert study_rooms.heartbeat_user(binh.id, (snap["id"],)) is False


# ---------------------------------------------------------------------------- friends' rooms
def test_a_friends_room_is_only_offered_when_the_viewer_could_join_it(client, clock):
    viewer, friend, host = person(client, "Vy"), person(client, "Yen"), person(client, "Zan")
    befriend(client, viewer, friend)
    snap = create_room(client, host)
    assert join(client, friend, snap["code"]).status_code == 200
    listed = client.get("/api/friends", headers=viewer.headers).json()["items"]
    assert listed[0]["id"] == friend.id and listed[0]["room"] is None  # joining would answer 404: Zan is no friend of Vy
    befriend(client, viewer, host)
    listed = {f["id"]: f for f in client.get("/api/friends", headers=viewer.headers).json()["items"]}
    assert listed[friend.id]["room"]["id"] == snap["id"]
    assert client.post(f"/api/study-rooms/{snap['id']}/join", headers=viewer.headers).status_code == 200


# ---------------------------------------------------------------------------- blocks and room lookup
def test_room_lookup_does_not_show_a_host_who_blocked_you(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    seen = client.post("/api/study-rooms/lookup", json={"code": snap["code"]}, headers=binh.headers).json()
    assert seen["host"]["id"] == ana.id
    assert client.post(f"/api/users/{binh.id}/block", headers=ana.headers).status_code == 201
    seen = client.post("/api/study-rooms/lookup", json={"code": snap["code"]}, headers=binh.headers).json()
    assert seen["can_join"] is False and seen["reason"] == "room_unavailable" and seen["host"] is None


# ---------------------------------------------------------------------------- hidden stats and their owner
def _hide_stats(who):
    with SessionLocal() as db:
        profile = db.scalar(select(SocialProfile).where(SocialProfile.user_id == who.id))
        profile.share_study_stats = False
        db.commit()


def test_someone_hiding_their_stats_still_gets_their_own_and_nobody_elses(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    room(client, binh, snap["id"])
    _hide_stats(binh)
    client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
    clock.advance(minutes=3)
    mine = heartbeat(client, binh, snap["id"])
    assert member(mine, binh)["focus_seconds"] is None  # the shared snapshot stays the same for everyone
    assert mine["own_stats"] == {"focus_seconds": 180, "cycles_completed": 0}
    theirs = heartbeat(client, ana, snap["id"])
    assert "own_stats" not in theirs and member(theirs, binh)["focus_seconds"] is None
    with socket(client, binh) as binh_ws, socket(client, ana) as ana_ws:
        receive(binh_ws)
        receive(ana_ws)
        ana_ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        snapshot = receive_until(ana_ws, lambda m: m["type"] == "room.snapshot")
        assert "own_stats" not in snapshot["room"]
        binh_ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        assert receive_until(binh_ws, lambda m: m["type"] == "room.snapshot")["room"]["own_stats"]["focus_seconds"] == 180
        clock.advance(minutes=2)
        client.post(f"/api/study-rooms/{snap['id']}/pause", headers=ana.headers)
        pushed = receive_until(binh_ws, lambda m: m["type"] == "room.own_stats")
        assert pushed["room_id"] == snap["id"] and pushed["stats"]["focus_seconds"] == 300
        assert receive_until(ana_ws, lambda m: m.get("event") == "session_paused")["type"] == "room.updated"
        ana_ws.send_json({"type": "ping"})
        assert receive_until(ana_ws, lambda m: m["type"] in ("pong", "room.own_stats"))["type"] == "pong"


# ---------------------------------------------------------------------------- what follows rewards
def _record_after_rewards(monkeypatch) -> list:
    calls = []
    monkeypatch.setattr(study_rooms, "_after_rewards", lambda ids: calls.append(list(ids)))
    return calls


def test_an_idle_close_starts_the_pet_walk_for_those_it_rewarded(client, clock, monkeypatch):
    ana = person(client, "Ana")
    snap = create_room(client, ana, cycles=1)
    client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
    calls = _record_after_rewards(monkeypatch)
    clock.advance(minutes=121)
    study_rooms.sweep(clock.now(), full=True)
    assert [ana.id] in calls
    assert client.get(f"/api/study-rooms/{snap['id']}", headers=ana.headers).status_code == 404  # closed: nobody is in it


def test_starting_over_an_expired_session_starts_the_pet_walk(client, clock, monkeypatch):
    ana = person(client, "Ana")
    snap = create_room(client, ana, cycles=1)
    client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
    calls = _record_after_rewards(monkeypatch)
    clock.advance(minutes=26)
    started = client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
    assert started.status_code == 200 and started.json()["already_started"] is False
    assert [ana.id] in calls


# ---------------------------------------------------------------------------- subscribe race
def test_leaving_while_a_subscribe_is_in_flight_does_not_leave_a_live_subscription(client, clock, monkeypatch):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    real_join = study_rooms.realtime_join

    def join_then_leave(user_id, room_id):
        allowed = real_join(user_id, room_id)  # the check passed; the same user leaves from another device right now
        with SessionLocal() as db:
            with study_rooms.locked_room(db, room_id) as locked:
                event, _ = study_rooms._leave(db, locked, study_rooms._member(db, room_id, user_id), clock.now())
                study_rooms._publish(db, locked, event, revoke=(user_id,))
                db.commit()
        return allowed

    monkeypatch.setattr(study_rooms, "realtime_join", join_then_leave)
    with socket(client, binh) as ws:
        receive(ws)
        ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        answer = receive_until(ws, lambda m: m["type"] in ("room.snapshot", "error"))
        assert answer == {"type": "error", "code": "room_not_found", "room_id": snap["id"]}
        assert hub.user_watches_room(binh.id, snap["id"]) is False
        monkeypatch.setattr(study_rooms, "realtime_join", real_join)
        client.post(f"/api/study-rooms/{snap['id']}/messages", json={"body": "riêng tư"}, headers=ana.headers)
        ws.send_json({"type": "ping"})
        got = receive_until(ws, lambda m: m["type"] in ("pong", "room.message"))
        assert got["type"] == "pong"


# ---------------------------------------------------------------------------- joining after the timer ran out
def test_joining_just_after_a_session_ran_out_does_not_make_you_part_of_it(client, clock, monkeypatch):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana, cycles=1)
    started = client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers).json()["room"]
    session_id = started["session"]["id"]
    calls = _record_after_rewards(monkeypatch)
    clock.advance(minutes=26)  # the sweep hasn't run yet
    joined = join(client, binh, snap["code"]).json()["room"]
    assert joined["session"] is None and joined["last_session_id"] == session_id
    assert [ana.id] in calls
    summary = client.get(f"/api/group-sessions/{session_id}/summary", headers=ana.headers).json()
    assert summary["finalized"] is True and [p["user_id"] for p in summary["participants"]] == [ana.id]
    assert client.get(f"/api/group-sessions/{session_id}/summary", headers=binh.headers).status_code == 404
    inbox = client.get("/api/notifications", headers=binh.headers).json()["items"]
    assert all(n["kind"] != "session_completed" for n in inbox)


def test_joining_a_running_session_still_makes_you_part_of_it(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
    clock.advance(minutes=5)
    joined = join(client, binh, snap["code"]).json()["room"]
    assert joined["session"] is not None and member(joined, binh)["in_session"] is True


# ---------------------------------------------------------------------------- personal Pomodoro clock
class _Now:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture()
def study_clock(monkeypatch):
    now = _Now(datetime.now(timezone.utc).replace(microsecond=0))
    monkeypatch.setattr(study, "utcnow", now)
    return now


def _put(client, who, cycle, **body):
    return client.put(f"/api/study/pomodoro/{cycle}", json={"timezone": "UTC", **body}, headers=who.headers)


def _duration(cycle):
    with SessionLocal() as db:
        return db.scalar(select(StudySession.duration_seconds).where(StudySession.pomodoro_cycle == cycle))


def test_a_start_that_arrived_live_bounds_the_session_by_server_time(client, study_clock):
    ana = person(client, "Ana")
    t = study_clock.t
    assert _put(client, ana, "livecycle01", event="started", occurred_at=(t - timedelta(seconds=59)).isoformat()).status_code == 200
    answer = _put(client, ana, "livecycle01", event="completed", duration_seconds=60)
    assert answer.status_code == 422 and _duration("livecycle01") == 0  # refused, nothing recorded


def test_a_start_held_back_by_the_network_keeps_the_time_the_server_can_vouch_for(client, study_clock):
    ana = person(client, "Ana")
    t = study_clock.t
    assert _put(client, ana, "livecycle02", event="started", occurred_at=(t - timedelta(seconds=30)).isoformat()).status_code == 200
    study_clock.t = t + timedelta(seconds=1470)
    answer = _put(client, ana, "livecycle02", event="completed", duration_seconds=1500)
    assert answer.status_code == 200 and answer.json()["status"] == "completed"
    assert _duration("livecycle02") == 1472  # server time since the start arrived, with the usual 2 s allowance


def test_a_live_session_within_server_time_keeps_its_duration(client, study_clock):
    ana = person(client, "Ana")
    assert _put(client, ana, "livecycle03", event="started").status_code == 200
    study_clock.t += timedelta(seconds=1500)
    answer = _put(client, ana, "livecycle03", event="completed", duration_seconds=1500)
    assert answer.status_code == 200 and _duration("livecycle03") == 1500


def test_sessions_delivered_after_being_offline_work_as_before(client, study_clock):
    ana = person(client, "Ana")
    t = study_clock.t
    start = t - timedelta(hours=3)
    assert _put(client, ana, "offcycle001", event="started", occurred_at=start.isoformat()).status_code == 200
    answer = _put(client, ana, "offcycle001", event="completed", duration_seconds=1500,
                  occurred_at=(start + timedelta(seconds=1500)).isoformat())
    assert answer.status_code == 200 and answer.json()["status"] == "completed" and _duration("offcycle001") == 1500


def test_a_cancelled_live_session_only_keeps_what_the_server_saw(client, study_clock):
    ana = person(client, "Ana")
    t = study_clock.t
    assert _put(client, ana, "livecycle04", event="started", occurred_at=(t - timedelta(seconds=50)).isoformat()).status_code == 200
    assert _put(client, ana, "livecycle04", event="cancelled", duration_seconds=50).status_code == 200
    assert _duration("livecycle04") == 2
