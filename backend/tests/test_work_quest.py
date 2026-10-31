"""Work Quest: work tasks are ordinary tasks (one task system, one EXP ledger, the same walk goals) with projects,
priorities, deadlines, steps, a dashboard, statistics and reward chests."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models import ExpEvent, InventoryStack, PetWalk, UserTask
from conftest import adult_signup as signup, bearer
from test_companion import finish_quests


@pytest.fixture()
def auth(client):
    return bearer(signup(client).json()["access_token"])


def today():
    return datetime.now(timezone.utc).date()


def iso(day):
    return day.isoformat()


def project(client, auth, name="Ra mắt app", theme="beach"):
    response = client.post("/api/work/projects", headers=auth, json={"name": name, "theme": theme})
    assert response.status_code == 201, response.json()
    return response.json()


def work_task(client, auth, title="Viết báo cáo", day=None, **extra):
    response = client.post("/api/tasks", headers=auth, json={
        "title": title, "category": "work", "scheduled_date": iso(day or today()), **extra})
    assert response.status_code == 200, response.json()
    return response.json()


def complete(client, auth, task_id, day=None):
    return client.post(f"/api/tasks/{task_id}/complete", headers=auth, json={"occurrence_date": iso(day or today())})


def task_exp_total(db):
    db.expire_all()
    return db.scalar(select(func.coalesce(func.sum(ExpEvent.amount), 0)).where(ExpEvent.source == "task"))


def test_project_task_with_steps_completes_once_and_builds_the_island(client, auth, db):
    island = project(client, auth)
    assert island["build_stage"] == 0 and island["progress"] == 0 and not island["ready_to_complete"]
    due = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    task = work_task(client, auth, project_id=island["id"], priority="high", due_at=due, estimated_minutes=45,
                     steps=["Thu thập số liệu", "Viết nháp", "Gửi duyệt"])
    assert task["exp"] == 8 and task["priority"] == "high" and task["estimated_minutes"] == 45
    assert [s["title"] for s in task["steps"]] == ["Thu thập số liệu", "Viết nháp", "Gửi duyệt"]

    listed = client.get(f"/api/tasks?start_date={iso(today())}", headers=auth).json()
    mine = next(t for t in listed if t["id"] == task["id"])
    assert mine["project_id"] == island["id"] and mine["due_at"] and len(mine["steps"]) == 3

    step = task["steps"][0]["id"]
    ticked = client.put(f"/api/tasks/{task['id']}/steps/{step}", headers=auth, json={"occurrence_date": iso(today()), "done": True})
    assert ticked.status_code == 200 and [s["done"] for s in ticked.json()["steps"]] == [True, False, False]
    again = client.put(f"/api/tasks/{task['id']}/steps/{step}", headers=auth, json={"occurrence_date": iso(today()), "done": True})
    assert [s["done"] for s in again.json()["steps"]] == [True, False, False]  # idempotent
    assert task_exp_total(db) == 0  # steps never earn EXP

    first = complete(client, auth, task["id"]).json()
    second = complete(client, auth, task["id"]).json()
    assert first["awarded_exp"] == 8 and not first["already_completed"]
    assert second["awarded_exp"] == 0 and second["already_completed"]
    assert task_exp_total(db) == 8

    built = client.get("/api/work/projects", headers=auth).json()[0]
    assert built["tasks_done"] == built["tasks_total"] == 1 and built["build_stage"] == 5 and built["ready_to_complete"]
    finished = client.patch(f"/api/work/projects/{island['id']}", headers=auth, json={"status": "completed"}).json()
    assert finished["status"] == "completed" and finished["completed_at"] and finished["build_stage"] == 5
    # A new task in a finished project doesn't take the island apart.
    work_task(client, auth, "Việc thêm", project_id=island["id"])
    assert client.get("/api/work/projects", headers=auth).json()[0]["build_stage"] == 5


def test_validation_titles_deadlines_priorities_and_projects(client, auth):
    base = {"category": "work", "scheduled_date": iso(today())}
    assert client.post("/api/tasks", headers=auth, json={**base}).status_code == 422
    assert client.post("/api/tasks", headers=auth, json={**base, "title": "   "}).status_code == 422
    assert client.post("/api/tasks", headers=auth, json={**base, "title": "x" * 121}).status_code == 422
    assert client.post("/api/tasks", headers=auth, json={**base, "title": "A", "priority": "critical"}).status_code == 422
    assert client.post("/api/tasks", headers=auth, json={**base, "title": "A", "estimated_minutes": 0}).status_code == 422
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    late = client.post("/api/tasks", headers=auth, json={**base, "title": "Trễ", "due_at": past})
    assert late.status_code == 422 and late.json()["code"] == "due_in_past"
    missing = client.post("/api/tasks", headers=auth, json={**base, "title": "A", "project_id": 9999})
    assert missing.status_code == 404 and missing.json()["code"] == "project_not_found"
    urgent = work_task(client, auth, "Khẩn", priority="urgent")
    assert urgent["exp"] == 10 <= 15
    assert client.post("/api/work/projects", headers=auth, json={"name": ""}).status_code == 422
    assert client.post("/api/work/projects", headers=auth, json={"name": "X", "theme": "lava"}).status_code == 422


def test_recurring_work_task_has_steps_per_occurrence_and_no_single_deadline(client, auth):
    start = today()
    due = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    task = work_task(client, auth, "Họp đứng", repeat="daily", due_at=due, steps=["Cập nhật tiến độ"])
    assert task["due_at"] is None  # a recurring task is due on each of its days
    step = task["steps"][0]["id"]
    client.put(f"/api/tasks/{task['id']}/steps/{step}", headers=auth, json={"occurrence_date": iso(start), "done": True})
    days = client.get(f"/api/tasks?start_date={iso(start)}&end_date={iso(start + timedelta(days=1))}", headers=auth).json()
    occurrences = [t for t in days if t["id"] == task["id"]]
    assert [t["steps"][0]["done"] for t in occurrences] == [True, False]
    assert complete(client, auth, task["id"]).json()["awarded_exp"] == 5
    assert complete(client, auth, task["id"], start + timedelta(days=1)).json()["awarded_exp"] == 5
    off_day = client.put(f"/api/tasks/{task['id']}/steps/{step}", headers=auth,
                         json={"occurrence_date": iso(start - timedelta(days=1)), "done": True})
    assert off_day.status_code == 409
    weekly = work_task(client, auth, "Báo cáo tuần", repeat="weekly", repeat_weekdays=[0, 4])
    week = client.get(f"/api/tasks?start_date={iso(start)}&end_date={iso(start + timedelta(days=13))}", headers=auth).json()
    weekdays = {datetime.fromisoformat(t["scheduled_date"]).weekday() for t in week if t["id"] == weekly["id"]}
    assert weekdays == {0, 4}
    assert client.patch(f"/api/tasks/{task['id']}", headers=auth, json={"due_at": due}).json()["code"] == "due_on_recurring"


def test_edit_keeps_history_and_overdue_tasks_show_on_the_dashboard(client, auth, db):
    yesterday = today() - timedelta(days=1)
    late = work_task(client, auth, "Hạn hôm qua", day=yesterday, priority="high")
    board = client.get("/api/work/dashboard?tz=UTC", headers=auth).json()
    assert [t["id"] for t in board["overdue"]] == [late["id"]] and board["overdue"][0]["overdue"]
    assert "pet_line" in board and board["walk"]["status"] in ("locked", "ready", "walking", "rested", "waiting_hatch", "returned")

    edited = client.patch(f"/api/tasks/{late['id']}", headers=auth, json={"title": "Đã đổi tên", "priority": "low"})
    assert edited.status_code == 200 and edited.json()["title"] == "Đã đổi tên" and edited.json()["exp"] == 5
    assert client.patch(f"/api/tasks/{late['id']}", headers=auth, json={"title": None}).status_code == 422
    assert client.patch(f"/api/tasks/{late['id']}", headers=auth, json={"scheduled_date": iso(today())}).status_code == 422

    assert complete(client, auth, late["id"], yesterday).json()["awarded_exp"] == 5  # a late task can still be finished
    assert client.get("/api/work/dashboard?tz=UTC", headers=auth).json()["overdue"] == []
    # Editing after it was done doesn't change the EXP already granted.
    client.patch(f"/api/tasks/{late['id']}", headers=auth, json={"priority": "urgent"})
    assert task_exp_total(db) == 5


def test_other_users_cannot_see_or_change_tasks_steps_or_projects(client, auth):
    island = project(client, auth)
    task = work_task(client, auth, project_id=island["id"], steps=["Bước 1"])
    other = bearer(signup(client, email="other@example.com").json()["access_token"])
    step = task["steps"][0]["id"]
    assert complete(client, other, task["id"]).status_code == 404
    assert client.patch(f"/api/tasks/{task['id']}", headers=other, json={"title": "Hack"}).status_code == 404
    assert client.delete(f"/api/tasks/{task['id']}", headers=other).status_code == 404
    assert client.put(f"/api/tasks/{task['id']}/steps/{step}", headers=other,
                      json={"occurrence_date": iso(today()), "done": True}).status_code == 404
    assert client.post(f"/api/tasks/{task['id']}/steps", headers=other, json={"title": "x"}).status_code == 404
    assert client.patch(f"/api/work/projects/{island['id']}", headers=other, json={"name": "Hack"}).status_code == 404
    assert client.get("/api/work/projects", headers=other).json() == []
    # Filing a task into someone else's project is refused like a missing one.
    stolen = client.post("/api/tasks", headers=other, json={"title": "A", "category": "work", "scheduled_date": iso(today()),
                                                            "project_id": island["id"]})
    assert stolen.status_code == 404
    assert client.get("/api/work/dashboard", headers=other).json()["tasks_today"] == []
    assert client.get("/api/work/dashboard").status_code == 401


def test_work_tasks_are_walk_goals_and_removing_the_last_one_starts_the_walk(client, auth, db):
    keep = work_task(client, auth, "Gửi email")
    drop = work_task(client, auth, "Việc bỏ")
    finish_quests(client, auth)
    board = client.get("/api/work/dashboard", headers=auth).json()
    assert board["walk"] == {"status": "locked", "goals_total": 5, "goals_done": 3}
    assert complete(client, auth, keep["id"]).status_code == 200
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "locked"
    assert client.delete(f"/api/tasks/{drop['id']}", headers=auth).json()["deleted"] is True
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "walking"
    # Removed, not erased: hidden from lists, its row (and completions) kept.
    assert all(t["id"] != drop["id"] for t in client.get("/api/tasks", headers=auth).json())
    db.expire_all()
    assert db.get(UserTask, drop["id"]).archived_at is not None
    assert complete(client, auth, drop["id"]).status_code == 404


def test_tasks_added_or_done_during_a_walk_never_reset_it(client, auth, db):
    finish_quests(client, auth)
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "walking"
    db.expire_all()
    walk = db.scalars(select(PetWalk)).one()
    started = walk.started_at
    later = work_task(client, auth, "Thêm khi pet đang đi")
    complete(client, auth, later["id"])
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(PetWalk)) == 1
    assert db.scalars(select(PetWalk)).one().started_at == started
    assert client.get("/api/pet/space", headers=auth).json()["status"] == "walking"


def test_task_exp_respects_the_shared_daily_cap(client, auth, db):
    ids = [work_task(client, auth, f"Khẩn {i}", priority="urgent")["id"] for i in range(8)]
    awarded = [complete(client, auth, task_id).json()["awarded_exp"] for task_id in ids]
    assert awarded[:6] == [10] * 6 and awarded[6:] == [0, 0]
    assert task_exp_total(db) == 60
    assert client.get("/api/work/dashboard", headers=auth).json()["summary"]["exp_remaining_today"] == 0


def test_concurrent_completions_award_exp_once(client, auth, db):
    task = work_task(client, auth, "Một lần thôi", priority="high")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: complete(client, auth, task["id"]), range(4)))
    assert {r.status_code for r in results} == {200}
    assert sum(r.json()["awarded_exp"] for r in results) == 8
    assert task_exp_total(db) == 8


def test_reward_chests_open_once_and_count_at_most_ten_completions_a_day(client, auth, db):
    rewards = client.get("/api/work/rewards", headers=auth).json()
    assert rewards["progress"] == 0 and rewards["chests"][0]["status"] == "locked"
    assert client.post("/api/work/rewards/first_quest/claim", headers=auth).json()["code"] == "chest_locked"
    assert client.post("/api/work/rewards/nope/claim", headers=auth).status_code == 404
    ids = [work_task(client, auth, f"Việc {i}", priority="low")["id"] for i in range(12)]
    for task_id in ids:
        complete(client, auth, task_id)
    rewards = client.get("/api/work/rewards", headers=auth).json()
    assert rewards["progress"] == 10  # 12 done today, 10 count
    assert [c["status"] for c in rewards["chests"][:3]] == ["ready", "ready", "locked"]

    with ThreadPoolExecutor(max_workers=3) as pool:
        opened = list(pool.map(lambda _: client.post("/api/work/rewards/first_quest/claim", headers=auth), range(3)))
    assert {r.status_code for r in opened} == {200}
    assert sum(not r.json()["already_opened"] for r in opened) == 1
    db.expire_all()
    notebooks = db.scalar(select(func.coalesce(func.sum(InventoryStack.quantity), 0)).where(InventoryStack.item_id == "pocket_notebook"))
    assert notebooks == 1
    assert opened[0].json()["chest"]["status"] == "opened"
    inventory = client.get("/api/inventory", headers=auth).json()
    assert "pocket_notebook" in str(inventory)


def test_statistics_count_by_day_priority_project_and_deadline(client, auth):
    island = project(client, auth, "Khách hàng A")
    soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    on_time = work_task(client, auth, "Đúng hạn", project_id=island["id"], due_at=soon, priority="high")
    plain = work_task(client, auth, "Không hạn")
    personal = client.post("/api/tasks", headers=auth, json={"title": "Đi bộ", "category": "health", "scheduled_date": iso(today())}).json()
    for task in (on_time, plain, personal):
        complete(client, auth, task["id"])
    stats = client.get("/api/work/statistics?period=week&tz=UTC", headers=auth).json()
    assert stats["completed"] == 2  # the health task isn't work
    assert stats["on_time"] == 1 and stats["late"] == 0
    assert stats["by_priority"]["high"] == 1 and stats["by_priority"]["medium"] == 1
    assert stats["by_project"] == [{"project_id": island["id"], "name": "Khách hàng A", "completed": 1}]
    assert sum(d["completed"] for d in stats["days"]) == 2
    assert client.get("/api/work/statistics?period=month&tz=UTC", headers=auth).json()["completed"] == 2
    assert client.get("/api/work/statistics?period=year", headers=auth).status_code == 422
    assert client.get("/api/work/statistics?tz=Not/AZone", headers=auth).status_code == 422
