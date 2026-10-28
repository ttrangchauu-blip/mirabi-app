import threading

import pytest

from app.config import settings
from together import assert_no_private_fields, befriend, create_room, join, member, person, room


@pytest.mark.parametrize("override", [
    {"name": "   "}, {"name": "x" * 61}, {"name": "a\nb"}, {"focus_minutes": 4}, {"focus_minutes": 91},
    {"break_minutes": 0}, {"cycles": 9}, {"max_members": 1}, {"max_members": 9}, {"visibility": "public"},
    {"subject": "hacking"}, {"goal": "y" * 161},
])
def test_room_settings_are_validated_by_the_backend(client, override):
    host = person(client, "Ana")
    body = {"name": "Phòng học", **override}
    response = client.post("/api/study-rooms", json=body, headers=host.headers)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_create_room_makes_the_creator_host_and_replays_idempotently(client):
    host = person(client, "Ana")
    headers = {**host.headers, "Idempotency-Key": "create-room-0001"}
    body = {"name": "  Toán 12  ", "goal": "Chương 3", "focus_minutes": 30, "cycles": 3, "visibility": "private"}
    first = client.post("/api/study-rooms", json=body, headers=headers)
    assert first.status_code == 201
    snap = first.json()["room"]
    assert snap["name"] == "Toán 12" and snap["state"] == "waiting" and snap["host_id"] == host.id
    assert len(snap["code"]) == 8 and snap["member_count"] == 1
    assert member(snap, host)["role"] == "host"
    replay = client.post("/api/study-rooms", json=body, headers=headers)
    assert replay.status_code == 201 and replay.json()["replayed"] is True and replay.json()["room"]["id"] == snap["id"]
    # One active room per person.
    other = client.post("/api/study-rooms", json={"name": "Khác"}, headers=host.headers)
    assert other.status_code == 409 and other.json()["code"] == "already_in_another_room"


def test_create_room_requires_an_adopted_pet(client):
    from conftest import bearer, signup
    headers = bearer(signup(client, email="nopet@example.com").json()["access_token"])
    assert client.post("/api/study-rooms", json={"name": "A"}, headers=headers).json()["code"] == "pet_not_adopted"


def test_join_by_code_with_preview_and_every_refusal_reason(client):
    host, binh, carl, dung = person(client, "Ana"), person(client, "Binh"), person(client, "Carl"), person(client, "Dung")
    snap = create_room(client, host, max_members=2)
    preview = client.post("/api/study-rooms/lookup", json={"code": snap["code"].lower()}, headers=binh.headers).json()
    assert preview["can_join"] is True and preview["member_count"] == 1 and "code" not in preview
    assert preview["host"]["display_name"] == "Ana"
    assert_no_private_fields(preview)
    joined = join(client, binh, f"{snap['code'][:4]}-{snap['code'][4:]}")
    assert joined.status_code == 200 and joined.json()["already_member"] is False
    assert join(client, binh, snap["code"]).json()["already_member"] is True
    full = join(client, carl, snap["code"])
    assert full.status_code == 409 and full.json()["code"] == "room_full"
    assert client.post("/api/study-rooms/lookup", json={"code": snap["code"]}, headers=carl.headers).json()["reason"] == "room_full"
    wrong = join(client, carl, "ZZZZZZZZ")
    assert wrong.status_code == 404 and wrong.json()["code"] == "room_not_found"
    assert join(client, carl, "abc").status_code == 422
    # Private rooms need an invitation even with the code.
    private = create_room(client, dung, visibility="private")
    refused = join(client, carl, private["code"])
    assert refused.status_code == 403 and refused.json()["code"] == "room_invite_only"
    # Closed rooms.
    assert client.post(f"/api/study-rooms/{snap['id']}/close", headers=host.headers).status_code == 200
    closed = join(client, carl, snap["code"])
    assert closed.status_code == 409 and closed.json()["code"] == "room_closed"


def test_members_can_be_in_only_one_room(client):
    ana, binh, carl = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    first, second = create_room(client, ana), create_room(client, binh)
    assert join(client, carl, first["code"]).status_code == 200
    busy = join(client, carl, second["code"])
    assert busy.status_code == 409 and busy.json()["code"] == "already_in_another_room"
    assert client.get("/api/study-rooms/current", headers=carl.headers).json()["room"]["id"] == first["id"]
    assert client.post(f"/api/study-rooms/{first['id']}/leave", headers=carl.headers).json()["left"] is True
    assert join(client, carl, second["code"]).status_code == 200


