"""Curriculum games (Ghép chữ, Thám tử chính tả, Phân loại cùng pet, Lập trình đường đi): content, rules, the programme
of a grade, and whole stages through the API."""
import itertools
import json
import random
from collections import deque

import pytest
from sqlalchemy import select

from app import curriculum, curriculum_games as cg
from app.learning import weakness
from app.learning_engine import InvalidAnswer
from app.models import LearningSessionItem, User
from conftest import bearer, login, register

_ids = itertools.count()


def eid() -> str:
    return f"cur-{next(_ids):08d}"


# ---------- content ----------

@pytest.mark.parametrize("game", cg.GAMES)
def test_content_files_are_valid_and_complete(game):
    data = cg.bank(game)  # raises ContentError for any problem
    entries = data.get("items") or data.get("sets") or data.get("levels")
    for entry in entries:
        for field in ("key", "curriculum", "subject", "topic", "difficulty", "version"):
            assert entry.get(field) not in (None, ""), (entry["key"], field)
        assert entry.get("explanation") or entry.get("cards"), entry["key"]


def test_the_validator_refuses_wrong_content():
    good = cg.bank("spelling_detective")["items"][0]
    twice = {**good, "sentence": f"{good['sentence']} {good['right']}."}
    assert cg.validate("spelling_detective", {"items": [twice]})
    assert cg.validate("spelling_detective", {"items": [{**good, "options": [good["right"]]}]})
    level = cg.bank("code_path")["levels"][0]
    assert cg.validate("code_path", {"levels": [{**level, "solution": ["forward"]}]})  # does not reach the goal
    assert cg.validate("code_path", {"levels": [{**level, "max_blocks": 1}]})
    word = cg.bank("word_builder")["items"][0]
    assert cg.validate("word_builder", {"items": [{**word, "answer": "khác"}]})


def test_word_pieces_are_never_shown_in_the_right_order():
    for item in cg.bank("word_builder")["items"]:
        for seed in range(5):
            snap = cg.stage_items("word_builder", item["grades"][0], seed, {}, weakness, [f"word_builder.{item['key']}"])[0]
            assert [t["text"] for t in snap["prompt"]["tiles"]] != item["pieces"]


def _shortest_without_loops(level: dict) -> int:
    """Fewest forward/turn blocks that reach the goal (breadth-first search over position and facing)."""
    walls = {tuple(w) for w in level["walls"]}
    start = (level["start"]["x"], level["start"]["y"], level["start"]["dir"])
    seen, queue = {start}, deque([(start, 0)])
    while queue:
        (x, y, facing), n = queue.popleft()
        for move in ("forward", "left", "right"):
            if move == "forward":
                nx, ny, nf = x + cg.STEP[facing][0], y + cg.STEP[facing][1], facing
                if not (0 <= nx < level["cols"] and 0 <= ny < level["rows"]) or (nx, ny) in walls:
                    continue
                if (nx, ny) == (level["goal"]["x"], level["goal"]["y"]):
                    return n + 1
            else:
                nx, ny, nf = x, y, cg.TURN[move][facing]
            if (nx, ny, nf) not in seen:
                seen.add((nx, ny, nf))
                queue.append(((nx, ny, nf), n + 1))
    raise AssertionError("unreachable goal")


def test_every_level_is_solvable_and_the_loop_levels_need_a_loop():
    for level in cg.bank("code_path")["levels"]:
        assert cg.run_program(level, level["solution"])["ok"]
        shortest = _shortest_without_loops(level)
        if level["tier"] == "basic":
            assert shortest <= level["max_blocks"], level["key"]
        else:  # Trung cấp, Nâng cao: without "Lặp lại" the program cannot fit
            assert shortest > level["max_blocks"], level["key"]


# ---------- rules ----------

def snap_of(game, band=None, key=None):
    data = cg.bank(game)
    if game == "sorting":
        s = data["sets"][0]
        return cg.stage_items(game, s["grades"][0], 1, {}, weakness, [f"sorting.{s['key']}.{s['cards'][0]['key']}"])[0]
    entry = (data.get("items") or data.get("levels"))[0] if key is None else next(
        e for e in (data.get("items") or data.get("levels")) if e["key"] == key)
    return cg.stage_items(game, band or 1, 1, {}, weakness, [f"{game}.{entry['key']}"])[0]


