"""The living world's state (app/world.py): weather read once per cell, honest when the provider is down, no user
linked to a place; settings that a late or outdated save can't overwrite."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import select

from app import world
from app.config import settings
from app.db import SessionLocal
from app.models import WeatherCache, utcnow
from conftest import adult_signup as signup, bearer

READING = {"condition": "rain", "temperature_c": 27, "wind_kmh": 12, "cloud_cover": 90, "is_day": True, "observed_at": "2026-11-01T08:00"}
WEATHER = "/api/world/weather?lat=21.0278&lon=105.8342"


def login(client, email="aqua@example.com"):
    return bearer(signup(client, email=email).json()["access_token"])


@pytest.fixture
def provider(monkeypatch):
    """A stand-in for the weather provider: counts its calls and fails when told to."""
    state = {"calls": [], "fail": False, "reading": READING}

    def fetch(lat, lon):
        state["calls"].append((lat, lon))
        if state["fail"]:
            raise OSError("down")
        return state["reading"]
    monkeypatch.setattr(world, "fetch_current", fetch)
    return state


def age_reading(minutes):
    with SessionLocal() as db:
        row = db.scalar(select(WeatherCache))
        row.fetched_at = utcnow() - timedelta(minutes=minutes)
        row.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()


def test_weather_needs_a_login_and_a_real_place(client, provider):
    assert client.get(WEATHER).status_code == 401
    headers = login(client)
    assert client.get("/api/world/weather?lat=91&lon=0", headers=headers).status_code == 422
    assert client.get("/api/world/weather?lat=0&lon=181", headers=headers).status_code == 422
    assert client.get("/api/world/weather", headers=headers).status_code == 422
    assert provider["calls"] == []


def test_weather_is_read_once_per_cell_and_keeps_no_exact_place_or_user(client, provider):
    headers, other = login(client), login(client, "mai@example.com")
    body = client.get(WEATHER, headers=headers).json()
    assert body["available"] is True and body["condition"] == "rain" and body["temperature_c"] == 27
    assert body["stale"] is False and body["windy"] is False and body["source"] == "Open-Meteo"
    # Someone else a few hundred metres away gets the same reading without another call.
    assert client.get("/api/world/weather?lat=21.04&lon=105.81", headers=other).json()["fetched_at"] == body["fetched_at"]
    assert provider["calls"] == [(21.0, 105.8)]
    with SessionLocal() as db:
        rows = db.scalars(select(WeatherCache)).all()
        assert [r.cell for r in rows] == ["21.0,105.8"]
        assert not hasattr(rows[0], "user_id")
        assert "21.0278" not in (rows[0].payload or "")


def test_a_fresh_read_replaces_an_expired_one(client, provider):
    headers = login(client)
    client.get(WEATHER, headers=headers)
    age_reading(31)
    provider["reading"] = {**READING, "condition": "clear", "wind_kmh": 40}
    body = client.get(WEATHER, headers=headers).json()
    assert body["condition"] == "clear" and body["windy"] is True and body["stale"] is False
    assert len(provider["calls"]) == 2


def test_when_the_provider_fails_a_recent_reading_is_marked_stale_and_the_provider_rests(client, provider):
    headers = login(client)
    client.get(WEATHER, headers=headers)
    age_reading(60)
    provider["fail"] = True
    body = client.get(WEATHER, headers=headers).json()
    assert body["available"] is True and body["stale"] is True and body["condition"] == "rain"
    assert len(provider["calls"]) == 2
    client.get(WEATHER, headers=headers)  # within the retry wait: the provider isn't asked again
    assert len(provider["calls"]) == 2


def test_with_nothing_recent_the_app_is_told_there_is_no_weather(client, provider):
    headers = login(client)
    provider["fail"] = True
    assert client.get(WEATHER, headers=headers).json() == {"available": False}
    assert len(provider["calls"]) == 1
    assert client.get(WEATHER, headers=headers).json() == {"available": False}
    assert len(provider["calls"]) == 1  # a failure rests too
    # A reading older than the stale window isn't shown as if it were weather.
    provider["fail"] = False
    age_reading(0)
    assert client.get(WEATHER, headers=headers).json()["available"] is True
    age_reading(settings.weather_stale_hours * 60 + 1)
    provider["fail"] = True
    assert client.get(WEATHER, headers=headers).json() == {"available": False}


def test_weather_can_be_switched_off(client, provider, monkeypatch):
    headers = login(client)
    monkeypatch.setattr(settings, "weather_enabled", False)
    assert client.get(WEATHER, headers=headers).json() == {"available": False}
    assert provider["calls"] == []


def test_a_provider_answer_it_cannot_read_is_no_reading(monkeypatch):
    class Reply:
        def __init__(self, body): self.body = body
        def read(self): return json.dumps(self.body).encode()
        def __enter__(self): return self
        def __exit__(self, *a): return False
    good = {"current": {"time": "2026-11-01T08:00", "temperature_2m": 26.6, "weather_code": 95, "cloud_cover": 100, "wind_speed_10m": 31.2, "is_day": 0}}
    monkeypatch.setattr(world.urllib.request, "urlopen", lambda url, timeout: Reply(good))
    assert world.fetch_current(21.0, 105.8) == {"condition": "storm", "temperature_c": 27, "wind_kmh": 31, "cloud_cover": 100, "is_day": False, "observed_at": "2026-11-01T08:00"}
    for bad in ({}, {"current": {**good["current"], "weather_code": 1234}}, {"current": {"time": "x"}}):
        monkeypatch.setattr(world.urllib.request, "urlopen", lambda url, timeout, b=bad: Reply(b))
        with pytest.raises((KeyError, ValueError, TypeError)):
            world.fetch_current(21.0, 105.8)


def test_the_same_place_has_one_cell():
    assert world.cell_of(-0.04, -0.04)[0] == "0.0,0.0"
    assert world.cell_of(0.04, 0.04)[0] == "0.0,0.0"
    assert world.cell_of(21.0278, 105.8342) == ("21.0,105.8", 21.0, 105.8)


def test_preferences_start_empty_and_are_private(client):
    a, b = login(client), login(client, "mai@example.com")
    assert client.get("/api/world/preferences").status_code == 401
    first = client.get("/api/world/preferences", headers=a).json()
    assert first["version"] == 0 and first["settings"]["motion"] == "auto" and first["settings"]["sound"] is None
    saved = client.put("/api/world/preferences", headers=a, json={"version": 0, "settings": {"sound": False, "motion": "reduced", "lamps": {"u1": False}}})
    assert saved.status_code == 200 and saved.json()["version"] == 1
    assert client.get("/api/world/preferences", headers=a).json()["settings"]["lamps"] == {"u1": False}
    assert client.get("/api/world/preferences", headers=b).json()["version"] == 0


def test_app_settings_follow_the_account_with_the_world_settings(client):
    headers = login(client)
    first = client.get("/api/world/preferences", headers=headers).json()["settings"]
    assert first["notifications"] == {"enabled": True, "focus": True, "pet": True, "achievements": True, "friends": True}
    assert first["language"] is None and first["theme"] == "system"
    body = {"version": 0, "settings": {"sound": False, "language": "vi", "theme": "dark",
                                       "notifications": {"enabled": False, "focus": True, "pet": False, "achievements": True, "friends": True}}}
    saved = client.put("/api/world/preferences", headers=headers, json=body).json()["settings"]
    assert saved["theme"] == "dark" and saved["language"] == "vi" and saved["sound"] is False
    # Turning everything off keeps each choice underneath.
    assert saved["notifications"] == {"enabled": False, "focus": True, "pet": False, "achievements": True, "friends": True}
    again = client.get("/api/world/preferences", headers=headers).json()["settings"]
    assert again == saved


def test_app_settings_refuse_what_the_app_does_not_have(client):
    headers = login(client)
    for settings in ({"language": "en"}, {"theme": "night"}, {"notifications": {"tasks": True}}):
        assert client.put("/api/world/preferences", headers=headers, json={"version": 0, "settings": settings}).status_code == 422
    assert client.get("/api/world/preferences", headers=headers).json()["version"] == 0


def test_settings_saved_before_the_app_settings_existed_still_read(client):
    from app.models import User, WorldPreference
    headers = login(client)
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.email == "aqua@example.com"))
        db.add(WorldPreference(user_id=user_id, settings_json='{"sound": false, "effects": null, "motion": "auto", "lamps": {}}', version=1))
        db.commit()
    body = client.get("/api/world/preferences", headers=headers).json()
    assert body["version"] == 1 and body["settings"]["sound"] is False
    assert body["settings"]["theme"] == "system" and body["settings"]["notifications"]["enabled"] is True


def test_an_outdated_or_late_save_changes_nothing(client):
    headers = login(client)
    assert client.put("/api/world/preferences", headers=headers, json={"version": 0, "settings": {"sound": True}}).json()["version"] == 1
    assert client.put("/api/world/preferences", headers=headers, json={"version": 1, "settings": {"sound": False}}).json()["version"] == 2
    late = client.put("/api/world/preferences", headers=headers, json={"version": 1, "settings": {"sound": True}})
    assert late.status_code == 409 and late.json()["code"] == "preferences_version_conflict"
    second_first = client.put("/api/world/preferences", headers=headers, json={"version": 0, "settings": {"sound": True}})
    assert second_first.status_code == 409
    body = client.get("/api/world/preferences", headers=headers).json()
    assert body["version"] == 2 and body["settings"]["sound"] is False


def test_saves_arriving_together_keep_exactly_one(client):
    headers = login(client)
    client.put("/api/world/preferences", headers=headers, json={"version": 0, "settings": {"sound": True}})
    with ThreadPoolExecutor(4) as pool:
        codes = list(pool.map(lambda i: client.put("/api/world/preferences", headers=headers, json={"version": 1, "settings": {"sound": bool(i % 2)}}).status_code, range(4)))
    assert sorted(codes) == [200, 409, 409, 409]
    assert client.get("/api/world/preferences", headers=headers).json()["version"] == 2


def test_preferences_refuse_what_they_do_not_know(client):
    headers = login(client)
    assert client.put("/api/world/preferences", headers=headers, json={"version": 0, "settings": {"motion": "fast"}}).status_code == 422
    assert client.put("/api/world/preferences", headers=headers, json={"version": 0, "settings": {"frames": [1, 2]}}).status_code == 422
    assert client.put("/api/world/preferences", headers=headers, json={"version": -1, "settings": {}}).status_code == 422
