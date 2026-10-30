"""Học tập by lesson: the programme of every grade, the lesson catalog and its validator, and whole stages of a lesson's
games through the API (only that lesson's content, progress per lesson and game, completion, locks, the short
vocabulary stage, self-assessment). The API tests use the small catalog in tests/data/catalog, so they do not depend
on the bundled content; the bundled files are checked on their own."""
import copy
import itertools
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app import lesson_catalog as lc
from app.db import SessionLocal
from app.learning import weakness
from app.learning_engine import InvalidAnswer
from app.models import LearningSessionItem
from conftest import bearer, login, register

FIXTURES = Path(__file__).parent / "data" / "catalog" / "lessons"
_ids = itertools.count()


def eid() -> str:
    return f"lsn-{next(_ids):08d}"


def _reset_caches():
    lc.catalog.cache_clear()
    lc.programme.cache_clear()


@pytest.fixture()
def fixture_catalog(monkeypatch):
    """The test catalog instead of the bundled one, for the app's startup seed and every request."""
    monkeypatch.setattr(lc, "LESSONS_DIR", FIXTURES)
    _reset_caches()
    yield
    _reset_caches()


# ---------- the programme ----------

def names(grade: int) -> list[str]:
    return [s["name"] for s in lc.subjects_for(grade)]


def test_every_grade_lists_its_own_subjects_named_as_at_that_grade():
    assert names(1)[:3] == ["Tiếng Việt", "Toán", "Tiếng Anh"]
    one = {s["code"]: s for s in lc.subjects_for(1)}
    assert one["english"]["type"] == "optional"  # Ngoại ngữ 1 is tự chọn in grades 1–2
    assert {"Đạo đức", "Tự nhiên và Xã hội", "Hoạt động trải nghiệm", "Âm nhạc", "Mĩ thuật", "Giáo dục thể chất"} <= set(names(1))
    assert "Tin học và Công nghệ" not in names(2) and "Tin học và Công nghệ" in names(3)
    assert {"Khoa học", "Lịch sử và Địa lí"} <= set(names(4)) and "Tự nhiên và Xã hội" not in names(4)
    seven = set(names(7))
    assert {"Ngữ văn", "Giáo dục công dân", "Khoa học tự nhiên", "Lịch sử và Địa lí", "Tin học", "Công nghệ",
            "Hoạt động trải nghiệm, hướng nghiệp", "Nội dung giáo dục của địa phương", "Ngoại ngữ 2"} <= seven
    ten = {s["code"]: s["type"] for s in lc.subjects_for(10)}
    assert ten["history"] == "compulsory" and ten["defense"] == "compulsory"  # Thông tư 13/2022
    assert {c for c, t in ten.items() if t == "elective"} >= {"geography", "civics", "physics", "chemistry", "biology",
                                                              "technology", "informatics", "music", "fine_arts"}
    assert "science" not in ten and "history_geography" not in ten
    assert lc.subject_name("civics", 2) == "Đạo đức" and lc.subject_name("civics", 8) == "Giáo dục công dân" \
        and lc.subject_name("civics", 11) == "Giáo dục kinh tế và pháp luật"
    # The same list is never used for two levels of school.
    assert set(names(2)) != set(names(7)) != set(names(11))


def test_subjects_that_depend_on_the_school_or_region_say_why_they_have_no_lessons():
    seven = {s["code"]: s for s in lc.subjects_for(7)}
    for code in ("local", "minority_language", "foreign_language_2"):
        assert seven[code]["unsupported"]
    assert set(lc.electives(11)) == {"geography", "civics", "physics", "chemistry", "biology", "technology", "informatics",
                                     "music", "fine_arts"}
    assert lc.electives(9) == []


# ---------- the validator ----------

