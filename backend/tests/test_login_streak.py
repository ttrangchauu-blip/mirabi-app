from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app import streaks
from app.models import LoginStreakDay, User
from conftest import PASSWORD, bearer, login, register

DAY_1 = date(2030, 3, 10)


@pytest.fixture()
def today(monkeypatch):
    """Controls the streak's local calendar day: set `today.value` to move between days."""
    class Clock:
        value = DAY_1
    monkeypatch.setattr(streaks, "local_today", lambda: Clock.value)
    return Clock


def login_streak(client, key=None):
    response = client.post("/api/auth/login", json={"email": "aqua@example.com", "password": PASSWORD},
                           headers={"Idempotency-Key": key} if key else {})
    assert response.status_code == 200
    return response.json()["login_streak"]


def test_first_login_of_the_day_shows_popup_once(client, today):
    register(client)
    first = login_streak(client)
    assert first == {"current_streak": 1, "longest_streak": 1, "last_login_date": "2030-03-10",
                     "should_show_popup": True, "daily_exp_awarded": 2, "milestone_exp_awarded": 0,
                     "already_claimed": False}

    again = login_streak(client)
    assert again["should_show_popup"] is False and again["already_claimed"] is True
    assert again["current_streak"] == 1 and again["daily_exp_awarded"] == 0
    assert client.get("/api/profile", headers=bearer(login(client).json()["access_token"])).json()["xp"] == 2


def test_logout_refresh_and_session_restore_do_not_show_popup_again(client, today):
    register(client)
    body = login(client).json()
    assert body["login_streak"]["should_show_popup"] is True

    refreshed = client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert refreshed.status_code == 200 and refreshed.json()["login_streak"] is None
    assert client.get("/api/auth/me", headers=bearer(refreshed.json()["access_token"])).status_code == 200

    assert client.post("/api/auth/logout", json={"refresh_token": refreshed.json()["refresh_token"]}).status_code == 204
    assert login_streak(client)["should_show_popup"] is False


def test_consecutive_days_increment_and_missed_day_resets(client, today):
    register(client)
    assert login_streak(client)["current_streak"] == 1
    today.value = DAY_1 + timedelta(days=1)
    second = login_streak(client)
    assert second["should_show_popup"] is True and second["current_streak"] == 2 and second["longest_streak"] == 2
    assert second["last_login_date"] == "2030-03-11"

    today.value = DAY_1 + timedelta(days=3)  # missed day 3
    reset = login_streak(client)
    assert reset["should_show_popup"] is True and reset["current_streak"] == 1
    assert reset["longest_streak"] == 2  # the record is kept, not lowered


def test_longest_streak_only_moves_when_current_passes_it(client, today):
    register(client)
    for offset in (0, 1, 2):  # record of 3
        today.value = DAY_1 + timedelta(days=offset)
        login_streak(client)
    longest = []
    for offset in (4, 5, 6, 7):  # new run: 1, 2, 3, 4
        today.value = DAY_1 + timedelta(days=offset)
        longest.append(login_streak(client)["longest_streak"])
    assert longest == [3, 3, 3, 4]


def test_retry_with_same_idempotency_key_returns_the_same_popup(client, today):
    register(client)
    first = login_streak(client, key="attempt-0001")
    # The response was lost on the network and the app retried the same attempt.
    retried = login_streak(client, key="attempt-0001")
    assert retried == first and retried["should_show_popup"] is True and retried["daily_exp_awarded"] == 2
    # Any other login that day does not show it.
    assert login_streak(client, key="attempt-0002")["should_show_popup"] is False
    assert login_streak(client)["should_show_popup"] is False


def test_malformed_idempotency_key_is_ignored_without_blocking_login(client, today):
    register(client)
    assert login_streak(client, key="bad key!")["should_show_popup"] is True
    assert login_streak(client, key="bad key!")["should_show_popup"] is False
    assert login_streak(client, key="x" * 200)["should_show_popup"] is False


