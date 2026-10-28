import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import ExpEvent, LoginStreakDay, StudySession, User
from app.study_statistics import preferences, statistics
from conftest import bearer, signup


def session(db, user_id, at, seconds=1500, completed=True, status="completed", zone="Asia/Bangkok", mode="pomodoro"):
    db.add(StudySession(user_id=user_id, mode=mode, duration_seconds=seconds, completed=completed,
                        status=status, started_at=at - timedelta(seconds=seconds), ended_at=at,
                        created_at=at, timezone=zone))


def test_local_days_streak_dedup_breaks_and_user_isolation(client, db):
    first = signup(client).json()
    signup(client, email="other@example.com")
    users = db.scalars(select(User).where(User.email != "community@refmi.demo").order_by(User.id)).all()
    user, other = users
    now = datetime(2026, 10, 23, 18, tzinfo=timezone.utc)  # Oct 24 in Bangkok
    preferences(db, user.id).timezone = "Asia/Bangkok"
    for offset in (0, 0, 1, 2, 5, 6, 7, 8):
        session(db, user.id, now - timedelta(days=offset))
    session(db, user.id, now, seconds=600, completed=False, status="cancelled")  # ended early: minutes only
    session(db, user.id, now, seconds=30, completed=False, status="cancelled")   # under a minute: ignored
    session(db, user.id, now, completed=False, status="started")
    session(db, user.id, now, mode="short_break")
    session(db, other.id, now, seconds=9000)
    db.commit()
    result = statistics(db, user.id, "month", now)
    assert result["today_seconds"] == 3600
    assert result["today_sessions"] == 2
    assert result["current_streak"] == 3 and result["longest_streak"] == 4
    assert result["history_completed"] == 8
    assert result["goal_progress"] == 3600 / 7200
    assert statistics(db, user.id, now=now + timedelta(days=1))["current_streak"] == 3
    assert statistics(db, user.id, now=now + timedelta(days=2))["current_streak"] == 0
    assert db.scalars(select(LoginStreakDay).where(LoginStreakDay.user_id == user.id)).all()  # login is separate
    response = client.get("/api/study/pomodoro-statistics?period=year", headers=bearer(first["access_token"]))
    assert response.status_code == 422


def test_events_validate_duration_and_terminal_state_idempotency(client, db):
    token = signup(client).json()["access_token"]
    headers = bearer(token)
    start = datetime.now(timezone.utc) - timedelta(minutes=26)
    path = "/api/study/pomodoro/focus123456"
    payload = {"event": "started", "timezone": "Asia/Bangkok", "occurred_at": start.isoformat()}
    assert client.put(path, headers=headers, json=payload).status_code == 200
    assert client.put(path, headers=headers, json=payload).status_code == 200
    response = client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 1500})
    assert response.status_code == 200
    assert response.json()["statistics"]["today_sessions"] == 1
    again = client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 1500})
    assert again.json()["xp_awarded"] == 0
    assert client.put(path, headers=headers, json={"event": "cancelled"}).json()["status"] == "completed"
    assert len(db.scalars(select(ExpEvent).where(ExpEvent.source == "study")).all()) == 1
    path = "/api/study/pomodoro/cancel12345"
    client.put(path, headers=headers, json=payload)
    client.put(path, headers=headers, json={"event": "cancelled", "duration_seconds": 120})
    assert client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 1500}).json()["status"] == "cancelled"
    assert client.get("/api/study/pomodoro-statistics", headers=headers).json()["today_sessions"] == 1
    path = "/api/study/pomodoro/invalid1234"
    client.put(path, headers=headers, json={"event": "started"})
    assert client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 1500}).status_code == 422
    assert client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 10}).status_code == 422
    assert client.put("/api/study/pomodoro/unknown123", headers=headers, json={"event": "completed", "duration_seconds": 1500}).status_code == 409


def test_preferences_persist_and_are_private(client):
    first = bearer(signup(client).json()["access_token"])
    second = bearer(signup(client, email="second@example.com").json()["access_token"])
    payload = {"timezone": "Asia/Bangkok", "daily_goal_minutes": 90, "focus_minutes": 15}
    assert client.put("/api/study/pomodoro-settings", headers=first, json=payload).status_code == 200
    assert client.get("/api/study/pomodoro-settings", headers=first).json()["daily_goal_minutes"] == 90
    assert client.get("/api/study/pomodoro-settings", headers=second).json()["daily_goal_minutes"] == 120
    payload["timezone"] = "bad/zone"
    assert client.put("/api/study/pomodoro-settings", headers=first, json=payload).status_code == 422
    assert client.get("/api/study/pomodoro-statistics").status_code == 401


