import threading

from app.config import settings
from together import assert_no_private_fields, befriend, person


def test_search_by_name_and_public_code_exposes_only_public_fields(client):
    ana, binh = person(client, "Ana"), person(client, "Binh", pet="cat")
    by_name = client.get("/api/users/search", params={"q": "bin"}, headers=ana.headers)
    assert by_name.status_code == 200
    [found] = by_name.json()["results"]
    assert found["id"] == binh.id and found["relationship"] == "none" and found["pet"] == "cat"
    assert_no_private_fields(by_name.json())
    code = found["public_code"]
    by_code = client.get("/api/users/search", params={"q": code.lower()}, headers=ana.headers)
    assert [r["id"] for r in by_code.json()["results"]] == [binh.id]
    # Search never finds the searcher, users without a pet, or the seeded demo author.
    assert client.get("/api/users/search", params={"q": "Ana"}, headers=ana.headers).json()["results"] == []
    assert client.get("/api/users/search", params={"q": "MaiStudy"}, headers=ana.headers).json()["results"] == []


def test_search_treats_wildcards_literally_and_respects_discoverable(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    assert client.get("/api/users/search", params={"q": "%_"}, headers=ana.headers).json()["results"] == []
    code = client.get("/api/social/me", headers=binh.headers).json()["public_code"]
    assert client.patch("/api/social/me", json={"discoverable": False}, headers=binh.headers).status_code == 200
    assert client.get("/api/users/search", params={"q": "Binh"}, headers=ana.headers).json()["results"] == []
    assert len(client.get("/api/users/search", params={"q": code}, headers=ana.headers).json()["results"]) == 1


def test_request_lifecycle_and_duplicate_handling(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    sent = client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers)
    assert sent.status_code == 201 and sent.json()["direction"] == "outgoing"
    again = client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers)
    assert again.status_code == 409 and again.json()["code"] == "friend_request_exists"
    incoming = client.get("/api/friend-requests", params={"direction": "incoming"}, headers=binh.headers).json()["items"]
    assert [r["user"]["id"] for r in incoming] == [ana.id]
    # Only the recipient accepts; a stranger can't even see the request.
    carl = person(client, "Carl")
    assert client.post(f"/api/friend-requests/{sent.json()['id']}/accept", headers=ana.headers).json()["code"] == "not_request_recipient"
    assert client.post(f"/api/friend-requests/{sent.json()['id']}/accept", headers=carl.headers).status_code == 404
    assert client.post(f"/api/friend-requests/{sent.json()['id']}/accept", headers=binh.headers).json()["status"] == "accepted"
    friends = client.get("/api/friends", headers=ana.headers).json()["items"]
    assert [f["id"] for f in friends] == [binh.id]
    assert_no_private_fields(friends)
    dup = client.post("/api/friend-requests", json={"user_id": ana.id}, headers=binh.headers)
    assert dup.status_code == 409 and dup.json()["code"] == "already_friends"
    assert client.delete(f"/api/friends/{binh.id}", headers=ana.headers).status_code == 204
    assert client.get("/api/friends", headers=binh.headers).json()["items"] == []
    assert client.delete(f"/api/friends/{binh.id}", headers=ana.headers).json()["code"] == "not_friends"


def test_sending_back_a_pending_request_accepts_it(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers)
    back = client.post("/api/friend-requests", json={"user_id": ana.id}, headers=binh.headers)
    assert back.status_code == 201 and back.json()["auto_accepted"] is True and back.json()["status"] == "accepted"


def test_decline_cooldown_and_cancel(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    first = client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers).json()
    assert client.post(f"/api/friend-requests/{first['id']}/decline", headers=binh.headers).json()["status"] == "declined"
    retry = client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers)
    assert retry.status_code == 409 and retry.json()["code"] == "friend_request_cooldown"
    # The person who declined may still reach out later.
    reverse = client.post("/api/friend-requests", json={"user_id": ana.id}, headers=binh.headers)
    assert reverse.status_code == 201 and reverse.json()["direction"] == "outgoing"
    assert client.delete(f"/api/friend-requests/{reverse.json()['id']}", headers=ana.headers).status_code == 409
    assert client.delete(f"/api/friend-requests/{reverse.json()['id']}", headers=binh.headers).status_code == 204
    assert client.get("/api/friend-requests", params={"direction": "incoming"}, headers=ana.headers).json()["items"] == []


def test_request_by_public_code_and_invalid_targets(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    code = client.get("/api/social/me", headers=binh.headers).json()["public_code"]
    by_code = client.post("/api/friend-requests", json={"public_code": f" {code[:4]}-{code[4:]} "}, headers=ana.headers)
    assert by_code.status_code == 201
    assert client.post("/api/friend-requests", json={"user_id": ana.id}, headers=ana.headers).json()["code"] == "cannot_friend_self"
    assert client.post("/api/friend-requests", json={"user_id": 99999}, headers=ana.headers).json()["code"] == "user_not_found"
    assert client.post("/api/friend-requests", json={}, headers=ana.headers).status_code == 422


def test_blocking_hides_both_sides_and_removes_the_friendship(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    befriend(client, ana, binh)
    assert client.post(f"/api/users/{binh.id}/block", headers=ana.headers).status_code == 201
    assert client.post(f"/api/users/{binh.id}/block", headers=ana.headers).status_code == 201  # idempotent
    assert client.get("/api/friends", headers=ana.headers).json()["items"] == []
    assert client.get("/api/friends", headers=binh.headers).json()["items"] == []
    assert client.get("/api/users/search", params={"q": "Ana"}, headers=binh.headers).json()["results"] == []
    assert client.get("/api/users/search", params={"q": "Binh"}, headers=ana.headers).json()["results"] == []
    # The blocked person learns nothing; the blocker gets a clear reason.
    assert client.post("/api/friend-requests", json={"user_id": ana.id}, headers=binh.headers).json()["code"] == "user_not_found"
    assert client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers).json()["code"] == "user_blocked"
    assert [u["id"] for u in client.get("/api/blocks", headers=ana.headers).json()["items"]] == [binh.id]
    assert client.delete(f"/api/users/{binh.id}/block", headers=ana.headers).status_code == 204
    assert client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers).status_code == 201


