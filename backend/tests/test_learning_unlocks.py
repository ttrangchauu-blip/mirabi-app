"""Tự động mở khóa (learning_unlocks.py): chapters and lessons open on their own as the required content before them is
completed, through the API that completes a stage, stored once per school year and never taken back.

The tests use their own small catalog (Toán lớp 2, generated problems, so stages are quick to play):

    toan2.khu_a "Khu A" (sequential)       toan2.khu_b "Khu B"      toan2.khu_c "Khu C" (free)
      a1  defense + math_bridge (+ match, optional)   b1 planned     c1  defense
      a2  defense            (optional lesson)                       c2  math_bridge
      a3  math_bridge                                                c3  defense, requires c1 and c2
      a4  planned
      a5  defense            (min_first_try 1.0)
"""
import copy
import json
import shutil
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import learning_unlocks as lu, lesson_catalog as lc
from app.db import SessionLocal
from app.models import LearningSession, LearningUnlock
from conftest import open_lessons
from test_lesson_catalog import FIXTURES, account, answer, finish, right_answer, start

DEFENSE = {"game": "defense", "title": "Đường đua phép tính", "math": {"topic": "arithmetic", "ops": ["mul"], "table": 2, "add_max": 100}}
BRIDGE = {"game": "math_bridge", "title": "Tìm số còn thiếu", "math": {"topic": "missing_number", "ops": ["div"], "table": 2, "add_max": 100}}
MATCH = {"game": "match", "title": "Ghép phép tính", "optional": True, "tasks": [
    {"key": f"m{i}", "prompt": "Ghép phép nhân với kết quả", "explanation": "Đếm thêm 2.",
     "pairs": [[f"2 × {a}", str(2 * a)] for a in (i, i + 3, i + 6)]} for i in (1, 2, 3)]}


def _lesson(key: str, title: str, *games, **extra) -> dict:
    return {"key": f"toan2.{key}", "title": title, "description": f"{title}.", "status": "ready", "review": {"status": "checked"},
            "objectives": [title], "summary": [f"{title}."], "games": [copy.deepcopy(g) for g in games], **extra}


def _planned(key: str, title: str) -> dict:
    return {"key": f"toan2.{key}", "title": title, "description": f"{title}.", "status": "planned"}


def math_file() -> dict:
    return {"subject": "math", "version": 1, "organization": "topic", "source_note": "Bộ bài kiểm thử mở khóa.", "chapters": [
        {"key": "toan2.khu_a", "grade": 2, "order": 1, "title": "Khu A", "lessons": [
            {**_lesson("a1", "Bài A1", DEFENSE, BRIDGE, MATCH), "order": 1},
            {**_lesson("a2", "Bài A2", DEFENSE), "order": 2, "optional": True},
            {**_lesson("a3", "Bài A3", BRIDGE), "order": 3},
            {**_planned("a4", "Bài A4"), "order": 4},
            {**_lesson("a5", "Bài A5", DEFENSE), "order": 5, "completion": {"min_first_try": 1.0}}]},
        {"key": "toan2.khu_b", "grade": 2, "order": 2, "title": "Khu B", "lessons": [{**_planned("b1", "Bài B1"), "order": 1}]},
        {"key": "toan2.khu_c", "grade": 2, "order": 3, "title": "Khu C", "progression": "free", "lessons": [
            {**_lesson("c1", "Bài C1", DEFENSE), "order": 1},
            {**_lesson("c2", "Bài C2", BRIDGE), "order": 2},
            {**_lesson("c3", "Bài C3", DEFENSE), "order": 3, "requires": ["toan2.c1", "toan2.c2"],
             "requires_note": "Bài C3 nối hai nhánh C1 và C2."}]}]}


def _reset():
    lc.catalog.cache_clear()
    lc.programme.cache_clear()


