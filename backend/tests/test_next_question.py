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
from conftest import open_lessons
from test_lesson_catalog import account, answer, right_answer, start

LESSON, GAME = "toan3.lam_tron", "choice"  # Làm tròn số: 6 quiz questions, played in Học tập


def wrong_option(turn: dict) -> str:
    return next(o["id"] for o in turn["prompt"]["options"] if o["id"] != right_answer(turn))


def stored_prompt(turn_id: str) -> dict:
    with SessionLocal() as db:
        return json.loads(db.scalar(select(LearningSessionItem.prompt_json).where(LearningSessionItem.turn_id == turn_id)))


def play(client, me):
    open_lessons(client, me, LESSON)  # reached by completing the lessons before it (test_learning_unlocks.py)
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


# ---------- moving from one question to the next: what the app relies on ----------

def test_every_question_has_its_own_id_and_is_asked_once_unless_it_is_being_practised(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    ids, questions = [], []
    while session["open_turns"]:
        turn = session["open_turns"][0]
        assert turn["turn_id"] not in ids
        ids.append(turn["turn_id"])
        if not turn["practice"]:
            assert turn["prompt"]["question"] not in questions, "the same question twice in a stage"
            questions.append(turn["prompt"]["question"])
        session = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()["session"]
    assert len(questions) == 6 and session["can_complete"]


def test_the_id_of_a_question_stays_the_same_while_it_is_on_screen(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    turn = session["open_turns"][0]
    again = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()
    assert again["open_turns"][0]["turn_id"] == turn["turn_id"] and again["open_turns"][0]["prompt"] == turn["prompt"]


def test_the_same_answer_sent_again_after_a_slow_network_counts_once(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    turn = session["open_turns"][0]
    body = {"turn_id": turn["turn_id"], "answer": wrong_option(turn), "client_event_id": "retry-of-the-same-answer-1"}
    url = f"/api/learning/sessions/{session['id']}/answer"
    first = client.post(url, headers=me, json=body).json()
    second = client.post(url, headers=me, json=body).json()
    assert second["replayed"] and second["result"] == first["result"]
    assert second["session"]["resolved_count"] == first["session"]["resolved_count"] == 1
    assert second["session"]["pending_practice"] == first["session"]["pending_practice"]
    assert second["session"]["open_turns"][0]["turn_id"] == first["session"]["open_turns"][0]["turn_id"]
    # Another tap with another event id on the question already over: refused, nothing counted.
    late = client.post(url, headers=me, json={**body, "client_event_id": "another-tap-on-the-same-turn"})
    assert late.status_code == 409 and late.json()["code"] == "turn_not_open"
    now = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()
    assert now["resolved_count"] == 1 and now["open_turns"][0]["turn_id"] == first["session"]["open_turns"][0]["turn_id"]


def test_coming_back_to_a_stage_restores_where_it_was(client):
    me = account(client, age=8, school_grade="grade3")
    session = play(client, me)
    turn = session["open_turns"][0]
    answered = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()["session"]
    client.post(f"/api/learning/sessions/{session['id']}/pause", headers=me, json={})
    back = client.post(f"/api/learning/sessions/{session['id']}/resume", headers=me, json={}).json()["session"]
    assert back["resolved_count"] == 1 and back["hearts"] == answered["hearts"]
    assert [t["turn_id"] for t in back["open_turns"]] == [t["turn_id"] for t in answered["open_turns"]]  # the next one, not the old one
