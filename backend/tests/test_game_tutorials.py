"""Interactive game tutorials (app/game_tutorials.py): every game has its own tutorial, built from its own content
builders and checked by its own checker, and playing one never counts as learning (no session, no EXP, no hearts)."""
import json

import pytest
from sqlalchemy import func, select

from app import game_tutorials as gt
from app.learning import GameId
from app.learning_engine import answer_key
from app.models import LearningEvent, LearningSession, LearningTutorialView
from together import person


@pytest.fixture()
def me(client):
    return person(client, "Mai").headers


def solve(item: dict):
    """The right answer of a demo item, as the app sends it."""
    kind, prompt, answer = item["kind"], item["prompt"], item["answer"]
    if kind in ("vocab_typing", "word_spelling"):
        return answer["accepted"][0]
    if kind == "gate_choice":
        return answer["option"]
    if kind == "compare":
        return answer["value"]
    if kind in ("math_input", "missing_number"):
        return answer["value"]
    if kind == "bridge_order":
        by_text = {t["text"]: t["id"] for t in prompt["tokens"]}
        return [by_text[w] for w in answer["accepted"][0].split()]
    if kind == "word_build":
        tiles = list(prompt["tiles"])
        out, rest = [], answer["accepted"][0]
        while rest:
            tile = next(t for t in tiles if rest.startswith(t["text"]) and t["id"] not in out)
            out.append(tile["id"])
            rest = rest[len(tile["text"]):].lstrip()
        return out
    if kind == "spell_fix":
        return [answer["wrong_id"], answer["right_option"]]
    if kind == "sort_card":
        return answer["group"]
    if kind == "code_path":
        return answer["solution"]
    if kind == "order_steps":
        return answer["order"]
    if kind == "match_pairs":
        return [a + b for a, b in answer["pairs"].items()]
    if kind == "choice_explain":
        return answer["ok"][0]
    if kind == "lab_experiment":
        return [f"{slot}:{parts[0]}" for slot, parts in answer["accept"].items()]
    if kind == "timeline_place":
        return [f"{m}:{e}" for e, m in answer["marker_of"].items()]
    if kind == "sentence_build":
        by_text = {}
        for t in prompt["tiles"]:
            by_text.setdefault(t["text"], t["id"])
        return [by_text[w] for w in answer["accepted"][0]]
    if kind == "geometry_build":
        return ["angle:90" if answer["target"].get("class") == "right" else f"angle:{answer['target']['degrees']}"]
    if kind == "equation_balance":
        return [str(c) for c in answer["coefficients"]]
    raise AssertionError(kind)


def counts(db):
    return db.scalar(select(func.count(LearningSession.id))), db.scalar(select(func.count(LearningEvent.id)))


# --- definitions -------------------------------------------------------------------------------------------------

TUTORED = {"word_shooter", "meteor", "gate", "bridge", "grammar", "defense", "math_bridge", "word_builder", "spelling_detective",
           "sorting", "code_path", "order", "match", "choice", "lab", "timeline", "sentence", "geometry", "balance"}


def test_every_game_has_its_own_valid_tutorial():
    defs = gt.definitions()
    assert TUTORED <= set(defs) <= set(GameId.__args__)
    # A game still without one is reported (logged at startup, 404 tutorial_missing), never given another game's.
    assert set(gt.missing_tutorials()) == set(GameId.__args__) - set(defs)
    for game, d in defs.items():
        assert {i["kind"] for i in d["items"].values()} <= gt.GAME_KINDS[game], game
        assert any(s["expected_action"] == "answer" for s in d["steps"]), f"{game}: no hands-on step"
        for s in d["steps"]:
            assert s["action"] in gt.ACTIONS and s["target"] in gt.TARGETS
            assert s.get("demo_animation", "none") in gt.ANIMATIONS
            assert len(s["instruction"]) <= gt.MAX_INSTRUCTION


