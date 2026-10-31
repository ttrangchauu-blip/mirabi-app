"""Mirabi Life, phases 2-3 and access: the 16+ rule, Phiêu lưu cuộc sống, Vườn tài chính, Thị trấn Mirabi and
Hành trình sự nghiệp."""
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import adventure, careers
from app.models import CareerPath, CareerSkill, ExpEvent, InventoryStack, User, UserSkillProgress
from conftest import adult_signup, bearer, login, register


def adopt(client, headers, name="Mây"):
    assert client.put("/api/pet", headers=headers, json={"pet": "fox", "name": name}).status_code == 200


def adult(client, email="aqua@example.com", age=25):
    """A signed-in adult with a pet (friends are made between accounts that adopted one)."""
    headers = bearer(adult_signup(client, email=email, age=age).json()["access_token"])
    adopt(client, headers)
    return headers


def me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def today():
    return datetime.now(timezone.utc).date()


def ref(n: int | str) -> str:
    return f"test-ref-{n:0>6}" if isinstance(n, int) else n


def befriend(client, a, b, b_id):
    sent = client.post("/api/friend-requests", json={"user_id": b_id}, headers=a)
    assert sent.status_code == 201, sent.json()
    assert client.post(f"/api/friend-requests/{sent.json()['id']}/accept", headers=b).status_code == 200


# ---------------------------------------------------------------------------- access
@pytest.mark.parametrize("path", ["/api/work/dashboard", "/api/life/healing", "/api/adventure/map", "/api/finance/goals",
                                  "/api/town/map", "/api/careers"])
def test_mirabi_life_is_for_ages_16_and_over(client, path):
    assert register(client, email="kid@example.com", age=15, school_grade="grade9").status_code == 201
    kid = bearer(login(client, email="kid@example.com").json()["access_token"])
    assert register(client, email="nobody@example.com").status_code == 201  # no age given
    unknown = bearer(login(client, email="nobody@example.com").json()["access_token"])
    for headers in (kid, unknown):
        blocked = client.get(path, headers=headers)
        assert blocked.status_code == 403 and blocked.json()["code"] == "age_restricted"
    assert client.get(path, headers=adult(client, "grown@example.com", age=16)).status_code == 200
    assert client.get(path).status_code == 401


# ---------------------------------------------------------------------------- Phiêu lưu cuộc sống
def test_adventure_activities_are_tasks_and_regions_unlock_in_order(client, db):
    h = adult(client)
    first = client.get("/api/adventure/map", headers=h).json()
    assert [r["unlocked"] for r in first["regions"]] == [True, False, False, False, False]
    assert first["regions"][1]["unlock_hint"]
    locked = client.post("/api/adventure/activities/tidy_room/start", headers=h, json={"scheduled_date": today().isoformat()})
    assert locked.status_code == 409 and locked.json()["code"] == "region_locked"

    ids = []
    for code in ("walk_20", "stretch", "water_goal"):
        started = client.post(f"/api/adventure/activities/{code}/start", headers=h, json={"scheduled_date": today().isoformat()})
        assert started.status_code == 201 and started.json()["region"] == "green_valley"
        ids.append(started.json()["id"])
    again = client.post("/api/adventure/activities/walk_20/start", headers=h, json={"scheduled_date": today().isoformat()})
    assert again.json()["id"] == ids[0]  # same activity, same day: the same task
    # The tasks are ordinary tasks of the day (so they are walk goals too).
    assert {t["id"] for t in client.get("/api/tasks", headers=h).json() if t.get("kind") == "scheduled"} >= set(ids)
    assert client.get("/api/adventure/map", headers=h).json()["regions"][0]["progress"] == 0  # started, not done
    for task_id in ids:
        done = client.post(f"/api/tasks/{task_id}/complete", headers=h, json={"occurrence_date": today().isoformat()})
        assert done.json()["awarded_exp"] == 5  # the task's own, capped EXP
    view = client.get("/api/adventure/map", headers=h).json()
    assert view["regions"][0]["progress"] == 3 and view["regions"][1]["unlocked"] and view["pet_region"] == "cozy_village"
    assert client.post("/api/adventure/activities/nope/start", headers=h, json={"scheduled_date": today().isoformat()}).status_code == 404
    far = (today() + timedelta(days=30)).isoformat()
    assert client.post("/api/adventure/activities/walk_20/start", headers=h, json={"scheduled_date": far}).json()["code"] == "invalid_day"
    history = client.get("/api/adventure/history", headers=h).json()
    assert len(history) == 3 and {e["region"] for e in history} == {"green_valley"}


