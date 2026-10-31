"""The math and reading gameplays (app/lesson_games_math.py, app/lesson_games_reading.py): Cầu trục số, Giải toán từng
bước, Thám tử đọc hiểu, Soi câu. Content checks, what the app gets (never the answer), right and wrong answers with
their feedback, what stays in place, and the steps confirmed by the server one at a time — also through the API."""
import json
import random
from fractions import Fraction

import pytest
from sqlalchemy import select

from app import curriculum_games as cg, lesson_catalog as lc, lesson_games as lg, lesson_games_reading as reading
from app.db import SessionLocal
from app.learning_engine import InvalidAnswer
from app.models import LearningSessionItem
from test_subject_games import right

GRADE3, GRADE7 = lc.limits(3), lc.limits(7)


def snap(game: str, task: dict, lim=GRADE7, seed: int = 3) -> tuple[dict, dict]:
    problems: list[str] = []
    assert lg.validate_task(game, task, lim, "t", problems) is not None and not problems, problems
    s = lg.snapshot(game, task, random.Random(seed), "Test")
    return s["prompt"], s["answer"]


def problems_of(game: str, task: dict, lim=GRADE7) -> list[str]:
    problems: list[str] = []
    lg.validate_task(game, task, lim, "t", problems)
    return problems


def play(kind, prompt, expected, answer):
    """One answer as the engine takes it: a right step before the last moves the prompt on (advance), else check."""
    step = lg.advance(kind, prompt, expected, answer)
    if step:
        prompt = {**prompt, **step[0]}
        return prompt, ("step", step[1])
    return prompt, cg.check(kind, prompt, expected, answer)


# ---------------------------------------------------------------------------------------------------------------
# Cầu trục số
# ---------------------------------------------------------------------------------------------------------------

LINE = {"prompt": "Đặt các số lên trục số.", "explanation": "47 gần 50; 74 gần 70.",
        "line": {"from": 0, "to": 100, "step": 10, "snap": 1}, "points": [{"label": "47", "value": 47}, {"label": "74", "value": 74}]}


def test_number_line_ticks_labels_and_the_answer_is_never_sent():
    prompt, expected = snap("number_line", LINE)
    assert prompt["ticks"] == 100 and prompt["major"] == 10
    assert [l["text"] for l in prompt["labels"]] == [str(n) for n in range(0, 101, 10)]
    assert {p["label"] for p in prompt["points"]} == {"47", "74"}
    assert "value" not in json.dumps(prompt) and "tick_of" not in prompt
    assert sorted(expected["tick_of"].values()) == [47, 74]


def test_number_line_right_wrong_direction_and_kept():
    prompt, expected = snap("number_line", LINE)
    ids = {p["label"]: p["id"] for p in prompt["points"]}
    assert cg.check("number_line_place", prompt, expected, [f"{ids['47']}:47", f"{ids['74']}:74"])[0]
    ok, error, _, feedback = cg.check("number_line_place", prompt, expected, [f"{ids['47']}:47", f"{ids['74']}:76"])
    assert not ok and error == "wrong_position" and "“74” đang lệch về bên phải" in feedback and "giữ lại" in feedback
    assert cg.kept("number_line_place", prompt, expected, [f"{ids['47']}:47", f"{ids['74']}:76"]) == [f"{ids['47']}:47"]
    _, _, _, both = cg.check("number_line_place", prompt, expected, [f"{ids['47']}:40", f"{ids['74']}:47"])
    assert "Có 2/2 số chưa đúng chỗ" in both and "giữ lại" not in both


def test_number_line_fractions_negative_numbers_ends_only_and_a_rounding_mark():
    fractions = {"prompt": "Đặt các phân số.", "explanation": "…", "line": {"from": 0, "to": 2, "step": "1/2", "snap": "1/4"},
                 "points": [{"label": "3/4", "value": "3/4"}, {"label": "1 1/2", "value": "3/2"}]}
    prompt, expected = snap("number_line", fractions)
    assert [l["text"] for l in prompt["labels"]] == ["0", "1/2", "1", "3/2", "2"]  # fractions stay fractions
    assert sorted(expected["tick_of"].values()) == [3, 6]
    negative = {"prompt": "Đặt số nguyên.", "explanation": "…", "line": {"from": -5, "to": 5, "step": 5, "snap": 1, "labels": "ends"},
                "points": [{"label": "−3", "value": "-3"}, {"label": "2", "value": 2}]}
    prompt, expected = snap("number_line", negative)
    assert [l["text"] for l in prompt["labels"]] == ["−5", "5"] and sorted(expected["tick_of"].values()) == [2, 7]
    rounding = {"prompt": "Làm tròn 47 đến hàng chục.", "explanation": "…", "line": {"from": 0, "to": 100, "step": 10},
                "marks": [{"label": "47", "value": 47}], "points": [{"label": "Số làm tròn", "value": 50}]}
    prompt, expected = snap("number_line", rounding)
    assert prompt["ticks"] == 10 and prompt["marks"] == [{"at": 0.47, "text": "47"}] and list(expected["tick_of"].values()) == [5]


