"""Regressions found by the audit of the life modules: the feed (one like per person, no hidden authors, no demo post),
money months on the user's own calendar, chests on the server's calendar, memories without a made-up accessory, and a
weather cell nobody read for a long time."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, inspect, select, text

from app import main, world
from app.config import settings
from app.db import SessionLocal
from app.migrations import upgrade_schema
from app.models import CommunityPost, Memory, User, UserTaskCompletion, WeatherCache, utcnow
from conftest import adult_signup, bearer
from together import person
from test_work_quest import complete, iso, project, today, work_task

ICT = "Asia/Ho_Chi_Minh"
CROWN = "Vương miện pha lê"


def adult(client, email="aqua@example.com"):
    headers = bearer(adult_signup(client, email=email).json()["access_token"])
    assert client.put("/api/pet", headers=headers, json={"pet": "fox", "name": "Mây"}).status_code == 200
    return headers


# ---------------------------------------------------------------------------- the feed
def post(client, who, body="Hôm nay vui ghê"):
    response = client.post("/api/community/posts", json={"body": body}, headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def bodies(client, who):
    response = client.get("/api/community/posts", headers=who.headers)
    assert response.status_code == 200, response.json()
    return [p["body"] for p in response.json()]


def test_a_new_database_has_no_demo_post_or_demo_account(client, db):
    assert db.scalar(select(User).where(User.email == "community@refmi.demo")) is None
    assert db.scalar(select(CommunityPost)) is None
    assert bodies(client, person(client, "Ana")) == []


def test_posts_already_stored_stay_when_the_server_starts(client, db):
    ana = person(client, "Ana")
    db.add(CommunityPost(user_id=ana.id, body="Bài cũ", likes=128))
    db.commit()
    main.startup()
    assert client.get("/api/community/posts", headers=ana.headers).json()[0]["likes"] == 128


def test_the_feed_needs_a_login_and_keeps_its_shape(client):
    ana = person(client, "Ana")
    post(client, ana)
    assert client.get("/api/community/posts").status_code == 401
    item = client.get("/api/community/posts", headers=ana.headers).json()[0]
    assert set(item) == {"id", "author", "body", "image_url", "likes", "created_at"}
    assert item["author"] == "Ana" and item["body"] == "Hôm nay vui ghê"


def test_one_person_likes_a_post_once(client):
    ana, bao = person(client, "Ana"), person(client, "Bao")
    post_id = post(client, ana)["id"]
    like = f"/api/community/posts/{post_id}/like"
    assert client.post(like).status_code == 401
    assert [client.post(like, headers=ana.headers).json() for _ in range(3)] == [{"id": post_id, "likes": 1}] * 3
    assert client.post(like, headers=bao.headers).json()["likes"] == 2
    assert client.get("/api/community/posts", headers=ana.headers).json()[0]["likes"] == 2
    assert client.post("/api/community/posts/999999/like", headers=ana.headers).status_code == 404


def test_likes_sent_at_once_count_once(client):
    ana = person(client, "Ana")
    post_id = post(client, ana)["id"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        replies = list(pool.map(lambda _: client.post(f"/api/community/posts/{post_id}/like", headers=ana.headers), range(4)))
    assert {r.status_code for r in replies} == {200}
    assert client.get("/api/community/posts", headers=ana.headers).json()[0]["likes"] == 1


def test_a_like_counted_before_the_table_existed_is_kept(client, db):
    ana = person(client, "Ana")
    db.add(CommunityPost(user_id=ana.id, body="Bài cũ", likes=128))
    db.commit()
    post_id = client.get("/api/community/posts", headers=ana.headers).json()[0]["id"]
    assert client.post(f"/api/community/posts/{post_id}/like", headers=ana.headers).json()["likes"] == 129


def test_blocked_authors_are_hidden_both_ways_and_come_back_when_unblocked(client):
    ana, bao, cam = person(client, "Ana"), person(client, "Bao"), person(client, "Cam")
    post_id = post(client, bao, "Của Bao")["id"]
    assert client.post(f"/api/users/{bao.id}/block", headers=ana.headers).status_code in (200, 201)
    assert bodies(client, ana) == [] and bodies(client, cam) == ["Của Bao"]
    assert client.post(f"/api/community/posts/{post_id}/like", headers=ana.headers).status_code == 404
    post(client, ana, "Của Ana")
    assert bodies(client, bao) == ["Của Bao"]  # who was blocked doesn't see the blocker's posts either
    assert client.delete(f"/api/users/{bao.id}/block", headers=ana.headers).status_code in (200, 204)
    assert set(bodies(client, ana)) == {"Của Ana", "Của Bao"}


def test_a_disabled_authors_posts_leave_the_feed(client, db):
    ana, bao = person(client, "Ana"), person(client, "Bao")
    post_id = post(client, bao, "Của Bao")["id"]
    db.get(User, bao.id).status = "disabled"
    db.commit()
    assert bodies(client, ana) == []
    assert client.post(f"/api/community/posts/{post_id}/like", headers=ana.headers).status_code == 404


def test_an_author_without_a_name_reads_properly(client, db):
    ana = person(client, "Ana")
    post(client, ana)
    db.get(User, ana.id).display_name = ""
    db.commit()
    assert client.get("/api/community/posts", headers=ana.headers).json()[0]["author"] == "Người dùng Mirabi"


# ---------------------------------------------------------------------------- money months
def month_before(day):
    return (day.replace(day=1) - timedelta(days=1)).replace(day=1)


def test_a_months_money_follows_the_users_own_calendar(client):
    headers = adult(client)
    last = month_before(today())
    earlier = month_before(last)
    period, before = last.strftime("%Y-%m"), earlier.strftime("%Y-%m")
    # 03:00 on the first of the month in Vietnam is still the previous month in UTC.
    at = datetime(last.year, last.month, 1, 3, tzinfo=timezone(timedelta(hours=7))).isoformat()
    category = next(c for c in client.get("/api/finance/categories", headers=headers).json() if c["type"] == "expense")["id"]
    assert client.post("/api/finance/transactions", headers=headers, json={
        "transaction_type": "expense", "amount": 1000, "category_id": category, "occurred_at": at, "client_ref": "month-ref-1"}).status_code == 201
    budget = client.post(f"/api/finance/budgets?tz={ICT}", headers=headers,
                         json={"category_id": category, "period": period, "limit_amount": 5000}).json()
    assert budget["spent"] == 1000

    def expense(month, tz=ICT):
        return client.get(f"/api/finance/summary?period={month}&tz={tz}", headers=headers).json()["expense"]
    assert expense(period) == 1000 and expense(before) == 0
    assert client.get(f"/api/finance/summary?period={period}&tz={ICT}", headers=headers).json()["budgets"][0]["spent"] == 1000
    assert client.get(f"/api/finance/budgets?period={period}&tz={ICT}", headers=headers).json()[0]["spent"] == 1000
    listed = client.get(f"/api/finance/transactions?period={period}&tz={ICT}", headers=headers).json()["items"]
    assert [t["amount"] for t in listed] == [1000]
    # Elsewhere on earth, or with no zone and settings still on UTC, that moment was the month before.
    assert expense(before, "UTC") == 1000
    assert client.get(f"/api/finance/summary?period={before}", headers=headers).json()["expense"] == 1000
    assert client.get(f"/api/finance/summary?period={period}&tz=Not/AZone", headers=headers).status_code == 422


def test_the_month_without_a_period_is_the_current_one_in_the_users_zone(client, monkeypatch):
    headers = adult(client)
    now = datetime(2026, 12, 31, 20, tzinfo=timezone.utc)  # already January in Vietnam
    monkeypatch.setattr("app.finance.utcnow", lambda: now)
    assert client.get(f"/api/finance/summary?tz={ICT}", headers=headers).json()["period"] == "2027-01"
    assert client.get("/api/finance/summary?tz=UTC", headers=headers).json()["period"] == "2026-12"


def test_a_list_can_ask_for_income_and_expenses_without_the_savings(client):
    headers = adult(client)
    goal = client.post("/api/finance/goals", headers=headers, json={"name": "Laptop", "target_amount": 100000}).json()["id"]
    for i in range(3):
        assert client.post("/api/finance/transactions", headers=headers, json={
            "transaction_type": "deposit", "amount": 10, "goal_id": goal, "client_ref": f"deposit-{i:04}"}).status_code == 201
    for kind in ("income", "expense"):
        assert client.post("/api/finance/transactions", headers=headers, json={
            "transaction_type": kind, "amount": 20, "client_ref": f"{kind}-0000"}).status_code == 201
    page = client.get("/api/finance/transactions?transaction_type=income,expense&limit=2", headers=headers).json()
    assert {t["transaction_type"] for t in page["items"]} == {"income", "expense"} and page["next_before"] is None
    assert client.get("/api/finance/transactions?transaction_type=deposit", headers=headers).json()["items"][0]["amount"] == 10
    assert client.get("/api/finance/transactions?transaction_type=income,gift", headers=headers).status_code == 422


def test_bringing_back_an_archived_goal_respects_the_limit(client):
    headers = adult(client)
    ids = [client.post("/api/finance/goals", headers=headers, json={"name": f"Quỹ {i}", "target_amount": 100}).json()["id"] for i in range(20)]
    assert client.patch(f"/api/finance/goals/{ids[0]}", headers=headers, json={"status": "archived"}).status_code == 200
    assert client.post("/api/finance/goals", headers=headers, json={"name": "Quỹ mới", "target_amount": 100}).status_code == 201
    refused = client.patch(f"/api/finance/goals/{ids[0]}", headers=headers, json={"status": "active"})
    assert refused.status_code == 409 and refused.json()["code"] == "too_many_goals"
    assert client.patch(f"/api/finance/goals/{ids[1]}", headers=headers, json={"status": "active"}).status_code == 200  # already active
    assert client.patch(f"/api/finance/goals/{ids[1]}", headers=headers, json={"status": "archived"}).status_code == 200
    assert client.patch(f"/api/finance/goals/{ids[0]}", headers=headers, json={"status": "active"}).status_code == 200


# ---------------------------------------------------------------------------- work
def test_chests_count_completions_per_day_of_the_server_calendar(client, db, monkeypatch):
    monkeypatch.setattr(settings, "daily_reset_timezone", ICT)
    headers = adult(client)
    ids = [work_task(client, headers, f"Việc {i}")["id"] for i in range(12)]
    for task_id in ids:
        complete(client, headers, task_id)
    # Six before and six after midnight in Vietnam (17:00 UTC): one UTC day, two days of the calendar.
    day = (utcnow() - timedelta(days=2)).date()
    rows = db.scalars(select(UserTaskCompletion).order_by(UserTaskCompletion.id)).all()
    for i, row in enumerate(rows):
        row.completed_at = datetime(day.year, day.month, day.day, 16 if i < 6 else 18, tzinfo=timezone.utc)
    db.commit()
    assert client.get("/api/work/rewards", headers=headers).json()["progress"] == 12


def test_upcoming_quests_are_the_nearest_ones_whichever_task_they_belong_to(client):
    headers = adult(client)
    work_task(client, headers, "Mỗi ngày", repeat="daily")
    tomorrow = today() + timedelta(days=1)
    work_task(client, headers, "Việc ngày mai", day=tomorrow)
    upcoming = client.get("/api/work/dashboard?tz=UTC", headers=headers).json()["upcoming"]
    assert [t["scheduled_date"] for t in upcoming] == sorted(t["scheduled_date"] for t in upcoming)
    assert "Việc ngày mai" in {t["title"] for t in upcoming[:6]}
    assert {t["title"] for t in upcoming if t["scheduled_date"] == iso(tomorrow)} == {"Mỗi ngày", "Việc ngày mai"}


# ---------------------------------------------------------------------------- memories
def save_memory(client, headers, key, **body):
    response = client.post("/api/memories", headers=headers, json={"title": "Một ngày", "client_request_id": key, **body})
    assert response.status_code == 201, response.json()
    return response.json()


@pytest.mark.parametrize("template,shown_in,not_in", [("study", "study", "pet"), ("together", "friends", "pet"), ("hatch", "pet", "study"),
                                                       ("walk", "pet", "friends"), ("auto", "pet", "study")])
def test_a_saved_memory_is_found_under_the_kind_it_was_made_as(client, template, shown_in, not_in):
    headers = adult(client)
    saved = save_memory(client, headers, "memory-key-1", template_key=template)

    def ids(category):
        return [m["id"] for m in client.get(f"/api/memories?category={category}", headers=headers).json()["items"]]
    assert saved["id"] in ids(shown_in) and saved["id"] in ids("all") and saved["id"] not in ids(not_in)


def test_nobody_starts_with_an_accessory_and_a_memory_says_so(client):
    headers = adult(client)
    saved = save_memory(client, headers, "memory-key-2")
    assert saved["snapshot"]["accessory"] is None
    assert "Phụ kiện" not in saved["image_svg"] and CROWN not in saved["image_svg"]
    assert client.get("/api/pet/room", headers=headers).json()["equipped_item"] is None


def test_an_accessory_the_user_chose_is_still_drawn_and_old_memories_stay_as_they_are(client, db):
    headers = adult(client)
    user = db.scalar(select(User).where(User.email == "aqua@example.com"))
    user.equipped_item = CROWN
    db.commit()
    old = save_memory(client, headers, "memory-key-3")
    assert f"Phụ kiện: {CROWN}" in old["image_svg"]
    db.expire_all()
    user.equipped_item = None
    db.commit()
    assert client.get(f"/api/memories/{old['id']}", headers=headers).json()["image_svg"] == old["image_svg"]
    assert "Phụ kiện" not in save_memory(client, headers, "memory-key-4")["image_svg"]
    db.expire_all()
    assert CROWN in db.get(Memory, old["id"]).snapshot_json


def test_upgrade_drops_the_accessory_nobody_chose_and_the_not_null(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("""CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) UNIQUE, password_hash VARCHAR(255),
            display_name VARCHAR(80), level INTEGER, xp INTEGER, coins INTEGER, gems INTEGER, avatar_theme VARCHAR(40),
            equipped_item VARCHAR(80) NOT NULL, created_at DATETIME)"""))
        conn.execute(text("INSERT INTO users (email, password_hash, equipped_item) VALUES ('a@example.com', 'h', :crown), "
                          "('b@example.com', 'h', 'Đèn mặt trăng')"), {"crown": CROWN})
    upgrade_schema(engine)
    upgrade_schema(engine)  # idempotent
    assert next(c for c in inspect(engine).get_columns("users") if c["name"] == "equipped_item")["nullable"]
    with engine.begin() as conn:
        assert conn.execute(text("SELECT email, equipped_item FROM users ORDER BY id")).all() == [
            ("a@example.com", None), ("b@example.com", "Đèn mặt trăng")]
        conn.execute(text("INSERT INTO users (email, password_hash) VALUES ('c@example.com', 'h')"))


# ---------------------------------------------------------------------------- weather
READING = {"condition": "rain", "temperature_c": 27, "wind_kmh": 12, "cloud_cover": 90, "is_day": True, "observed_at": "2026-11-01T08:00"}
WEATHER = "/api/world/weather?lat=21.0278&lon=105.8342"


def test_a_cell_nobody_read_for_over_a_week_is_read_again(client, monkeypatch):
    monkeypatch.setattr(world, "fetch_current", lambda lat, lon: READING)
    headers = adult(client)
    assert client.get(WEATHER, headers=headers).json()["available"] is True
    with SessionLocal() as session:
        row = session.scalar(select(WeatherCache))
        row.fetched_at = row.expires_at = utcnow() - timedelta(days=8)
        session.commit()
    for _ in range(2):
        again = client.get(WEATHER, headers=headers)
        assert again.status_code == 200 and again.json()["available"] is True and again.json()["stale"] is False
    with SessionLocal() as session:
        assert len(session.scalars(select(WeatherCache)).all()) == 1


def test_other_cells_nobody_reads_are_still_removed(client, monkeypatch):
    monkeypatch.setattr(world, "fetch_current", lambda lat, lon: READING)
    headers = adult(client)
    client.get(WEATHER, headers=headers)
    with SessionLocal() as session:
        row = session.scalar(select(WeatherCache))
        row.fetched_at = row.expires_at = utcnow() - timedelta(days=8)
        session.commit()
    assert client.get("/api/world/weather?lat=10.8&lon=106.7", headers=headers).status_code == 200
    with SessionLocal() as session:
        assert [r.cell for r in session.scalars(select(WeatherCache))] == ["10.8,106.7"]