def test_adventure_milestones_reward_once_and_progress_survives_edits_and_logout(client, db):
    h = adult(client)
    ids = [client.post(f"/api/adventure/activities/{c}/start", headers=h, json={"scheduled_date": today().isoformat()}).json()["id"]
           for c in ("walk_20", "stretch", "water_goal", "exercise_30")]
    early = client.post("/api/adventure/rewards/green_valley:3/claim", headers=h)
    assert early.status_code == 409 and early.json()["code"] == "milestone_locked"
    for task_id in ids:
        client.post(f"/api/tasks/{task_id}/complete", headers=h, json={"occurrence_date": today().isoformat()})
    # At most 3 a day per region count.
    assert client.get("/api/adventure/map", headers=h).json()["regions"][0]["progress"] == 3
    with ThreadPoolExecutor(max_workers=3) as pool:
        claims = list(pool.map(lambda _: client.post("/api/adventure/rewards/green_valley:3/claim", headers=h), range(3)))
    assert {c.status_code for c in claims} == {200} and sum(not c.json()["already_claimed"] for c in claims) == 1
    db.expire_all()
    assert db.scalar(select(func.sum(InventoryStack.quantity)).where(InventoryStack.item_id == "seed_daisy")) == 2
    # Renaming or removing a done task changes nothing: what was done stays done.
    client.patch(f"/api/tasks/{ids[0]}", headers=h, json={"title": "Đổi tên"})
    client.delete(f"/api/tasks/{ids[1]}", headers=h)
    client.post("/api/auth/logout", headers=h)
    h2 = bearer(login(client).json()["access_token"])
    region = client.get("/api/adventure/regions/green_valley", headers=h2).json()
    assert region["progress"] == 3 and region["milestones"][0]["status"] == "claimed"
    assert client.get("/api/adventure/regions/atlantis", headers=h2).status_code == 404


# ---------------------------------------------------------------------------- Vườn tài chính
def test_money_goal_tree_grows_and_shrinks_with_recorded_money(client):
    h = adult(client)
    goal = client.post("/api/finance/goals", headers=h, json={"name": "Laptop", "target_amount": 20_000_000, "plant": "oak"}).json()
    assert goal["stage"] == 0 and goal["stage_name"] == "Hạt giống" and goal["saved_amount"] == 0

    def move(kind, amount, n):
        return client.post("/api/finance/transactions", headers=h, json={"transaction_type": kind, "amount": amount,
                                                                         "goal_id": goal["id"], "client_ref": ref(n)})
    first = move("deposit", 1_000_000, 1)
    assert first.status_code == 201 and first.json()["goal"]["stage"] == 1  # Mầm cây
    assert move("deposit", 1_000_000, 1).json()["already_recorded"] is True  # a retry counts once
    assert move("deposit", 9_000_000, 2).json()["goal"]["stage"] == 3  # 50 %: Cây phát triển
    withdrawn = move("withdraw", 6_000_000, 3).json()
    assert withdrawn["goal"]["saved_amount"] == 4_000_000 and withdrawn["goal"]["stage"] == 1  # 20 %: back to Mầm cây
    over = move("withdraw", 4_000_001, 4)
    assert over.status_code == 409 and over.json()["code"] == "insufficient_balance"
    assert move("deposit", 16_000_000, 5).json()["goal"]["stage"] == 5  # 100 %: Cây nở hoa
    view = client.get("/api/finance/goals", headers=h).json()[0]
    assert view["percent"] == 100 and all(m["reached"] for m in view["milestones"])


