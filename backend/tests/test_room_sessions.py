from sqlalchemy import func, select

from app import study_rooms
from app.db import SessionLocal
from app.models import ExpEvent, StudyRoomSession, StudySession
from together import befriend, create_room, heartbeat, join, member, person, room


def setup_pair(client, **room_overrides):
    host, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, host, **room_overrides)
    assert join(client, binh, snap["code"]).status_code == 200
    return host, binh, snap["id"]


def study(client, clock, people, room_id, minutes, step=5):
    """Let `minutes` pass while `people` keep their app open (a heartbeat every `step` minutes)."""
    for _ in range(minutes // step):
        clock.advance(minutes=step)
        for who in people:
            heartbeat(client, who, room_id)


def start(client, host, room_id):
    response = client.post(f"/api/study-rooms/{room_id}/start", headers=host.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def exp_total(user_id, source=None):
    with SessionLocal() as db:
        query = select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(ExpEvent.user_id == user_id)
        if source:
            query = query.where(ExpEvent.source == source)
        return db.scalar(query)


def test_full_session_runs_on_the_server_clock_and_rewards_once(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, break_minutes=5, cycles=2)
    started = start(client, host, room_id)
    assert started["already_started"] is False
    snap = started["room"]
    assert snap["state"] == "focus" and snap["session"]["remaining_ms"] == 25 * 60 * 1000
    assert start(client, host, room_id)["already_started"] is True  # double tap
    # Every member sees the same timer.
    a, b = room(client, host, room_id), room(client, binh, room_id)
    assert a["session"]["phase_ends_at"] == b["session"]["phase_ends_at"]
    study(client, clock, [host, binh], room_id, 25)
    after_focus = room(client, binh, room_id)
    assert after_focus["state"] == "break" and after_focus["session"]["completed_cycles"] == 1
    assert member(after_focus, binh)["focus_seconds"] == 1500 and member(after_focus, binh)["cycles_completed"] == 1
    study(client, clock, [host, binh], room_id, 5)
    assert room(client, host, room_id)["state"] == "focus"
    study(client, clock, [host, binh], room_id, 25)
    done = room(client, host, room_id)
    assert done["state"] == "waiting" and done["session"] is None and done["last_session_id"]
    session_id = done["last_session_id"]

    summary = client.get(f"/api/group-sessions/{session_id}/summary", headers=binh.headers).json()
    assert summary["status"] == "completed" and summary["finalized"] is True and summary["completed_cycles"] == 2
    # 50 valid minutes -> 10 blocks x 2 EXP, plus the together bonus of 2 EXP per completed cycle.
    assert summary["me"] == {"focus_seconds": 3000, "cycles_completed": 2, "study_exp": 20, "bonus_exp": 4,
                             "exp_awarded": 24, "rewarded": True}
    assert {p["user_id"] for p in summary["participants"]} == {host.id, binh.id}
    with SessionLocal() as db:
        rows = db.scalars(select(StudySession).where(StudySession.pomodoro_cycle == f"room{session_id}")).all()
        assert {(r.user_id, r.duration_seconds, r.status, r.mode, r.study_type) for r in rows} == {
            (host.id, 3000, "completed", "pomodoro", "together"), (binh.id, 3000, "completed", "pomodoro", "together")}
    # Group minutes count in personal statistics too.
    assert client.get("/api/study/summary", headers=binh.headers).json()["today_seconds"] == 3000
    before = exp_total(binh.id)
    # Ending again, re-reading, sweeping and re-finalizing never pays twice.
    end_again = client.post(f"/api/study-rooms/{room_id}/end", headers=host.headers)
    assert end_again.status_code == 200 and end_again.json()["session_id"] == session_id
    room(client, binh, room_id)
    study_rooms.sweep(clock.now())
    with SessionLocal() as db:
        assert study_rooms.finalize_session(db, db.get(StudyRoomSession, session_id)) == []
        db.commit()
    assert exp_total(binh.id) == before  # login streak EXP is included in both readings
    assert exp_total(binh.id, "study") == 20 and exp_total(binh.id, "group") == 4
    history = client.get("/api/group-sessions/history", headers=binh.headers).json()["items"]
    assert [(h["id"], h["focus_seconds"], h["exp_awarded"]) for h in history] == [(session_id, 3000, 24)]


def test_dropping_out_stops_credit_after_the_grace_period_and_reconnecting_resumes(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, break_minutes=5, cycles=2)
    start(client, host, room_id)
    study(client, clock, [host], room_id, 20)  # Binh's app went silent at the start
    snap = room(client, host, room_id)
    assert member(snap, binh)["in_session"] is False
    study_rooms.sweep(clock.now())
    assert member(room(client, host, room_id), binh)["presence"] == "away"
    study(client, clock, [host], room_id, 5)  # focus 1 ends; Binh got 10 minutes (the grace) and no cycle
    snap = room(client, host, room_id)
    assert member(snap, binh)["focus_seconds"] == 600 and member(snap, binh)["cycles_completed"] == 0
    clock.advance(minutes=2)
    back = heartbeat(client, binh, room_id)  # reconnects during the break
    assert member(back, binh)["in_session"] is True and member(back, binh)["presence"] == "online"
    clock.advance(minutes=3)
    study(client, clock, [host, binh], room_id, 25)
    summary = client.get(f"/api/group-sessions/{room(client, host, room_id)['last_session_id']}/summary",
                         headers=binh.headers).json()
    assert summary["me"]["focus_seconds"] == 600 + 1500 and summary["me"]["cycles_completed"] == 1


def test_a_short_network_loss_inside_the_grace_costs_nothing(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=1)
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 5)
    clock.advance(minutes=8)  # screen locked / offline, then back
    heartbeat(client, host, room_id)
    heartbeat(client, binh, room_id)
    study(client, clock, [host, binh], room_id, 12, step=4)
    summary = client.get(f"/api/group-sessions/{room(client, host, room_id)['last_session_id']}/summary",
                         headers=binh.headers).json()
    assert summary["me"]["focus_seconds"] == 1500 and summary["me"]["cycles_completed"] == 1


def test_paused_time_is_not_credited(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=1)
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 10)
    paused = client.post(f"/api/study-rooms/{room_id}/pause", headers=host.headers).json()["room"]
    assert paused["state"] == "paused" and paused["session"]["remaining_ms"] == 15 * 60 * 1000
    assert paused["session"]["phase_ends_at"] is None
    assert client.post(f"/api/study-rooms/{room_id}/pause", headers=host.headers).json()["code"] == "session_not_running"
    study(client, clock, [host, binh], room_id, 30)
    assert room(client, binh, room_id)["session"]["remaining_ms"] == 15 * 60 * 1000
    resumed = client.post(f"/api/study-rooms/{room_id}/resume", headers=host.headers).json()["room"]
    assert resumed["state"] == "focus" and resumed["session"]["remaining_ms"] == 15 * 60 * 1000
    assert client.post(f"/api/study-rooms/{room_id}/resume", headers=host.headers).json()["code"] == "session_not_paused"
    study(client, clock, [host, binh], room_id, 15)
    summary = client.get(f"/api/group-sessions/{room(client, host, room_id)['last_session_id']}/summary",
                         headers=host.headers).json()
    assert summary["status"] == "completed" and summary["me"]["focus_seconds"] == 1500


