from conftest import bearer, signup

LOGIN_EXP = 2  # first-day login streak reward, granted by signup()'s login


def test_custom_task_reward_is_fixed_and_stops_at_daily_cap(client):
    token = signup(client).json()["access_token"]
    headers = bearer(token)
    system_task = client.post("/api/pet/quests/focus/complete", headers=headers)
    assert system_task.json()["awarded_exp"] == 10
    rewards = []
    for index in range(11):
        task = client.post("/api/tasks", headers=headers, json={
            "title": f"Task {index}", "category": "personal",
            "difficulty": "very_hard" if index % 2 == 0 else "easy",
            "scheduled_date": "2030-01-01",
        })
        assert task.status_code == 200
        assert task.json()["difficulty"] == "medium"
        completed = client.post(f"/api/tasks/{task.json()['id']}/complete", headers=headers,
                                json={"occurrence_date": "2030-01-01"})
        assert completed.status_code == 200
        rewards.append(completed.json()["awarded_exp"])

    assert rewards == [5] * 10 + [0]
    duplicate = client.post("/api/tasks/1/complete", headers=headers, json={"occurrence_date": "2030-01-01"})
    assert duplicate.json()["awarded_exp"] == 0
    user = client.get("/api/profile", headers=headers).json()
    assert user["xp"] == 60 + LOGIN_EXP and user["level"] == 0
    assert client.get("/api/dashboard", headers=headers).json()["user"]["xp"] == 60 + LOGIN_EXP


def test_daily_quest_completion_awards_task_xp_once(client):
    token = signup(client).json()["access_token"]
    headers = bearer(token)

    first = client.post("/api/pet/quests/focus/complete", headers=headers)
    duplicate = client.post("/api/pet/quests/focus/complete", headers=headers)

    assert first.json()["awarded_exp"] == 10
    assert duplicate.json()["awarded_exp"] == 0
    assert duplicate.json()["daily_exp_remaining"] == 50
    assert duplicate.json()["already_completed"] is True
    assert client.get("/api/profile", headers=headers).json()["xp"] == 10 + LOGIN_EXP


def test_pet_progress_is_saved_per_pet_and_study_xp_evolves(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "study_daily_exp_cap", 500)
    token = signup(client).json()["access_token"]
    headers = bearer(token)
    adopted = client.put("/api/pet", headers=headers, json={"pet": "dolphin", "name": "Aqua"})
    # Login EXP earned before adoption moves to the first pet.
    assert adopted.json()["level"] == 0 and adopted.json()["xp"] == LOGIN_EXP

    study = client.post("/api/study/sessions", headers=headers, json={"duration_seconds": 750 * 60})
    assert study.json()["xp_awarded"] == 300  # 150 five-minute blocks x 2 EXP
    profile = client.get("/api/profile", headers=headers).json()
    assert profile["xp"] == 300 + LOGIN_EXP and profile["level"] == 1

    switched = client.patch("/api/profile", headers=headers, json={"pet": "cat"}).json()
    assert switched["xp"] == 0 and switched["level"] == 0
    restored = client.patch("/api/profile", headers=headers, json={"pet": "dolphin"}).json()
    assert restored["xp"] == 300 + LOGIN_EXP and restored["level"] == 1
