"""The Study Together acceptance scenario, end to end through the public API and the realtime socket."""
from together import (assert_no_private_fields, befriend, heartbeat, member, person, receive, receive_until, room,
                      socket)


def test_two_friends_study_together_from_invitation_to_summary(client, clock):
    # 1. A signs in and creates a private room.
    a, b = person(client, "Ana", pet="dolphin"), person(client, "Binh", pet="cat")
    befriend(client, a, b)
    created = client.post("/api/study-rooms", json={"name": "Ôn Hóa", "goal": "Xong đề 2", "subject": "science",
                                                     "focus_minutes": 25, "break_minutes": 5, "cycles": 2,
                                                     "max_members": 4, "visibility": "private"}, headers=a.headers)
    assert created.status_code == 201
    room_id = created.json()["room"]["id"]

    # 2. A invites B.
    assert client.post(f"/api/study-rooms/{room_id}/invitations", json={"user_ids": [b.id]},
                       headers=a.headers).json()["invited"] == [b.id]
    home = client.get("/api/study-together/home", headers=b.headers).json()
    [invitation] = home["invitations"]
    assert invitation["room"]["name"] == "Ôn Hóa" and home["unread_notifications"] >= 1

    # 3. B accepts.
    accepted = client.post(f"/api/room-invitations/{invitation['id']}/accept", headers=b.headers)
    assert accepted.status_code == 200

    with socket(client, a) as ws_a, socket(client, b) as ws_b:
        for ws in (ws_a, ws_b):
            receive(ws)
            ws.send_json({"type": "subscribe", "room_id": room_id})
            receive_until(ws, lambda m: m["type"] == "room.snapshot")

        # 4. Both study together: A starts the session and both are told.
        assert client.post(f"/api/study-rooms/{room_id}/start", headers=a.headers).status_code == 200
        seen_a = receive_until(ws_a, lambda m: m.get("event") == "session_started")
        seen_b = receive_until(ws_b, lambda m: m.get("event") == "session_started")

        # 5. The timer is the same for both.
        assert seen_a["version"] == seen_b["version"]
        assert seen_a["room"]["session"] == seen_b["room"]["session"]
        assert seen_a["room"]["session"]["phase_ends_at"] is not None

        for _ in range(2):
            clock.advance(minutes=5)
            ws_a.send_json({"type": "ping"})
            ws_b.send_json({"type": "ping"})
            receive_until(ws_a, lambda m: m["type"] == "pong")
            receive_until(ws_b, lambda m: m["type"] == "pong")

    # 6. B loses the connection (both sockets closed above) and comes back 4 minutes later.
    clock.advance(minutes=4)
    with socket(client, b) as ws_b:
        receive(ws_b)
        ws_b.send_json({"type": "subscribe", "room_id": room_id})
        restored = receive_until(ws_b, lambda m: m["type"] == "room.snapshot")
        assert restored["room"]["state"] == "focus" and restored["room"]["session"]["remaining_ms"] == 11 * 60 * 1000
        assert member(restored["room"], b)["in_session"] is True
    heartbeat(client, a, room_id)

    # 7. The session runs to the end on the server's clock.
    for _ in range(8):
        clock.advance(minutes=5)
        heartbeat(client, a, room_id)
        heartbeat(client, b, room_id)
    clock.advance(minutes=1)
    final = room(client, a, room_id)
    assert final["state"] == "waiting" and final["last_session_id"]

    # 8. The backend computed valid time and EXP: 50 minutes, 2 cycles each (the 4-minute drop was within the grace).
    # 9. Both see their own summary.
    for who in (a, b):
        summary = client.get(f"/api/group-sessions/{final['last_session_id']}/summary", headers=who.headers).json()
        assert summary["status"] == "completed" and summary["completed_cycles"] == 2
        assert summary["me"] == {"focus_seconds": 3000, "cycles_completed": 2, "study_exp": 20, "bonus_exp": 4,
                                 "exp_awarded": 24, "rewarded": True}
        # 10. Nothing private leaks to the other person.
        assert_no_private_fields(summary["participants"])
        assert_no_private_fields(client.get("/api/study-together/home", headers=who.headers).json()["friends"])
    assert_no_private_fields(final)
    profile = client.get("/api/auth/me", headers=b.headers).json()
    assert profile["xp"] >= 24  # the pet received the EXP