def test_every_demo_turn_is_solvable_with_the_games_own_checker():
    for game, d in gt.definitions().items():
        for tid, item in d["items"].items():
            # The spelling detective plays in two steps: the word first.
            if item["kind"] == "spell_fix":
                found = gt.check(d, tid, [item["answer"]["wrong_id"]])
                assert found["correct"] and not found["resolved"] and found["prompt"]["step"] == "fix"
            result = gt.check(d, tid, solve(item))
            assert result["correct"] and result["resolved"], (game, tid, result)
            assert result["score_delta"] == 0 and result["hearts_delta"] == 0


@pytest.mark.parametrize("bad, problem", [
    ({"action": "dance"}, "action must be"),
    ({"target": "everywhere"}, "target must be"),
    ({"demo_animation": "fireworks"}, "demo_animation must be"),
    ({"instruction": "x" * 200}, "instruction is one short line"),
    ({"expected_action": "next"}, "an observe step waits"),
    ({"release": ["nope"]}, "releases unknown demo item"),
])
def test_an_invalid_step_is_refused(bad, problem):
    d = json.loads(gt.DATA.read_text(encoding="utf-8"))["games"]["meteor"]
    d["steps"][1] = {**d["steps"][1], **bad}
    problems: list[str] = []
    gt._validate("meteor", d, problems)
    assert any(problem in p for p in problems), problems


def test_a_tutorial_must_follow_its_games_gameplay_version(monkeypatch):
    d = json.loads(gt.DATA.read_text(encoding="utf-8"))["games"]["defense"]
    monkeypatch.setitem(gt.game_registry.GAMEPLAYS, "defense", {**gt.game_registry.GAMEPLAYS["defense"], "engine_version": 2})
    problems: list[str] = []
    gt._validate("defense", d, problems)
    assert any("engine version" in p for p in problems)


def test_a_tutorial_without_a_hands_on_step_is_refused():
    d = json.loads(gt.DATA.read_text(encoding="utf-8"))["games"]["sorting"]
    d["steps"] = [{"id": "look", "action": "observe", "instruction": "Nhìn", "target": "play", "expected_action": "next",
                   "release": ["t1"]}]
    problems: list[str] = []
    gt._validate("sorting", d, problems)
    assert any("hands-on" in p for p in problems)


# --- API -----------------------------------------------------------------------------------------------------------

def test_the_tutorial_is_served_without_answers(client, me):
    body = client.get("/api/games/meteor/tutorial", headers=me).json()
    assert body["game_id"] == "meteor" and body["game_mode"] == "practice" and body["tutorial_version"] >= 4
    assert [t["kind"] for t in body["demo"]] == ["vocab_typing", "vocab_typing"]
    demo = json.dumps(body["demo"])
    assert "accepted" not in demo and '"answer"' not in demo and "cat" not in demo
    # Falling words shoot as soon as they are typed right: keys of the answers, never the answers.
    first = body["demo"][0]
    assert first["prompt"]["answer_keys"] == [answer_key(first["turn_id"], "cat")]
    assert client.get("/api/games/meteor/tutorial").status_code == 401


def test_unknown_games_and_missing_tutorials_are_told_apart(client, me, monkeypatch, caplog):
    assert client.get("/api/games/chess/tutorial", headers=me).json()["code"] == "game_not_found"
    defs = dict(gt.definitions())
    defs.pop("balance")
    monkeypatch.setattr(gt, "definitions", lambda: defs)
    with caplog.at_level("WARNING", logger="refmi.tutorials"):
        missing = client.get("/api/games/balance/tutorial", headers=me)
    assert missing.status_code == 404 and missing.json()["code"] == "tutorial_missing"
    assert "balance" in caplog.text  # logged for the administrators