@pytest.fixture()
def unlock_catalog(monkeypatch, tmp_path):
    """The fixture catalog with the math file above; `write(data)` changes it (content edited by an admin)."""
    folder = tmp_path / "lessons"
    shutil.copytree(FIXTURES, folder)

    def write(data: dict) -> None:
        (folder / "math.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        _reset()

    write(math_file())
    monkeypatch.setattr(lc, "LESSONS_DIR", folder)
    _reset()
    yield write
    _reset()


def subject(client, me) -> dict:
    return client.get("/api/learning/programme/subjects/math", headers=me).json()


def states(client, me) -> dict[str, str]:
    """lesson or chapter key (without "toan2.") → LOCKED / UNLOCKED / IN_PROGRESS / COMPLETED."""
    body = client.get("/api/learning/unlock-map?subject=math", headers=me).json()
    out = {}
    for c in body["chapters"]:
        out[c["key"][10:]] = c["status"]  # toan2.khu_a → a
        out.update({x["key"][6:]: x["status"] for x in c["lessons"]})
    return out


def complete(client, me, key: str, game: str) -> dict:
    """Plays a whole stage right and completes it: the `complete` response (with `unlocked`)."""
    session = start(client, me, f"toan2.{key}", game)
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        session = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()["session"]
    res = client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={})
    assert res.status_code == 200, res.json()
    return res.json()


def opened(response: dict) -> set[str]:
    return {u["key"].replace("toan2.", "").replace("khu_", "") for u in response["unlocked"]}


def celebrate_all(client, me) -> None:
    pending = client.post("/api/learning/progress/sync", headers=me).json()["unlocked"]
    if pending:
        assert client.post("/api/learning/unlocks/celebrated", headers=me, json={"ids": [u["id"] for u in pending]}).status_code == 200


def unlock_rows(**where) -> list[LearningUnlock]:
    with SessionLocal() as db:
        return list(db.scalars(select(LearningUnlock).filter_by(**where).order_by(LearningUnlock.id)))


# ---------- the rules, through the stages ----------