def test_ending_early_credits_studied_minutes_as_an_unfinished_session(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=2)
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 10)
    clock.advance(minutes=2)
    ended = client.post(f"/api/study-rooms/{room_id}/end", headers=host.headers)
    assert ended.status_code == 200
    session_id = ended.json()["session_id"]
    summary = client.get(f"/api/group-sessions/{session_id}/summary", headers=binh.headers).json()
    assert summary["status"] == "cancelled" and summary["end_reason"] == "ended_by_host"
    # 12 minutes -> 2 blocks; no cycle finished, so no together bonus.
    assert summary["me"] == {"focus_seconds": 720, "cycles_completed": 0, "study_exp": 4, "bonus_exp": 0,
                             "exp_awarded": 4, "rewarded": True}
    with SessionLocal() as db:
        row = db.scalar(select(StudySession).where(StudySession.user_id == binh.id))
        assert (row.status, row.completed, row.duration_seconds) == ("cancelled", False, 720)
    assert client.post(f"/api/study-rooms/{room_id}/pause", headers=host.headers).json()["code"] == "no_active_session"


def test_group_study_shares_the_personal_daily_study_cap(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=1)
    # Binh already studied 120 minutes alone today: the study cap (48 EXP) is used up.
    assert client.post("/api/study/sessions", json={"duration_seconds": 7200}, headers=binh.headers).json()["xp_awarded"] == 48
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 25)
    session_id = room(client, host, room_id)["last_session_id"]
    mine = client.get(f"/api/group-sessions/{session_id}/summary", headers=binh.headers).json()["me"]
    assert mine["study_exp"] == 0 and mine["bonus_exp"] == 2
    assert client.get(f"/api/group-sessions/{session_id}/summary", headers=host.headers).json()["me"]["study_exp"] == 10


