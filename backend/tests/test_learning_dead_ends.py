"""Stages and lessons that could not be finished, and what a request could reach around the grade and unlock rules."""
import json

from sqlalchemy import select

from app import lesson_catalog as lc
from app import vocab_lesson as vl
from app.db import SessionLocal
from app.learning import AnswerInput
from app.models import Activity, ExpEvent, LearningLesson, LearningLevel, LearningReviewItem, LearningSession, LearningSessionItem, User
from conftest import open_lessons
from test_education import at, calendar, school, state  # noqa: F401 (fixture)
from test_lesson_catalog import account, answer, finish, fixture_catalog, right_answer, start  # noqa: F401 (fixture)
from test_subject_games import KINDS, right

FAMILY = "ta3.tu_vung_gia_dinh"  # the test catalog's vocabulary lesson


def eid(n=[0]) -> str:
    n[0] += 1
    return f"dead-end-{n[0]:06d}"


def post(client, me, session_id, action, **body):
    return client.post(f"/api/learning/sessions/{session_id}/{action}", headers=me, json=body)


def lesson_id(code: str) -> int:
    with SessionLocal() as db:
        return db.scalar(select(LearningLesson.id).where(LearningLesson.code == code))


def game_of(client, me, key, game) -> dict:
    detail = client.get(f"/api/learning/lesson-catalog/{key}", headers=me).json()
    return next(g for g in detail["games"] if g["game"] == game)


# ---------- answers the request schema refused: a right answer could never be sent ----------

def test_the_right_answer_of_every_question_of_the_catalog_can_be_sent():
    for key, entry in lc.catalog()["lessons"].items():
        if entry["lesson"]["status"] != "ready":
            continue
        for spec in entry["lesson"].get("games", []):
            if spec["game"] not in lc.CONTENT_GAMES:
                continue
            for item in lc.stage_items(key, spec["game"], 1, {}, lambda *_: 1.0, None, version=entry["version"]):
                if item["kind"] in KINDS:
                    AnswerInput(turn_id="abcdefgh", client_event_id="abcdefgh", answer=right(item["kind"], item["prompt"], item["answer"]))


def test_a_wide_angle_is_accepted_and_the_geometry_lesson_can_be_passed(client):
    me = account(client, age=10, school_grade="grade4")
    open_lessons(client, me, "toan4.goc")
    done = finish(client, me, start(client, me, "toan4.goc", "geometry"))  # 120° and 180° among its questions
    assert done["status"] == "completed"
    assert game_of(client, me, "toan4.goc", "geometry")["progress"]["passed"]


# ---------- "Xem đáp án" on the last question ----------

def play_gate(client, me) -> dict:
    res = client.post("/api/learning/play", headers=me, json={"game": "gate", "timezone": "UTC"})
    assert res.status_code == 201, res.json()
    return post(client, me, res.json()["id"], "resume").json()["session"]


def right_option(turn: dict) -> str:
    with SessionLocal() as db:
        return json.loads(db.scalar(select(LearningSessionItem.answer_json).where(LearningSessionItem.turn_id == turn["turn_id"])))["option"]


def wrong_option(turn: dict) -> str:
    return next(o["id"] for o in turn["prompt"]["options"] if o["id"] != right_option(turn))


def up_to_the_last(client, me, session: dict) -> dict:
    while session["resolved_count"] < session["required_count"] - 1:
        turn = session["open_turns"][0]
        session = answer(client, me, session["id"], turn["turn_id"], right_option(turn)).json()["session"]
    return session


def play_right(client, me, session: dict) -> dict:
    while session["open_turns"]:
        turn = session["open_turns"][0]
        session = answer(client, me, session["id"], turn["turn_id"], right_option(turn)).json()["session"]
    return session


def test_revealing_the_last_question_queues_its_re_practice_so_the_stage_can_finish(client):
    me = account(client, age=9, school_grade="grade3")
    session = up_to_the_last(client, me, play_gate(client, me))
    last = session["open_turns"][0]
    res = post(client, me, session["id"], "reveal", turn_id=last["turn_id"], client_event_id=eid()).json()
    assert res["result"]["practice_added"] is True
    session = res["session"]
    assert [t["practice"] for t in session["open_turns"]] == [True] and not session["can_complete"]
    # Answered wrong it comes back again: the revealed question still owes a right answer.
    turn = session["open_turns"][0]
    res = answer(client, me, session["id"], turn["turn_id"], wrong_option(turn)).json()
    assert res["result"]["practice_added"] is True and not res["session"]["can_complete"]
    session = play_right(client, me, res["session"])
    assert session["can_complete"]
    assert post(client, me, session["id"], "complete").json()["session"]["status"] == "completed"