@pytest.mark.parametrize("answer", [["p1:47"], ["p1:47", "p1:48"], ["p1:47", "p2:101"], ["p9:1", "p2:2"], ["p1:-1", "p2:3"], "47", []])
def test_number_line_malformed_answers_are_refused(answer):
    prompt, expected = snap("number_line", LINE)
    with pytest.raises(InvalidAnswer):
        cg.check("number_line_place", prompt, expected, answer)


@pytest.mark.parametrize("change, message", [
    ({"line": {"from": 10, "to": 0, "step": 1}}, "smaller number to a bigger one"),
    ({"line": {"from": 0, "to": 100, "step": 7}}, "whole number of steps"),
    ({"line": {"from": 0, "to": 1000, "step": 100, "snap": 1}}, "at most 100 positions"),
    ({"points": [{"label": "47,5", "value": "47,5"}]}, "not on a position"),
    ({"points": [{"label": "a", "value": 4}, {"label": "b", "value": 4}]}, "same position"),
    ({"points": [{"label": "a", "value": 4}, {"label": "a", "value": 5}]}, "same label"),
    ({"points": [{"label": "a", "value": "bốn"}]}, "no exact value"),
    ({"line": {"from": 0, "to": 100, "step": 10, "snap": 1, "labels": "every"}}, "labels must be"),
])
def test_the_number_line_validator(change, message):
    assert any(message in p for p in problems_of("number_line", {**LINE, **change}))


# ---------------------------------------------------------------------------------------------------------------
# Giải toán từng bước
# ---------------------------------------------------------------------------------------------------------------

MARBLES = {"problem": "Lan có 48 viên bi. Lan cho em 12 viên rồi chia đều số bi còn lại vào 4 hộp. Mỗi hộp có bao nhiêu viên bi?",
           "numbers": [48, 12, 4], "explanation": "48 − 12 = 36; 36 : 4 = 9.",
           "steps": [{"ask": "Lan còn lại bao nhiêu viên bi?", "expr": "48 - 12", "result": 36, "unit": "viên bi"},
                     {"ask": "Mỗi hộp có bao nhiêu viên bi?", "expr": "r1 : 4", "result": 9, "unit": "viên bi"}]}


def test_step_solver_shows_only_the_first_step_and_the_problems_numbers():
    prompt, expected = snap("step_solver", MARBLES, GRADE3)
    assert prompt["ask"] == "Lan còn lại bao nhiêu viên bi?" and prompt["at_step"] == 1 and prompt["steps"] == 2
    assert [c["text"] for c in prompt["chips"]] == ["48", "12", "4"] and prompt["done"] == []
    assert "Mỗi hộp" not in json.dumps(prompt["ask"]) and "36" not in json.dumps(prompt) and "plan" not in prompt
    assert expected["display"] == "Đáp số: 9 viên bi"


def test_step_solver_steps_are_confirmed_one_at_a_time_and_results_become_chips():
    prompt, expected = snap("step_solver", MARBLES, GRADE3)
    prompt, outcome = play("step_solve", prompt, expected, ["n1", "-", "n2", "36"])
    assert outcome[0] == "step" and "Bước 1 đúng: 48 − 12 = 36 viên bi" in outcome[1]
    assert prompt["at_step"] == 2 and prompt["ask"] == "Mỗi hộp có bao nhiêu viên bi?"
    assert prompt["chips"][-1] == {"id": "r1", "text": "36", "step": 1} and prompt["done"][0]["result"] == "36 viên bi"
    prompt, outcome = play("step_solve", prompt, expected, ["r1", ":", "n3", "9"])
    assert outcome[0] is True