def test_empty_optional_text_sent_as_null_is_accepted(client):
    """The app sends `null` for an empty note or description; that must be a normal request, never a 500."""
    h = adult(client)
    goal = client.post("/api/finance/goals", headers=h, json={"name": "Quỹ", "target_amount": 1_000_000}).json()
    deposit = client.post("/api/finance/transactions", headers=h, json={
        "transaction_type": "deposit", "amount": 50_000, "goal_id": goal["id"], "note": None, "client_ref": ref(1)})
    assert deposit.status_code == 201 and deposit.json()["goal"]["saved_amount"] == 50_000
    tx = deposit.json()["transaction"]["id"]
    assert client.patch(f"/api/finance/transactions/{tx}", headers=h, json={"note": None}).status_code == 200
    assert client.post("/api/life/moods", headers=h, json={"mood": "happy", "note": None}).status_code == 201
    assert client.post("/api/work/projects", headers=h, json={"name": "Dự án", "description": None}).status_code == 201
    assert client.post("/api/tasks", headers=h, json={"title": "Việc", "category": "work", "scheduled_date": today().isoformat(), "description": None}).status_code == 200
    assert client.post("/api/careers/profile", headers=h, json={"career_code": "qa_tester", "current_goal": None}).status_code == 200
    too_long = client.post("/api/finance/transactions", headers=h, json={
        "transaction_type": "deposit", "amount": 1, "goal_id": goal["id"], "note": "x" * 201, "client_ref": ref(2)})
    assert too_long.status_code == 422


def test_money_validation_and_editing_never_goes_below_zero(client):
    h = adult(client)
    base = {"name": "Du lịch"}
    for bad in (0, -5, 1.5, "1000", 100_000_000_001):
        assert client.post("/api/finance/goals", headers=h, json={**base, "target_amount": bad}).status_code == 422
    big = client.post("/api/finance/goals", headers=h, json={**base, "target_amount": 100_000_000_000})
    assert big.status_code == 201  # 100 billion VND fits (BIGINT, no float)
    goal = big.json()["id"]
    deposit = client.post("/api/finance/transactions", headers=h, json={"transaction_type": "deposit", "amount": 500_000, "goal_id": goal,
                                                                        "client_ref": ref(10)}).json()["transaction"]
    spend = client.post("/api/finance/transactions", headers=h, json={"transaction_type": "withdraw", "amount": 300_000, "goal_id": goal,
                                                                      "client_ref": ref(11)}).json()["transaction"]
    lower = client.patch(f"/api/finance/transactions/{deposit['id']}", headers=h, json={"amount": 100_000})
    assert lower.status_code == 409 and lower.json()["code"] == "balance_would_go_negative"
    assert client.delete(f"/api/finance/transactions/{deposit['id']}", headers=h).status_code == 409
    assert client.delete(f"/api/finance/transactions/{spend['id']}", headers=h).json()["goal"]["saved_amount"] == 500_000
    assert client.post("/api/finance/transactions", headers=h, json={"transaction_type": "deposit", "amount": 5,
                                                                     "client_ref": ref(12)}).status_code == 422  # no goal
    future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    assert client.post("/api/finance/transactions", headers=h, json={"transaction_type": "income", "amount": 5, "occurred_at": future,
                                                                     "client_ref": ref(13)}).json()["code"] == "occurred_in_future"


def test_concurrent_withdrawals_never_overdraw(client):
    h = adult(client)
    goal = client.post("/api/finance/goals", headers=h, json={"name": "Quỹ", "target_amount": 1_000_000}).json()["id"]
    client.post("/api/finance/transactions", headers=h, json={"transaction_type": "deposit", "amount": 100_000, "goal_id": goal,
                                                              "client_ref": ref(20)})

    def take(n):
        return client.post("/api/finance/transactions", headers=h, json={"transaction_type": "withdraw", "amount": 60_000,
                                                                         "goal_id": goal, "client_ref": ref(30 + n)})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(take, range(4)))
    assert sum(r.status_code == 201 for r in results) == 1
    assert client.get("/api/finance/goals", headers=h).json()[0]["saved_amount"] == 40_000