def test_a_reveal_with_no_re_practice_left_to_give_does_not_hold_the_stage(client):
    me = account(client, age=9, school_grade="grade3")
    session = up_to_the_last(client, me, play_gate(client, me))
    with SessionLocal() as db:
        row = db.get(LearningSession, session["id"])
        row.scoring_json = json.dumps({**json.loads(row.scoring_json), "max_practice_turns": 0})
        db.commit()
    res = post(client, me, session["id"], "reveal", turn_id=session["open_turns"][0]["turn_id"], client_event_id=eid()).json()
    assert res["result"]["practice_added"] is False and res["session"]["open_turns"] == [] and res["session"]["can_complete"]
    assert post(client, me, session["id"], "complete").json()["session"]["status"] == "completed"


# ---------- a lesson's vocabulary game with no new word left ----------

def exhaust(monkeypatch):
    real = vl.build_scope

    def nothing_new(allowed, words, found, *args, **kwargs):  # the whole scope discovered
        sc = real(allowed, words, found, *args, **kwargs)
        sc.found |= {w.canonical for w in sc.core + sc.topic + sc.related + sc.next_level}
        return sc
    monkeypatch.setattr(vl, "build_scope", nothing_new)


def play_words(client, me, session: dict, *, first_try: bool) -> dict:
    while not session["can_complete"]:
        if not session["open_turns"]:
            session = post(client, me, session["id"], "next", count=3).json()["session"]
            continue
        turn = session["open_turns"][0]
        if not first_try:
            assert answer(client, me, session["id"], turn["turn_id"], "zzzzzz").json()["result"]["correct"] is False
        res = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()
        assert res["result"]["correct"], res
        session = res["session"]
    done = post(client, me, session["id"], "complete")
    assert done.status_code == 200, done.json()
    return done.json()["session"]


def test_with_no_new_word_left_a_review_of_the_lessons_own_words_can_pass_the_game(fixture_catalog, client, monkeypatch):
    me = account(client, age=9, school_grade="grade3")
    play_words(client, me, start(client, me, FAMILY, "word_shooter"), first_try=False)  # below 80%: not passed
    assert not game_of(client, me, FAMILY, "word_shooter")["progress"]["passed"]
    exhaust(monkeypatch)

    review = start(client, me, FAMILY, "word_shooter")  # no 409: it would leave the lesson locked for the year
    assert review["kind"] == "review" and review["catalog"]["lesson"] == FAMILY and review["catalog"]["words_review"]
    with SessionLocal() as db:
        served = {json.loads(a)["entry_key"] for a in db.scalars(select(LearningSessionItem.answer_json).where(
            LearningSessionItem.session_id == review["id"]))}
    assert served <= set(lc.game_spec(lc.lesson(FAMILY), "word_shooter")["words"])

    # The 80% rule is the same: a review below it passes nothing.
    assert play_words(client, me, review, first_try=False)["reward"] == {"status": "not_eligible", "exp": 0}
    assert not game_of(client, me, FAMILY, "word_shooter")["progress"]["passed"]

    done = play_words(client, me, start(client, me, FAMILY, "word_shooter"), first_try=True)
    assert done["reward"] == {"status": "not_eligible", "exp": 0}  # a review stage earns no stage reward
    progress = game_of(client, me, FAMILY, "word_shooter")["progress"]
    assert progress["passed"] and progress["stages"] == 1 and progress["completed"] == 1  # its stages are not reviews

    # Passed: nothing more is owed, and there is still nothing new to discover.
    assert start(client, me, FAMILY, "word_shooter", expect=409)["code"] == "vocabulary_exhausted"


def test_a_review_with_new_words_still_left_never_passes_the_game(fixture_catalog, client):
    me = account(client, age=9, school_grade="grade3")
    play_words(client, me, start(client, me, FAMILY, "word_shooter"), first_try=False)
    topic = next(i.topic_id for i in _reviews(client, me))
    res = client.post("/api/learning/review/sessions", headers=me, json={"topic_id": topic, "start_paused": False})
    assert res.status_code == 201, res.json()
    play_words(client, me, res.json(), first_try=True)
    assert not game_of(client, me, FAMILY, "word_shooter")["progress"]["passed"]