def _file(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_the_fixture_catalog_is_valid():
    for path in FIXTURES.glob("*.json"):
        assert lc.validate_file(_file(path.name), path.name) == []


def test_the_validator_refuses_padded_misplaced_or_unclear_lessons():
    good = _file("science.json")

    def problems(change) -> list[str]:
        data = copy.deepcopy(good)
        change(data)
        return lc.validate_file(data)

    lesson = lambda d: d["chapters"][0]["lessons"][0]
    order = lambda d: lesson(d)["games"][0]
    assert problems(lambda d: order(d)["tasks"].append({**order(d)["tasks"][0], "key": "again"}))  # the same question twice
    assert problems(lambda d: order(d)["tasks"].pop())  # 3 tasks: fewer than an order game needs
    assert problems(lambda d: lesson(d).update(title="Bài 3"))  # a number, not a title
    assert problems(lambda d: d["chapters"][0].update(grade=10))  # no "science" in grade 10 (Vật lí, Hoá học, Sinh học)
    long_card = "Cây lớn lên, ra nhiều hoa, hoa kết thành quả, quả chín rồi rơi xuống đất và nảy mầm"
    assert problems(lambda d: order(d)["tasks"][0]["items"].append(long_card))  # too much to read in grade 3
    assert problems(lambda d: order(d)["tasks"][0]["items"].extend(["a", "b"]))  # 6 cards: more than grade 3 handles
    assert problems(lambda d: lesson(d).update(status="planned"))  # a planned lesson publishes no game
    assert problems(lambda d: lesson(d).update(review={"status": "draft"}))  # ready means checked
    assert problems(lambda d: order(d).update(turns=9))  # more turns than questions
    assert problems(lambda d: d.update(organization="textbook"))  # a textbook names its series and every lesson's ref
    choice = copy.deepcopy(_file("experience.json"))
    task = choice["chapters"][0]["lessons"][1]["games"][0]["tasks"][0]
    task["options"][0]["ok"] = False
    assert lc.validate_file(choice)  # a graded question with no acceptable option
    task["options"][0]["ok"] = task["options"][1]["ok"] = True
    assert lc.validate_file(choice)  # every option right: that is a self-assessment


def test_a_lessons_vocabulary_must_come_from_the_bank():
    data = _file("english.json")
    data["chapters"][0]["lessons"][0]["games"][0]["words"].append("no-such-word")
    assert any("vocabulary bank" in p for p in lc.validate_file(data))


def test_the_bundled_catalog_is_valid_and_every_published_game_builds_a_stage_of_its_own_lesson():
    _reset_caches()
    try:
        catalog = lc.catalog()  # raises ContentError for any problem in any file
        games = 0
        for key, entry in catalog["lessons"].items():
            assert entry["lesson"]["title"] and entry["lesson"]["description"]
            assert lc.offer(entry["subject"], entry["grade"]) is not None  # a subject taught in that grade
            for spec in entry["lesson"].get("games", []):
                games += 1
                if spec["game"] not in lc.CONTENT_GAMES:
                    continue  # generated Math problems and bank words: checked by the validator
                for seed in (1, 2):
                    stage = lc.stage_items(key, spec["game"], seed, {}, weakness)
                    assert len(stage) == lc.turns_of(spec), (key, spec["game"])
                    assert len({s["question_key"] for s in stage}) == len(stage)  # never one question twice
                    assert all(s["question_key"].startswith(f"{key}:{spec['game']}:") for s in stage)
        assert games > 500
        # Every grade has lessons to play in its core subjects.
        for grade in lc.GRADES:
            ready = {e["subject"] for e in catalog["lessons"].values() if e["grade"] == grade and e["lesson"]["status"] == "ready"}
            assert {"vietnamese", "math", "civics", "music", "fine_arts", "pe", "experience"} <= ready, grade
    finally:
        _reset_caches()


# ---------- the lesson games' rules ----------

def test_order_match_and_choice_check_answers_and_keep_what_is_right(fixture_catalog):
    order = lc.stage_items("kh3.vong_doi_cay", "order", 3, {}, weakness)
    assert len(order) == 4 and {s["kind"] for s in order} == {"order_steps"}
    snap = order[0]
    right = snap["answer"]["order"]
    assert [c["id"] for c in snap["prompt"]["cards"]] != right  # never shown in the right order
    assert lc.cg.check("order_steps", snap["prompt"], snap["answer"], right)[0]
    wrong = [right[1], right[0], *right[2:]]
    ok, error, _, feedback = lc.cg.check("order_steps", snap["prompt"], snap["answer"], wrong)
    assert not ok and error == "wrong_order" and "2/4" in feedback
    assert lc.cg.kept("order_steps", snap["prompt"], snap["answer"], wrong) == right[2:]
    with pytest.raises(InvalidAnswer):
        lc.cg.check("order_steps", snap["prompt"], snap["answer"], right[:2])

    match = lc.stage_items("toan2.bang_nhan_2", "match", 1, {}, weakness)[0]
    pairs = [a + b for a, b in match["answer"]["pairs"].items()]
    assert lc.cg.check("match_pairs", match["prompt"], match["answer"], pairs)[0]
    lefts = list(match["answer"]["pairs"])
    swapped = [lefts[0] + match["answer"]["pairs"][lefts[1]], lefts[1] + match["answer"]["pairs"][lefts[0]], pairs[2]]
    assert not lc.cg.check("match_pairs", match["prompt"], match["answer"], swapped)[0]
    assert lc.cg.kept("match_pairs", match["prompt"], match["answer"], swapped) == [pairs[2]]
    with pytest.raises(InvalidAnswer):
        lc.cg.check("match_pairs", match["prompt"], match["answer"], [pairs[0], pairs[0], pairs[2]])

    situation = lc.stage_items("tn6.tinh_huong", "choice", 2, {}, weakness)[0]
    ok_id = situation["answer"]["ok"][0]
    other = next(o["id"] for o in situation["prompt"]["options"] if o["id"] != ok_id)
    assert lc.cg.check("choice_explain", situation["prompt"], situation["answer"], ok_id)[0]
    ok, _, _, why = lc.cg.check("choice_explain", situation["prompt"], situation["answer"], other)
    assert not ok and why == situation["answer"]["why"][other]  # every option explains itself
    reflect = lc.stage_items("tn6.tu_danh_gia", "choice", 2, {}, weakness)[0]
    assert all(lc.cg.check("choice_explain", reflect["prompt"], reflect["answer"], o["id"])[0] for o in reflect["prompt"]["options"])


def test_a_stage_only_ever_holds_the_lessons_own_questions(fixture_catalog):
    for seed in range(10):
        keys = {s["question_key"] for s in lc.stage_items("kh3.vong_doi_cay", "sorting", seed, {}, weakness)}
        assert len(keys) == 8 and all(k.startswith("kh3.vong_doi_cay:sorting:") for k in keys)
    assert lc.stage_items("kh3.vong_doi_cay", "match", 1, {}, weakness) == []  # a game the lesson does not publish
    assert lc.stage_items("toan2.bang_nhan_5", "match", 1, {}, weakness) == []  # a planned lesson


# ---------- through the API ----------

def account(client, email="lesson@example.com", **profile):
    assert register(client, email=email, **profile).status_code == 201
    return bearer(login(client, email=email).json()["access_token"])


def start(client, me, key, game, expect=201):
    res = client.post(f"/api/learning/lesson-catalog/{key}/play", headers=me, json={"game": game, "timezone": "Asia/Ho_Chi_Minh"})
    assert res.status_code == expect, res.json()
    if expect != 201:
        return res.json()
    return client.post(f"/api/learning/sessions/{res.json()['id']}/resume", headers=me, json={}).json()["session"]


def right_answer(turn: dict):
    with SessionLocal() as db:
        item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn["turn_id"]))
        expected = json.loads(item.answer_json)
    kind = turn["kind"]
    if kind == "order_steps":
        return expected["order"]
    if kind == "match_pairs":
        return [a + b for a, b in expected["pairs"].items()]
    if kind == "choice_explain":
        return expected["ok"][0]
    if kind == "sort_card":
        return expected["group"]
    if kind in ("vocab_typing", "word_spelling"):
        return expected["display"]
    return expected["value"]