def test_budgets_summary_and_money_privacy(client):
    h = adult(client)
    categories = client.get("/api/finance/categories", headers=h).json()
    food = next(c for c in categories if c["name"] == "Ăn uống")
    salary = next(c for c in categories if c["name"] == "Lương")
    period = datetime.now(timezone.utc).strftime("%Y-%m")
    budget = client.post("/api/finance/budgets", headers=h, json={"category_id": food["id"], "period": period, "limit_amount": 2_000_000})
    assert budget.status_code == 200 and budget.json()["spent"] == 0
    assert client.post("/api/finance/budgets", headers=h, json={"category_id": salary["id"], "period": period,
                                                                "limit_amount": 1}).json()["code"] == "category_type_mismatch"
    client.post("/api/finance/transactions", headers=h, json={"transaction_type": "income", "amount": 15_000_000,
                                                              "category_id": salary["id"], "client_ref": ref(40)})
    client.post("/api/finance/transactions", headers=h, json={"transaction_type": "expense", "amount": 2_500_000,
                                                              "category_id": food["id"], "client_ref": ref(41)})
    summary = client.get(f"/api/finance/summary?period={period}", headers=h).json()
    assert summary["income"] == 15_000_000 and summary["expense"] == 2_500_000 and summary["net"] == 12_500_000
    assert summary["budgets"][0]["over"] is True and summary["budgets"][0]["left"] == -500_000
    custom = client.post("/api/finance/categories", headers=h, json={"name": "Cà phê", "type": "expense", "icon": "☕"}).json()

    other = adult(client, "other@example.com")
    assert client.get("/api/finance/goals", headers=other).json() == []
    assert client.get("/api/finance/transactions", headers=other).json()["items"] == []
    assert client.get(f"/api/finance/summary?period={period}", headers=other).json()["income"] == 0
    assert all(c["id"] != custom["id"] for c in client.get("/api/finance/categories", headers=other).json())
    mine = client.get("/api/finance/transactions", headers=h).json()["items"]
    assert client.delete(f"/api/finance/transactions/{mine[0]['id']}", headers=other).status_code == 404
    # Money never appears in what friends or the town can see.
    assert "15000000" not in json.dumps(client.get("/api/town/map", headers=other).json())


# ---------------------------------------------------------------------------- Thị trấn Mirabi
def test_town_shows_eligible_friends_and_gifts_move_one_copy_once(client, db):
    a = adult(client, "a@example.com")
    b = adult(client, "b@example.com")
    assert register(client, email="kid@example.com", age=13, school_grade="grade8").status_code == 201
    kid = bearer(login(client, email="kid@example.com").json()["access_token"])
    adopt(client, kid)
    ids = {u["email"]: u["id"] for u in (me(client, a), me(client, b), me(client, kid))}
    befriend(client, a, b, ids["b@example.com"])
    befriend(client, a, kid, ids["kid@example.com"])
    town = client.get("/api/town/map", headers=a).json()
    assert [f["id"] for f in town["friends"]] == [ids["b@example.com"]]  # the younger friend isn't in the town
    assert {p["code"] for p in town["projects"]} == {"square_fountain", "community_garden", "lantern_street"}
    assert town["events"] and all(e["status"] == "active" for e in town["events"])

    # A has one teddy bear (granted directly, as a walk would).
    from app import inventory as inv
    user_a = db.get(User, ids["a@example.com"])
    inv.grant(db, user_a.id, "teddy_bear", inv.variants_of("teddy_bear")[0], 1, kind="walk_reward", ref=None, event_key="test:teddy")
    db.commit()
    variant = inv.variants_of("teddy_bear")[0]
    assert any(i["id"] == "teddy_bear" for i in client.get("/api/town/giftable", headers=a).json())
    gift = {"receiver_id": ids["b@example.com"], "item_id": "teddy_bear", "variant": variant, "client_ref": ref(50)}
    with ThreadPoolExecutor(max_workers=3) as pool:
        sent = list(pool.map(lambda _: client.post("/api/town/gifts", headers=a, json=gift), range(3)))
    assert sum(r.status_code == 201 for r in sent) == 1 and all(r.status_code in (200, 201) for r in sent)
    db.expire_all()
    owned = lambda uid: db.scalar(select(func.coalesce(func.sum(InventoryStack.quantity), 0)).where(
        InventoryStack.user_id == uid, InventoryStack.item_id == "teddy_bear"))
    assert owned(ids["a@example.com"]) == 0 and owned(ids["b@example.com"]) == 1
    again = client.post("/api/town/gifts", headers=a, json={**gift, "client_ref": ref(51)})
    assert again.status_code == 409 and again.json()["code"] == "item_not_available"  # nothing left to give
    to_kid = client.post("/api/town/gifts", headers=b, json={**gift, "receiver_id": ids["kid@example.com"], "client_ref": ref(52)})
    assert to_kid.status_code == 404
    keepsake = client.post("/api/town/gifts", headers=b, json={**gift, "receiver_id": ids["a@example.com"], "item_id": "shell", "client_ref": ref(53)})
    assert keepsake.json()["code"] == "item_not_giftable"
    assert client.get("/api/town/gifts", headers=b).json()[0]["direction"] == "received"
    assert any(n["kind"] == "town_gift" for n in client.get("/api/notifications", headers=b).json()["items"])


