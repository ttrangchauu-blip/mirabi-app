"""Helpers for the Study Together tests: people with adopted pets, friendships, rooms and realtime sockets."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from conftest import bearer, login, register


@dataclass
class Person:
    id: int
    name: str
    email: str
    headers: dict


def person(client, name: str, pet: str = "fox") -> Person:
    email = f"{name.lower()}@example.com"
    assert register(client, email=email, display_name=name).status_code == 201
    headers = bearer(login(client, email=email).json()["access_token"])
    adopted = client.put("/api/pet", json={"pet": pet, "name": f"{name} Pet"}, headers=headers)
    assert adopted.status_code == 200
    return Person(adopted.json()["id"], name, email, headers)


def befriend(client, a: Person, b: Person) -> None:
    sent = client.post("/api/friend-requests", json={"user_id": b.id}, headers=a.headers)
    assert sent.status_code == 201, sent.json()
    accepted = client.post(f"/api/friend-requests/{sent.json()['id']}/accept", headers=b.headers)
    assert accepted.status_code == 200 and accepted.json()["status"] == "accepted"


def create_room(client, host: Person, **overrides) -> dict:
    body = {"name": "Ôn thi cùng nhau", "goal": "Hoàn thành chương 3", "subject": "math", "focus_minutes": 25,
            "break_minutes": 5, "cycles": 2, "max_members": 4, "visibility": "code", **overrides}
    created = client.post("/api/study-rooms", json=body, headers=host.headers)
    assert created.status_code == 201, created.json()
    return created.json()["room"]


def join(client, who: Person, code: str):
    return client.post("/api/study-rooms/join", json={"code": code}, headers=who.headers)


def room(client, who: Person, room_id: int) -> dict:
    response = client.get(f"/api/study-rooms/{room_id}", headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def heartbeat(client, who: Person, room_id: int) -> dict:
    response = client.post(f"/api/study-rooms/{room_id}/heartbeat", headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def member(snapshot: dict, who: Person) -> dict:
    return next(m for m in snapshot["members"] if m["user_id"] == who.id)


_receiver = ThreadPoolExecutor(max_workers=4)


def socket(client, who: Person):
    ticket = client.post("/api/realtime/ticket", headers=who.headers).json()["ticket"]
    return client.websocket_connect(f"/api/realtime/ws?ticket={ticket}")


def receive(ws, timeout: float = 5) -> dict:
    """ws.receive_json() that fails the test instead of hanging when nothing arrives."""
    return _receiver.submit(ws.receive_json).result(timeout=timeout)


def receive_until(ws, predicate, timeout: float = 5, limit: int = 20) -> dict:
    """Skip unrelated messages (presence updates, pongs) until one matches."""
    for _ in range(limit):
        message = receive(ws, timeout)
        if predicate(message):
            return message
    raise AssertionError("expected realtime message never arrived")


def assert_no_private_fields(payload) -> None:
    """Responses about other people must never carry emails or account internals."""
    text = str(payload)
    assert "@example.com" not in text
    for key in ("email", "password_hash", "token_version", "status_reason"):
        assert f"'{key}'" not in text