def test_word_build_checks_the_order_and_every_piece():
    snap = snap_of("word_builder", key="l1.meo")
    tiles = {t["text"]: t["id"] for t in snap["prompt"]["tiles"]}
    right = [tiles["m"], tiles["è"], tiles["o"]]
    assert cg.check("word_build", snap["prompt"], snap["answer"], right)[:3] == (True, None, "mèo")
    ok, error, built, feedback = cg.check("word_build", snap["prompt"], snap["answer"], [tiles["o"], tiles["è"], tiles["m"]])
    assert (ok, error, built) == (False, "wrong_order", "oèm") and "đổi thứ tự" in feedback
    for bad in ([tiles["m"], tiles["è"]], [tiles["m"], tiles["m"], tiles["o"]], ["x1", "x2", "x3"], "mèo"):
        with pytest.raises(InvalidAnswer):
            cg.check("word_build", snap["prompt"], snap["answer"], bad)


def test_spelling_detective_finds_the_word_then_its_spelling():
    snap = snap_of("spelling_detective", 2, key="s01")  # "Mẹ mua cho em một quyển xách mới."
    prompt, answer = snap["prompt"], snap["answer"]
    assert "options" not in prompt  # the spellings would show which word is wrong
    wrong = next(t["id"] for t in prompt["tokens"] if t["text"] == "xách")
    other = next(t["id"] for t in prompt["tokens"] if t["text"] == "quyển")
    assert cg.spell_found(prompt, answer, [wrong]) is True
    assert cg.spell_found(prompt, answer, [other]) is False
    ok, error, _, feedback = cg.check("spell_fix", prompt, answer, [other])
    assert (ok, error) == (False, "wrong_word") and "“quyển” viết đúng rồi" in feedback
    fixing = {**prompt, "step": "fix", "found": wrong, "options": answer["options"]}
    by_text = {o["text"]: o["id"] for o in answer["options"]}
    assert cg.check("spell_fix", fixing, answer, [wrong, by_text["sách"]])[:2] == (True, None)
    assert cg.check("spell_fix", fixing, answer, [wrong, by_text["sạch"]])[:2] == (False, "wrong_fix")
    with pytest.raises(InvalidAnswer):
        cg.check("spell_fix", fixing, answer, [other, by_text["sách"]])


def test_sorting_explains_a_wrong_group():
    snap = snap_of("sorting")
    right = snap["answer"]["group"]
    wrong = next(g["id"] for g in snap["prompt"]["groups"] if g["id"] != right)
    assert cg.check("sort_card", snap["prompt"], snap["answer"], right)[0] is True
    ok, error, _, feedback = cg.check("sort_card", snap["prompt"], snap["answer"], wrong)
    assert (ok, error) == (False, "wrong_group") and snap["answer"]["why"] in feedback
    with pytest.raises(InvalidAnswer):
        cg.check("sort_card", snap["prompt"], snap["answer"], "nowhere")


def test_code_path_walks_the_program_and_says_where_it_failed():
    level = next(lv for lv in cg.bank("code_path")["levels"] if lv["key"] == "b4")  # an obstacle right ahead
    snap = cg.stage_items("code_path", "basic", 1, {}, weakness, ["code_path.b4"])[0]
    assert cg.check("code_path", snap["prompt"], snap["answer"], level["solution"])[0] is True
    ok, error, _, feedback = cg.check("code_path", snap["prompt"], snap["answer"], ["forward", "forward"])
    assert (ok, error) == (False, "path_wall") and "bước 2" in feedback
    assert cg.check("code_path", snap["prompt"], snap["answer"], ["left", "forward", "forward", "forward"])[1] == "path_edge"
    assert cg.check("code_path", snap["prompt"], snap["answer"], ["forward"])[1] == "path_short"
    for bad in (["forward"] * 13, ["repeat:3", "forward"], ["repeat:3", "end"], ["jump"], ["repeat:2", "forward", "end"]):
        with pytest.raises(InvalidAnswer):  # too long, unclosed, empty loop, unknown, loops not in the basic level
            cg.check("code_path", snap["prompt"], snap["answer"], bad)
    loop_level = cg.stage_items("code_path", "intermediate", 1, {}, weakness, ["code_path.i1"])[0]
    with pytest.raises(InvalidAnswer):  # loops are not nested
        cg.check("code_path", loop_level["prompt"], loop_level["answer"], ["repeat:2", "repeat:3", "forward", "end", "end"])
    assert cg.check("code_path", loop_level["prompt"], loop_level["answer"], ["repeat:6", "forward", "end"])[0] is True


def test_a_stage_never_repeats_a_question_and_follows_the_band():
    for game in cg.GAMES:
        for band in cg.lesson_bands(game):
            snaps = cg.stage_items(game, band, 3, {}, weakness)
            assert len(snaps) == cg.STAGE_TURNS[game]
            assert len({s["question_key"] for s in snaps}) == len(snaps)
    sorting = cg.stage_items("sorting", 4, 5, {}, weakness)
    assert len({json.dumps(s["prompt"]["groups"]) for s in sorting}) == 1  # one set (one set of groups) per stage
    levels = cg.stage_items("code_path", 7, 5, {}, weakness)  # grade 7 → Trung cấp
    assert all(s["question_key"].startswith("code_path.i") for s in levels)