def test_blocked_friends_leave_the_town_and_visits_are_logged(client):
    a = adult(client, "a@example.com")
    b = adult(client, "b@example.com")
    ids = {u["email"]: u["id"] for u in (me(client, a), me(client, b))}
    befriend(client, a, b, ids["b@example.com"])
    assert client.get(f"/api/personal-room/visit/{ids['b@example.com']}", headers=a).status_code == 200
    history = client.get("/api/town/visits/history", headers=b).json()
    assert history[0]["direction"] == "in" and history[0]["user_id"] == ids["a@example.com"]
    assert client.post(f"/api/users/{ids['a@example.com']}/block", headers=b).status_code in (200, 201)
    assert client.get("/api/town/map", headers=a).json()["friends"] == []
    assert client.get(f"/api/personal-room/visit/{ids['b@example.com']}", headers=a).status_code == 404


def test_community_contributions_are_exact_capped_and_idempotent(client, db):
    a = adult(client, "a@example.com")
    b = adult(client, "b@example.com")
    project = client.get("/api/town/projects", headers=a).json()[0]
    coins = me(client, a)["coins"]
    with ThreadPoolExecutor(max_workers=3) as pool:
        same = list(pool.map(lambda _: client.post(f"/api/town/projects/{project['id']}/contribute", headers=a,
                                                   json={"amount": 300, "client_ref": ref(60)}), range(3)))
    assert all(r.status_code == 200 for r in same) and sum(not r.json()["already_recorded"] for r in same) == 1
    client.post(f"/api/town/projects/{project['id']}/contribute", headers=b, json={"amount": 200, "client_ref": ref(61)})
    view = next(p for p in client.get("/api/town/projects", headers=a).json() if p["id"] == project["id"])
    assert view["current"] == 500 and view["my_contribution"] == 300 and view["contributors"] == 2
    assert me(client, a)["coins"] == coins - 300
    capped = client.post(f"/api/town/projects/{project['id']}/contribute", headers=a, json={"amount": 500, "client_ref": ref(62)})
    assert client.post(f"/api/town/projects/{project['id']}/contribute", headers=a,
                       json={"amount": 300, "client_ref": ref(63)}).json()["code"] == "contribution_limit"
    assert capped.status_code == 200
    assert client.post(f"/api/town/projects/{project['id']}/contribute", headers=a, json={"amount": 5000,
                                                                                         "client_ref": ref(64)}).status_code == 422
    broke = db.get(User, me(client, b)["id"])
    broke.coins = 50
    db.commit()
    poor = client.post(f"/api/town/projects/{project['id']}/contribute", headers=b, json={"amount": 100, "client_ref": ref(65)})
    assert poor.status_code == 409 and poor.json()["code"] == "insufficient_coins"
    db.expire_all()
    assert db.get(User, broke.id).coins == 50
    assert db.scalar(select(func.count()).select_from(ExpEvent).where(ExpEvent.source.in_(("town", "community")))) == 0


