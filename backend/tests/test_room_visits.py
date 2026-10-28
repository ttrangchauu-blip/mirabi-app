"""Friends and visits (Bạn bè và ghé thăm): friend codes, read-only room visits, greetings, cheers and study invites."""
import json
from datetime import timedelta

from sqlalchemy import delete, select

from app.config import settings
from app.models import (ExpEvent, Friendship, PetWalk, RoomVisitInteraction, SocialNotification, StudyRoomInvitation,
                        User, utcnow)
from together import assert_no_private_fields, befriend, create_room, person, room


def visit(client, who, host):
    return client.get(f"/api/personal-room/visit/{host.id}", headers=who.headers)


def greet(client, who, host, kind="hello", message=None, request_id=None):
    body = {"kind": kind, **({"message": message} if message else {}),
            **({"client_request_id": request_id} if request_id else {})}
    return client.post(f"/api/personal-room/visit/{host.id}/greetings", headers=who.headers, json=body)


def invite(client, who, host, request_id="invite-0001", **settings_):
    body = {"subject": "math", "focus_minutes": 30, "break_minutes": 5, "cycles": 3, "client_request_id": request_id,
            **settings_}
    return client.post(f"/api/personal-room/visit/{host.id}/study-invite", headers=who.headers, json=body)


def code_of(client, who) -> str:
    return client.get("/api/social/me", headers=who.headers).json()["public_code"]


def notes(db, who, kind="room_visit"):
    db.expire_all()
    return db.scalars(select(SocialNotification).where(SocialNotification.user_id == who.id,
                                                       SocialNotification.kind == kind).order_by(SocialNotification.id)).all()


# ---------------------------------------------------------------------------- friend codes
def test_friend_code_and_qr_lookup_show_a_short_profile(client):
    aqua, may = person(client, "Aqua", pet="dolphin"), person(client, "May", pet="cat")
    code = code_of(client, aqua)
    for typed in (code, code.lower(), f"{code[:4]} {code[4:]}", f"MIRABI-FRIEND:{code}"):
        found = client.post("/api/users/lookup", headers=may.headers, json={"public_code": typed})
        assert found.status_code == 200, typed
        assert found.json()["id"] == aqua.id and found.json()["relationship"] == "none"
        assert found.json()["pet"] == "dolphin" and found.json()["pet_name"] == "Aqua Pet"
        assert_no_private_fields(found.json())
    own = client.post("/api/users/lookup", headers=aqua.headers, json={"public_code": code}).json()
    assert own["relationship"] == "self"
    assert client.post("/api/users/lookup", headers=may.headers, json={"public_code": "ZZZZZZZZ"}).json()["code"] == "user_not_found"

    sent = client.post("/api/friend-requests", headers=may.headers, json={"public_code": code})
    assert sent.status_code == 201
    looked = client.post("/api/users/lookup", headers=may.headers, json={"public_code": code}).json()
    assert looked["relationship"] == "outgoing" and looked["request_id"] == sent.json()["id"]
    assert client.post("/api/friend-requests", headers=may.headers, json={"public_code": code}).json()["code"] == "friend_request_exists"
    assert client.post("/api/friend-requests", headers=aqua.headers,
                       json={"public_code": code}).json()["code"] == "cannot_friend_self"

    client.post(f"/api/users/{may.id}/block", headers=aqua.headers)
    # Someone who blocked you can't be looked up or asked.
    assert client.post("/api/users/lookup", headers=may.headers, json={"public_code": code}).status_code == 404
    assert client.post("/api/friend-requests", headers=may.headers, json={"public_code": code}).status_code == 404