def test_step_solver_wrong_operation_or_wrong_result_and_what_is_kept():
    prompt, expected = snap("step_solver", MARBLES, GRADE3)
    ok, error, _, feedback = cg.check("step_solve", prompt, expected, ["n1", "+", "n2", "60"])
    assert not ok and error == "wrong_operation" and "48 + 12 chưa trả lời câu hỏi" in feedback
    assert cg.kept("step_solve", prompt, expected, ["n1", "+", "n2", "60"]) == []
    ok, error, _, feedback = cg.check("step_solve", prompt, expected, ["n1", "-", "n2", "34"])
    assert not ok and error == "calc" and "chọn đúng rồi" in feedback
    assert cg.kept("step_solve", prompt, expected, ["n1", "-", "n2", "34"]) == ["n1", "-", "n2"]
    assert lg.advance("step_solve", prompt, expected, ["n1", "-", "n2", "34"]) is None  # a wrong step never opens the next


def test_step_solver_addition_and_multiplication_either_way_and_an_accepted_other_way():
    task = {"problem": "Mỗi hàng có 6 cây, có 4 hàng. Trồng thêm 5 cây. Có tất cả bao nhiêu cây?", "numbers": [6, 4, 5],
            "explanation": "…", "steps": [{"ask": "Có bao nhiêu cây trong 4 hàng?", "expr": "6 × 4", "result": 24},
                                          {"ask": "Có tất cả bao nhiêu cây?", "expr": "r1 + 5", "result": 29, "accepted": ["5 + r1"]}]}
    prompt, expected = snap("step_solver", task, GRADE3)
    prompt, outcome = play("step_solve", prompt, expected, ["n2", "×", "n1", "24"])  # 4 × 6
    assert outcome[0] == "step"
    assert cg.check("step_solve", prompt, expected, ["n3", "+", "r1", "29"])[0]


def test_step_solver_decimals_fractions_and_typed_numbers():
    task = {"problem": "Một tấm vải dài 3/4 m, cắt đi 1/4 m. Còn lại bao nhiêu mét?", "numbers": ["3/4", "1/4"], "explanation": "…",
            "steps": [{"ask": "Còn lại bao nhiêu mét vải?", "expr": "3/4 - 1/4", "result": "1/2", "unit": "m"}]}
    prompt, expected = snap("step_solver", task)
    assert [c["text"] for c in prompt["chips"]] == ["3/4", "1/4"] and expected["display"] == "Đáp số: 1/2 m"
    for typed in ("1/2", "2/4", "0,5"):
        assert cg.check("step_solve", prompt, expected, ["n1", "-", "n2", typed])[0], typed
    decimal = {"problem": "Mua 2,5 kg táo giá 40000 đồng một ki-lô-gam. Hết bao nhiêu tiền?", "numbers": ["2,5", 40000],
               "explanation": "…", "steps": [{"ask": "Mua táo hết bao nhiêu tiền?", "expr": "2,5 × 40000", "result": 100000}]}
    prompt, expected = snap("step_solver", decimal)
    assert [c["text"] for c in prompt["chips"]] == ["2,5", "40 000"]
    assert cg.check("step_solve", prompt, expected, ["n1", "×", "n2", "100 000"])[0]


@pytest.mark.parametrize("answer", [["n1", "-", "n2"], ["n1", "^", "n2", "1"], ["n9", "-", "n2", "1"], ["r1", "-", "n2", "1"],
                                    ["n1", "-", "n2", "ba mươi"], "36"])
def test_step_solver_malformed_answers_are_refused(answer):
    prompt, expected = snap("step_solver", MARBLES, GRADE3)
    with pytest.raises(InvalidAnswer):
        cg.check("step_solve", prompt, expected, answer)


@pytest.mark.parametrize("change, message", [
    ({"numbers": [48, 12, 7]}, "7 is not written in the problem"),
    ({"steps": [{"ask": "?", "expr": "48 - 12", "result": 35}]}, "is not 35"),
    ({"steps": [{"ask": "?", "expr": "48 - 5", "result": 43}]}, "neither in numbers nor an earlier result"),
    ({"steps": [{"ask": "?", "expr": "r2 + 4", "result": 4}]}, "not an earlier step"),
    ({"steps": [{"ask": "?", "expr": "12 - 48", "result": -36}]}, "negative result before grade 6"),
    ({"steps": [{"ask": "?", "expr": "48 : 0", "result": 0}]}, "division by zero"),
    ({"steps": [{"ask": "?", "expr": "48 - 12", "result": 36, "accepted": ["12 + 48"]}]}, "does not give 36"),
])
def test_the_step_solver_validator(change, message):
    assert any(message in p for p in problems_of("step_solver", {**MARBLES, **change}, GRADE3)), problems_of("step_solver", {**MARBLES, **change}, GRADE3)