# ---------- the programme of a grade ----------

MATH = {"defense": {"grade2", "grade3", "grade4", "grade6"}, "math_bridge": {"grade2", "grade3", "grade4", "grade6"}}


def subjects(grade=None, level=None):
    return {s["code"]: (s["name"], [g["id"] for g in s["games"]]) for s in curriculum.programme(grade, level, MATH)["subjects"]}


def test_each_grade_gets_its_subjects_named_as_at_school_and_only_games_with_content():
    assert subjects("grade1") == {"vietnamese": ("Tiếng Việt", ["word_builder"]), "science": ("Tự nhiên và Xã hội", ["sorting"])}
    grade4 = subjects("grade4")
    assert grade4["vietnamese"] == ("Tiếng Việt", ["spelling_detective"])
    assert grade4["math"] == ("Toán", ["defense", "math_bridge"])
    assert grade4["english"] == ("Tiếng Anh", ["word_shooter", "meteor", "gate", "bridge"])
    assert grade4["science"] == ("Khoa học", ["sorting"])
    assert grade4["informatics"] == ("Tin học", ["code_path"])
    assert "math" not in subjects("grade5")  # no Math content for grade 5 yet: not offered
    assert set(subjects("grade8")) == {"english", "informatics"}
    empty = curriculum.programme("preschool", None, MATH)
    assert empty["subjects"] == [] and "Lớp 1" in empty["note"]


def test_learners_outside_school_choose_subjects_and_a_level():
    asked = curriculum.programme("adult", None, MATH)
    assert asked["subjects"] == [] and asked["note"] and [lv["id"] for lv in asked["levels"]] == ["basic", "intermediate", "advanced"]
    assert set(subjects("university", "basic")) == {"math", "english", "informatics"}
    assert curriculum.programme("adult", "advanced", MATH)["label"] == "Người đi làm/Học tự do · Nâng cao"


# ---------- through the API ----------

def account(client, email="aqua@example.com", **profile):
    assert register(client, email=email, **profile).status_code == 201
    return bearer(login(client, email=email).json()["access_token"])


def play(client, me, game, **band):
    res = client.post("/api/learning/play", headers=me, json={"game": game, "timezone": "Asia/Ho_Chi_Minh", **band})
    assert res.status_code == 201, res.json()
    session = res.json()
    return client.post(f"/api/learning/sessions/{session['id']}/resume", headers=me, json={}).json()["session"]


def answer(client, me, session_id, turn_id, value):
    return client.post(f"/api/learning/sessions/{session_id}/answer", headers=me,
                       json={"turn_id": turn_id, "client_event_id": eid(), "answer": value})


def right_answer(db, turn: dict):
    item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn["turn_id"]))
    db.refresh(item)
    expected = json.loads(item.answer_json)
    kind, prompt = item.kind, turn["prompt"]
    if kind == "word_build":
        ids, left = [], list(prompt["tiles"])
        for piece in _pieces(expected["display"], prompt):
            tile = next(t for t in left if t["text"] == piece)
            left.remove(tile)
            ids.append(tile["id"])
        return ids
    if kind == "sort_card":
        return expected["group"]
    if kind == "code_path":
        return expected["solution"]
    return [expected["wrong_id"]] if prompt["step"] == "find" else [prompt["found"], expected["right_option"]]


def _pieces(word: str, prompt: dict) -> list[str]:
    texts = sorted((t["text"] for t in prompt["tiles"]), key=len, reverse=True)
    if prompt["unit"] == "syllable":
        return word.split(" ")
    out, rest = [], word
    while rest:
        piece = next(t for t in texts if rest.startswith(t) and out.count(t) < texts.count(t))
        out.append(piece)
        rest = rest[len(piece):]
    return out


def finish(client, me, db, session):
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        res = answer(client, me, session["id"], turn["turn_id"], right_answer(db, turn))
        assert res.status_code == 200, res.json()
        session = res.json()["session"]
    return client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={}).json()["session"]


def test_catalog_shows_the_programme_of_the_grade_and_another_grade_without_changing_it(client):
    me = account(client, age=7, school_grade="grade2")
    programme = client.get("/api/learning/catalog", headers=me).json()["programme"]
    assert programme["grade"] == "grade2" and programme["label"] == "Lớp 2"
    assert {s["code"] for s in programme["subjects"]} == {"vietnamese", "math", "science"}
    other = client.get("/api/learning/catalog?grade=grade4", headers=me).json()["programme"]
    assert other["grade"] == "grade4" and "english" in {s["code"] for s in other["subjects"]}
    assert client.get("/api/auth/me", headers=me).json()["school_grade"] == "grade2"
    assert client.get("/api/learning/catalog?grade=grade13", headers=me).status_code == 422


