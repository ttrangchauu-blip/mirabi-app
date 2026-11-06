"""Thành tựu (app/achievements.py): progress read from each feature's own records, tiers stored once, coins paid once."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import select

from app import achievements as ach
from app.db import SessionLocal
from app.models import (AchievementUnlock, CoinEvent, Friendship, GardenHarvest, InventoryEvent, PetEvolution, PetWalk,
                        StudySession, User, utcnow)
from conftest import adult_signup, bearer, open_lessons
from test_learning_api import eid, post
from test_learning_history import play, stage
from together import person
from test_learning_unlocks import unlock_catalog  # noqa: F401  (fixture)

TODAY = utcnow().date().isoformat()  # tests run with DAILY_RESET_TIMEZONE=UTC (conftest)


@pytest.fixture()
def mai(client):
    return person(client, "Mai")


def overview(client, who) -> dict:
    response = client.get("/api/achievements", headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def item(body: dict, achievement: str) -> dict:
    return next(a for a in body["achievements"] if a["id"] == achievement)


def task(client, who, title="Đọc sách", category="study", repeat="none", day=TODAY) -> dict:
    created = client.post("/api/tasks", headers=who.headers, json={
        "title": title, "category": category, "scheduled_date": day, "repeat": repeat})
    assert created.status_code in (200, 201), created.json()
    return created.json()


def complete(client, who, task_id: int, day=TODAY):
    done = client.post(f"/api/tasks/{task_id}/complete", headers=who.headers, json={"occurrence_date": day})
    assert done.status_code == 200, done.json()
    return done.json()


def unlocks(user_id: int) -> list[tuple[str, int]]:
    with SessionLocal() as db:
        return sorted((u.achievement, u.tier) for u in db.scalars(select(AchievementUnlock).where(AchievementUnlock.user_id == user_id)))


def coins(user_id: int) -> int:
    with SessionLocal() as db:
        return db.get(User, user_id).coins


# ------------------------------------------------------------------------------------------------- basics / boundaries
def test_a_new_account_has_nothing_unlocked_and_every_progress_at_zero(client, mai):
    body = overview(client, mai)
    assert body["summary"]["unlocked"] == 0 and body["summary"]["claimable"] == 0
    assert body["summary"]["total"] == sum(len(a["tiers"]) for a in ach.ACHIEVEMENTS if a["group"] != "life")
    assert all(a["progress"] == 0 and a["tier"] == 0 for a in body["achievements"])
    assert body["recent"] == [] and body["near"] == []
    # No age given: Mirabi Life is for 16 and over, so its achievements don't exist for this account.
    assert "life" not in {g["id"] for g in body["groups"]}
    assert all(a["group"] != "life" for a in body["achievements"])
    assert unlocks(mai.id) == []


def test_no_endpoint_takes_progress_from_the_app_and_nobody_reads_another_account(client, mai):
    assert client.post("/api/achievements", headers=mai.headers, json={"tasks_done": 500}).status_code == 405
    assert client.get("/api/achievements").status_code == 401
    complete(client, mai, task(client, mai)["id"])
    mine = item(overview(client, mai), "tasks_done")["tiers"][0]
    assert mine["unlocked"] and mine["claimable"]
    lan = person(client, "Lan")
    stolen = client.post(f"/api/achievements/unlocks/{mine['unlock_id']}/claim", headers=lan.headers)
    assert stolen.status_code == 404 and stolen.json()["code"] == "achievement_not_found"
    assert client.post("/api/achievements/seen", headers=lan.headers, json={"ids": [mine["unlock_id"]]}).json()["seen"] == 0
    assert overview(client, lan)["summary"]["unlocked"] == 0
    assert coins(mai.id) == coins(lan.id)  # nothing was paid to anyone


def test_a_task_unlocks_the_first_tier_once_however_often_it_is_checked(client, mai):
    t = task(client, mai)
    assert item(overview(client, mai), "tasks_done")["tier"] == 0
    complete(client, mai, t["id"])
    complete(client, mai, t["id"])  # the same occurrence again: already completed, counted once
    for _ in range(3):
        a = item(overview(client, mai), "tasks_done")
    assert a["progress"] == 1 and a["tier"] == 1 and a["title"] == "Nhiệm vụ đầu tiên"
    assert a["next"]["threshold"] == 10 and a["next"]["rank"] == 2
    assert unlocks(mai.id).count(("tasks_done", 1)) == 1


def test_tiers_open_exactly_at_their_threshold_and_a_day_counts_at_most_ten_tasks(client, mai):
    ids = [task(client, mai, title=f"Việc {i}")["id"] for i in range(12)]
    for task_id in ids[:9]:
        complete(client, mai, task_id)
    a = item(overview(client, mai), "tasks_done")
    assert (a["progress"], a["tier"]) == (9, 1)  # one short of Bạc: not unlocked
    complete(client, mai, ids[9])
    a = item(overview(client, mai), "tasks_done")
    assert (a["progress"], a["tier"]) == (10, 2)  # exactly at the threshold
    for task_id in ids[10:]:
        complete(client, mai, task_id)
    a = item(overview(client, mai), "tasks_done")
    assert a["progress"] == ach.DAILY_TASKS_COUNTED == 10 and a["tier"] == 2  # creating more tasks the same day adds nothing


def test_a_removed_task_no_longer_counts_but_a_tier_reached_is_kept(client, mai):
    t = task(client, mai)
    complete(client, mai, t["id"])
    assert item(overview(client, mai), "tasks_done")["tier"] == 1
    assert client.delete(f"/api/tasks/{t['id']}", headers=mai.headers).status_code in (200, 204)
    a = item(overview(client, mai), "tasks_done")
    assert a["progress"] == 0 and a["tier"] == 1 and a["tiers"][0]["unlocked"]


def test_recurring_tasks_and_task_groups(client, mai):
    days = [(utcnow().date() - timedelta(days=d)).isoformat() for d in range(3)]
    daily = task(client, mai, title="Uống nước", category="health", repeat="daily", day=days[-1])
    for day in days:
        complete(client, mai, daily["id"], day)
    complete(client, mai, task(client, mai, title="Một lần", category="study")["id"])
    body = overview(client, mai)
    assert item(body, "habit")["progress"] == 3 and item(body, "habit")["tier"] == 1
    assert item(body, "task_categories")["progress"] == 2 and item(body, "task_categories")["tier"] == 1
    assert [t["threshold"] for t in item(body, "task_categories")["tiers"]] == [2, 4, 6]  # a short track: three tiers


# ------------------------------------------------------------------------------------------------------- rewards
def test_coins_are_paid_once_per_tier_and_only_when_taken(client, mai):
    complete(client, mai, task(client, mai)["id"])
    before = coins(mai.id)
    tier = item(overview(client, mai), "tasks_done")["tiers"][0]
    assert coins(mai.id) == before  # reaching a tier pays nothing by itself
    first = client.post(f"/api/achievements/unlocks/{tier['unlock_id']}/claim", headers=mai.headers).json()
    assert first["paid"] is True and first["reward_coins"] == 10 and first["coins"] == before + 10
    again = client.post(f"/api/achievements/unlocks/{tier['unlock_id']}/claim", headers=mai.headers).json()
    assert again["paid"] is False and again["already_claimed"] is True and again["coins"] == before + 10
    assert client.post("/api/achievements/claim-all", headers=mai.headers).json()["paid"] == 0
    with SessionLocal() as db:
        events = list(db.scalars(select(CoinEvent).where(CoinEvent.user_id == mai.id, CoinEvent.kind == "achievement")))
    assert [(e.delta, e.event_key, e.balance_after) for e in events] == [(10, "achievement:tasks_done:1", before + 10)]
    after = item(overview(client, mai), "tasks_done")["tiers"][0]
    assert after["claimed_at"] and not after["claimable"]


def test_claims_sent_together_pay_once(client, mai):
    complete(client, mai, task(client, mai)["id"])
    tier = item(overview(client, mai), "tasks_done")["tiers"][0]
    before = coins(mai.id)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: client.post(f"/api/achievements/unlocks/{tier['unlock_id']}/claim",
                                                      headers=mai.headers), range(6)))
    assert all(r.status_code == 200 for r in results)
    assert sum(r.json()["paid"] for r in results) == 1
    assert coins(mai.id) == before + 10


def test_claim_all_takes_every_tier_waiting(client, mai):
    ids = [task(client, mai, title=f"Việc {i}")["id"] for i in range(10)]
    for task_id in ids:
        complete(client, mai, task_id)
    body = overview(client, mai)
    assert body["summary"]["claimable_coins"] >= 30  # Đồng 10 + Bạc 20 of tasks, and whatever else these reached
    before = coins(mai.id)
    result = client.post("/api/achievements/claim-all", headers=mai.headers).json()
    assert result["reward_coins"] == body["summary"]["claimable_coins"] and result["coins"] == before + result["reward_coins"]
    assert overview(client, mai)["summary"]["claimable"] == 0


# ------------------------------------------------------------------------------------------------- notices / backfill
def test_unseen_tiers_are_announced_once_on_any_device(client, mai):
    assert client.get("/api/achievements/unseen", headers=mai.headers).json()["count"] == 0
    complete(client, mai, task(client, mai)["id"])
    ach_check = ach.CHECK_SECONDS
    try:
        ach.CHECK_SECONDS = 0
        unseen = client.get("/api/achievements/unseen", headers=mai.headers).json()
    finally:
        ach.CHECK_SECONDS = ach_check
    titles = {u["title"] for u in unseen["unlocks"]}
    assert "Nhiệm vụ đầu tiên" in titles and all(u["new"] for u in unseen["unlocks"])
    ids = unseen["ids"]  # every unseen tier, so the app acknowledges them all at once
    assert len(ids) == unseen["count"] and {u["id"] for u in unseen["unlocks"]} <= set(ids)
    assert client.post("/api/achievements/seen", headers=mai.headers, json={"ids": ids}).json()["seen"] == len(ids)
    assert client.post("/api/achievements/seen", headers=mai.headers, json={"ids": ids}).json()["seen"] == 0
    assert client.get("/api/achievements/unseen", headers=mai.headers).json()["count"] == 0


def test_the_poll_checks_at_most_every_few_seconds_but_the_screen_always_checks(client, mai):
    client.get("/api/achievements/unseen", headers=mai.headers)  # the first check
    complete(client, mai, task(client, mai)["id"])
    assert client.get("/api/achievements/unseen", headers=mai.headers).json()["count"] == 0  # within CHECK_SECONDS
    assert item(overview(client, mai), "tasks_done")["tier"] == 1
    assert client.get("/api/achievements/unseen", headers=mai.headers).json()["count"] >= 1


def test_what_was_done_before_achievements_existed_is_found_and_can_be_claimed_once(client, mai):
    with SessionLocal() as db:  # history written before the first check of this account
        now = utcnow()
        db.add_all([PetWalk(user_id=mai.id, item_id="catalog", started_at=now - timedelta(days=d, hours=9),
                            returns_at=now - timedelta(days=d, hours=1), rewarded_at=now - timedelta(days=d),
                            collected_at=now - timedelta(days=d), task_cycle_id=f"d{d}") for d in range(10)])
        db.commit()
    body = overview(client, mai)
    walks = item(body, "walks")
    assert walks["progress"] == 10 and walks["tier"] == 2
    assert all(t["backfilled"] for t in walks["tiers"] if t["unlocked"])
    # Nothing of achievements was ever paid before they existed, so their coins are owed exactly once.
    assert client.post("/api/achievements/claim-all", headers=mai.headers).json()["reward_coins"] == 30
    assert client.post("/api/achievements/claim-all", headers=mai.headers).json()["reward_coins"] == 0
    # Later tiers aren't backfilled.
    with SessionLocal() as db:
        now = utcnow()
        db.add_all([PetWalk(user_id=mai.id, item_id="catalog", started_at=now - timedelta(days=20 + d),
                            returns_at=now - timedelta(days=20 + d), rewarded_at=now - timedelta(days=20 + d),
                            task_cycle_id=f"e{d}") for d in range(20)])
        db.commit()
    gold = item(overview(client, mai), "walks")["tiers"][2]
    assert gold["unlocked"] and not gold["backfilled"]


# ------------------------------------------------------------------------------------------------------- features
def test_learning_stages_count_only_backend_results(client, mai):
    perfect = play(client, mai, stage(client, mai, ["bank.money", "cold.weather"]), {})
    assert perfect["status"] == "completed"
    helped = play(client, mai, stage(client, mai, ["bank.river", "walk"]), {"bank.river": "wrong_then_right"})
    assert helped["status"] == "completed"
    left = stage(client, mai, ["run.move"])  # started, then abandoned: never a result
    post(client, mai.headers, left, "resume", client_event_id=eid())
    assert post(client, mai.headers, left, "abandon", client_event_id=eid()).status_code == 200
    body = overview(client, mai)
    assert item(body, "stages")["progress"] == 2 and item(body, "stages")["tier"] == 1
    assert item(body, "perfect_stages")["progress"] == 1  # the one with a wrong answer is not perfect
    assert item(body, "correct_answers")["progress"] == 3  # bank.river was right only at the second try
    assert item(body, "learning_days")["progress"] == 1
    assert item(body, "game_subjects")["progress"] == 1
    assert item(body, "lessons")["progress"] == 0  # free vocabulary stages aren't catalog lessons


def test_focus_counts_sessions_the_server_timed_to_their_end(client, mai):
    started = (utcnow() - timedelta(minutes=26)).isoformat()
    for cycle, event in (("cycledone01", "completed"), ("cyclestop01", "cancelled")):
        assert client.put(f"/api/study/pomodoro/{cycle}", headers=mai.headers,
                          json={"event": "started", "occurred_at": started, "timezone": "UTC"}).status_code == 200
    with SessionLocal() as db:  # a live start: backdate the server's receipt so 25 minutes really passed
        for row in db.scalars(select(StudySession).where(StudySession.user_id == mai.id)):
            row.created_at = utcnow() - timedelta(minutes=26)
        db.commit()
    done = client.put("/api/study/pomodoro/cycledone01", headers=mai.headers,
                      json={"event": "completed", "duration_seconds": 1500, "timezone": "UTC"})
    assert done.status_code == 200 and done.json()["status"] == "completed"
    stopped = client.put("/api/study/pomodoro/cyclestop01", headers=mai.headers,
                         json={"event": "cancelled", "duration_seconds": 600, "timezone": "UTC"})
    assert stopped.status_code == 200 and stopped.json()["status"] == "cancelled"
    # A duration the app states by itself (older endpoint, nothing timed by the server) never counts.
    assert client.post("/api/study/sessions", headers=mai.headers,
                       json={"mode": "focus", "duration_seconds": 36000, "completed": True}).status_code == 200
    body = overview(client, mai)
    assert item(body, "focus_sessions")["progress"] == 1 and item(body, "focus_sessions")["tier"] == 1
    assert item(body, "focus_hours")["progress"] == 0  # 25 minutes, not the 10 hours claimed
    assert item(body, "focus_days")["progress"] == 1


def test_pet_hatching_levels_walks_and_finds(client, mai):
    body = overview(client, mai)
    assert item(body, "pet_hatched")["tier"] == 0 and item(body, "pet_level")["progress"] == 0
    with SessionLocal() as db:
        progress = db.scalar(select(PetEvolution).where(PetEvolution.user_id == mai.id))
        progress.hatched_at, progress.total_xp, progress.level = utcnow(), 1500, 3
        now = utcnow()
        db.add(PetWalk(user_id=mai.id, item_id="catalog", started_at=now - timedelta(hours=9),
                       returns_at=now - timedelta(hours=1), task_cycle_id="x1", rewarded_at=now,
                       rewards='[{"slot": "main", "item_id": "clover", "variant": "default", "quantity": 1}]'))
        db.add(PetWalk(user_id=mai.id, item_id="catalog", started_at=now, returns_at=now + timedelta(hours=8),
                       task_cycle_id="x2"))  # still out: not a finished walk
        db.commit()
    body = overview(client, mai)
    hatched = item(body, "pet_hatched")
    assert hatched["milestone"] and hatched["tier"] == ach.MILESTONE_RANK and hatched["tiers"][0]["name"] == "Cột mốc"
    level = item(body, "pet_level")
    assert level["progress"] == 3 and level["tier"] == 2 and level["next"]["goal"] == "Pet đạt cấp 4"
    assert item(body, "walks")["progress"] == 1 and item(body, "walk_finds")["progress"] == 1


def test_garden_plantings_and_harvests(client, mai):
    with SessionLocal() as db:
        db.add(InventoryEvent(user_id=mai.id, item_id="seed_carrot", delta=-1, kind="plant", ref="garden:0", event_key="plant:a"))
        for i, plant in enumerate(("carrot", "carrot", "strawberry", "cherry_blossom")):
            db.add(GardenHarvest(user_id=mai.id, plot=i, planting_ref=f"p{i}", item_id=f"seed_{plant}", plant_id=plant,
                                 planted_at=utcnow() - timedelta(hours=1), client_request_id=f"h{i}"))
        db.commit()
    body = overview(client, mai)
    assert item(body, "first_planting")["tier"] == ach.MILESTONE_RANK
    assert item(body, "harvests")["progress"] == 4 and item(body, "harvests")["tier"] == 1
    assert item(body, "harvest_varieties")["progress"] == 3 and item(body, "harvest_varieties")["tier"] == 1
    assert item(body, "harvest_rarities")["progress"] == 3 and item(body, "harvest_rarities")["tier"] == 2


def test_friends_count_only_accepted_ones(client, mai):
    lan, hoa = person(client, "Lan"), person(client, "Hoa")
    with SessionLocal() as db:
        db.add(Friendship(user_low_id=min(mai.id, lan.id), user_high_id=max(mai.id, lan.id), requester_id=mai.id, status="accepted"))
        db.add(Friendship(user_low_id=min(mai.id, hoa.id), user_high_id=max(mai.id, hoa.id), requester_id=mai.id, status="pending"))
        db.commit()
    a = item(overview(client, mai), "friends")
    assert a["progress"] == 1 and a["tier"] == 1


def test_life_achievements_are_for_adults_and_give_the_badge_only(client):
    token = adult_signup(client).json()["access_token"]
    headers = bearer(token)
    assert client.put("/api/pet", json={"pet": "cat", "name": "Mây"}, headers=headers).status_code == 200
    body = client.get("/api/achievements", headers=headers).json()
    life = [a for a in body["achievements"] if a["group"] == "life"]
    assert {a["id"] for a in life} == {"mood_days", "journal_days", "money_days", "savings_goals", "career_badges"}
    assert all(t["reward_coins"] == 0 for a in life for t in a["tiers"])
    assert "life" in {g["id"] for g in body["groups"]}


def test_the_catalog_is_well_formed():
    assert len({a["id"] for a in ach.ACHIEVEMENTS}) == len(ach.ACHIEVEMENTS)
    for a in ach.ACHIEVEMENTS:
        thresholds = [t["threshold"] for t in a["tiers"]]
        assert thresholds == sorted(set(thresholds)) and thresholds[0] >= 1, a["id"]
        assert all(t["goal"] and "{" not in t["goal"] for t in a["tiers"]), a["id"]
        assert a["group"] in {g["id"] for g in ach.GROUPS}
        assert hasattr(ach._Measure, a["metric"]), a["metric"]
        if a["group"] == "life":
            assert not a["coins"]
    # No two achievements read the same metric with the same tiers (no duplicate under another name).
    seen = {(a["metric"], tuple(t["threshold"] for t in a["tiers"])) for a in ach.ACHIEVEMENTS}
    assert len(seen) == len(ach.ACHIEVEMENTS)


def test_catalog_lessons_subjects_and_chapters_count_each_lesson_once(unlock_catalog, client, monkeypatch):
    from test_learning_unlocks import account, complete as complete_stage, subject
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    for key in ("toan2.c1", "toan2.c2", "toan2.c3"):  # Khu C opens after Khu A; not what is tested here
        open_lessons(client, me, key)  # one at a time: the helper stores a chapter once per call

    def body():
        response = client.get("/api/achievements", headers=me)
        assert response.status_code == 200
        return {a["id"]: a for a in response.json()["achievements"]}

    complete_stage(client, me, "a1", "defense")
    assert body()["lessons"]["progress"] == 0  # one of its two required games: not completed yet
    complete_stage(client, me, "a1", "math_bridge")
    got = body()
    assert got["lessons"]["progress"] == 1 and got["lessons"]["title"] == "Bước chân đầu tiên"
    complete_stage(client, me, "a1", "defense")  # the same lesson played again
    got = body()
    assert got["lessons"]["progress"] == 1 and got["stages"]["progress"] == 3
    for key, game in (("c1", "defense"), ("c2", "math_bridge")):
        complete_stage(client, me, key, game)
    got = body()
    assert got["lessons"]["progress"] == 3 and got["subject_expert"]["progress"] == 3 and got["subject_expert"]["tier"] == 1
    assert got["chapters"]["progress"] == 0  # Khu C still has C3
    complete_stage(client, me, "c3", "defense")
    got = body()
    assert got["chapters"]["progress"] == 1 and got["chapters"]["title"] == "Chinh phục kiến thức"

    # Nothing played since the last check: the lessons are not read again.
    calls = []
    real = ach.lesson_api.game_progress
    monkeypatch.setattr(ach.lesson_api, "game_progress", lambda *a, **k: calls.append(1) or real(*a, **k))
    assert body()["lessons"]["progress"] == 4 and calls == []
    complete_stage(client, me, "a3", "math_bridge")  # (playing reads the lessons' progress itself)
    calls.clear()
    assert body()["lessons"]["progress"] == 5 and calls == [1]  # a session changed: read again, once