def test_concurrent_logins_record_one_day_and_one_popup(client, today, db):
    from fastapi.testclient import TestClient
    from app.main import app
    register(client)
    # SQLite allows one writer, so some parallel logins may fail with "database is locked";
    # whatever succeeds must still record the day, its reward and its popup at most once.
    racer = TestClient(app, raise_server_exceptions=False)
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda i: racer.post(
            "/api/auth/login", json={"email": "aqua@example.com", "password": PASSWORD},
            headers={"Idempotency-Key": f"attempt-{i:04d}"}), range(6)))
    ok = [r.json() for r in responses if r.status_code == 200]
    assert ok and all(r.status_code in (200, 500) for r in responses)
    claims = [body["login_streak"] for body in ok if body["login_streak"]]
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    days = db.scalars(select(LoginStreakDay).where(LoginStreakDay.user_id == user.id)).all()
    assert len(days) <= 1
    assert sum(1 for c in claims if c["should_show_popup"]) == len(days)
    assert all(c["current_streak"] == 1 for c in claims)
    assert user.xp == 2 * len(days)


def test_losing_the_insert_race_reports_existing_day_without_popup(client, today, db, monkeypatch):
    from app.db import SessionLocal
    register(client)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    db.add(LoginStreakDay(user_id=user.id, login_date=DAY_1, streak_count=1, daily_exp=2, popup_claim_key="winner-key"))
    db.commit()

    with SessionLocal() as session:
        racer = session.get(User, user.id)
        original = session.scalar
        calls = {"n": 0}

        def stale_first_read(*args, **kwargs):  # this request checked before the winner committed
            calls["n"] += 1
            return None if calls["n"] == 1 else original(*args, **kwargs)
        monkeypatch.setattr(session, "scalar", stale_first_read)
        loser = streaks.record_successful_login(racer, session, "loser-key")
        assert loser["should_show_popup"] is False and loser["current_streak"] == 1
        monkeypatch.setattr(session, "scalar", original)
        assert streaks.record_successful_login(racer, session, "winner-key")["should_show_popup"] is True


def test_streak_failure_does_not_block_login(client, today, monkeypatch):
    register(client)
    def broken(*args, **kwargs):
        raise RuntimeError("streak store unavailable")
    monkeypatch.setattr("app.auth.record_successful_login", broken)
    response = login(client)
    assert response.status_code == 200
    assert response.json()["access_token"] and response.json()["login_streak"] is None


def test_streak_endpoint_matches_login_response(client, today):
    register(client)
    body = login(client).json()
    streak = client.get("/api/streak", headers=bearer(body["access_token"])).json()
    assert streak["current_streak"] == body["login_streak"]["current_streak"] == 1
    assert streak["longest_streak"] == body["login_streak"]["longest_streak"]
    assert streak["last_login_date"] == body["login_streak"]["last_login_date"]
    assert streak["today_claimed"] is True


def check_in(client, token, key=None):
    headers = {**bearer(token), **({"Idempotency-Key": key} if key else {})}
    response = client.post("/api/streak/check-in", headers=headers)
    assert response.status_code == 200
    return response.json()


def test_opening_the_app_on_a_new_day_counts_as_that_days_login(client, today):
    register(client)
    token = login(client).json()["access_token"]  # day 1, recorded by the login itself
    assert check_in(client, token)["should_show_popup"] is False

    today.value = DAY_1 + timedelta(days=1)  # app reopened tomorrow with the saved session
    opened = check_in(client, token)
    assert opened["should_show_popup"] is True and opened["current_streak"] == 2 and opened["daily_exp_awarded"] == 2
    again = check_in(client, token)
    assert again["should_show_popup"] is False and again["current_streak"] == 2 and again["daily_exp_awarded"] == 0
    # Signing in later the same day doesn't count twice either.
    assert login_streak(client)["should_show_popup"] is False

    today.value = DAY_1 + timedelta(days=3)
    assert check_in(client, token)["current_streak"] == 1


def test_check_in_retry_with_same_key_returns_the_same_popup(client, today):
    register(client)
    token = login(client).json()["access_token"]
    today.value = DAY_1 + timedelta(days=1)
    first = check_in(client, token, key="open-0001")
    assert check_in(client, token, key="open-0001") == first and first["should_show_popup"] is True
    assert check_in(client, token, key="open-0002")["should_show_popup"] is False


def test_check_in_requires_a_session(client):
    assert client.post("/api/streak/check-in").status_code == 401


def test_web_build_may_send_idempotency_key_cross_origin(client):
    # The Expo web build sends Idempotency-Key on login; a preflight that rejects it blocks every web login.
    res = client.options("/api/auth/login", headers={"Origin": "http://localhost:8081", "Access-Control-Request-Method": "POST",
                                                     "Access-Control-Request-Headers": "content-type,idempotency-key"})
    assert res.status_code == 200
    assert "idempotency-key" in res.headers["access-control-allow-headers"].lower()
