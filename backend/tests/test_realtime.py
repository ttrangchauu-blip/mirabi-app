import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.realtime import hub
from together import create_room, join, member, person, receive, receive_until, room, socket


def is_event(name):
    return lambda m: m.get("type") == "room.updated" and m.get("event") == name


def test_socket_needs_a_valid_single_use_ticket(client):
    ana = person(client, "Ana")
    ticket = client.post("/api/realtime/ticket", headers=ana.headers).json()
    assert ticket["path"] == "/api/realtime/ws" and ticket["expires_in"] == 60
    assert client.post("/api/realtime/ticket").status_code == 401
    with client.websocket_connect(f"/api/realtime/ws?ticket={ticket['ticket']}") as ws:
        hello = receive(ws)
        assert hello["type"] == "hello" and hello["user_id"] == ana.id
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/realtime/ws?ticket={ticket['ticket']}") as ws:
            receive(ws)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/realtime/ws?ticket=forged") as ws:
            receive(ws)


def test_only_members_can_subscribe_and_bad_messages_are_rejected(client):
    ana, outsider = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana, visibility="private")
    with socket(client, outsider) as ws:
        receive(ws)
        ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        assert receive(ws) == {"type": "error", "code": "room_not_found", "room_id": snap["id"]}
        ws.send_text("not json")
        assert receive(ws)["code"] == "invalid_message"
        ws.send_json({"type": "subscribe", "room_id": "1 OR 1=1"})
        assert receive(ws)["code"] == "invalid_message"
        ws.send_json({"type": "ping"})
        assert receive(ws)["type"] == "pong"


def test_members_receive_ordered_room_updates_and_leavers_are_cut_off(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    with socket(client, ana) as ws:
        receive(ws)
        ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        first = receive_until(ws, lambda m: m["type"] == "room.snapshot")
        assert first["room"]["id"] == snap["id"] and first["version"] == first["room"]["version"]
        join(client, binh, snap["code"])
        joined = receive_until(ws, is_event("member_joined"))
        assert joined["version"] > first["version"] and len(joined["room"]["members"]) == 2
        client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
        started = receive_until(ws, is_event("session_started"))
        assert started["version"] > joined["version"]
        assert started["room"]["state"] == "focus" and started["room"]["session"]["remaining_ms"] == 25 * 60 * 1000
        client.post(f"/api/study-rooms/{snap['id']}/reactions", json={"reaction": "clap"}, headers=binh.headers)
        reaction = receive_until(ws, lambda m: m["type"] == "room.reaction")
        assert reaction["user_id"] == binh.id and reaction["reaction"] == "clap"
        with socket(client, binh) as other:
            receive(other)
            other.send_json({"type": "subscribe", "room_id": snap["id"]})
            receive_until(other, lambda m: m["type"] == "room.snapshot")
            client.post(f"/api/study-rooms/{snap['id']}/leave", headers=binh.headers)
            assert receive_until(other, lambda m: m["type"] == "room.removed")["room_id"] == snap["id"]
            left = receive_until(ws, is_event("member_left"))
            assert [m["user_id"] for m in left["room"]["members"]] == [ana.id]
            time.sleep(0.2)
            assert all(c.user_id != binh.id for c in hub.by_room.get(snap["id"], ()))


def test_closing_the_socket_shows_the_member_as_away_and_reconnecting_restores_state(client, clock):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, ana)
    join(client, binh, snap["code"])
    client.post(f"/api/study-rooms/{snap['id']}/start", headers=ana.headers)
    with socket(client, ana) as ws:
        receive(ws)
        ws.send_json({"type": "subscribe", "room_id": snap["id"]})
        receive_until(ws, lambda m: m["type"] == "room.snapshot")
        with socket(client, binh) as other:
            receive(other)
            other.send_json({"type": "subscribe", "room_id": snap["id"]})
            receive_until(other, lambda m: m["type"] == "room.snapshot")
        away = receive_until(ws, lambda m: m.get("event") == "member_status_changed"
                             and member(m["room"], binh)["presence"] == "away")
        assert member(away["room"], binh)["in_session"] is True  # credit continues within the grace period
        clock.advance(minutes=3)
        with socket(client, binh) as other:
            receive(other)
            other.send_json({"type": "subscribe", "room_id": snap["id"]})
            restored = receive_until(other, lambda m: m["type"] == "room.snapshot")
            assert restored["room"]["state"] == "focus"
            assert restored["room"]["session"]["remaining_ms"] == 22 * 60 * 1000
            assert member(restored["room"], binh)["presence"] == "online"
            other.send_json({"type": "ping"})
            receive_until(other, lambda m: m["type"] == "pong")
    assert member(room(client, ana, snap["id"]), binh)["focus_seconds"] == 180


def test_notifications_are_pushed_to_the_recipient_only(client):
    ana, binh, carl = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    with socket(client, binh) as ws, socket(client, carl) as bystander:
        receive(ws)
        receive(bystander)
        client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers)
        pushed = receive_until(ws, lambda m: m["type"] == "notification")
        assert pushed["notification"]["kind"] == "friend_request" and pushed["notification"]["data"]["user_id"] == ana.id
        bystander.send_json({"type": "ping"})
        assert receive(bystander)["type"] == "pong"  # nothing else was queued for Carl
