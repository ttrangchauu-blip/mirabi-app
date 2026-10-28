from sqlalchemy import select

from app import study_rooms
from app.config import settings
from app.models import StudyRoomMessage, UserReport
from together import create_room, join, person, receive, receive_until, socket


def send(client, who, room_id, body, **extra):
    return client.post(f"/api/study-rooms/{room_id}/messages", json={"body": body, **extra}, headers=who.headers)


def history(client, who, room_id, **params):
    response = client.get(f"/api/study-rooms/{room_id}/messages", params=params, headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def bodies(page):
    return [m["body"] for m in page["items"]]


def test_members_chat_and_validation_keeps_messages_plain_text(client):
    ana, binh, outsider = person(client, "Ana"), person(client, "Binh"), person(client, "Chi")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    sent = send(client, ana, snap["id"], "  Chào cả nhà!\r\n\r\n\r\n\r\nCố lên nhé  ")
    assert sent.status_code == 201
    message = sent.json()["message"]
    assert message["body"] == "Chào cả nhà!\n\nCố lên nhé"  # trimmed, line endings normalized, blank runs folded
    assert message["sender"]["id"] == ana.id and message["deleted"] is False
    assert set(message["sender"]) == {"id", "display_name", "avatar_theme", "pet", "pet_name", "pet_level", "public_code"}
    assert send(client, binh, snap["id"], "Ok luôn 💪").status_code == 201
    assert bodies(history(client, binh, snap["id"])) == ["Chào cả nhà!\n\nCố lên nhé", "Ok luôn 💪"]

    assert send(client, ana, snap["id"], "   ").status_code == 422
    assert send(client, ana, snap["id"], "x" * 501).status_code == 422
    assert send(client, ana, snap["id"], "bell\x07").status_code == 422
    # Outsiders can neither read nor write, and can't tell the room exists.
    assert send(client, outsider, snap["id"], "hi").json()["code"] == "room_not_found"
    assert client.get(f"/api/study-rooms/{snap['id']}/messages", headers=outsider.headers).json()["code"] == "room_not_found"


def test_a_retried_send_with_the_same_client_id_posts_once(client):
    ana = person(client, "Ana")
    snap = create_room(client, ana)
    first = send(client, ana, snap["id"], "Một lần thôi", client_id="msg-123456")
    again = send(client, ana, snap["id"], "Một lần thôi", client_id="msg-123456")
    assert first.status_code == 201 and again.status_code == 201
    assert again.json()["replayed"] is True and again.json()["message"]["id"] == first.json()["message"]["id"]
    assert len(history(client, ana, snap["id"])["items"]) == 1
    assert send(client, ana, snap["id"], "bad id", client_id="no spaces!").status_code == 422


def test_members_only_see_messages_sent_since_they_joined(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    send(client, ana, snap["id"], "trước khi Binh vào")
    clock.advance(seconds=5)
    join(client, binh, snap["code"])
    send(client, ana, snap["id"], "chào Binh")
    assert bodies(history(client, binh, snap["id"])) == ["chào Binh"]
    assert bodies(history(client, ana, snap["id"])) == ["trước khi Binh vào", "chào Binh"]
    # Leaving and joining again starts from the new join.
    clock.advance(seconds=5)
    assert client.post(f"/api/study-rooms/{snap['id']}/leave", headers=binh.headers).status_code == 200
    assert send(client, binh, snap["id"], "đã rời").json()["code"] == "room_not_found"
    clock.advance(seconds=5)
    join(client, binh, snap["code"])
    assert history(client, binh, snap["id"])["items"] == []


def test_history_pages_backwards_from_the_newest(client):
    ana = person(client, "Ana")
    snap = create_room(client, ana)
    for i in range(35):
        send(client, ana, snap["id"], f"tin {i}")
    first = history(client, ana, snap["id"])
    assert bodies(first) == [f"tin {i}" for i in range(5, 35)] and first["next_before_id"] is not None
    older = history(client, ana, snap["id"], before_id=first["next_before_id"])
    assert bodies(older) == [f"tin {i}" for i in range(5)] and older["next_before_id"] is None


def test_messages_and_typing_are_pushed_live_except_between_blocked_people(client):
    ana, binh, chi = person(client, "Ana"), person(client, "Binh"), person(client, "Chi")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    join(client, chi, snap["code"])
    assert client.post(f"/api/users/{chi.id}/block", headers=ana.headers).status_code == 201
    with socket(client, binh) as binh_ws, socket(client, chi) as chi_ws:
        for ws in (binh_ws, chi_ws):
            receive(ws)
            ws.send_json({"type": "subscribe", "room_id": snap["id"]})
            receive_until(ws, lambda m: m["type"] == "room.snapshot")
        send(client, ana, snap["id"], "Ana nói")
        send(client, binh, snap["id"], "Binh nói")
        got = receive_until(binh_ws, lambda m: m["type"] == "room.message")
        assert got["room_id"] == snap["id"] and got["message"]["body"] == "Ana nói"
        # Chi (blocked by Ana) gets Binh's message but never Ana's.
        assert receive_until(chi_ws, lambda m: m["type"] == "room.message")["message"]["body"] == "Binh nói"

        binh_ws.send_json({"type": "typing", "room_id": snap["id"]})
        binh_ws.send_json({"type": "typing", "room_id": snap["id"]})  # throttled: relayed once
        typing = receive_until(chi_ws, lambda m: m["type"] == "room.typing")
        assert typing == {"type": "room.typing", "room_id": snap["id"], "user_id": binh.id}
        binh_ws.send_json({"type": "typing", "room_id": snap["id"] + 99})  # not subscribed: ignored
        send(client, binh, snap["id"], "sau typing")
        after = receive_until(chi_ws, lambda m: m["type"] in ("room.typing", "room.message"))
        assert after["type"] == "room.message" and after["message"]["body"] == "sau typing"
    # The history hides them from each other too, both ways.
    assert bodies(history(client, chi, snap["id"])) == ["Binh nói", "sau typing"]
    send(client, chi, snap["id"], "Chi nói")
    assert "Chi nói" not in bodies(history(client, ana, snap["id"]))
    assert "Chi nói" in bodies(history(client, binh, snap["id"]))


def test_unsend_and_host_removal(client):
    ana, binh, chi = person(client, "Ana"), person(client, "Binh"), person(client, "Chi")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    join(client, chi, snap["code"])
    mine = send(client, binh, snap["id"], "gõ nhầm").json()["message"]
    rude = send(client, chi, snap["id"], "nội dung xấu").json()["message"]
    assert client.delete(f"/api/study-rooms/{snap['id']}/messages/{rude['id']}", headers=binh.headers).json()["code"] == "not_message_owner"
    with socket(client, binh) as ws:
        receive(ws)
        ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        receive_until(ws, lambda m: m["type"] == "room.snapshot")
        assert client.delete(f"/api/study-rooms/{snap['id']}/messages/{mine['id']}", headers=binh.headers).status_code == 200
        assert client.delete(f"/api/study-rooms/{snap['id']}/messages/{rude['id']}", headers=ana.headers).status_code == 200
        removed = receive_until(ws, lambda m: m["type"] == "room.message_deleted")
        assert removed == {"type": "room.message_deleted", "room_id": snap["id"], "message_id": mine["id"], "removed_by": "sender"}
        assert receive_until(ws, lambda m: m["type"] == "room.message_deleted")["removed_by"] == "host"
    assert client.delete(f"/api/study-rooms/{snap['id']}/messages/{mine['id']}", headers=binh.headers).status_code == 200  # retry-safe
    items = history(client, chi, snap["id"])["items"]
    assert [(m["body"], m["deleted"], m["removed_by"]) for m in items] == [(None, True, "sender"), (None, True, "host")]
    assert client.delete(f"/api/study-rooms/{snap['id']}/messages/999999", headers=ana.headers).json()["code"] == "message_not_found"


def test_reporting_a_message_keeps_its_text_after_unsend(client, db):
    ana, binh, outsider = person(client, "Ana"), person(client, "Binh"), person(client, "Chi")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    message = send(client, ana, snap["id"], "lời khó nghe").json()["message"]
    client.delete(f"/api/study-rooms/{snap['id']}/messages/{message['id']}", headers=ana.headers)
    report = client.post(f"/api/users/{ana.id}/report", json={"reason": "harassment", "message_id": message["id"]},
                         headers=binh.headers)
    assert report.status_code == 201, report.json()
    stored = db.get(UserReport, report.json()["id"])
    assert (stored.message_id, stored.message_body, stored.room_id) == (message["id"], "lời khó nghe", snap["id"])
    # The message must be the reported person's, and the reporter must have been in that room.
    assert client.post(f"/api/users/{binh.id}/report", json={"reason": "spam", "message_id": message["id"]},
                       headers=ana.headers).json()["code"] == "message_not_found"
    assert client.post(f"/api/users/{ana.id}/report", json={"reason": "spam", "message_id": message["id"]},
                       headers=outsider.headers).json()["code"] == "message_not_found"


def test_sending_is_rate_limited(client, monkeypatch):
    ana = person(client, "Ana")
    snap = create_room(client, ana)
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_room_message", "2/60")
    assert [send(client, ana, snap["id"], f"{i}").status_code for i in range(3)] == [201, 201, 429]


def test_old_messages_are_purged_by_the_sweep(client, clock, db):
    ana = person(client, "Ana")
    snap = create_room(client, ana)
    send(client, ana, snap["id"], "cũ")
    clock.advance(days=settings.study_room_message_retention_days + 1)
    send(client, ana, snap["id"], "mới")
    study_rooms.sweep(clock.now(), full=True)
    assert [m.body for m in db.scalars(select(StudyRoomMessage))] == ["mới"]