def _reviews(client, me) -> list[LearningReviewItem]:
    user_id = client.get("/api/auth/me", headers=me).json()["id"]
    with SessionLocal() as db:
        return list(db.scalars(select(LearningReviewItem).where(LearningReviewItem.user_id == user_id, LearningReviewItem.status == "open")))


# ---------- what a request can start ----------

def math_lesson(level: str) -> int:
    with SessionLocal() as db:
        return db.scalar(select(LearningLesson.id).join(LearningLevel, LearningLevel.id == LearningLesson.level_id).where(
            LearningLevel.code == level, LearningLesson.code.like("math.%"), LearningLesson.status == "published").limit(1))


def start_by_id(client, me, lesson: int):
    return client.post("/api/learning/sessions", headers=me, json={"lesson_id": lesson, "timezone": "UTC"})


def test_a_lesson_of_the_catalog_is_never_started_by_its_id(client):
    me = account(client, age=7, school_grade="grade2")
    res = start_by_id(client, me, lesson_id("cat.toan4.goc.geometry"))  # another grade, and locked
    assert res.status_code == 404 and res.json()["code"] == "lesson_not_found"
    own = account(client, email="own@example.com", age=10, school_grade="grade4")  # not even at its own grade: locks apply
    assert start_by_id(client, own, lesson_id("cat.toan4.goc.geometry")).status_code == 404


def test_a_math_lesson_of_another_grade_is_refused_by_the_backend(client):
    me = account(client, age=9, school_grade="grade3")
    res = start_by_id(client, me, math_lesson("grade6"))
    assert res.status_code == 403 and res.json()["code"] == "grade_locked"
    assert start_by_id(client, me, math_lesson("grade3")).status_code == 201
    # Outside school there is no grade to keep to: every level stays open, as the app offers it.
    adult = account(client, email="adult@example.com", age=30, school_grade="adult")
    assert start_by_id(client, adult, math_lesson("grade6")).status_code == 201


def test_play_goes_by_the_stored_grade_and_the_word_games_stay_open(client):
    me = account(client, age=6, school_grade="grade1")  # English games start at grade 3 (curriculum.py)
    for game in ("gate", "bridge"):
        res = client.post("/api/learning/play", headers=me, json={"game": game})
        assert res.status_code == 409 and res.json()["code"] == "game_not_available", game
    # Ôn tập of a lesson's words at grades 1–2 goes through here: refused only for having nothing to review yet.
    res = client.post("/api/learning/play", headers=me, json={"game": "meteor", "vocab": "review"})
    assert res.status_code == 409 and res.json()["code"] == "nothing_to_review"
    # "Khám phá" after a level's celebration: words of the learner's own grade, whatever the free games' grades are.
    assert client.post("/api/learning/play", headers=me, json={"game": "meteor"}).status_code == 201
    grade3 = account(client, email="three@example.com", age=9, school_grade="grade3")
    assert client.post("/api/learning/play", headers=grade3, json={"game": "gate"}).status_code == 201


# ---------- the daily task and the stage reward ----------

def test_a_stage_completes_the_open_daily_task_even_when_its_subject_was_rewarded_today(client):
    me = account(client, age=9, school_grade="grade3")
    first = play_right(client, me, play_gate(client, me))
    assert post(client, me, first["id"], "complete").json()["session"]["reward"] == {"status": "granted", "exp": 10}
    # The task is picked after the subject's stage reward: the next stage is still the first since then.
    assert client.put("/api/pet", headers=me, json={"pet": "cat", "name": "Mochi"}).status_code == 200
    assert client.put("/api/onboarding/daily-tasks", headers=me, json={"task_ids": ["learning"]}).status_code == 200
    second = play_right(client, me, play_gate(client, me))
    assert post(client, me, second["id"], "complete").json()["session"]["reward"] == {"status": "daily_task", "exp": 10}
    user_id = client.get("/api/auth/me", headers=me).json()["id"]
    with SessionLocal() as db:
        assert db.scalar(select(Activity.id).where(Activity.user_id == user_id, Activity.kind == "quest_learning"))
        assert [e.source for e in db.scalars(select(ExpEvent).where(ExpEvent.user_id == user_id, ExpEvent.source.in_(("task", "learning"))))
                ].count("task") == 1
    third = play_right(client, me, play_gate(client, me))
    assert post(client, me, third["id"], "complete").json()["session"]["reward"] == {"status": "already_claimed", "exp": 0}


# ---------- a promotion and the old grade ----------