def test_checking_a_demo_answer_saves_nothing(client, me, db):
    before_me = client.get("/api/auth/me", headers=me).json()
    before = counts(db)
    version = gt.definitions()["defense"]["tutorial_version"]
    check = lambda answer: client.post("/api/games/defense/tutorial/check", headers=me,
                                       json={"tutorial_version": version, "turn_id": "t1", "answer": answer}).json()["result"]
    wrong = check("8")
    assert not wrong["correct"] and wrong["retry_allowed"] and not wrong["resolved"] and wrong["error_type"]
    right = check("7")
    assert right["correct"] and right["resolved"] and right["explanation"] == "3 + 4 = 7"
    assert right["score_delta"] == 0 and right["hearts_delta"] == 0
    assert counts(db) == before  # no session, no event
    assert client.get("/api/auth/me", headers=me).json() == before_me  # no EXP, no level, nothing
    bad = client.post("/api/games/defense/tutorial/check", headers=me, json={"tutorial_version": version, "turn_id": "t1", "answer": ""})
    assert bad.status_code == 422 and bad.json()["code"] == "invalid_answer_format"
    old = client.post("/api/games/defense/tutorial/check", headers=me, json={"tutorial_version": 1, "turn_id": "t1", "answer": "7"})
    assert old.status_code == 409 and old.json()["code"] == "tutorial_outdated"
    other = client.post("/api/games/defense/tutorial/check", headers=me, json={"tutorial_version": version, "turn_id": "x9", "answer": "7"})
    assert other.status_code == 404


def test_a_reveal_game_resolves_a_wrong_demo_answer_as_a_stage_does(client, me):
    version = gt.definitions()["gate"]["tutorial_version"]
    wrong = client.post("/api/games/gate/tutorial/check", headers=me,
                        json={"tutorial_version": version, "turn_id": "t1", "answer": "o1"}).json()["result"]
    assert wrong["resolved"] and not wrong["correct"] and wrong["correct_options"] == ["o2"] and wrong["explanation"]


def test_the_spelling_detective_demo_plays_its_two_steps(client, me):
    d = gt.definitions()["spelling_detective"]
    item = d["items"]["t1"]
    post = lambda answer: client.post("/api/games/spelling_detective/tutorial/check", headers=me,
                                      json={"tutorial_version": d["tutorial_version"], "turn_id": "t1", "answer": answer}).json()
    right_word = [t["id"] for t in item["prompt"]["tokens"] if t["id"] != item["answer"]["wrong_id"]][0]
    missed = post([right_word])["result"]
    assert not missed["correct"] and missed["retry_allowed"] and missed["feedback"]
    found = post([item["answer"]["wrong_id"]])["result"]
    assert found["correct"] and not found["resolved"] and {o["text"] for o in found["prompt"]["options"]} == {"nước", "lước", "nướt"}
    fixed = post([item["answer"]["wrong_id"], item["answer"]["right_option"]])["result"]
    assert fixed["correct"] and fixed["resolved"]
    assert post([right_word, item["answer"]["right_option"]]).get("code") == "invalid_answer_format"