def test_ai_requires_data_and_receives_only_own_aggregates(client, db, monkeypatch):
    headers = bearer(signup(client).json()["access_token"])
    other = signup(client, email="private@example.com").json()
    assert not client.post("/api/study/pomodoro-insights", headers=headers).json()["sufficient_data"]
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    now = datetime.now(timezone.utc)
    for offset in (0, 0, 1, 1, 2):
        session(db, user.id, now - timedelta(days=offset), zone="UTC")
    db.commit()

    async def fake_run(payload):
        assert payload["user_id"] == user.id
        assert payload["feature_key"] == "pomodoro_coach"
        assert set(payload["context"]) == {"study_facts"}
        facts = json.loads(payload["context"]["study_facts"])
        assert facts["history_completed"] == 5
        assert "email" not in payload["context"]["study_facts"]
        return {"text": "Bạn đã hoàn thành 5 phiên học.", "run_id": 1}

    monkeypatch.setattr("app.study.call_ai_engine", fake_run)
    result = client.post("/api/study/pomodoro-insights", headers=headers).json()
    assert result["suggested_minutes"] == 25
    assert result["sufficient_data"]
    assert client.get("/api/study/pomodoro-settings", headers=headers).json()["focus_minutes"] == 25
    assert not client.post("/api/study/pomodoro-insights", headers=bearer(other["access_token"])).json()["sufficient_data"]


def test_legacy_sessions_remain_counted_without_migration_backfill(client, db):
    signup(client)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    db.add(StudySession(user_id=user.id, mode="pomodoro", completed=True, duration_seconds=1500))
    db.commit()
    stats = statistics(db, user.id)
    assert stats["today_seconds"] == 1500 and stats["current_streak"] == 1


def test_midnight_rate_uses_start_cohort_and_dst_uses_calendar_days(client, db):
    signup(client)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    preferences(db, user.id).timezone = "America/New_York"
    # DST ends Nov 1: both 01:30 occurrences belong to the same study day.
    for at in (datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc),
               datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc),
               datetime(2026, 11, 2, 5, 10, tzinfo=timezone.utc)):
        session(db, user.id, at, zone="America/New_York")
    db.commit()
    result = statistics(db, user.id, "day", datetime(2026, 11, 2, 6, tzinfo=timezone.utc))
    assert result["current_streak"] == 2
    assert result["today_sessions"] == 1
    assert result["started"] == 0 and result["completion_rate"] == 0


def test_ai_unavailable_returns_error_without_reward_or_settings_change(client, db, monkeypatch):
    from app.ai_client import AIServiceError
    headers = bearer(signup(client).json()["access_token"])
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    for offset in (0, 0, 1, 1, 2):
        session(db, user.id, datetime.now(timezone.utc) - timedelta(days=offset), zone="UTC")
    db.commit()

    async def unavailable(payload):
        raise AIServiceError("ai_service_unavailable")

    monkeypatch.setattr("app.study.call_ai_engine", unavailable)
    assert client.post("/api/study/pomodoro-insights", headers=headers).status_code == 503
    assert not db.scalars(select(ExpEvent).where(ExpEvent.source == "study")).all()
    assert client.get("/api/study/pomodoro-settings", headers=headers).json()["focus_minutes"] == 25


