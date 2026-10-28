from conftest import bearer, signup


def study(client, headers, minutes, **extra):
    response = client.post("/api/study/sessions", headers=headers, json={"duration_seconds": minutes * 60, **extra})
    assert response.status_code == 200
    return response.json()["xp_awarded"]


def test_two_exp_per_five_minutes_with_leftover_carried_into_next_block(client):
    headers = bearer(signup(client).json()["access_token"])
    assert study(client, headers, 23) == 8   # 4 blocks, 3 minutes left over
    assert study(client, headers, 7) == 4    # 3 + 7 = 10 minutes -> 2 more blocks
    assert study(client, headers, 4) == 0    # 4 minutes waiting for the next block
    assert study(client, headers, 1) == 2


def test_daily_cap_is_shared_by_logged_sessions_and_pomodoro_cycles(client):
    headers = bearer(signup(client).json()["access_token"])
    assert study(client, headers, 100) == 40
    first = client.post("/api/study/pomodoro/cycle0000001?duration_seconds=1800", headers=headers).json()
    assert first["xp_awarded"] == 8          # 130 minutes, but only 120 count -> 48 EXP total
    second = client.post("/api/study/pomodoro/cycle0000002?duration_seconds=1500", headers=headers).json()
    assert second["xp_awarded"] == 0
    assert study(client, headers, 600) == 0


def test_unfinished_and_break_sessions_earn_nothing(client):
    headers = bearer(signup(client).json()["access_token"])
    assert study(client, headers, 30, completed=False) == 0
    assert study(client, headers, 30, mode="short_break") == 0
    assert study(client, headers, 5) == 2    # the ignored 60 minutes do not count toward blocks


def test_pomodoro_completion_event_awards_block_exp_once(client):
    from datetime import datetime, timedelta, timezone

    headers = bearer(signup(client).json()["access_token"])
    start = datetime.now(timezone.utc) - timedelta(minutes=26)
    path = "/api/study/pomodoro/focus99999999"
    client.put(path, headers=headers, json={"event": "started", "timezone": "Asia/Ho_Chi_Minh", "occurred_at": start.isoformat()})
    done = client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 1500, "timezone": "Asia/Ho_Chi_Minh"})
    assert done.json()["xp_awarded"] == 10   # 25 minutes = 5 blocks
    again = client.put(path, headers=headers, json={"event": "completed", "duration_seconds": 1500, "timezone": "Asia/Ho_Chi_Minh"})
    assert again.json()["xp_awarded"] == 0


def test_ending_a_pomodoro_early_still_earns_exp_for_studied_minutes(client):
    from datetime import datetime, timedelta, timezone

    headers = bearer(signup(client).json()["access_token"])
    start = datetime.now(timezone.utc) - timedelta(minutes=20)
    path = "/api/study/pomodoro/early1234567"
    client.put(path, headers=headers, json={"event": "started", "timezone": "UTC", "occurred_at": start.isoformat()})
    ended = client.put(path, headers=headers, json={"event": "cancelled", "duration_seconds": 18 * 60, "timezone": "UTC"})
    assert ended.json()["status"] == "cancelled" and ended.json()["xp_awarded"] == 6   # 18 min -> 3 blocks
    stats = ended.json()["statistics"]
    assert stats["today_seconds"] == 18 * 60 and stats["today_sessions"] == 0 and stats["current_streak"] == 0
    assert stats["cancelled"] == 1
    assert study(client, headers, 2) == 2     # 3 leftover minutes + 2 -> one more block