def test_reports_are_validated_rate_limited_and_resolved_by_admins(client, monkeypatch):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    report = client.post(f"/api/users/{binh.id}/report", json={"reason": "spam", "details": "Gửi lời mời liên tục"},
                         headers=ana.headers)
    assert report.status_code == 201 and report.json()["status"] == "open"
    assert client.post(f"/api/users/{ana.id}/report", json={"reason": "spam"}, headers=ana.headers).status_code == 422
    assert client.post(f"/api/users/{binh.id}/report", json={"reason": "bad"}, headers=ana.headers).status_code == 422
    assert client.post(f"/api/users/{binh.id}/report", json={"reason": "other", "details": "a\x00b"},
                       headers=ana.headers).status_code == 422
    assert client.post(f"/api/users/{binh.id}/report", json={"reason": "other", "room_id": 12345},
                       headers=ana.headers).json()["code"] == "room_not_found"
    # Only admins see the moderation queue; disabling ends the reported user's sessions.
    assert client.get("/api/admin/social/reports", headers=ana.headers).status_code == 403
    from app.db import SessionLocal
    from app.models import User
    with SessionLocal() as db:
        db.get(User, ana.id).role = "admin"
        db.commit()
    queue = client.get("/api/admin/social/reports", headers=ana.headers).json()["items"]
    assert [r["reported"]["id"] for r in queue] == [binh.id] and queue[0]["reported_open_reports"] == 1
    resolved = client.post(f"/api/admin/social/reports/{queue[0]['id']}/resolve", json={"action": "disable_user"},
                           headers=ana.headers)
    assert resolved.json()["status"] == "actioned"
    assert client.get("/api/friends", headers=binh.headers).status_code == 401
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_report", "2/86400")
    carl = person(client, "Carl")
    codes = [client.post(f"/api/users/{ana.id}/report", json={"reason": "spam"}, headers=carl.headers).status_code
             for _ in range(3)]
    assert codes == [201, 201, 429]


def test_search_and_friend_requests_are_rate_limited(client, monkeypatch):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_user_search", "2/60")
    monkeypatch.setattr(settings, "rate_limit_friend_request", "1/3600")
    codes = [client.get("/api/users/search", params={"q": "Bi"}, headers=ana.headers).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers).status_code == 201
    limited = client.post("/api/friend-requests", json={"user_id": binh.id}, headers=ana.headers)
    assert limited.status_code == 429 and "Retry-After" in limited.headers


def test_simultaneous_mutual_requests_end_as_one_friendship(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    results = []
    barrier = threading.Barrier(2)

    def send(a, b):
        barrier.wait()
        results.append(client.post("/api/friend-requests", json={"user_id": b.id}, headers=a.headers))

    threads = [threading.Thread(target=send, args=pair) for pair in ((ana, binh), (binh, ana))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r.status_code for r in results) == [201, 201]
    assert [f["id"] for f in client.get("/api/friends", headers=ana.headers).json()["items"]] == [binh.id]
    from app.db import SessionLocal
    from app.models import Friendship
    with SessionLocal() as db:
        rows = db.query(Friendship).all()
        assert len(rows) == 1 and rows[0].status == "accepted"


def test_friend_presence_respects_privacy_and_reaches_the_dashboard(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    befriend(client, ana, binh)
    client.get("/api/friends", headers=binh.headers)  # Binh is active now
    [friend] = client.get("/api/friends", headers=ana.headers).json()["items"]
    assert friend["presence"] == "online"
    dashboard = client.get("/api/dashboard", headers=ana.headers).json()
    assert dashboard["online_friends"] == [{"id": binh.id, "name": "Binh", "status": "online"}]
    client.patch("/api/social/me", json={"presence_visibility": "nobody"}, headers=binh.headers)
    [friend] = client.get("/api/friends", headers=ana.headers).json()["items"]
    assert friend["presence"] == "hidden"
    assert client.get("/api/dashboard", headers=ana.headers).json()["online_friends"] == []


def test_friend_notifications_can_be_read_only_by_their_owner(client):
    ana, binh = person(client, "Ana"), person(client, "Binh")
    befriend(client, ana, binh)
    inbox = client.get("/api/notifications", headers=binh.headers).json()
    assert inbox["unread_count"] == 1 and inbox["items"][0]["kind"] == "friend_request"
    accepted = client.get("/api/notifications", headers=ana.headers).json()["items"]
    assert accepted[0]["kind"] == "friend_accepted" and accepted[0]["data"]["user_id"] == binh.id
    note_id = inbox["items"][0]["id"]
    assert client.post(f"/api/notifications/{note_id}/read", headers=ana.headers).status_code == 404
    read = client.post(f"/api/notifications/{note_id}/read", headers=binh.headers).json()
    assert read["notification"]["read"] is True and read["unread_count"] == 0
    assert client.post("/api/notifications/read-all", headers=ana.headers).json()["unread_count"] == 0


def test_social_endpoints_require_authentication(client):
    for method, path in (("get", "/api/friends"), ("get", "/api/users/search?q=ab"), ("post", "/api/friend-requests"),
                         ("get", "/api/notifications"), ("get", "/api/study-together/home"), ("post", "/api/study-rooms"),
                         ("post", "/api/realtime/ticket")):
        assert getattr(client, method)(path).status_code == 401