def test_a_new_learner_starts_at_the_first_lesson_and_nothing_else_is_open(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    assert states(client, me) == {"a": "UNLOCKED", "a1": "UNLOCKED", "a2": "LOCKED", "a3": "LOCKED", "a4": "LOCKED", "a5": "LOCKED",
                                  "b": "LOCKED", "b1": "LOCKED", "c": "LOCKED", "c1": "LOCKED", "c2": "LOCKED", "c3": "LOCKED"}
    body = subject(client, me)
    a3 = next(x for x in body["lessons"] if x["lesson_id"] == "toan2.a3")
    # A3 waits for A1 (the optional A2 between them holds nothing back), and says so.
    assert a3["unlock_requirements"] == [{"type": "lesson", "lesson_id": "toan2.a1", "title": "Bài A1", "done": False}]
    assert a3["unlock_note"] == "Hoàn thành “Bài A1” để mở bài này." and a3["content_status"] == "LOCKED"
    c1 = next(x for x in body["lessons"] if x["lesson_id"] == "toan2.c1")
    assert c1["unlock_requirements"][0] == {"type": "chapter", "chapter_key": "toan2.khu_a", "title": "Khu A", "done": False, "remaining": 3}
    assert body["unlocked"] == []  # where a learner starts is not celebrated
    assert {(r.content_key, r.source, r.celebrated_at is not None) for r in unlock_rows()} == {
        ("toan2.khu_a", "start", True), ("toan2.a1", "start", True)}
    # Nothing the app sends opens a lesson.
    res = client.post("/api/learning/lesson-catalog/toan2.a3/play", headers=me, json={"game": "math_bridge", "unlock_status": "unlocked"})
    assert res.status_code == 409 and res.json()["code"] == "lesson_locked"
    client.post("/api/learning/progress/sync", headers=me, json={"lesson": "toan2.a3", "status": "COMPLETED"})
    assert states(client, me)["a3"] == "LOCKED"


def test_every_required_game_opens_the_next_lessons_an_optional_one_never_holds_them_back(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    first = complete(client, me, "a1", "defense")
    assert first["session"]["status"] == "completed" and first["unlocked"] == []  # math_bridge is still required
    assert first["session"]["catalog"]["next"] == {"key": "toan2.a2", "title": "Bài A2", "ready": True, "locked": True}
    assert states(client, me)["a1"] == "IN_PROGRESS" and states(client, me)["a3"] == "LOCKED"
    second = complete(client, me, "a1", "math_bridge")  # the optional Ghép phép tính is never played
    assert opened(second) == {"a2", "a3"}
    assert second["session"]["catalog"]["next"]["locked"] is False  # the result leads on only now
    assert {u["source"] for u in second["unlocked"]} == {"completed"} and {u["trigger"] for u in second["unlocked"]} == {"toan2.a1"}
    a3 = next(u for u in second["unlocked"] if u["key"] == "toan2.a3")
    assert a3["lesson"] == "toan2.a3" and a3["chapter_title"] == "Khu A" and a3["subject_name"] == "Toán"
    seen = states(client, me)
    assert seen["a1"] == "COMPLETED" and seen["a2"] == seen["a3"] == "UNLOCKED" and seen["a5"] == "LOCKED"
    # What has just opened can be played at once, and is shown as new until the app says it was celebrated.
    assert start(client, me, "toan2.a3", "math_bridge")["catalog"]["lesson"] == "toan2.a3"
    detail = client.get("/api/learning/lesson-catalog/toan2.a1", headers=me).json()
    assert [(g["game"], g["required"], g["status"]) for g in detail["games"]] == [
        ("defense", True, "COMPLETED"), ("math_bridge", True, "COMPLETED"), ("match", False, "UNLOCKED")]
    assert detail["progress"]["games_total"] == 2 and detail["progress"]["percent"] == 100
    cards = {x["lesson_id"]: x for x in subject(client, me)["lessons"]}
    assert cards["toan2.a3"]["celebrate"] and not cards["toan2.a1"]["celebrate"]


def test_a_score_under_the_threshold_completes_the_stage_but_not_the_lesson(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    open_lessons(client, me, "toan2.a5")  # reached: tested on its own threshold (every answer right at the first try)
    session = start(client, me, "toan2.a5", "defense")
    turn = session["open_turns"][0]
    value = right_answer(turn)
    wrong = answer(client, me, session["id"], turn["turn_id"], value + 1 if isinstance(value, int) else f"{value}9").json()
    assert wrong["result"]["correct"] is False
    session = wrong["session"]
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        session = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()["session"]
    done = client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={}).json()
    assert done["session"]["status"] == "completed" and done["unlocked"] == []
    detail = client.get("/api/learning/lesson-catalog/toan2.a5", headers=me).json()
    assert detail["games"][0]["progress"]["completed"] == 1 and not detail["games"][0]["progress"]["passed"]
    assert detail["content_status"] == "IN_PROGRESS"


def test_a_tutorial_or_a_stage_left_unfinished_opens_nothing(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    assert client.post("/api/learning/tutorials/defense", headers=me, json={}).status_code in (200, 201)
    session = start(client, me, "toan2.a1", "defense")
    turn = session["open_turns"][0]
    answer(client, me, session["id"], turn["turn_id"], right_answer(turn))
    client.post(f"/api/learning/sessions/{session['id']}/abandon", headers=me, json={"reason": "user_ended"})
    assert states(client, me)["a3"] == "LOCKED" and states(client, me)["a1"] == "IN_PROGRESS"
    assert client.post("/api/learning/progress/sync", headers=me).json()["unlocked"] == []


def test_playing_again_or_completing_twice_never_opens_or_rewards_twice(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    complete(client, me, "a1", "defense")
    done = complete(client, me, "a1", "math_bridge")
    assert opened(done) == {"a2", "a3"}
    # A retry of the same `complete` (or another device finishing it) is a replay: same unlocks, nothing more.
    again = client.post(f"/api/learning/sessions/{done['session']['id']}/complete", headers=me, json={}).json()
    assert again["replayed"] and opened(again) == {"a2", "a3"}
    celebrate_all(client, me)
    replay = complete(client, me, "a1", "defense")  # a completed lesson played again for review
    assert replay["unlocked"] == [] and replay["session"]["reward"]["status"] == "already_claimed"
    keys = [r.content_key for r in unlock_rows()]
    assert len(keys) == len(set(keys)) == 4  # a, a1, a2, a3: each stored once


def test_a_lost_result_is_caught_up_and_celebrated_once(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    complete(client, me, "a1", "defense")
    complete(client, me, "a1", "math_bridge")  # its response never reached the app (no network)
    pending = client.post("/api/learning/progress/sync", headers=me).json()["unlocked"]
    assert {u["key"] for u in pending} == {"toan2.a2", "toan2.a3"}
    ids = [u["id"] for u in pending]
    other = account(client, email="other@example.com", age=8, school_grade="grade2")
    client.post("/api/learning/unlocks/celebrated", headers=other, json={"ids": ids})  # someone else's: never touched
    assert len(client.post("/api/learning/progress/sync", headers=me).json()["unlocked"]) == 2
    assert client.post("/api/learning/unlocks/celebrated", headers=me, json={"ids": ids}).json() == {"celebrated": sorted(ids)}
    assert client.post("/api/learning/unlocks/celebrated", headers=me, json={"ids": ids}).status_code == 200  # idempotent
    assert client.post("/api/learning/progress/sync", headers=me).json()["unlocked"] == []
    assert not any(x["celebrate"] for x in subject(client, me)["lessons"])


def test_two_devices_storing_the_same_unlock_store_it_once(unlock_catalog, client, monkeypatch):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    complete(client, me, "a1", "defense")
    complete(client, me, "a1", "math_bridge")
    user_id = unlock_rows()[0].user_id
    year = unlock_rows()[0].academic_year
    # The other device read the unlocks before this one stored A2 and A3: storing them again must not fail or double.
    stale = [r for r in unlock_rows() if r.content_key not in ("toan2.a2", "toan2.a3")]
    monkeypatch.setattr(lu, "_stored", lambda *a, **k: stale)
    with SessionLocal() as db:
        nodes = lu.sync(db, user_id, "math", 2, year, trigger="toan2.a1")
        db.commit()
    assert nodes["toan2.a3"]["open"]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(LearningUnlock).where(LearningUnlock.content_key == "toan2.a3")) == 1


def test_a_chapter_opens_when_its_required_lessons_are_done_an_empty_one_is_never_completed(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    complete(client, me, "a1", "defense")
    complete(client, me, "a1", "math_bridge")
    complete(client, me, "a3", "math_bridge")
    seen = states(client, me)
    assert seen["a5"] == "UNLOCKED" and seen["a4"] == "LOCKED" and seen["c"] == "LOCKED"  # A4 is still being written
    celebrate_all(client, me)  # A2, A3, A5 were shown
    last = complete(client, me, "a5", "defense")
    # Khu A done (A2 is optional): Khu B has nothing to do and holds nothing back, and opens quietly: there is nothing
    # to celebrate or go to yet. Khu C (free) opens with C1 and C2.
    assert opened(last) == {"c", "c1", "c2"}
    assert unlock_rows(content_key="toan2.khu_b")[0].celebrated_at is not None
    assert last["unlocked"][0]["type"] == "chapter"  # an area first: the app names it
    seen = states(client, me)
    assert seen["a"] == "COMPLETED" and seen["b"] == "UNLOCKED" and seen["c"] == "UNLOCKED" and seen["c3"] == "LOCKED"
    chapter_c = next(u for u in last["unlocked"] if u["key"] == "toan2.khu_c")
    assert chapter_c["lesson"] == "toan2.c1"  # "Khám phá ngay" leads to its first lesson
    # Two branches: C3 opens only once both C1 and C2 are completed.
    assert opened(complete(client, me, "c1", "defense")) >= set() and states(client, me)["c3"] == "LOCKED"
    assert "c3" in opened(complete(client, me, "c2", "math_bridge"))
    locked = client.get("/api/learning/unlock-map?subject=math", headers=me).json()
    assert next(c for c in locked["chapters"] if c["key"] == "toan2.khu_b")["required_total"] == 0


def test_content_added_or_withdrawn_later_never_closes_what_was_open(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    for key, game in (("a1", "defense"), ("a1", "math_bridge"), ("a3", "math_bridge"), ("a5", "defense")):
        complete(client, me, key, game)
    celebrate_all(client, me)
    assert states(client, me)["c"] == "UNLOCKED"
    # An admin finishes writing A4 (a new required lesson of the completed Khu A) and withdraws A3.
    data = math_file()
    lessons = data["chapters"][0]["lessons"]
    lessons[3] = {**_lesson("a4", "Bài A4", BRIDGE), "order": 4}
    lessons[2] = {**_planned("a3", "Bài A3"), "order": 3}
    unlock_catalog(data)
    seen = states(client, me)
    assert seen["c"] == "UNLOCKED" and seen["c1"] == "UNLOCKED"  # never locked again
    assert seen["a"] == "IN_PROGRESS" and seen["a4"] == "UNLOCKED" and seen["a3"] == "LOCKED"  # A4 waits for A1 only now
    news = client.post("/api/learning/progress/sync", headers=me).json()["unlocked"]
    assert [(u["key"], u["source"]) for u in news] == [("toan2.a4", "progress")]


def test_a_lesson_withdrawn_before_it_was_celebrated_is_not_announced(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    complete(client, me, "a1", "defense")
    assert opened(complete(client, me, "a1", "math_bridge")) == {"a2", "a3"}
    data = math_file()
    data["chapters"][0]["lessons"][2] = {**_planned("a3", "Bài A3"), "order": 3}
    unlock_catalog(data)
    # A3 is not announced; A5, which now follows A1 directly, has really opened.
    assert {u["key"] for u in client.post("/api/learning/progress/sync", headers=me).json()["unlocked"]} == {"toan2.a2", "toan2.a5"}


def test_each_school_year_keeps_its_own_unlocks(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    subject(client, me)
    complete(client, me, "a1", "defense")
    complete(client, me, "a1", "math_bridge")
    year = subject(client, me)["academic_year"]
    with SessionLocal() as db:  # the school year ends (education.py): last year's results and unlocks stay that year's
        for s in db.scalars(select(LearningSession)):
            s.academic_year = year - 1
        for u in db.scalars(select(LearningUnlock)):
            u.academic_year = year - 1
        db.commit()
    assert states(client, me)["a3"] == "LOCKED"  # this year starts from its first lesson
    assert {r.content_key for r in unlock_rows(academic_year=year - 1)} == {"toan2.khu_a", "toan2.a1", "toan2.a2", "toan2.a3"}
    assert {r.content_key for r in unlock_rows(academic_year=year)} == {"toan2.khu_a", "toan2.a1"}


def test_learners_who_studied_before_unlocks_were_stored_keep_what_they_reached(unlock_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    open_lessons(client, me, "toan2.a5")
    session = start(client, me, "toan2.a5", "defense")  # played when every lesson was open
    client.post(f"/api/learning/sessions/{session['id']}/abandon", headers=me, json={"reason": "user_ended"})
    with SessionLocal() as db:
        db.query(LearningUnlock).delete()  # as before this feature
        db.commit()
    seen = states(client, me)
    assert seen["a5"] == "IN_PROGRESS" and seen["a1"] == "UNLOCKED" and seen["a3"] == "UNLOCKED"  # up to where they were
    assert seen["c"] == "LOCKED"  # beyond it, the rules
    assert {r.source for r in unlock_rows(content_key="toan2.a3")} == {"migration"}
    assert client.post("/api/learning/progress/sync", headers=me).json()["unlocked"] == []  # nothing to celebrate


# ---------- the rules themselves ----------

def test_the_unlock_graph_has_no_loop_and_rules_are_validated(unlock_catalog):
    path = lc.unlock_path("math", 2)
    assert [(x["key"], x["after"]) for x in path[0]["lessons"]] == [
        ("toan2.a1", None), ("toan2.a2", "toan2.a1"), ("toan2.a3", "toan2.a1"), ("toan2.a4", "toan2.a3"), ("toan2.a5", "toan2.a3")]
    assert path[1]["needs"] == ["toan2.a1", "toan2.a3", "toan2.a5"] and path[2]["needs"] == path[1]["needs"]
    assert lc.find_cycle(lc.unlock_edges(path)) is None
    # Ordered so that A1 comes after A3 while A1 requires… A3 requires A1 (file order): the rules would go round.
    data = math_file()
    data["chapters"][0]["lessons"][0]["order"] = 9
    data["chapters"][0]["lessons"][2].update(requires=["toan2.a1"], requires_note="A3 sau A1.")
    loop = lc.find_cycle(lc.unlock_edges(lc._unlock_path([c for c in data["chapters"] if c["grade"] == 2])))
    assert loop and loop[0] == loop[-1]
    with pytest.raises(lc.ContentError, match="loop"):
        unlock_catalog(data)
        lc.catalog()
    unlock_catalog(math_file())

    def problems(change) -> list[str]:
        data = math_file()
        change(data)
        return lc.validate_file(data)

    assert problems(lambda d: None) == []
    assert problems(lambda d: d["chapters"][0].update(progression="random"))
    assert problems(lambda d: d["chapters"][0]["lessons"][0]["games"][0].update(optional="yes"))
    assert any("at least one game is required" in p for p in problems(
        lambda d: [g.update(optional=True) for g in d["chapters"][0]["lessons"][2]["games"]]))
    other_grade = math_file()
    other_grade["chapters"].insert(0, {"key": "toan3.x", "grade": 3, "order": 0, "title": "Lớp 3", "lessons": [
        {**_lesson("a0", "Bài lớp 3", DEFENSE), "key": "toan3.a0"}]})
    other_grade["chapters"][1]["lessons"][0].update(requires=["toan3.a0"], requires_note="Bài lớp 3 trước.")
    assert any("not a lesson of grade 2" in p for p in lc.validate_file(other_grade))


def test_subjects_whose_lessons_do_not_build_on_each_other_open_at_once():
    """The bundled catalog: a new learner opens every ready lesson of these subjects, in every chapter; the other
    subjects still open in order."""
    _reset()
    subjects = lc.catalog()["subjects"]
    free = {code for code, data in subjects.items() if data.get("progression") == "free"}
    assert free == {"music", "fine_arts", "pe", "experience"}

    def open_and_ready(code: str) -> tuple[int, int]:
        opened = ready = 0
        for grade in lc.GRADES:
            path = lc.unlock_path(code, grade)
            nodes = lu.evaluate(path, {}, set())
            for x in (x for c in path for x in c["lessons"] if x["ready"]):
                ready += 1
                opened += nodes[x["key"]]["open"]
        return opened, ready

    for code in free:
        opened, ready = open_and_ready(code)
        assert opened == ready > 0, code
    opened, ready = open_and_ready("math")
    assert opened < ready


def test_a_free_subject_still_keeps_a_lessons_own_prerequisite_and_never_counts_nothing_as_done():
    data = math_file()
    path = lc._unlock_path(data["chapters"], True)
    nodes = lu.evaluate(path, {}, set())
    assert nodes["toan2.a5"]["open"] and nodes["toan2.khu_c"]["open"] and nodes["toan2.c1"]["open"]
    assert not nodes["toan2.c3"]["open"]  # requires C1 and C2
    assert not nodes["toan2.a4"]["open"]  # still being written
    assert nodes["toan2.khu_b"]["status"] == "UNLOCKED" and nodes["toan2.c1"]["requirements"] == []  # nothing required: not completed
    assert lc.find_cycle(lc.unlock_edges(path)) is None
    assert lc.validate_file({**data, "progression": "free"}) == []
    assert lc.validate_file({**data, "progression": "random"})


def test_evaluate_alone():
    path = lc._unlock_path(math_file()["chapters"])
    nodes = lu.evaluate(path, {}, set())
    assert [k for k, n in nodes.items() if n["open"]] == ["toan2.khu_a", "toan2.a1"]
    done = {k: {"status": "completed"} for k in ("toan2.a1", "toan2.a3", "toan2.a5")}
    nodes = lu.evaluate(path, done, set())
    assert nodes["toan2.khu_c"]["open"] and nodes["toan2.c2"]["open"] and not nodes["toan2.c3"]["open"]
    assert nodes["toan2.khu_a"]["status"] == "COMPLETED" and nodes["toan2.khu_b"]["status"] == "UNLOCKED"
    # A stored unlock stays open whatever the progress says.
    assert lu.evaluate(path, {}, {("lesson", "toan2.a5")})["toan2.a5"]["open"]