def test_room_data_is_only_visible_to_members(client):
    host, outsider = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, host, visibility="private")
    for method, path in (("get", f"/api/study-rooms/{snap['id']}"), ("post", f"/api/study-rooms/{snap['id']}/start"),
                         ("post", f"/api/study-rooms/{snap['id']}/heartbeat"), ("post", f"/api/study-rooms/{snap['id']}/leave"),
                         ("post", f"/api/study-rooms/{snap['id']}/join"), ("get", f"/api/study-rooms/{snap['id']}/preview"),
                         ("post", f"/api/study-rooms/{snap['id']}/close")):
        response = getattr(client, method)(path, headers=outsider.headers)
        assert response.status_code == 404 and response.json()["code"] == "room_not_found", path
    assert client.patch(f"/api/study-rooms/{snap['id']}", json={"name": "Hack"}, headers=outsider.headers).status_code == 404


def test_only_the_host_controls_the_room_and_timer_settings_lock_during_a_session(client):
    host, binh = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, host)
    join(client, binh, snap["code"])
    for path in ("start", "pause", "resume", "end", "close"):
        response = client.post(f"/api/study-rooms/{snap['id']}/{path}", headers=binh.headers)
        assert response.status_code == 403 and response.json()["code"] == "not_room_host", path
    assert client.patch(f"/api/study-rooms/{snap['id']}", json={"name": "X"}, headers=binh.headers).json()["code"] == "not_room_host"
    renamed = client.patch(f"/api/study-rooms/{snap['id']}", json={"name": "Lý 11", "goal": ""}, headers=host.headers).json()
    assert renamed["name"] == "Lý 11" and renamed["goal"] is None and renamed["version"] > snap["version"]
    too_low = client.patch(f"/api/study-rooms/{snap['id']}", json={"max_members": 2}, headers=host.headers)
    assert too_low.status_code == 200
    assert client.patch(f"/api/study-rooms/{snap['id']}", json={"max_members": 2}, headers=host.headers).status_code == 200
    client.post(f"/api/study-rooms/{snap['id']}/start", headers=host.headers)
    locked = client.patch(f"/api/study-rooms/{snap['id']}", json={"focus_minutes": 50}, headers=host.headers)
    assert locked.status_code == 409 and locked.json()["code"] == "session_in_progress"
    assert client.patch(f"/api/study-rooms/{snap['id']}", json={"name": "Vẫn đổi tên được"}, headers=host.headers).status_code == 200


def test_max_members_cannot_drop_below_current_members(client):
    host, binh, carl = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    snap = create_room(client, host)
    join(client, binh, snap["code"])
    join(client, carl, snap["code"])
    response = client.patch(f"/api/study-rooms/{snap['id']}", json={"max_members": 2}, headers=host.headers)
    assert response.status_code == 422 and response.json()["code"] == "max_members_too_low"


def test_invitations_only_go_to_friends_and_join_private_rooms(client, clock):
    host, binh, carl = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    befriend(client, host, binh)
    snap = create_room(client, host, visibility="private", invitee_ids=[binh.id, carl.id])
    created = client.get("/api/room-invitations", headers=binh.headers).json()["items"]
    assert len(created) == 1 and created[0]["room"]["id"] == snap["id"] and created[0]["inviter"]["id"] == host.id
    assert client.get("/api/room-invitations", headers=carl.headers).json()["items"] == []
    notes = client.get("/api/notifications", headers=binh.headers).json()["items"]
    assert any(n["kind"] == "room_invitation" and n["data"]["room_id"] == snap["id"] for n in notes)
    # The invitee may preview the private room; strangers may not.
    assert client.get(f"/api/study-rooms/{snap['id']}/preview", headers=binh.headers).json()["can_join"] is True
    assert client.get(f"/api/study-rooms/{snap['id']}/preview", headers=carl.headers).status_code == 404
    accepted = client.post(f"/api/room-invitations/{created[0]['id']}/accept", headers=binh.headers)
    assert accepted.status_code == 200 and {m["user_id"] for m in accepted.json()["room"]["members"]} == {host.id, binh.id}
    again = client.post(f"/api/room-invitations/{created[0]['id']}/accept", headers=binh.headers)
    assert again.json()["already_member"] is True
    assert client.post(f"/api/room-invitations/{created[0]['id']}/accept", headers=carl.headers).status_code == 404


def test_invitations_expire_and_can_be_declined(client, clock):
    host, binh = person(client, "Ana"), person(client, "Binh")
    befriend(client, host, binh)
    snap = create_room(client, host, visibility="private")
    result = client.post(f"/api/study-rooms/{snap['id']}/invitations", json={"user_ids": [binh.id, binh.id, 4242]},
                         headers=host.headers).json()
    assert result["invited"] == [binh.id] and result["skipped"] == [{"user_id": 4242, "reason": "not_friends"}]
    invitation = client.get("/api/room-invitations", headers=binh.headers).json()["items"][0]
    clock.advance(hours=settings.room_invitation_hours, seconds=1)
    expired = client.post(f"/api/room-invitations/{invitation['id']}/accept", headers=binh.headers)
    assert expired.status_code == 410 and expired.json()["code"] == "invitation_expired"
    client.post(f"/api/study-rooms/{snap['id']}/invitations", json={"user_ids": [binh.id]}, headers=host.headers)
    assert client.post(f"/api/room-invitations/{invitation['id']}/decline", headers=binh.headers).json()["status"] == "declined"
    assert client.get("/api/room-invitations", headers=binh.headers).json()["items"] == []