def answer(client, me, session_id, turn_id, value):
    return client.post(f"/api/learning/sessions/{session_id}/answer", headers=me,
                       json={"turn_id": turn_id, "client_event_id": eid(), "answer": value})


def finish(client, me, session, wrong_first=0):
    """Answer every turn right; the first `wrong_first` turns are answered wrong once before."""
    done = 0
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        if done < wrong_first:
            wrong = {"order_steps": lambda: list(reversed(right_answer(turn))),
                     "choice_explain": lambda: next(o["id"] for o in turn["prompt"]["options"] if o["id"] != right_answer(turn))}[turn["kind"]]()
            assert answer(client, me, session["id"], turn["turn_id"], wrong).json()["result"]["correct"] is False
        res = answer(client, me, session["id"], turn["turn_id"], right_answer(turn))
        assert res.status_code == 200, res.json()
        assert res.json()["result"]["correct"], res.json()
        session = res.json()["session"]
        done += 1
    return client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={}).json()["session"]


def test_the_programme_of_the_grade_and_another_grade_without_changing_the_profile(fixture_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    body = client.get("/api/learning/programme", headers=me).json()
    assert body["grade"] == "grade2" and body["is_main"] and body["selection"] is None
    by_code = {s["code"]: s for s in body["subjects"]}
    assert by_code["math"]["ready"] == 2 and by_code["math"]["lessons"] == 3 and by_code["math"]["status"] == "partial"
    assert by_code["vietnamese"]["status"] == "empty" and by_code["vietnamese"]["name"] == "Tiếng Việt"
    other = client.get("/api/learning/programme?grade=grade3", headers=me).json()
    assert other["grade"] == "grade3" and not other["is_main"]
    assert {s["code"]: s for s in other["subjects"]}["science"]["name"] == "Tự nhiên và Xã hội"
    assert client.get("/api/auth/me", headers=me).json()["school_grade"] == "grade2"
    adult = account(client, email="adult@example.com", age=30, school_grade="adult")
    asked = client.get("/api/learning/programme", headers=adult).json()
    assert asked["grade"] is None and asked["note"] and len(asked["grades"]) == 12


def test_thpt_learners_pick_their_electives_and_still_see_every_subject(fixture_catalog, client):
    me = account(client, age=16, school_grade="grade11")
    body = client.get("/api/learning/programme", headers=me).json()
    assert body["selection"]["count"] == 4 and "physics" in body["selection"]["available"]
    assert client.put("/api/learning/programme/selection", headers=me, json={"subjects": ["physics", "math"]}).status_code == 422
    assert client.put("/api/learning/programme/selection", headers=me,
                      json={"subjects": ["physics", "chemistry", "biology", "informatics", "geography"]}).status_code == 422
    assert client.put("/api/learning/programme/selection", headers=me, json={"subjects": ["physics", "informatics"]}).json() == {
        "chosen": ["physics", "informatics"]}
    subjects = {s["code"]: s for s in client.get("/api/learning/programme", headers=me).json()["subjects"]}
    assert subjects["physics"]["selected"] is True and subjects["geography"]["selected"] is False
    assert subjects["math"]["selected"] is None and "history" in subjects  # compulsory ones are not chosen


def test_lessons_by_chapter_with_search_status_and_locks(fixture_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    body = client.get("/api/learning/programme/subjects/math", headers=me).json()
    lessons = {lsn["key"]: lsn for c in body["chapters"] for lsn in c["lessons"]}
    assert [c["title"] for c in body["chapters"]] == ["Phép nhân và phép chia"] and body["organization"] == "topic"
    assert lessons["toan2.bang_nhan_2"]["progress"]["status"] == "not_started"
    assert lessons["toan2.bang_chia_2"]["locked"] and lessons["toan2.bang_chia_2"]["requires_note"]
    assert lessons["toan2.bang_nhan_5"]["status"] == "planned" and lessons["toan2.bang_nhan_5"]["progress"] is None
    found = client.get("/api/learning/programme/subjects/math?q=chia", headers=me).json()
    assert [lsn["key"] for c in found["chapters"] for lsn in c["lessons"]] == ["toan2.bang_chia_2"]
    assert client.get("/api/learning/programme/subjects/history", headers=me).status_code == 404  # not a grade-2 subject
    start(client, me, "toan2.bang_chia_2", "math_bridge", expect=409)  # locked, with its reason
    start(client, me, "toan2.bang_nhan_5", "match", expect=409)  # planned: no game to play
    start(client, me, "toan2.bang_nhan_2", "order", expect=422)  # not a game of this lesson
    assert client.post("/api/learning/lesson-catalog/nope.x/play", headers=me, json={"game": "order"}).status_code == 404


def test_a_lesson_screen_then_its_games_progress_and_completion(fixture_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    detail = client.get("/api/learning/lesson-catalog/toan2.bang_nhan_2", headers=me).json()
    assert detail["subject"]["name"] == "Toán" and detail["grade_label"] == "Lớp 2"
    assert detail["objectives"] and detail["summary"] and detail["examples"][0]["lines"]
    assert [g["title"] for g in detail["games"]] == ["Đường đua phép tính", "Ghép phép tính với kết quả"]
    assert all(g["playable"] for g in detail["games"]) and detail["next"]["key"] == "toan2.bang_chia_2"

    # Bảng nhân 2: every generated problem is a × of the table 2, nothing else.
    session = start(client, me, "toan2.bang_nhan_2", "defense")
    assert session["catalog"]["lesson"] == "toan2.bang_nhan_2" and session["catalog"]["other_games"][0]["game"] == "match"
    with SessionLocal() as db:
        items = db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"])).all()
        assert len(items) == 10 and all(json.loads(i.prompt_json)["expression"].startswith("2 × ") for i in items)
    session = finish(client, me, session)
    assert session["status"] == "completed" and session["reward"]["status"] in ("granted", "daily_task")
    detail = client.get("/api/learning/lesson-catalog/toan2.bang_nhan_2", headers=me).json()
    assert detail["progress"]["status"] == "in_progress"  # one game of two: not completed yet
    assert detail["games"][0]["progress"]["passed"] and detail["games"][0]["progress"]["last"]["first_try"] == 10

    session = finish(client, me, start(client, me, "toan2.bang_nhan_2", "match"))
    assert session["reward"]["status"] == "already_claimed"  # once per subject per day, as every game
    detail = client.get("/api/learning/lesson-catalog/toan2.bang_nhan_2", headers=me).json()
    assert detail["progress"]["status"] == "completed" and detail["progress"]["percent"] == 100
    # Its follow-up is unlocked now, and "Tiếp tục học" points at the lesson last practised.
    assert not client.get("/api/learning/lesson-catalog/toan2.bang_chia_2", headers=me).json()["locked"]
    session = start(client, me, "toan2.bang_chia_2", "math_bridge")
    with SessionLocal() as db:
        items = db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"])).all()
        assert all(json.loads(i.prompt_json)["equation"].endswith(": 2 = " + json.loads(i.answer_json)["c"].__str__())
                   for i in items)
    resume = client.get("/api/learning/programme", headers=me).json()["resume"]
    assert resume["lesson"] == "toan2.bang_chia_2" and resume["open_session"] == session["id"]


def test_completion_needs_enough_right_at_the_first_try(fixture_catalog, client):
    me = account(client, age=9, school_grade="grade3")
    session = finish(client, me, start(client, me, "kh3.vong_doi_cay", "order"), wrong_first=2)  # 2/4 first try
    detail = client.get("/api/learning/lesson-catalog/kh3.vong_doi_cay", headers=me).json()
    order = detail["games"][0]["progress"]
    assert order["completed"] == 1 and not order["passed"] and order["best"] == 50
    assert order["last"]["to_review"] == 2 and order["last"]["attempts"] == 6
    assert detail["games"][0]["review_count"] == 2  # the wrong ones are in Cần ôn
    assert detail["progress"]["status"] == "in_progress"
    review = client.get("/api/learning/review", headers=me).json()
    assert any(g["topic"]["code"] == "kh3.thuc_dong_vat" for g in review["groups"])


def test_changing_the_lesson_changes_the_knowledge(fixture_catalog, client):
    me = account(client, age=9, school_grade="grade3")
    a = start(client, me, "kh3.vong_doi_cay", "sorting")
    with SessionLocal() as db:
        keys = {i.question_key for i in db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == a["id"]))}
    assert keys and all(k.startswith("kh3.vong_doi_cay:sorting:") for k in keys)
    client.post(f"/api/learning/sessions/{a['id']}/abandon", headers=me, json={"reason": "user_ended"})
    b = start(client, me, "kh3.vong_doi_cay", "order")
    assert b["open_turns"][0]["kind"] == "order_steps" and b["catalog"]["game_title"] == "Vòng đời kỳ diệu"


def test_a_short_vocabulary_lesson_says_so_and_still_counts_as_a_stage(fixture_catalog, client):
    me = account(client, age=9, school_grade="grade3")
    detail = client.get("/api/learning/lesson-catalog/ta3.tu_vung_gia_dinh", headers=me).json()
    assert [g["short_stage"] for g in detail["games"]] == [True, True] and detail["games"][0]["turns"] == 8
    session = start(client, me, "ta3.tu_vung_gia_dinh", "word_shooter")
    assert session["required_count"] == 8 and session["catalog"]["short_stage"] and session["game"] == "word_shooter"
    with SessionLocal() as db:
        words = {json.loads(i.answer_json)["entry_key"] for i in db.scalars(
            select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"]))}
    assert words == {"family", "mother", "father", "sister", "brother", "grandmother", "grandfather", "parents"}
    session = finish(client, me, session)
    assert session["status"] == "completed" and session["reward"]["status"] in ("granted", "daily_task")


def test_self_assessment_has_no_wrong_answer_and_is_never_to_review(fixture_catalog, client):
    me = account(client, age=12, school_grade="grade6")
    session = start(client, me, "tn6.tu_danh_gia", "choice")
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        res = answer(client, me, session["id"], turn["turn_id"], turn["prompt"]["options"][-1]["id"]).json()
        assert res["result"]["correct"] and res["result"]["feedback"]
        session = res["session"]
    client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={})
    detail = client.get("/api/learning/lesson-catalog/tn6.tu_danh_gia", headers=me).json()
    assert detail["progress"]["status"] == "completed" and detail["games"][0]["review_count"] == 0


def test_a_wrong_match_keeps_the_right_pairs(fixture_catalog, client):
    me = account(client, age=8, school_grade="grade2")
    session = start(client, me, "toan2.bang_nhan_2", "match")
    turn = session["open_turns"][0]
    right = right_answer(turn)
    a, b, c = right
    wrong = [a[:2] + b[2:], b[:2] + a[2:], c]
    result = answer(client, me, session["id"], turn["turn_id"], wrong).json()["result"]
    assert result["correct"] is False and result["retry_allowed"] and result["kept"] == [c]
    assert answer(client, me, session["id"], turn["turn_id"], ["a1b1"]).status_code == 422  # malformed: not counted


# ---------- the bundled catalog, end to end ----------

def _bundled_answer(turn: dict, session_id: int):
    with SessionLocal() as db:
        item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn["turn_id"]))
        expected, prompt = json.loads(item.answer_json), json.loads(item.prompt_json)
    kind = turn["kind"]
    if kind == "word_build":
        ids, left = [], list(prompt["tiles"])
        pieces = expected["display"].split(" ") if prompt["unit"] == "syllable" else None
        if pieces is None:  # letters: the longest tile that starts the rest (digraphs such as "ch", "ng")
            pieces, rest = [], expected["display"]
            while rest:
                piece = max((t["text"] for t in left if rest.startswith(t["text"]) and t["text"] not in pieces[len(pieces):]), key=len)
                pieces.append(piece)
                rest = rest[len(piece):]
        for piece in pieces:
            tile = next(t for t in left if t["text"] == piece)
            left.remove(tile)
            ids.append(tile["id"])
        return ids
    if kind == "spell_fix":
        return [expected["wrong_id"]] if prompt["step"] == "find" else [prompt["found"], expected["right_option"]]
    if kind == "code_path":
        return expected["solution"]
    if kind in ("math_input", "missing_number"):
        return expected["value"]
    if kind == "compare":
        return expected["value"]
    return right_answer(turn)