# ---------------------------------------------------------------------------------------------------------------
# Thám tử đọc hiểu
# ---------------------------------------------------------------------------------------------------------------

STORY = {"passage": "Hello! My name is An. I am nine years old. My sister Mi is four. She likes cats.", "lang": "en",
         "question": "How old is An?", "evidence": [3], "clue": "Tìm câu có “years old” nói về An.", "explanation": "I am nine years old.",
         "options": [{"text": "Nine.", "ok": True, "why": "Đúng."}, {"text": "Four.", "ok": False, "why": "Bốn tuổi là Mi."},
                     {"text": "Eight.", "ok": False, "why": "Bài không có số tám."}]}


def test_the_passage_is_split_into_sentences_and_the_options_wait_for_the_clue():
    assert reading.sentences("Mẹ về. “Con ăn cơm chưa?” Mẹ hỏi. Bé gật đầu!") == ["Mẹ về.", "“Con ăn cơm chưa?”", "Mẹ hỏi.", "Bé gật đầu!"]
    prompt, expected = snap("story_detective", STORY)
    assert [s["text"] for s in prompt["sentences"]] == ["Hello!", "My name is An.", "I am nine years old.", "My sister Mi is four.", "She likes cats."]
    assert prompt["phase"] == "find" and "options" not in prompt and "Nine" not in json.dumps(prompt)
    assert expected["evidence"] == ["s3"]


def test_story_wrong_clue_then_the_clue_then_a_wrong_answer_then_the_right_one():
    prompt, expected = snap("story_detective", STORY)
    prompt2, outcome = play("story_evidence", prompt, expected, ["s4"])
    assert outcome[0] is False and outcome[1] == "wrong_evidence" and "years old" in outcome[3] and prompt2 is prompt
    prompt, outcome = play("story_evidence", prompt, expected, ["s3"])
    assert outcome[0] == "step" and prompt["phase"] == "answer" and prompt["found"] == "s3" and len(prompt["options"]) == 3
    four = next(o["id"] for o in prompt["options"] if o["text"] == "Four.")
    ok, error, _, feedback = cg.check("story_evidence", prompt, expected, [four])
    assert not ok and error == "wrong_answer" and feedback.startswith("Bốn tuổi là Mi.")
    assert cg.check("story_evidence", prompt, expected, [expected["right"]])[0]


def test_story_malformed_answers_are_refused():
    prompt, expected = snap("story_detective", STORY)
    for answer in (["s9"], ["s1", "s3"], ["o1"]):
        with pytest.raises(InvalidAnswer):
            play("story_evidence", prompt, expected, answer)


@pytest.mark.parametrize("change, message", [
    ({"evidence": [9]}, "evidence lists the sentence numbers"),
    ({"evidence": [1, 2, 3]}, "at most half the sentences"),
    ({"passage": "Hi. Bye."}, "3–14 sentences"),
    ({"options": [{"text": "A", "ok": True, "why": "x"}, {"text": "B", "ok": True, "why": "y"}]}, "exactly one right option"),
    ({"lang": "fr"}, "lang must be"),
])
def test_the_story_validator(change, message):
    assert any(message in p for p in problems_of("story_detective", {**STORY, **change}))


# ---------------------------------------------------------------------------------------------------------------
# Soi câu
# ---------------------------------------------------------------------------------------------------------------

XRAY = {"prompt": "Tô từ chỉ sự vật và từ chỉ hoạt động.", "roles": ["Sự vật", "Hoạt động"], "explanation": "…",
        "sentence": "[Mẹ|1] đang [nấu|2] [cơm|1] trong [bếp|1]."}


def test_xray_pieces_punctuation_and_no_roles_sent():
    assert reading.pieces("[Những chùm hoa phượng|1] đỏ rực [như|2] [đốm lửa|3].") == [
        ("Những chùm hoa phượng", 1), ("đỏ", 0), ("rực", 0), ("như", 2), ("đốm lửa", 3), (".", None)]
    prompt, expected = snap("sentence_xray", XRAY)
    assert [w["text"] for w in prompt["words"]] == ["Mẹ", "đang", "nấu", "cơm", "trong", "bếp", "."]
    assert prompt["words"][-1].get("fixed") and [r["name"] for r in prompt["roles"]] == ["Sự vật", "Hoạt động"]
    assert "role" not in json.dumps(prompt["words"]) and expected["role_of"]["w3"] == 2