def mistake_on_old_lesson(client, me, lesson="toan2.bang_nhan_2") -> dict:
    session = start(client, me, lesson, "defense")
    turn = session["open_turns"][0]
    res = answer(client, me, session["id"], turn["turn_id"], "-1").json()
    assert res["result"]["correct"] is False
    return finish(client, me, res["session"])


def test_a_promotion_takes_the_old_grades_questions_off_the_review_list_and_keeps_them_in_the_archive(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    mistake_on_old_lesson(client, me)
    assert client.get("/api/learning/review", headers=me).json()["total"] >= 1

    school.t = at(2027, 9, 2)
    assert state(client, me)["grade"] == "grade3"
    assert client.get("/api/learning/review", headers=me).json() == {"groups": [], "total": 0}
    for subject in client.get("/api/learning/catalog", headers=me).json()["subjects"]:
        assert not any(t["review_count"] for t in subject["topics"])
    year = client.get("/api/education/archives/2026", headers=me).json()
    assert any(m["lesson"] == "toan2.bang_nhan_2" for m in year["mistakes"])  # nothing is lost: it is in that year


def test_repeating_a_grade_keeps_its_review_list(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    mistake_on_old_lesson(client, me)
    user_id = client.get("/api/auth/me", headers=me).json()["id"]
    with SessionLocal() as db:
        from app.models import UserEducationProfile
        db.get(UserEducationProfile, user_id).hold_next_promotion = True
        db.commit()
    school.t = at(2027, 9, 2)
    assert state(client, me)["grade"] == "grade2"
    assert client.get("/api/learning/review", headers=me).json()["total"] >= 1


def test_an_open_vocabulary_word_stays_on_the_review_list_across_a_promotion(client, school):
    me = account(client, age=9, school_grade="grade3")
    res = client.post("/api/learning/play", headers=me, json={"game": "meteor", "timezone": "UTC"})
    session = post(client, me, res.json()["id"], "resume").json()["session"]
    turn = session["open_turns"][0]
    assert post(client, me, session["id"], "reveal", turn_id=turn["turn_id"], client_event_id=eid()).status_code == 200
    assert post(client, me, session["id"], "abandon").status_code == 200
    school.t = at(2027, 9, 2)
    assert state(client, me)["grade"] == "grade4"
    assert client.get("/api/learning/review", headers=me).json()["total"] == 1  # the word bank is not one grade's content


# ---------- Kho lưu trữ: each game of a lesson has its own reviews ----------

def test_an_open_archive_review_belongs_to_its_own_game(fixture_catalog, client, school):
    me = account(client, age=7, school_grade="grade2")
    lesson = "toan2.bang_nhan_2"
    finish(client, me, start(client, me, lesson, "defense"))
    school.t = at(2027, 9, 2)
    assert state(client, me)["grade"] == "grade3"
    res = client.post(f"/api/education/archives/2026/lessons/{lesson}/play", headers=me, json={"game": "match", "timezone": "UTC"})
    assert res.status_code == 201, res.json()
    games = {g["game"]: g["review"] for g in client.get(f"/api/education/archives/2026/lessons/{lesson}", headers=me).json()["games"]}
    assert games["match"]["open_session"] == res.json()["id"] and games["match"]["stages"] == 1
    assert games["defense"]["open_session"] is None and games["defense"]["stages"] == 0


def test_a_verified_grade_correction_leaves_the_review_list_at_the_right_grade(client, db, monkeypatch):
    from app.config import settings
    from app.models import LearningLesson, LearningReviewItem, LearningTopic, User
    from sqlalchemy import select
    monkeypatch.setattr(settings, "admin_emails", "admin@example.com")
    admin = account(client, email="admin@example.com")
    me = account(client, age=9, school_grade="grade3")
    user = db.scalar(select(User).where(User.email != "admin@example.com").order_by(User.id.desc()))
    lesson = db.get(LearningLesson, math_lesson("grade3"))
    db.add(LearningReviewItem(user_id=user.id, subject_id=db.get(LearningTopic, lesson.topic_id).subject_id, topic_id=lesson.topic_id, lesson_id=lesson.id,
                              question_key="q1", skill_key="s1", label="Câu 1", reason="wrong", status="open"))
    db.commit()
    res = client.post(f"/api/admin/education/users/{user.id}/grade", headers=admin,
                      json={"grade": "grade6", "reason": "Phụ huynh xác nhận khai sai lớp", "verification": "TICKET-123"})
    assert res.status_code == 200, res.json()
    db.expire_all()
    assert db.scalar(select(LearningReviewItem.status)) == "archived"
