from conftest import bearer, signup


def test_recurrence_weekdays_interval_limits_and_completion_is_per_occurrence(client):
    headers = bearer(signup(client).json()["access_token"])
    task = client.post("/api/tasks", headers=headers, json={
        "title": "English", "category": "study", "scheduled_date": "2030-01-07",
        "repeat": "weekly", "repeat_interval": 2, "repeat_weekdays": [0, 2, 4],
        "start_time": "19:00", "end_time": "19:30", "all_day": False, "repeat_count": 4,
    })
    assert task.status_code == 200
    occurrences = client.get("/api/tasks?start_date=2030-01-01&end_date=2030-01-31", headers=headers).json()
    entries = [item for item in occurrences if item["title"] == "English"]
    assert [item["scheduled_date"] for item in entries] == ["2030-01-07", "2030-01-09", "2030-01-11", "2030-01-21"]
    assert entries[0]["start_time"] == "19:00" and entries[0]["end_time"] == "19:30"
    first = client.post(f"/api/tasks/{task.json()['id']}/complete", headers=headers, json={"occurrence_date": "2030-01-07"}).json()
    duplicate = client.post(f"/api/tasks/{task.json()['id']}/complete", headers=headers, json={"occurrence_date": "2030-01-07"}).json()
    second = client.post(f"/api/tasks/{task.json()['id']}/complete", headers=headers, json={"occurrence_date": "2030-01-09"}).json()
    assert first["awarded_exp"] == 5 and duplicate["awarded_exp"] == 0 and second["awarded_exp"] == 5


def test_monthly_missing_dates_and_yearly_leap_days_are_skipped(client):
    headers = bearer(signup(client).json()["access_token"])
    monthly = client.post("/api/tasks", headers=headers, json={
        "title": "Monthly", "category": "personal", "scheduled_date": "2030-01-31", "repeat": "monthly",
    }).json()
    yearly = client.post("/api/tasks", headers=headers, json={
        "title": "Leap day", "category": "personal", "scheduled_date": "2028-02-29", "repeat": "yearly",
    }).json()
    items = client.get("/api/tasks?start_date=2030-01-01&end_date=2030-03-31", headers=headers).json()
    leap_items = client.get("/api/tasks?start_date=2032-02-01&end_date=2032-03-31", headers=headers).json()
    monthly_days = [item["scheduled_date"] for item in items if item["id"] == monthly["id"]]
    leap_days = [item["scheduled_date"] for item in leap_items if item["id"] == yearly["id"]]
    assert monthly_days == ["2030-01-31", "2030-03-31"]
    assert leap_days == ["2032-02-29"]


def test_time_and_custom_repeat_validation(client):
    headers = bearer(signup(client).json()["access_token"])
    base = {"title": "Bad", "category": "study", "scheduled_date": "2030-01-01"}
    assert client.post("/api/tasks", headers=headers, json={**base, "start_time": "20:00", "end_time": "19:00", "all_day": False}).status_code == 422
    assert client.post("/api/tasks", headers=headers, json={**base, "repeat": "custom"}).status_code == 422