def test_coach_runs_through_shared_engine_and_persists_authorized_run(client, db, monkeypatch):
    import httpx
    from ai_engine.app import app as engine_app
    from ai_engine.engine import PROVIDERS
    from app.config import settings
    from app.models import AIRun, AIUsageLog

    token = signup(client).json()["access_token"]
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    for offset in (0, 0, 1, 1, 2):
        session(db, user.id, datetime.now(timezone.utc) - timedelta(days=offset), zone="UTC")
    db.commit()
    monkeypatch.setattr(settings, "backend_ai_service_token", "integration-test-token")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "integration-test-token")
    monkeypatch.setenv("OPENAI_API_KEY", "test-provider-key")

    async def provider(model, prompt, parameters, max_output_tokens):
        assert '"history_completed": 5' in prompt
        assert "Không tự thay đổi cài đặt" in prompt
        return "Bạn đã hoàn thành 5 phiên học.", 30, 12

    monkeypatch.setitem(PROVIDERS, "openai", provider)
    original_client = httpx.AsyncClient
    monkeypatch.setattr("app.ai_client.httpx.AsyncClient", lambda **kwargs: original_client(
        transport=httpx.ASGITransport(app=engine_app), **kwargs))
    response = client.post("/api/study/pomodoro-insights", headers=bearer(token))
    assert response.status_code == 200
    db.expire_all()
    run = db.get(AIRun, response.json()["run_id"])
    assert run.user_id == user.id and run.feature_key == "pomodoro_coach" and run.status == "succeeded"
    assert db.scalar(select(AIUsageLog).where(AIUsageLog.run_id == run.id)).outcome == "success"


def test_dashboard_study_summary_matches_focus_statistics(client, db):
    token = signup(client).json()["access_token"]
    user = db.scalar(select(User).where(User.email != "community@refmi.demo"))
    preferences(db, user.id).timezone = "Asia/Ho_Chi_Minh"
    now = datetime.now(timezone.utc)
    for offset in (0, 0, 1):
        session(db, user.id, now - timedelta(days=offset), zone="Asia/Ho_Chi_Minh")
    session(db, user.id, now, seconds=600, completed=False, status="cancelled", zone="Asia/Ho_Chi_Minh")
    session(db, user.id, now, mode="short_break", zone="Asia/Ho_Chi_Minh")
    db.commit()
    study = client.get("/api/dashboard", headers=bearer(token)).json()["study"]
    stats = client.get("/api/study/pomodoro-statistics", headers=bearer(token)).json()
    assert study == {"total_minutes": 85, "today_minutes": 60, "today_sessions": 2, "current_streak": 2,
                     "longest_streak": 2, "daily_goal_minutes": 120, "goal_progress": 3600 / 7200}
    assert study["today_sessions"] == stats["today_sessions"] and study["current_streak"] == stats["current_streak"]


def test_split_study_endpoints_agree_with_full_dashboard(client, db):
    token = signup(client).json()["access_token"]
    headers = bearer(token)
    user = db.scalar(select(User).where(User.email != "community@refmi.demo"))
    preferences(db, user.id).timezone = "Asia/Ho_Chi_Minh"
    now = datetime.now(timezone.utc)
    for offset in (0, 0, 1, 3):
        session(db, user.id, now - timedelta(days=offset), zone="Asia/Ho_Chi_Minh")
    session(db, user.id, now, seconds=600, completed=False, status="cancelled", zone="Asia/Ho_Chi_Minh")
    db.commit()
    full = client.get("/api/study/dashboard?period=month", headers=headers).json()
    assert full == client.get("/api/study/pomodoro-statistics?period=month", headers=headers).json()

    assert client.get("/api/study/summary", headers=headers).json() == {
        "timezone": "Asia/Ho_Chi_Minh", "today_seconds": 3600, "today_sessions": 2, "current_streak": 2}
    assert client.get("/api/study/streak", headers=headers).json() == {
        "timezone": "Asia/Ho_Chi_Minh", "current_streak": 2, "longest_streak": 2, "active_days": 3}

    minutes = client.get("/api/study/minutes?period=month", headers=headers).json()
    assert minutes["total_seconds"] == 6600 and minutes["today_seconds"] == 3600
    assert minutes["seconds"] == full["seconds"] and minutes["goal_progress"] == full["goal_progress"]
    assert [d["seconds"] for d in minutes["days"]] == [d["seconds"] for d in full["days"]]

    done = client.get("/api/study/completed-sessions?period=month", headers=headers).json()
    assert done["today_sessions"] == 2 and done["cancelled"] == 1
    assert done["completion_rate"] == full["completion_rate"] and done["hours"] == full["hours"]
    assert set(done["days"][0]) == {"date", "started", "completed"}

    for path in ("/api/study/minutes?period=year", "/api/study/completed-sessions?period=year", "/api/study/dashboard?period=year"):
        assert client.get(path, headers=headers).status_code == 422
    for path in ("/api/study/summary", "/api/study/minutes", "/api/study/completed-sessions", "/api/study/streak", "/api/study/dashboard"):
        assert client.get(path).status_code == 401