def test_friends_see_and_join_each_others_code_rooms_but_not_private_ones(client):
    host, binh = person(client, "Ana"), person(client, "Binh")
    befriend(client, host, binh)
    snap = create_room(client, host, visibility="code")
    rooms = client.get("/api/study-rooms", headers=binh.headers).json()["items"]
    assert [(r["id"], r["relation"]) for r in rooms] == [(snap["id"], "friend_room")]
    assert client.post(f"/api/study-rooms/{snap['id']}/join", headers=binh.headers).status_code == 200
    client.post(f"/api/study-rooms/{snap['id']}/leave", headers=binh.headers)
    client.patch(f"/api/study-rooms/{snap['id']}", json={"visibility": "private"}, headers=host.headers)
    assert client.get("/api/study-rooms", headers=binh.headers).json()["items"] == []
    assert client.post(f"/api/study-rooms/{snap['id']}/join", headers=binh.headers).status_code == 404


def test_blocked_users_cannot_join_or_be_invited(client):
    host, binh = person(client, "Ana"), person(client, "Binh")
    befriend(client, host, binh)
    snap = create_room(client, host, visibility="code")
    client.post(f"/api/users/{binh.id}/block", headers=host.headers)
    refused = join(client, binh, snap["code"])
    assert refused.status_code == 403 and refused.json()["code"] == "room_unavailable"
    invited = client.post(f"/api/study-rooms/{snap['id']}/invitations", json={"user_ids": [binh.id]}, headers=host.headers)
    assert invited.json()["invited"] == []


def test_host_leaving_hands_over_the_room_and_the_last_one_out_closes_it(client):
    host, binh, carl = person(client, "Ana"), person(client, "Binh"), person(client, "Carl")
    snap = create_room(client, host)
    join(client, binh, snap["code"])
    join(client, carl, snap["code"])
    left = client.post(f"/api/study-rooms/{snap['id']}/leave", headers=host.headers).json()
    assert left["room_closed"] is False
    after = room(client, binh, snap["id"])
    assert after["host_id"] == binh.id and member(after, binh)["role"] == "host" and after["member_count"] == 2
    assert client.post(f"/api/study-rooms/{snap['id']}/leave", headers=host.headers).json()["left"] is True  # retry-safe
    client.post(f"/api/study-rooms/{snap['id']}/leave", headers=carl.headers)
    last = client.post(f"/api/study-rooms/{snap['id']}/leave", headers=binh.headers).json()
    assert last["room_closed"] is True


def test_concurrent_joins_never_overfill_a_room(client):
    host = person(client, "Ana")
    joiners = [person(client, f"User{i}") for i in range(6)]
    snap = create_room(client, host, max_members=3)
    results = []
    barrier = threading.Barrier(len(joiners))

    def attempt(who):
        barrier.wait()
        results.append(join(client, who, snap["code"]))

    threads = [threading.Thread(target=attempt, args=(who,)) for who in joiners]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 200, 409, 409, 409, 409]
    assert {r.json()["code"] for r in results if r.status_code == 409} == {"room_full"}
    final = room(client, host, snap["id"])
    assert final["member_count"] == 3 and len(final["members"]) == 3


def test_room_code_guessing_is_rate_limited(client, monkeypatch):
    ana = person(client, "Ana")
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_room_code", "3/300")
    codes = [join(client, ana, f"AAAAAAA{c}").status_code for c in "BCDE"]
    assert codes == [404, 404, 404, 429]
    assert client.post("/api/study-rooms/lookup", json={"code": "AAAAAAAF"}, headers=ana.headers).status_code == 429


def test_reactions_are_a_fixed_set_for_members(client, monkeypatch):
    host, outsider = person(client, "Ana"), person(client, "Binh")
    snap = create_room(client, host)
    assert client.post(f"/api/study-rooms/{snap['id']}/reactions", json={"reaction": "cheer"}, headers=host.headers).status_code == 202
    assert client.post(f"/api/study-rooms/{snap['id']}/reactions", json={"reaction": "<script>"}, headers=host.headers).status_code == 422
    assert client.post(f"/api/study-rooms/{snap['id']}/reactions", json={"reaction": "cheer"}, headers=outsider.headers).status_code == 404
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_reaction", "1/60")
    codes = [client.post(f"/api/study-rooms/{snap['id']}/reactions", json={"reaction": "star"}, headers=host.headers).status_code
             for _ in range(2)]
    assert codes == [202, 429]
