from sqlalchemy import select

from app.models import StudySession
from conftest import bearer, signup


def test_pomodoro_completion_is_idempotent_and_scoped_to_user(client):
    first_token = signup(client, email="pomodoro-one@example.com").json()["access_token"]
    second_token = signup(client, email="pomodoro-two@example.com").json()["access_token"]
    key = "focuscycle8abc"

    first = client.post(f"/api/study/pomodoro/{key}?duration_seconds=1500", headers=bearer(first_token))
    duplicate = client.post(f"/api/study/pomodoro/{key}?duration_seconds=1500", headers=bearer(first_token))
    other_user = client.post(f"/api/study/pomodoro/{key}?duration_seconds=1500", headers=bearer(second_token))

    assert first.status_code == 200 and first.json()["already_recorded"] is False
    assert duplicate.status_code == 200 and duplicate.json()["already_recorded"] is True
    assert duplicate.json()["id"] == first.json()["id"]
    assert other_user.status_code == 200 and other_user.json()["id"] != first.json()["id"]
    from app.db import SessionLocal
    with SessionLocal() as db:
        sessions = db.scalars(select(StudySession).where(StudySession.mode == "pomodoro")).all()
        assert len(sessions) == 2 and {s.study_type for s in sessions} == {"self_study"}  # Học tự chọn

    first_list = client.get("/api/study/sessions", headers=bearer(first_token)).json()
    assert len(first_list) == 1 and first_list[0]["mode"] == "pomodoro"


def test_pomodoro_completion_rejects_invalid_key(client):
    token = signup(client, email="pomodoro-invalid@example.com").json()["access_token"]
    response = client.post("/api/study/pomodoro/short?duration_seconds=1500", headers=bearer(token))
    assert response.status_code == 422