# ---------------------------------------------------------------------------- Hành trình sự nghiệp
def test_career_tree_unlocks_by_prerequisites_and_keeps_progress_when_switching(client, db):
    h = adult(client)
    paths = client.get("/api/careers", headers=h).json()
    assert {"qa_tester", "software_developer", "business_analyst", "ui_ux_designer", "project_manager", "marketing", "sales",
            "accountant", "human_resources", "data_analyst"} <= {p["code"] for p in paths}
    qa = client.get("/api/careers/qa_tester", headers=h).json()
    assert [g["name"] for g in qa["groups"]] == ["Kiểm thử thủ công", "Kiểm thử API", "Kiểm thử tự động", "Kiểm thử cơ sở dữ liệu", "Kỹ năng mềm"]
    skills = {s["code"]: s for g in qa["groups"] for s in g["skills"]}
    assert skills["test_case_design"]["unlocked"] and not skills["test_execution"]["unlocked"]
    assert "answer" not in json.dumps(skills["test_case_design"]["assessment"])  # answers never leave the server
    not_chosen = client.patch(f"/api/careers/skills/{skills['test_case_design']['id']}/progress", headers=h, json={"progress_percent": 40})
    assert not_chosen.json()["code"] == "career_not_selected"

    assert client.post("/api/careers/profile", headers=h, json={"career_code": "qa_tester", "current_goal": "Thành QA trong 6 tháng"}).status_code == 200
    locked = client.patch(f"/api/careers/skills/{skills['test_execution']['id']}/progress", headers=h, json={"practiced": True})
    assert locked.status_code == 409 and locked.json()["code"] == "skill_locked"
    estimate = client.patch(f"/api/careers/skills/{skills['test_case_design']['id']}/progress", headers=h, json={"progress_percent": 40}).json()
    tcd = next(s for g in estimate["groups"] for s in g["skills"] if s["code"] == "test_case_design")
    assert tcd["status"] == "in_progress" and tcd["progress_percent"] == 40  # self-reported, not "mastered"
    practiced = client.patch(f"/api/careers/skills/{skills['test_case_design']['id']}/progress", headers=h, json={"practiced": True}).json()
    assert practiced["awarded_exp"] == 5
    again = client.patch(f"/api/careers/skills/{skills['test_case_design']['id']}/progress", headers=h, json={"practiced": True}).json()
    assert again["awarded_exp"] == 0  # EXP once per skill
    lowered = client.patch(f"/api/careers/skills/{skills['test_case_design']['id']}/progress", headers=h, json={"progress_percent": 10}).json()
    assert next(s for g in lowered["groups"] for s in g["skills"] if s["code"] == "test_case_design")["status"] == "practiced"
    opened = next(s for g in lowered["groups"] for s in g["skills"] if s["code"] == "test_execution")
    assert opened["unlocked"] and opened["status"] == "available"

    # Switching career keeps the QA progress.
    client.post("/api/careers/profile", headers=h, json={"career_code": "data_analyst"})
    progress = client.get("/api/careers/my-progress", headers=h).json()
    assert progress["active"]["code"] == "data_analyst"
    assert next(c for c in progress["careers"] if c["code"] == "qa_tester")["skills_done"] == 1
    assert client.post("/api/careers/profile", headers=h, json={"career_code": "astronaut"}).status_code == 404