def test_ghep_chu_stage_no_hearts_no_clock_mistakes_fixed_and_recorded(client, db):
    me = account(client, age=6, school_grade="grade1")
    session = play(client, me, "word_builder", grade="grade1")
    assert (session["game"], session["required_count"], session["hearts_max"], session["timed"]) == ("word_builder", 10, 0, False)
    turn = session["open_turns"][0]
    assert turn["skill_label"] == "Ghép chữ" and "answer" not in json.dumps(turn["prompt"])
    right = right_answer(db, turn)
    wrong = list(reversed(right))
    res = answer(client, me, session["id"], turn["turn_id"], wrong).json()
    assert res["result"]["correct"] is False and res["result"]["retry_allowed"] and res["result"]["feedback"]
    assert res["result"]["hearts_delta"] == 0 and res["session"]["status"] == "active"
    res = answer(client, me, session["id"], turn["turn_id"], right).json()
    assert res["result"]["outcome"] == "corrected"  # right after a mistake is never "first try"
    done = finish(client, me, db, res["session"])
    assert done["status"] == "completed" and done["reward"]["status"] in ("granted", "daily_task")
    review = client.get("/api/learning/review?subject=vietnamese", headers=me).json()["groups"]
    assert review and review[0]["items"][0]["reason"] == "corrected"
    stage = client.post("/api/learning/review/sessions", headers=me,
                        json={"topic_id": review[0]["topic"]["id"], "timezone": "UTC"})
    assert stage.status_code == 201 and stage.json()["open_turns"][0]["kind"] == "word_build"


def test_tham_tu_chinh_ta_sends_the_spellings_only_after_the_word_is_found(client, db):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me, "spelling_detective")  # the confirmed grade
    turn = session["open_turns"][0]
    assert turn["prompt"]["step"] == "find" and "options" not in turn["prompt"]
    item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn["turn_id"]))
    expected = json.loads(item.answer_json)
    other = next(t["id"] for t in turn["prompt"]["tokens"] if t["id"] != expected["wrong_id"])
    res = answer(client, me, session["id"], turn["turn_id"], [other]).json()
    assert res["result"]["error_type"] == "wrong_word" and "viết đúng rồi" in res["result"]["feedback"]
    res = answer(client, me, session["id"], turn["turn_id"], [expected["wrong_id"]]).json()
    assert res["result"]["correct"] is True and res["result"]["resolved"] is False and "chọn cách viết đúng" in res["result"]["feedback"]
    opened = res["session"]["open_turns"][0]
    assert opened["prompt"]["step"] == "fix" and len(opened["prompt"]["options"]) >= 2
    res = answer(client, me, session["id"], turn["turn_id"], [expected["wrong_id"], expected["right_option"]]).json()
    assert res["result"]["outcome"] == "corrected" and res["result"]["explanation"]


def test_phan_loai_and_lap_trinh_whole_stages_earn_the_stage_reward(client, db):
    me = account(client, age=10, school_grade="grade5")
    sorting = finish(client, me, db, play(client, me, "sorting"))
    assert sorting["status"] == "completed" and sorting["subject"]["code"] == "science"
    code = play(client, me, "code_path")
    assert code["required_count"] == 5 and code["level"]["code"] == "basic"
    turn = code["open_turns"][0]
    for _ in range(3):  # run and fix as often as needed
        res = answer(client, me, code["id"], turn["turn_id"], ["left"]).json()
        assert res["result"]["retry_allowed"] and res["result"]["feedback"]
    done = finish(client, me, db, res["session"])
    assert done["status"] == "completed" and done["reward"]["status"] in ("granted", "capped")  # 5 levels are a whole stage


def test_a_game_is_only_started_for_a_grade_it_has_content_for(client):
    me = account(client, age=6, school_grade="grade1")
    for game, grade in (("word_builder", "grade5"), ("spelling_detective", "grade1"), ("word_shooter", "grade1"),
                        ("code_path", "grade2"), ("sorting", "grade6")):
        body = {"game": game, "timezone": "UTC", "grade": grade}
        res = client.post("/api/learning/play", headers=me, json=body)
        assert res.status_code == 409 and res.json()["code"] == "game_not_available", (game, grade)
    adult = account(client, email="adult@example.com", age=30, school_grade="adult")
    assert client.post("/api/learning/play", headers=adult, json={"game": "code_path"}).status_code == 409  # no level yet
    assert client.post("/api/learning/play", headers=adult, json={"game": "code_path", "level": "advanced"}).status_code == 201


def test_older_apps_still_start_english_games_without_a_grade(client):
    me = account(client)
    assert client.post("/api/learning/play", headers=me, json={"game": "gate"}).status_code == 201