def test_studying_alone_in_a_room_earns_no_together_bonus(client, clock):
    host = person(client, "Ana")
    room_id = create_room(client, host, focus_minutes=25, cycles=1)["id"]
    start(client, host, room_id)
    study(client, clock, [host], room_id, 25)
    mine = client.get(f"/api/group-sessions/{room(client, host, room_id)['last_session_id']}/summary",
                      headers=host.headers).json()["me"]
    assert mine["study_exp"] == 10 and mine["bonus_exp"] == 0


def test_late_joiner_gets_minutes_but_a_cycle_only_after_half_of_it(client, clock):
    host, binh, carl = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    room_id = create_room(client, host, focus_minutes=20, cycles=1)["id"]
    join(client, binh, room(client, host, room_id)["code"])
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 15)
    join(client, carl, room(client, host, room_id)["code"])  # 5 minutes left
    study(client, clock, [host, binh, carl], room_id, 5)
    summary = client.get(f"/api/group-sessions/{room(client, host, room_id)['last_session_id']}/summary",
                         headers=carl.headers).json()
    assert summary["me"]["focus_seconds"] == 300 and summary["me"]["cycles_completed"] == 0


def test_summary_and_history_are_private_to_participants(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=1)
    outsider = person(client, "Carl")
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 25)
    session_id = room(client, host, room_id)["last_session_id"]
    assert client.get(f"/api/group-sessions/{session_id}/summary", headers=outsider.headers).status_code == 404
    assert client.get("/api/group-sessions/history", headers=outsider.headers).json()["items"] == []
    # Members who keep their stats private show no numbers to others, but always to themselves.
    client.patch("/api/social/me", json={"share_study_stats": False}, headers=binh.headers)
    seen_by_host = client.get(f"/api/group-sessions/{session_id}/summary", headers=host.headers).json()
    other = next(p for p in seen_by_host["participants"] if p["user_id"] == binh.id)
    assert other["focus_seconds"] is None and other["cycles_completed"] is None
    seen_by_self = client.get(f"/api/group-sessions/{session_id}/summary", headers=binh.headers).json()
    assert next(p for p in seen_by_self["participants"] if p["user_id"] == binh.id)["focus_seconds"] == 1500


def test_background_sweep_advances_timers_hands_over_rooms_and_closes_idle_ones(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, break_minutes=5, cycles=2)
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 20)
    clock.advance(minutes=6)
    study_rooms.sweep(clock.now())  # nobody asked, but the phase changed
    assert study_rooms.load_snapshot(room_id)["state"] == "break"
    # The host vanished; Binh keeps studying and takes over after the grace period.
    study(client, clock, [binh], room_id, 15)
    study_rooms.sweep(clock.now())
    snap = study_rooms.load_snapshot(room_id)
    assert snap["host_id"] == binh.id and member(snap, binh)["role"] == "host"
    assert member(snap, host)["presence"] == "away"
    # Everyone gone for two hours: the room closes and the session is settled.
    clock.advance(hours=3)
    study_rooms.sweep(clock.now(), full=True)
    snap = study_rooms.load_snapshot(room_id)
    assert snap["status"] == "closed" and snap["session"] is None
    summary = client.get(f"/api/group-sessions/{snap['last_session_id']}/summary", headers=binh.headers).json()
    assert summary["finalized"] is True and summary["completed_cycles"] == 2


def test_closing_the_room_mid_session_settles_it(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=2)
    befriend(client, host, binh)
    start(client, host, room_id)
    study(client, clock, [host, binh], room_id, 10)
    closed = client.post(f"/api/study-rooms/{room_id}/close", headers=host.headers).json()
    assert closed["closed"] is True and closed["last_session_id"]
    assert client.post(f"/api/study-rooms/{room_id}/close", headers=host.headers).json()["closed"] is True
    assert client.get(f"/api/group-sessions/{closed['last_session_id']}/summary",
                      headers=binh.headers).json()["me"]["focus_seconds"] == 600
    assert client.get(f"/api/study-rooms/{room_id}", headers=binh.headers).status_code == 404
    assert client.get("/api/study-rooms/current", headers=binh.headers).json()["room"] is None


def test_client_supplied_reward_fields_are_ignored(client, clock):
    host, binh, room_id = setup_pair(client, focus_minutes=25, cycles=1)
    start(client, host, room_id)
    clock.advance(minutes=1)
    forged = client.post(f"/api/study-rooms/{room_id}/heartbeat", json={"focus_seconds": 99999, "xp": 500},
                         headers=binh.headers).json()
    assert member(forged, binh)["focus_seconds"] == 60
    ended = client.post(f"/api/study-rooms/{room_id}/end", json={"exp": 1000}, headers=host.headers).json()
    summary = client.get(f"/api/group-sessions/{ended['session_id']}/summary", headers=binh.headers).json()
    assert summary["me"]["exp_awarded"] == 0 and exp_total(binh.id, "study") == 0