def test_every_kind_of_game_plays_through_from_the_grade_to_the_result(client):
    """With the bundled content: the programme of the lesson's grade lists its subject, the subject lists the lesson,
    and a whole stage of each kind of game is played and completed with only that lesson's questions."""
    first = {}
    for key, entry in lc.catalog()["lessons"].items():
        for spec in entry["lesson"].get("games", []):
            if not entry["lesson"].get("requires"):  # a lesson with a prerequisite: locks are tested above
                first.setdefault(spec["game"], (key, entry))
    assert set(first) == set(lc.GAMES)
    for n, (game, (key, entry)) in enumerate(sorted(first.items())):
        me = account(client, email=f"e2e{n}@example.com", age=entry["grade"] + 6, school_grade=f"grade{entry['grade']}")
        subjects = {s["code"]: s for s in client.get("/api/learning/programme", headers=me).json()["subjects"]}
        assert subjects[entry["subject"]]["ready"] >= 1
        listed = client.get(f"/api/learning/programme/subjects/{entry['subject']}", headers=me).json()
        assert key in {lsn["key"] for c in listed["chapters"] for lsn in c["lessons"]}
        session = start(client, me, key, game)
        assert session["catalog"]["lesson"] == key and session["game"] == game
        while not session["can_complete"]:
            turn = session["open_turns"][0]
            res = answer(client, me, session["id"], turn["turn_id"], _bundled_answer(turn, session["id"]))
            assert res.status_code == 200, (game, key, res.json())
            session = res.json()["session"]
        with SessionLocal() as db:
            keys = {i.question_key for i in db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"]))}
        if game in lc.CONTENT_GAMES:
            assert all(k.startswith(f"{key}:{game}:") for k in keys), (game, keys)
        done = client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={}).json()["session"]
        assert done["status"] == "completed", (game, key)
        detail = client.get(f"/api/learning/lesson-catalog/{key}", headers=me).json()
        assert next(g for g in detail["games"] if g["game"] == game)["progress"]["completed"] == 1