def test_xray_right_wrong_unpainted_and_kept():
    prompt, expected = snap("sentence_xray", XRAY)
    good = ["w1:c1", "w3:c2", "w4:c1", "w6:c1"]
    assert cg.check("sentence_paint", prompt, expected, good)[0]
    ok, error, _, feedback = cg.check("sentence_paint", prompt, expected, ["w1:c1", "w3:c1", "w4:c1", "w6:c1"])
    assert not ok and error == "wrong_role" and "“nấu” chưa phải sự vật." in feedback
    _, _, _, feedback = cg.check("sentence_paint", prompt, expected, ["w1:c1", "w3:c2", "w4:c1"])
    assert "“bếp” cũng cần được tô màu." in feedback
    _, _, _, feedback = cg.check("sentence_paint", prompt, expected, good + ["w2:c2"])
    assert "“đang” không thuộc màu nào" in feedback
    assert cg.kept("sentence_paint", prompt, expected, ["w1:c1", "w3:c1", "w4:c1"]) == ["w1:c1", "w4:c1"]
    _, _, given, feedback = cg.check("sentence_paint", prompt, expected, ["none"])
    assert given == "(chưa tô)" and "Còn 4 chỗ" in feedback


@pytest.mark.parametrize("answer", [["w7:c1"], ["w1:c3"], ["w1:c1", "w1:c2"], ["w1"], "w1:c1", []])
def test_xray_malformed_answers_are_refused(answer):
    prompt, expected = snap("sentence_xray", XRAY)
    with pytest.raises(InvalidAnswer):
        cg.check("sentence_paint", prompt, expected, answer)


@pytest.mark.parametrize("change, message", [
    ({"sentence": "[Mẹ|1] đang nấu cơm."}, "every role is used"),
    ({"sentence": "[Mẹ|1] [nấu|3] [cơm|2]."}, "no highlighter"),
    ({"roles": ["a", "b", "c", "d"]}, "1–3 roles"),
    ({"roles": ["Sự vật"], "sentence": "[Mẹ|1] [cơm|1] [bếp|1]."}, "some pieces must stay unpainted"),
    ({"sentence": "[Mẹ|1] [nấu|2]."}, "3–18 pieces"),
])
def test_the_xray_validator(change, message):
    assert any(message in p for p in problems_of("sentence_xray", {**XRAY, **change}))


# ---------------------------------------------------------------------------------------------------------------
# Through the API: a step confirmed by the server keeps the turn open and moves its prompt on
# ---------------------------------------------------------------------------------------------------------------

def test_the_helper_used_by_the_catalog_tests_plays_every_step():
    prompt, expected = snap("step_solver", MARBLES, GRADE3)
    while True:
        prompt, outcome = play("step_solve", prompt, expected, right("step_solve", prompt, expected))
        if outcome[0] != "step":
            assert outcome[0] is True
            break
    prompt, expected = snap("story_detective", STORY)
    prompt, outcome = play("story_evidence", prompt, expected, right("story_evidence", prompt, expected))
    assert outcome[0] == "step" and cg.check("story_evidence", prompt, expected, right("story_evidence", prompt, expected))[0]
    for game, kind, task in (("number_line", "number_line_place", LINE), ("sentence_xray", "sentence_paint", XRAY)):
        prompt, expected = snap(game, task)
        assert cg.check(kind, prompt, expected, right(kind, prompt, expected))[0]


def test_staged_answers_through_the_api(client):
    from test_lesson_catalog import account, answer

    me = account(client, age=8, school_grade="grade3")
    # Giải bài toán có hai bước tính (lớp 3): every problem has two steps.
    res = client.post("/api/learning/lesson-catalog/toan3.hai_buoc_tinh/play", headers=me, json={"game": "step_solver", "timezone": "Asia/Ho_Chi_Minh"})
    assert res.status_code == 201, res.json()
    session = client.post(f"/api/learning/sessions/{res.json()['id']}/resume", headers=me, json={}).json()["session"]
    turn = session["open_turns"][0]
    assert "plan" not in json.dumps(turn["prompt"])
    with SessionLocal() as db:
        item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn["turn_id"]))
        prompt, expected = json.loads(item.prompt_json), json.loads(item.answer_json)
    assert prompt["steps"] == 2
    result = answer(client, me, session["id"], turn["turn_id"], right("step_solve", prompt, expected)).json()
    assert result["result"]["correct"] and not result["result"]["resolved"] and result["result"]["feedback"].startswith("Bước 1 đúng")
    again = next(t for t in result["session"]["open_turns"] if t["turn_id"] == turn["turn_id"])
    assert again["prompt"]["at_step"] == 2 and again["prompt"]["chips"][-1]["id"] == "r1"