def test_career_assessment_badges_once_and_exp_within_the_cap(client, db):
    h = adult(client)
    client.post("/api/careers/profile", headers=h, json={"career_code": "qa_tester"})
    qa = client.get("/api/careers/qa_tester", headers=h).json()
    soft = next(g for g in qa["groups"] if g["name"] == "Kỹ năng mềm")
    path = db.scalar(select(CareerPath).where(CareerPath.code == "qa_tester"))
    answers = {s.code: [q["answer"] for q in json.loads(s.assessment)]
               for s in db.scalars(select(CareerSkill).where(CareerSkill.career_path_id == path.id))}
    comm = next(s for s in soft["skills"] if s["code"] == "communication")
    wrong = client.post(f"/api/careers/skills/{comm['id']}/assessment", headers=h, json={"answers": [2]}).json()
    assert wrong["passed"] is False and wrong["awarded_exp"] == 0
    right = client.post(f"/api/careers/skills/{comm['id']}/assessment", headers=h, json={"answers": answers["communication"]}).json()
    assert right["passed"] and next(s for g in right["groups"] for s in g["skills"] if s["code"] == "communication")["status"] == "assessed"
    no_check = next(s for s in soft["skills"] if s["code"] == "teamwork")
    assert client.post(f"/api/careers/skills/{no_check['id']}/assessment", headers=h, json={"answers": [0]}).json()["code"] == "no_assessment"
    badges = []
    for code in ("problem_solving", "teamwork", "documentation"):
        skill_id = next(s["id"] for s in soft["skills"] if s["code"] == code)
        badges += client.patch(f"/api/careers/skills/{skill_id}/progress", headers=h, json={"practiced": True}).json()["new_badges"]
    assert [b["milestone"] for b in badges] == ["group:Kỹ năng mềm"]
    client.patch(f"/api/careers/skills/{no_check['id']}/progress", headers=h, json={"practiced": True})
    assert len(client.get("/api/careers/achievements", headers=h).json()) == 1  # not twice
    # Career EXP shares the 60/day task pool: practising many skills never passes it.
    db.expire_all()
    total = db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(ExpEvent.source.in_(("task", "learning"))))
    assert total <= 60


def test_career_content_rejects_cycles_and_retires_removed_skills(client, db):
    with pytest.raises(careers.ContentError):
        careers.validate([{"code": "x", "skills": [{"code": "a", "prerequisites": ["b"]}, {"code": "b", "prerequisites": ["a"]}]}])
    with pytest.raises(careers.ContentError):
        careers.validate([{"code": "x", "skills": [{"code": "a", "prerequisites": ["ghost"]}]}])
    careers.validate(careers.load_content())  # the shipped content is valid
    h = adult(client)
    client.post("/api/careers/profile", headers=h, json={"career_code": "sales"})
    skill = db.scalar(select(CareerSkill).join(CareerPath).where(CareerPath.code == "sales", CareerSkill.code == "crm"))
    path = db.get(CareerPath, skill.career_path_id)
    version = path.content_version
    # crm needs prospecting: practise that first.
    prospect = db.scalar(select(CareerSkill).where(CareerSkill.career_path_id == path.id, CareerSkill.code == "prospecting"))
    client.patch(f"/api/careers/skills/{prospect.id}/progress", headers=h, json={"practiced": True})
    client.patch(f"/api/careers/skills/{skill.id}/progress", headers=h, json={"practiced": True})
    content = careers.load_content()
    for p in content:
        if p["code"] == "sales":
            p["skills"] = [s for s in p["skills"] if s["code"] != "crm"]
    careers.seed_careers(db, content)
    db.commit()
    db.expire_all()
    assert db.get(CareerSkill, skill.id).status == "retired" and db.get(CareerPath, path.id).content_version == version + 1
    assert db.scalar(select(UserSkillProgress).where(UserSkillProgress.skill_id == skill.id)) is not None  # progress kept
    assert all(s["code"] != "crm" for s in client.get("/api/careers/sales/skills", headers=h).json())
    careers.seed_careers(db)  # back, and running twice adds nothing
    careers.seed_careers(db)
    db.commit()
    assert db.scalar(select(func.count()).select_from(CareerSkill).where(CareerSkill.code == "crm")) == 1
