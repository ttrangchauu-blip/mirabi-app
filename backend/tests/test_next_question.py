"""“Câu tiếp theo” always brings another question (app/learning.py add_practice_turn, issue_turns).

A wrong answer in Học tập that shows the right one (a quiz: Chọn đáp án) queues the same question again to practise, at
the end of the stage. It used to be queued even when nothing else was left: the next turn was then the very question
just explained, with its options in the same order, so “Câu tiếp theo” seemed to show the old question again (and a
second wrong answer queued it once more). A re-practice now always has another question before it, and its options come
in another order."""
import json

from sqlalchemy import select

from app.db import SessionLocal
from app.models import LearningSessionItem
from test_lesson_catalog import account, answer, right_answer, start

LESSON, GAME = "toan3.lam_tron", "choice"  # Làm tròn số: 6 quiz questions, played in Học tập


def wrong_option(turn: dict) -> str:
    return next(o["id"] for o in turn["prompt"]["options"] if o["id"] != right_answer(turn))


def stored_prompt(turn_id: str) -> dict:
    with SessionLocal() as db:
        return json.loads(db.scalar(select(LearningSessionItem.prompt_json).where(LearningSessionItem.turn_id == turn_id)))


def play(client, me):
    session = start(client, me, LESSON, GAME)
    assert session["mode"] == "practice" and session["required_count"] == 6
    return session


def test_a_wrong_answer_is_practised_again_later_never_as_the_next_question(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    first = session["open_turns"][0]
    res = answer(client, me, session["id"], first["turn_id"], wrong_option(first)).json()
    assert res["result"]["correct"] is False and res["result"]["resolved"] and res["result"]["practice_added"]
    nxt = res["session"]["open_turns"]
    assert len(nxt) == 1 and nxt[0]["turn_id"] != first["turn_id"] and not nxt[0]["practice"]
    assert nxt[0]["prompt"]["question"] != first["prompt"]["question"]  # another question, not the one just explained
    # Played on: the re-practice comes last, after every other question, with its options in another order.
    session, seen = res["session"], [first["prompt"]["question"]]
    while session["open_turns"]:
        turn = session["open_turns"][0]
        assert turn["prompt"]["question"] != seen[-1], "the same question twice in a row"
        seen.append(turn["prompt"]["question"])
        if turn["practice"]:
            assert turn["prompt"]["question"] == first["prompt"]["question"] and len(seen) == 7
            assert [o["id"] for o in turn["prompt"]["options"]] != [o["id"] for o in first["prompt"]["options"]]
            assert sorted(o["id"] for o in turn["prompt"]["options"]) == sorted(o["id"] for o in first["prompt"]["options"])
        res = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()
        assert res["result"]["correct"], res
        session = res["session"]
    assert session["can_complete"] and session["resolved_count"] == 6


def test_the_last_question_answered_wrong_goes_to_the_result_not_back_to_itself(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    for _ in range(5):
        turn = session["open_turns"][0]
        session = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()["session"]
    last = session["open_turns"][0]
    res = answer(client, me, session["id"], last["turn_id"], wrong_option(last)).json()
    assert res["result"]["correct"] is False and res["result"]["explanation"] and res["result"]["practice_added"] is False
    assert res["session"]["open_turns"] == [] and res["session"]["can_complete"]  # "Xem kết quả", not the same question


def run(client, me, wrong_at) -> tuple[list[tuple[str, bool]], dict]:
    """Plays a stage; `wrong_at(n, turn)` says whether the n-th question shown (from 1) is answered wrong."""
    session = play(client, me)
    shown = []
    while session["open_turns"]:
        turn = session["open_turns"][0]
        shown.append((turn["prompt"]["question"], turn["practice"]))
        bad = wrong_at(len(shown), turn)
        session = answer(client, me, session["id"], turn["turn_id"], wrong_option(turn) if bad else right_answer(turn)).json()["session"]
        assert len(shown) < 20
    texts = [q for q, _ in shown]
    assert all(a != b for a, b in zip(texts, texts[1:])), texts  # never the same question twice in a row
    return shown, session


def test_two_wrong_answers_are_practised_in_turn_never_back_to_back(client):
    me = account(client, age=8, school_grade="grade3")
    shown, session = run(client, me, lambda n, turn: n in (5, 6))
    assert [p for _, p in shown] == [False] * 6 + [True, True]
    assert [q for q, _ in shown][6:] == [shown[4][0], shown[5][0]] and session["can_complete"]


def test_a_practice_answered_wrong_again_with_nothing_left_is_not_asked_a_third_time(client):
    me = account(client, age=8, school_grade="grade3")
    shown, session = run(client, me, lambda n, turn: n == 5 or turn["practice"])
    assert [p for _, p in shown] == [False] * 6 + [True] and shown[6][0] == shown[4][0] and session["can_complete"]


def test_a_stage_reopened_keeps_its_place(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    first = session["open_turns"][0]
    session = answer(client, me, session["id"], first["turn_id"], right_answer(first)).json()["session"]
    current = session["open_turns"][0]
    client.post(f"/api/learning/sessions/{session['id']}/pause", headers=me, json={"client_event_id": "p-1"})
    again = client.post(f"/api/learning/sessions/{session['id']}/resume", headers=me, json={}).json()["session"]
    assert [t["turn_id"] for t in again["open_turns"]] == [current["turn_id"]] and again["resolved_count"] == 1
    assert stored_prompt(current["turn_id"]) == current["prompt"] or current["prompt"]["question"] == stored_prompt(current["turn_id"])["question"]
