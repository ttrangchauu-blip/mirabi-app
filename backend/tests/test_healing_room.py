"""Healing Room: mood check-ins on local days, a private journal, idempotent relaxation sessions and the ambience."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.models import ExpEvent, JournalEntry, Memory, MoodEntry
from conftest import adult_signup as signup, bearer


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def adopt(client, auth):
    assert client.put("/api/pet", headers=auth, json={"pet": "fox", "name": "Lửa"}).status_code == 200


def exp_events(db):
    db.expire_all()
    return len(db.scalars(select(ExpEvent)).all())


def test_mood_check_in_uses_the_local_day_and_the_pet_answers_kindly(client, auth, db):
    before = exp_events(db)  # signing in may already have earned a login reward
    tz = "Pacific/Kiritimati"  # UTC+14: its day is usually not the UTC day
    created = client.post("/api/life/moods", headers=auth, json={"mood": "stressed", "note": "Deadline dồn", "timezone": tz})
    assert created.status_code == 201
    body = created.json()
    local_today = datetime.now(ZoneInfo(tz)).date().isoformat()
    assert body["entry"]["local_date"] == local_today and body["entry"]["mood"] == "stressed"
    assert body["pet"]["animation"] == "comfort" and body["pet"]["suggest"] == "breathing" and body["pet"]["support_hint"]
    happy = client.post("/api/life/moods", headers=auth, json={"mood": "happy", "timezone": tz}).json()
    assert happy["pet"]["animation"] == "celebrate" and "support_hint" not in happy["pet"]

    history = client.get(f"/api/life/moods/history?days=7&tz={tz}", headers=auth).json()
    assert history["end"] == local_today
    assert [e["mood"] for e in history["entries"]] == ["happy", "stressed"]
    assert history["days"] == [{"date": local_today, "mood": "happy"}]
    assert history["counts"] == {"happy": 1, "stressed": 1}

    assert client.post("/api/life/moods", headers=auth, json={"mood": "angry"}).status_code == 422
    assert client.post("/api/life/moods", headers=auth, json={"mood": "sad", "timezone": "Mars/Base"}).status_code == 422
    assert client.post("/api/life/moods", headers=auth, json={"mood": "sad", "note": "x" * 281}).status_code == 422
    assert client.post("/api/life/moods", json={"mood": "sad"}).status_code == 401
    assert exp_events(db) == before  # a check-in is not a reward source


def test_mood_history_belongs_to_its_owner(client, auth):
    client.post("/api/life/moods", headers=auth, json={"mood": "tired"})
    other = bearer(signup(client, email="other@example.com").json()["access_token"])
    assert client.get("/api/life/moods/history", headers=other).json()["entries"] == []


def test_journal_is_private_and_only_its_owner_edits_or_deletes_it(client, auth, db):
    page = client.post("/api/life/journal", headers=auth, json={
        "kind": "gratitude", "title": "Ba điều tốt đẹp", "content": "1. Cà phê ngon\n2. Gặp bạn\n3. Trời mát", "mood": "happy"})
    assert page.status_code == 201
    entry = page.json()
    assert entry["visibility"] == "private" and entry["kind"] == "gratitude"

    other = bearer(signup(client, email="other@example.com").json()["access_token"])
    assert client.get("/api/life/journal", headers=other).json()["items"] == []
    assert client.patch(f"/api/life/journal/{entry['id']}", headers=other, json={"title": "Hack"}).status_code == 404
    assert client.delete(f"/api/life/journal/{entry['id']}", headers=other).status_code == 404

    edited = client.patch(f"/api/life/journal/{entry['id']}", headers=auth, json={"content": "Đã sửa"})
    assert edited.status_code == 200 and edited.json()["content"] == "Đã sửa" and edited.json()["title"] == "Ba điều tốt đẹp"
    assert client.patch(f"/api/life/journal/{entry['id']}", headers=auth, json={"title": None}).status_code == 422
    assert client.patch(f"/api/life/journal/{entry['id']}", headers=auth, json={"visibility": "public"}).status_code == 422
    assert client.get("/api/life/journal", headers=auth).json()["items"][0]["content"] == "Đã sửa"

    assert client.delete(f"/api/life/journal/{entry['id']}", headers=auth).status_code == 204
    assert client.delete(f"/api/life/journal/{entry['id']}", headers=auth).status_code == 404
    db.expire_all()
    assert db.scalars(select(JournalEntry)).all() == []
    assert client.post("/api/life/journal", headers=auth, json={"title": "", "content": "x"}).status_code == 422
    assert client.post("/api/life/journal", headers=auth, json={"title": "A", "content": "x" * 5001}).status_code == 422


def test_journal_moment_saved_to_the_album_keeps_the_title_not_the_text(client, auth, db):
    adopt(client, auth)
    entry = client.post("/api/life/journal", headers=auth, json={
        "title": "Ngày ra mắt dự án", "content": "Nội dung rất riêng tư", "save_to_album": True}).json()
    assert entry["memory_id"]
    db.expire_all()
    memory = db.get(Memory, entry["memory_id"])
    assert memory.event_type == "journal_moment" and memory.title == "Ngày ra mắt dự án"
    assert "riêng tư" not in memory.snapshot_json and "riêng tư" not in memory.image_svg
    album = client.get("/api/memories", headers=auth).json()["items"]
    assert any(m["id"] == entry["memory_id"] for m in album)
    # Saved by the user, so no "new memory" notice pops up for it.
    assert client.get("/api/memories/pending", headers=auth).json() in (None, {})


def test_pagination_of_the_journal(client, auth):
    for i in range(3):
        client.post("/api/life/journal", headers=auth, json={"title": f"Trang {i}", "content": "..."})
    first = client.get("/api/life/journal?limit=2", headers=auth).json()
    assert [e["title"] for e in first["items"]] == ["Trang 2", "Trang 1"] and first["next_before"]
    rest = client.get(f"/api/life/journal?limit=2&before={first['next_before']}", headers=auth).json()
    assert [e["title"] for e in rest["items"]] == ["Trang 0"] and rest["next_before"] is None


def test_relaxation_sessions_count_once_and_add_up(client, auth, db):
    before = exp_events(db)
    report = {"activity_type": "breathing", "duration_seconds": 120, "client_ref": "breath-0001", "timezone": "Asia/Ho_Chi_Minh"}
    first = client.post("/api/life/relaxation-sessions", headers=auth, json=report)
    replay = client.post("/api/life/relaxation-sessions", headers=auth, json={**report, "duration_seconds": 600})
    assert first.status_code == 201 and replay.status_code == 200
    assert replay.json()["already_recorded"] and replay.json()["session"]["duration_seconds"] == 120
    client.post("/api/life/relaxation-sessions", headers=auth,
                json={**report, "activity_type": "rest", "duration_seconds": 300, "client_ref": "rest-0001"})
    summary = client.get("/api/life/healing?tz=Asia/Ho_Chi_Minh", headers=auth).json()["relaxation"]
    assert summary == {"today_seconds": 420, "today_sessions": 2, "week_seconds": 420, "calm_days": 1}
    assert client.post("/api/life/relaxation-sessions", headers=auth, json={**report, "client_ref": "bad ref!"}).status_code == 422
    assert client.post("/api/life/relaxation-sessions", headers=auth, json={**report, "duration_seconds": 0}).status_code == 422
    assert client.post("/api/life/relaxation-sessions", headers=auth, json={**report, "activity_type": "nap"}).status_code == 422
    assert exp_events(db) == before  # self-care earns no EXP


def test_ambience_defaults_to_silent_and_is_saved_per_user(client, auth):
    assert client.get("/api/life/room-ambience", headers=auth).json() == {"ambience_type": "cozy_night", "sound_enabled": False, "volume": 0.4}
    saved = client.put("/api/life/room-ambience", headers=auth, json={"ambience_type": "rainy_day", "sound_enabled": True, "volume": 0.25})
    assert saved.json() == {"ambience_type": "rainy_day", "sound_enabled": True, "volume": 0.25}
    assert client.get("/api/life/room-ambience", headers=auth).json()["ambience_type"] == "rainy_day"
    assert client.put("/api/life/room-ambience", headers=auth, json={"ambience_type": "volcano"}).status_code == 422
    assert client.put("/api/life/room-ambience", headers=auth, json={"ambience_type": "starry_night", "volume": 2}).status_code == 422
    other = bearer(signup(client, email="other@example.com").json()["access_token"])
    assert client.get("/api/life/room-ambience", headers=other).json()["ambience_type"] == "cozy_night"
    healing = client.get("/api/life/healing", headers=auth).json()
    assert healing["ambience"]["ambience_type"] == "rainy_day" and healing["mood_today"] is None and healing["journal_count"] == 0