def test_progress_completed_and_skipped_are_kept_apart(client, me, db):
    d = gt.definitions()["word_shooter"]
    v = d["tutorial_version"]
    progress = lambda: client.get("/api/games/word_shooter/tutorial/progress", headers=me).json()
    assert progress()["required"] and progress()["status"] == "not_started"
    # Left in the middle: still asked for, with the step it was left at.
    left = client.post("/api/games/word_shooter/tutorial/progress", headers=me,
                       json={"tutorial_version": v, "current_step": 1, "status": "in_progress"}).json()
    assert left["required"] and left["status"] == "in_progress" and left["current_step"] == 1
    # Completing needs every hands-on step.
    early = client.post("/api/games/word_shooter/tutorial/complete", headers=me,
                        json={"tutorial_version": v, "gameplay_version": d["gameplay_version"], "steps_done": ["watch"]})
    assert early.status_code == 422 and early.json()["code"] == "steps_missing"
    done = client.post("/api/games/word_shooter/tutorial/complete", headers=me,
                       json={"tutorial_version": v, "gameplay_version": d["gameplay_version"], "steps_done": ["type"]}).json()
    assert done["status"] == "completed" and not done["required"] and done["completed_at"]
    # Watching it again, or skipping it afterwards, never undoes the completion.
    again = client.post("/api/games/word_shooter/tutorial/progress", headers=me,
                        json={"tutorial_version": v, "current_step": 0, "status": "in_progress"}).json()
    assert again["status"] == "completed"
    assert client.post("/api/games/word_shooter/tutorial/progress", headers=me,
                       json={"tutorial_version": v, "status": "skipped"}).json()["status"] == "completed"
    # Skipping another game is recorded as skipped (not completed), and it is no longer asked for.
    skipped = client.post("/api/games/meteor/tutorial/progress", headers=me, json={"tutorial_version": v, "status": "skipped"}).json()
    assert skipped["status"] == "skipped" and not skipped["required"]
    everything = client.get("/api/games/tutorials/progress", headers=me).json()["games"]
    assert set(everything) == set(gt.definitions())
    assert {g for g, p in everything.items() if not p["required"]} == {"word_shooter", "meteor"}
    assert db.scalar(select(func.count(LearningSession.id))) == 0
    # Bad requests.
    assert client.post("/api/games/meteor/tutorial/progress", headers=me,
                       json={"tutorial_version": v, "current_step": 5}).json()["code"] == "step_out_of_range"
    assert client.post("/api/games/meteor/tutorial/progress", headers=me,
                       json={"tutorial_version": v, "game_mode": "challenge"}).status_code == 422
    assert client.post("/api/games/meteor/tutorial/progress", headers=me,
                       json={"tutorial_version": v + 1}).json()["code"] == "tutorial_outdated"


def test_a_new_tutorial_or_a_changed_gameplay_asks_again(client, me, db, monkeypatch):
    d = gt.definitions()["sorting"]
    client.post("/api/games/sorting/tutorial/complete", headers=me,
                json={"tutorial_version": d["tutorial_version"], "gameplay_version": d["gameplay_version"], "steps_done": ["sort"]})
    assert not client.get("/api/games/sorting/tutorial/progress", headers=me).json()["required"]
    changed = {**gt.definitions(), "sorting": {**d, "gameplay_version": d["gameplay_version"] + 1}}
    monkeypatch.setattr(gt, "definitions", lambda: changed)
    assert client.get("/api/games/sorting/tutorial/progress", headers=me).json()["required"]


def test_an_old_guide_counts_until_the_interactive_tutorial_replaces_it(client, me, db):
    from app.learning import TUTORIAL_VERSION
    client.post("/api/learning/tutorials/order", headers=me, json={"version": TUTORIAL_VERSION})
    # The old guide is still finished for older apps, but the interactive tutorial (a newer version) is asked for.
    assert "order" in client.get("/api/learning/tutorials", headers=me).json()["seen"]
    assert client.get("/api/games/order/tutorial/progress", headers=me).json()["required"]
    # A tutorial left in the middle is not finished for older apps either.
    v = gt.definitions()["match"]["tutorial_version"]
    client.post("/api/games/match/tutorial/progress", headers=me, json={"tutorial_version": v, "status": "in_progress"})
    assert "match" not in client.get("/api/learning/tutorials", headers=me).json()["seen"]
    row = db.scalar(select(LearningTutorialView).where(LearningTutorialView.game == "match"))
    assert row.status == "in_progress"


def test_a_landed_demo_target_tells_its_word_and_saves_nothing(client, me, db):
    version = gt.definitions()["meteor"]["tutorial_version"]
    before = counts(db)
    told = client.post("/api/games/meteor/tutorial/check", headers=me,
                       json={"tutorial_version": version, "turn_id": "t2", "event": "miss"}).json()["result"]
    assert told["event"] == "miss" and told["word"]["en"] == "dog" and told["word"]["vi"] == "con chó" and told["hearts_delta"] == 0
    assert counts(db) == before
    gate = gt.definitions()["gate"]["tutorial_version"]
    assert client.post("/api/games/gate/tutorial/check", headers=me,
                       json={"tutorial_version": gate, "turn_id": "t1", "event": "miss"}).status_code == 404