def test_accepting_twice_keeps_one_friendship_for_both_sides(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    sent = client.post("/api/friend-requests", headers=may.headers, json={"user_id": aqua.id}).json()
    first = client.post(f"/api/friend-requests/{sent['id']}/accept", headers=aqua.headers)
    retry = client.post(f"/api/friend-requests/{sent['id']}/accept", headers=aqua.headers)
    assert first.status_code == retry.status_code == 200 and retry.json()["status"] == "accepted"
    assert db.query(Friendship).count() == 1
    assert len(notes(db, may, "friend_accepted")) == 1
    assert [f["id"] for f in client.get("/api/friends", headers=aqua.headers).json()["items"]] == [may.id]
    friend = client.get("/api/friends", headers=may.headers).json()["items"][0]
    assert friend["id"] == aqua.id and friend["can_visit"] is True and friend["accepts_study_invites"] is True


# ---------------------------------------------------------------------------- visiting
def test_a_visit_shows_the_saved_room_and_pets_and_nothing_private(client, db):
    aqua, may = person(client, "Aqua", pet="dolphin"), person(client, "May", pet="cat")
    own = client.get("/api/personal-room", headers=aqua.headers).json()["room"]
    moved = [{**p, "x": p["x"] + 10} if i == 0 else p for i, p in enumerate(own["layout"]["items"])]
    saved = client.put("/api/personal-room", headers=aqua.headers, json={
        "name": "Góc biển", "wall_id": own["layout"]["wall"], "floor_id": own["layout"]["floor"], "items": moved,
        "version": own["version"]}).json()["room"]
    task = client.post("/api/tasks", headers=aqua.headers, json={"title": "Bí mật", "category": "study",
                                                                 "scheduled_date": utcnow().date().isoformat()})
    assert task.status_code == 200, task.json()
    befriend(client, aqua, may)

    data = visit(client, may, aqua).json()
    assert data["room"] == {"name": "Góc biển", "layout": saved["layout"]}  # exactly the saved room, nothing else
    assert data["pet"] == {"id": "dolphin", "name": "Aqua Pet", "level": 0}
    assert data["guest_pet"] == {"id": "cat", "name": "May Pet", "level": 0}
    assert set(data) == {"owner", "room", "pet", "activity", "walk", "guest_pet", "can_invite_study", "available_at", "pet_gift"}
    assert set(data["owner"]) == {"id", "display_name", "avatar_theme", "pet", "pet_name", "pet_level"}
    assert data["walk"] == {"away": False}
    assert "Bí mật" not in json.dumps(data, ensure_ascii=False)
    assert_no_private_fields(data)


def test_only_friends_who_allow_visits_can_visit_and_unfriending_or_blocking_revokes_it(client, db):
    aqua, may, stranger = person(client, "Aqua"), person(client, "May"), person(client, "La")
    assert visit(client, stranger, aqua).status_code == 404
    befriend(client, aqua, may)
    assert visit(client, may, aqua).status_code == 200

    client.patch("/api/social/me", headers=aqua.headers, json={"allow_room_visits": False})
    refused = visit(client, may, aqua)
    assert refused.status_code == 403 and refused.json()["code"] == "room_visits_disabled"
    assert greet(client, may, aqua).status_code == 403
    assert client.get("/api/friends", headers=may.headers).json()["items"][0]["can_visit"] is False
    client.patch("/api/social/me", headers=aqua.headers, json={"allow_room_visits": True})

    client.delete(f"/api/friends/{may.id}", headers=aqua.headers)
    assert visit(client, may, aqua).status_code == 404 and greet(client, may, aqua).status_code == 404
    befriend(client, may, aqua)
    client.post(f"/api/users/{aqua.id}/block", headers=may.headers)
    assert visit(client, may, aqua).status_code == 404 and visit(client, aqua, may).status_code == 404


def test_hidden_presence_never_shows_the_host_studying(client, db):
    from app.models import StudySession
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    db.add(StudySession(user_id=aqua.id, duration_seconds=0, completed=False, status="started", started_at=utcnow(),
                        pomodoro_cycle="focus-1"))
    db.commit()
    assert visit(client, may, aqua).json()["activity"] == "studying"
    client.patch("/api/social/me", headers=aqua.headers, json={"presence_visibility": "nobody"})
    assert visit(client, may, aqua).json()["activity"] == "idle"


# ---------------------------------------------------------------------------- greetings and cheers
def test_greetings_and_cheers_are_limited_retry_safe_and_never_give_exp(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    xp_before = {u.id: u.xp for u in db.scalars(select(User))}
    events_before = db.query(ExpEvent).count()

    assert greet(client, may, aqua, "cheer").status_code == 422  # a cheer needs one of the preset messages
    assert greet(client, may, aqua, "cheer", "anything").status_code == 422
    first = greet(client, may, aqua, request_id="tap-hello-01")
    assert first.status_code == 201 and first.json()["replayed"] is False
    replay = greet(client, may, aqua, request_id="tap-hello-01")  # the same tap retried after a timeout
    assert replay.status_code == 201 and replay.json()["replayed"] is True and replay.json()["id"] == first.json()["id"]
    again = greet(client, may, aqua, request_id="tap-hello-02")
    assert again.status_code == 429 and again.json()["code"] == "greeting_cooldown" and int(again.headers["Retry-After"]) > 0
    assert greet(client, may, aqua, "cheer", "take_break").status_code == 201
    assert db.query(RoomVisitInteraction).count() == 2 and len(notes(db, aqua)) == 2

    cooldowns = visit(client, may, aqua).json()["available_at"]
    assert cooldowns["hello"] and cooldowns["cheer"] and cooldowns["study_invite"] is None
    for _ in range(5):
        visit(client, may, aqua)
    db.expire_all()
    assert {u.id: u.xp for u in db.scalars(select(User))} == xp_before
    assert db.query(ExpEvent).count() == events_before


def test_a_daily_cap_applies_across_friends(client, db, monkeypatch, clock):
    monkeypatch.setattr(settings, "visit_interaction_daily_limit", 3)
    may = person(client, "May")
    hosts = [person(client, name) for name in ("Aqua", "Bong", "Coco", "Dao")]
    for host in hosts:
        befriend(client, may, host)
    for host in hosts[:3]:
        assert greet(client, may, host).status_code == 201
    capped = greet(client, may, hosts[3])
    assert capped.status_code == 429 and capped.json()["code"] == "visit_daily_limit"
    clock.advance(hours=25)
    assert greet(client, may, hosts[3]).status_code == 201


def test_a_greeting_while_the_pet_walks_is_left_for_later(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    now = utcnow()
    db.add(PetWalk(user_id=aqua.id, item_id="exp", started_at=now, returns_at=now + timedelta(minutes=60),
                   task_cycle_id=now.date().isoformat()))
    db.commit()
    data = visit(client, may, aqua).json()
    assert data["walk"] == {"away": True}  # the return time stays private
    sent = greet(client, may, aqua)
    assert sent.json()["host_away"] is True
    (note,) = notes(db, aqua)
    assert note.title == "May để lại lời chào" and "đang đi dạo" in note.body


def test_unread_greetings_of_one_kind_are_merged_and_reading_marks_them_seen(client, db, clock):
    aqua, may, bong = person(client, "Aqua"), person(client, "May"), person(client, "Bong")
    befriend(client, aqua, may)
    befriend(client, aqua, bong)
    greet(client, may, aqua)
    greet(client, bong, aqua)
    greet(client, may, aqua, "cheer", "keep_going")
    hello, cheer = notes(db, aqua)
    assert json.loads(hello.data_json)["actor_ids"] == [bong.id, may.id] and json.loads(hello.data_json)["count"] == 2
    assert hello.title == "Bong và 1 bạn khác ghé thăm phòng"
    assert "Cùng cố gắng nào!" in cheer.body
    inbox = client.get("/api/notifications", headers=aqua.headers).json()["items"]
    assert [n["kind"] for n in inbox].count("room_visit") == 2  # three interactions, two notifications

    clock.advance(minutes=11)
    client.post(f"/api/notifications/{hello.id}/read", headers=aqua.headers)
    db.expire_all()
    seen = db.scalars(select(RoomVisitInteraction).where(RoomVisitInteraction.kind == "hello")).all()
    assert all(row.seen_at is not None for row in seen) and len(seen) == 2
    greet(client, may, aqua)  # after reading, a new greeting starts a new notification
    assert len([n for n in notes(db, aqua) if json.loads(n.data_json)["group"] == "hello"]) == 2


# ---------------------------------------------------------------------------- study invites
def test_rủ_học_creates_a_real_invitation_the_host_can_join(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    sent = invite(client, may, aqua)
    assert sent.status_code == 201, sent.json()
    body = sent.json()
    assert body["created_room"] is True and body["replayed"] is False
    snap = body["room"]
    assert (snap["subject"], snap["focus_minutes"], snap["break_minutes"], snap["cycles"], snap["visibility"]) == \
        ("math", 30, 5, 3, "private")
    assert [m["user_id"] for m in snap["members"]] == [may.id]

    (note,) = notes(db, aqua, "room_invitation")
    data = json.loads(note.data_json)
    assert data["source"] == "visit" and data["invitation_id"] == body["invitation"]["id"]
    assert "Toán · 30 phút × 3 lượt" in note.body

    replay = invite(client, may, aqua)  # same client_request_id
    assert replay.json()["replayed"] is True and replay.json()["invitation"]["id"] == body["invitation"]["id"]
    assert len(notes(db, aqua, "room_invitation")) == 1
    again = invite(client, may, aqua, request_id="invite-0002")
    assert again.status_code == 429 and again.json()["code"] == "greeting_cooldown"

    detail = client.get(f"/api/room-invitations/{body['invitation']['id']}", headers=aqua.headers).json()
    assert detail["state"] == "pending" and detail["room"]["focus_minutes"] == 30
    joined = client.post(f"/api/room-invitations/{body['invitation']['id']}/accept", headers=aqua.headers)
    assert joined.status_code == 200
    assert {m["user_id"] for m in room(client, aqua, snap["id"])["members"]} == {aqua.id, may.id}
    interaction = db.scalars(select(RoomVisitInteraction).where(RoomVisitInteraction.kind == "study_invite")).one()
    assert interaction.room_id == snap["id"] and interaction.invitation_id == body["invitation"]["id"]


def test_rủ_học_uses_the_visitors_current_room(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    current = create_room(client, may, focus_minutes=50, cycles=2)
    sent = invite(client, may, aqua).json()
    assert sent["created_room"] is False and sent["room"]["id"] == current["id"]
    assert sent["room"]["focus_minutes"] == 50  # the room's own rhythm wins


def test_study_invites_respect_the_hosts_setting_everywhere(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    client.patch("/api/social/me", headers=aqua.headers, json={"allow_study_invites": False})
    assert visit(client, may, aqua).json()["can_invite_study"] is False
    refused = invite(client, may, aqua)
    assert refused.status_code == 403 and refused.json()["code"] == "study_invites_disabled"
    current = create_room(client, may)
    skipped = client.post(f"/api/study-rooms/{current['id']}/invitations", headers=may.headers, json={"user_ids": [aqua.id]})
    assert skipped.json() == {"invited": [], "skipped": [{"user_id": aqua.id, "reason": "invites_disabled"}]}
    assert notes(db, aqua, "room_invitation") == []


def test_closed_expired_and_withdrawn_invitations_are_shown_clearly_and_cannot_be_joined(client, db, clock):
    aqua, may, bong = person(client, "Aqua"), person(client, "May"), person(client, "Bong")
    befriend(client, aqua, may)
    befriend(client, aqua, bong)
    first = invite(client, may, aqua).json()
    client.post(f"/api/study-rooms/{first['room']['id']}/close", headers=may.headers)
    closed = client.get(f"/api/room-invitations/{first['invitation']['id']}", headers=aqua.headers).json()
    assert closed["state"] == "room_closed" and closed["room"]["can_join"] is False
    assert client.post(f"/api/room-invitations/{first['invitation']['id']}/accept",
                       headers=aqua.headers).json()["code"] == "room_closed"

    second = invite(client, bong, aqua, request_id="invite-bong-1").json()
    clock.advance(hours=settings.room_invitation_hours, minutes=1)
    expired = client.get(f"/api/room-invitations/{second['invitation']['id']}", headers=aqua.headers).json()
    assert expired["state"] == "expired"
    assert client.post(f"/api/room-invitations/{second['invitation']['id']}/accept",
                       headers=aqua.headers).status_code == 410

    third = invite(client, bong, aqua, request_id="invite-bong-2").json()  # cooldown is over after a day
    assert third["room"]["id"] == second["room"]["id"]
    client.delete(f"/api/friends/{aqua.id}", headers=bong.headers)  # unfriending withdraws it
    withdrawn = client.get(f"/api/room-invitations/{third['invitation']['id']}", headers=aqua.headers).json()
    assert withdrawn["state"] == "cancelled"
    assert client.post(f"/api/room-invitations/{third['invitation']['id']}/accept",
                       headers=aqua.headers).json()["code"] == "invitation_not_pending"


def test_joining_checks_the_friendship_again(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    sent = invite(client, may, aqua).json()
    # The friendship disappears without going through unfriend (e.g. removed by an admin): joining still checks it.
    db.execute(delete(Friendship))
    db.commit()
    refused = client.post(f"/api/room-invitations/{sent['invitation']['id']}/accept", headers=aqua.headers)
    assert refused.status_code == 409 and refused.json()["code"] == "invitation_not_pending"
    db.expire_all()
    assert db.get(StudyRoomInvitation, sent["invitation"]["id"]).status == "cancelled"
    assert len(room(client, may, sent["room"]["id"])["members"]) == 1


def test_blocking_removes_pending_invitations_both_ways(client, db):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    sent = invite(client, may, aqua).json()
    client.post(f"/api/users/{may.id}/block", headers=aqua.headers)
    assert client.get("/api/room-invitations", headers=aqua.headers).json()["items"] == []
    assert client.get(f"/api/room-invitations/{sent['invitation']['id']}", headers=aqua.headers).status_code == 404
    assert invite(client, may, aqua, request_id="invite-after-block").status_code == 404


def test_the_dashboard_counts_friend_requests_waiting_for_an_answer(client):
    aqua, may, bong = person(client, "Aqua"), person(client, "May"), person(client, "Bong")
    pending = lambda who: client.get("/api/dashboard", headers=who.headers).json()["pending_friend_requests"]
    assert pending(aqua) == 0
    sent = client.post("/api/friend-requests", headers=may.headers, json={"user_id": aqua.id}).json()
    client.post("/api/friend-requests", headers=bong.headers, json={"user_id": aqua.id})
    assert pending(aqua) == 2 and pending(may) == 0  # only requests to answer, not the ones you sent
    client.post(f"/api/friend-requests/{sent['id']}/accept", headers=aqua.headers)
    assert pending(aqua) == 1
    client.post(f"/api/users/{bong.id}/block", headers=aqua.headers)
    assert pending(aqua) == 0


def test_the_dashboard_counts_unread_notifications(client):
    aqua, may = person(client, "Aqua"), person(client, "May")
    befriend(client, aqua, may)
    before = client.get("/api/dashboard", headers=aqua.headers).json()["unread_notifications"]
    greet(client, may, aqua, "cheer", "believe")
    assert client.get("/api/dashboard", headers=aqua.headers).json()["unread_notifications"] == before + 1
