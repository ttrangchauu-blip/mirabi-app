"""Learning games API: sessions, answers, state machine, idempotency, concurrency, ownership, progress and EXP."""
import itertools
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest

from app.learning_engine import VOCAB_HEARTS, VOCAB_STAGE_WORDS
from sqlalchemy import func, select

from together import person

_ids = itertools.count()


def eid() -> str:
    return f"evt-{next(_ids):08d}"


def lesson_id(client, headers, code: str) -> int:
    catalog = client.get("/api/learning/catalog", headers=headers).json()
    return next(l["id"] for s in catalog["subjects"] for l in s["lessons"] if l["code"] == code)


def start(client, headers, code="en.animals.starter", mode="practice", **extra) -> dict:
    body = {"lesson_id": lesson_id(client, headers, code), "mode": mode, "timezone": "Asia/Ho_Chi_Minh", **extra}
    response = client.post("/api/learning/sessions", headers=headers, json=body)
    assert response.status_code == 201, response.json()
    return response.json()


def stored_answer(turn: dict) -> dict:
    """Test-only peek at the server-side answer of a turn."""
    from app.db import SessionLocal
    from app.models import LearningSessionItem
    with SessionLocal() as db:
        item = db.scalar(select(LearningSessionItem).where(LearningSessionItem.turn_id == turn["turn_id"]))
        return json.loads(item.answer_json)


def drawn(session: dict) -> list[dict]:
    """Test-only peek at the words drawn for a session (the app only learns them as they are played)."""
    from app.db import SessionLocal
    from app.models import LearningSessionItem
    with SessionLocal() as db:
        items = db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"],
                                                             LearningSessionItem.practice_of_id.is_(None))
                           .order_by(LearningSessionItem.position))
        return [{"word": a["display"], "level": a.get("level"), "difficulty": a.get("difficulty"), "pick": a.get("pick"),
                 "meaning_vi": a.get("meaning_vi")} for a in (json.loads(i.answer_json) for i in items)]


def order_ids(tokens: list[dict], sentence: str) -> list[str]:
    """Token ids that spell a sentence; pieces may hold several words."""
    words, pool, ids = sentence.lower().split(), list(tokens), []
    while words:
        token = next(t for t in pool if words[:len(t["text"].split())] == t["text"].lower().split())
        pool.remove(token)
        ids.append(token["id"])
        words = words[len(token["text"].split()):]
    return ids


def right(turn: dict):
    answer = stored_answer(turn)
    kind = turn["kind"]
    if kind in ("vocab_typing", "word_spelling"):
        return answer["accepted"][0]
    if kind == "gate_choice":
        return answer["option"]
    if kind == "bridge_order":
        from app.learning_engine import normalize_sentence
        return order_ids(turn["prompt"]["tokens"], normalize_sentence(answer["accepted"][0]))
    return answer["value"]


def wrong(turn: dict):
    answer = stored_answer(turn)
    kind = turn["kind"]
    if kind in ("vocab_typing", "word_spelling"):
        return "zzzz"
    if kind == "gate_choice":
        return next(o["id"] for o in turn["prompt"]["options"] if o["id"] != answer["option"])
    if kind == "bridge_order":
        return list(reversed(right(turn)))
    if kind == "compare":
        return next(o for o in ("<", "=", ">") if o != answer["value"])
    return str(int(answer["value"]) + 1)


def post(client, headers, session: dict, action: str, **body):
    return client.post(f"/api/learning/sessions/{session['id']}/{action}", headers=headers, json=body)


def answer(client, headers, session, turn, value=None, event_id=None):
    return post(client, headers, session, "answer", turn_id=turn["turn_id"], client_event_id=event_id or eid(),
                answer=right(turn) if value is None else value)


def play_all(client, headers, session: dict) -> dict:
    while session["status"] == "active" and session["open_turns"]:
        response = answer(client, headers, session, session["open_turns"][0])
        assert response.status_code == 200, response.json()
        session = response.json()["session"]
    return session


def complete(client, headers, session) -> dict:
    response = post(client, headers, session, "complete")
    assert response.status_code == 200, response.json()
    return response.json()["session"]


@pytest.fixture()
def me(client):
    return person(client, "Mai").headers


# --- catalog, content safety --------------------------------------------------------------------------------------

def test_catalog_lists_both_subjects_without_answers(client, me):
    catalog = client.get("/api/learning/catalog", headers=me)
    assert catalog.status_code == 200
    body = catalog.json()
    assert [s["code"] for s in body["subjects"]] == ["english", "math", "vietnamese", "science", "informatics"]
    english, math = body["subjects"][:2]
    assert sum(1 for t in english["topics"] if t["skill_type"] == "vocabulary") >= 2
    assert sum(1 for t in english["topics"] if t["skill_type"] == "grammar") >= 2
    assert {t["skill_type"] for t in math["topics"]} == {"arithmetic", "missing_number", "compare", "order_of_operations"}
    text = json.dumps(body)
    assert "accepted" not in text and "answer" not in text
    intro = client.get(f"/api/learning/lessons/{lesson_id(client, me, 'en.animals.starter')}", headers=me).json()["intro"]
    assert len(intro["words"]) >= 16 and all(w["example_en"] for w in intro["words"])  # the whole bank
    # Phrases ("wild animal") may come without a phonetic (the bank's checker allows it); single words never do.
    assert all(w["phonetic"] for w in intro["words"] if " " not in w["word"])


def test_game_guides_are_finished_once_per_account_and_game(client, me):
    from app.learning import TUTORIAL_VERSION
    done = {"version": TUTORIAL_VERSION}
    seen = lambda *games: {"seen": list(games), "version": TUTORIAL_VERSION}
    assert client.get("/api/learning/tutorials", headers=me).json() == seen()
    assert client.post("/api/learning/tutorials/meteor", headers=me, json=done).json() == seen("meteor")
    assert client.post("/api/learning/tutorials/meteor", headers=me, json=done).json() == seen("meteor")  # seen again: no change
    assert client.post("/api/learning/tutorials/defense", headers=me, json=done).json() == seen("meteor", "defense")
    assert client.post("/api/learning/tutorials/chess", headers=me, json=done).status_code == 422
    # Per account: another user still gets every guide.
    other = person(client, "Lan").headers
    assert client.get("/api/learning/tutorials", headers=other).json() == seen()
    assert client.get("/api/learning/tutorials", headers=me).json() == seen("meteor", "defense")
    assert client.get("/api/learning/tutorials").status_code == 401


def test_a_guide_finished_at_an_older_version_shows_once_more(client, me):
    """The guides were rewritten: whoever finished the old one sees the new one once; an older app finishes version 1."""
    from app.learning import TUTORIAL_VERSION
    seen = lambda *games: {"seen": list(games), "version": TUTORIAL_VERSION}
    assert client.post("/api/learning/tutorials/word_shooter", headers=me).json() == seen()  # an older app: version 1
    assert client.post("/api/learning/tutorials/gate", headers=me, json={"version": 1}).json() == seen()
    assert client.post("/api/learning/tutorials/gate", headers=me, json={"version": TUTORIAL_VERSION}).json() == seen("gate")
    assert client.post("/api/learning/tutorials/gate", headers=me, json={"version": 1}).json() == seen("gate")  # never lowered
    assert client.post("/api/learning/tutorials/word_shooter", headers=me, json={"version": TUTORIAL_VERSION}).json()         == seen("word_shooter", "gate")


def test_requires_authentication(client):
    assert client.get("/api/learning/catalog").status_code == 401
    assert client.post("/api/learning/sessions", json={"lesson_id": 1}).status_code == 401


@pytest.mark.parametrize("code", ["en.animals.starter", "en.to_be.basic", "math.arithmetic.grade2", "math.compare.grade3"])
def test_open_turns_never_carry_the_answer(client, me, code):
    session = start(client, me, code, mode="challenge")
    turn = session["open_turns"][0]
    assert set(turn) == {"turn_id", "position", "kind", "skill_label", "prompt", "hints_shown", "hints_total", "attempts",
                         "wrong_attempts", "practice", "travel_seconds", "on_screen_ms"}
    text = json.dumps(turn, ensure_ascii=False).lower()
    if turn["kind"] == "vocab_typing":
        assert all(a.lower() not in text for a in stored_answer(turn)["accepted"])
    if turn["kind"] == "bridge_order":
        assert stored_answer(turn)["accepted"][0].lower() not in text
    assert turn["hints_shown"] == []


def test_falling_words_carry_keys_of_every_accepted_answer_not_the_answers(client, me):
    from app.learning_engine import answer_key
    # The same value the app computes (mobile/__tests__/answer-key.test.ts checks these vectors too).
    assert answer_key("turn-0001-abcdef", "cat") == answer_key("turn-0001-abcdef", "  Cat. ") == "4f65fd689c5f51be"
    assert answer_key("t-x", "Don’t   worry!") == "16d4547551c484cc"
    for variant in ("meteor", "word_shooter"):
        session = start(client, me, variant=variant)
        turn = session["open_turns"][0]
        accepted = stored_answer(turn)["accepted"]
        assert turn["prompt"]["answer_keys"] == [answer_key(turn["turn_id"], a) for a in accepted]
        if turn["kind"] == "vocab_typing":
            assert all(a.lower() not in json.dumps(turn, ensure_ascii=False).lower() for a in accepted)
        post(client, me, session, "abandon")
    grammar = start(client, me, "en.to_be.basic")
    assert "answer_keys" not in grammar["open_turns"][0]["prompt"]  # only the typed falling words


# --- a full stage --------------------------------------------------------------------------------------------------

def test_full_english_stage_updates_progress_and_grants_exp_once(client, me):
    before = client.get("/api/profile", headers=me).json()["xp"]
    session = start(client, me)
    assert session["status"] == "active" and session["required_count"] == VOCAB_STAGE_WORDS
    assert session["hearts_max"] == VOCAB_HEARTS and session["variant"] == "meteor"  # lost only by words that land
    first = session["open_turns"][0]
    spaced = answer(client, me, session, first, value="  " + right(first).upper() + "  ")
    assert spaced.json()["result"]["correct"] is True  # case and spacing do not matter
    session = play_all(client, me, spaced.json()["session"])
    assert session["can_complete"] and session["resolved_count"] == VOCAB_STAGE_WORDS
    done = complete(client, me, session)
    assert done["status"] == "completed" and done["reward"] == {"status": "granted", "exp": 10}
    assert client.get("/api/profile", headers=me).json()["xp"] == before + 10
    again = post(client, me, session, "complete")
    assert again.status_code == 200 and again.json()["replayed"] and again.json()["session"]["reward"]["exp"] == 10
    assert client.get("/api/profile", headers=me).json()["xp"] == before + 10
    skills = client.get("/api/learning/progress?subject=english", headers=me).json()["skills"]
    assert len(skills) == VOCAB_STAGE_WORDS and all(s["first_try"] == 1 and s["skill_type"] == "word" for s in skills)  # all different
    result = client.get(f"/api/learning/sessions/{session['id']}/result", headers=me).json()
    assert result["counts"]["first_try"] == VOCAB_STAGE_WORDS and all(i["correct_answer"] for i in result["items"])


def test_each_session_records_its_subject_game_topic_and_level(client, me):
    from app.db import SessionLocal
    from app.models import LearningSession
    cases = (("en.animals.starter", {}, "english", "meteor"), ("en.animals.starter", {"variant": "word_shooter"}, "english", "word_shooter"),
             ("en.to_be.basic", {"variant": "gate"}, "english", "gate"),
             ("en.to_be.basic", {"variant": "bridge"}, "english", "bridge"), ("en.to_be.basic", {}, "english", "grammar"),
             ("math.arithmetic.grade3", {}, "math", "defense"), ("math.compare.grade2", {}, "math", "math_bridge"))
    for code, extra, subject, game in cases:
        session = start(client, me, code, **extra)
        assert session["subject"]["code"] == subject and session["game"] == game
        assert session["lesson"]["code"] == code and session["topic"]["code"] and session["level"]["code"]
        with SessionLocal() as db:
            row = db.get(LearningSession, session["id"])
            assert (row.game, row.topic_id, row.level_id) == (game, session["topic"]["id"], session["level"]["id"])
        post(client, me, session, "abandon")


def test_invalid_input_is_rejected_and_not_counted(client, me):
    for code, bad in (("en.animals.starter", "   "), ("math.arithmetic.grade2", "12a"), ("math.arithmetic.grade2", "")):
        session = start(client, me, code)
        turn = session["open_turns"][0]
        response = answer(client, me, session, turn, value=bad)
        assert response.status_code == 422 and response.json()["code"] in ("invalid_answer_format", "validation_error")
        state = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()
        assert state["open_turns"][0]["attempts"] == 0
        post(client, me, session, "abandon")


def test_practice_mode_wrong_answers_can_be_corrected_and_hints_come_one_by_one(client, me):
    session = start(client, me, "math.arithmetic.grade2")
    turn = session["open_turns"][0]
    miss = answer(client, me, session, turn, value=wrong(turn)).json()
    assert miss["result"]["correct"] is False and miss["result"]["retry_allowed"] and miss["result"]["correct_answer"] is None
    assert miss["result"]["hearts_delta"] == -1 and miss["session"]["hearts"] == 2  # Học tập: a wrong answer costs a heart
    hint = post(client, me, session, "hint", turn_id=turn["turn_id"], client_event_id=eid()).json()
    assert hint["result"]["hint"] and hint["session"]["open_turns"][0]["hints_shown"] == [hint["result"]["hint"]]
    assert hint["session"]["hearts"] == 2  # hints are free
    fixed = answer(client, me, session, turn).json()
    assert fixed["result"]["outcome"] == "corrected" and fixed["session"]["hearts"] == 2
    review = client.get("/api/learning/review", headers=me).json()
    assert review["total"] == 1 and review["groups"][0]["items"][0]["reason"] == "corrected"


def test_practice_mode_ends_when_the_hearts_run_out(client, me):
    session = start(client, me, "math.arithmetic.grade2")
    turn = session["open_turns"][0]
    for expected_hearts in (2, 1, 0):
        response = answer(client, me, session, turn, value=wrong(turn)).json()
        assert response["result"]["hearts_delta"] == -1
        session = response["session"]
        assert session["hearts"] == expected_hearts
    assert session["status"] == "failed" and session["end_reason"] == "out_of_hearts"
    assert session["reward"] == {"status": "not_eligible", "exp": 0}
    result = client.get(f"/api/learning/sessions/{session['id']}/result", headers=me).json()
    assert result["counts"]["wrong"] == 1  # the open turn's confirmed mistake still counts for review


def test_revealed_answer_needs_a_correct_repractice_and_keeps_the_original_result(client, me):
    session = start(client, me, "en.to_be.basic", variant="gate")
    turn = session["open_turns"][0]
    revealed = post(client, me, session, "reveal", turn_id=turn["turn_id"], client_event_id=eid()).json()
    assert revealed["result"]["outcome"] == "revealed" and revealed["result"]["correct_answer"] and revealed["result"]["practice_added"]
    session = revealed["session"]
    practice_seen = False
    while session["open_turns"]:
        current = session["open_turns"][0]
        if current["practice"] and not practice_seen:
            practice_seen = True
            blocked = post(client, me, session, "complete")
            assert blocked.status_code == 409 and blocked.json()["code"] == "session_incomplete"
        session = answer(client, me, session, current).json()["session"]
    assert practice_seen and session["can_complete"]
    complete(client, me, session)
    result = client.get(f"/api/learning/sessions/{session['id']}/result", headers=me).json()
    original = next(i for i in result["items"] if i["turn_id"] == turn["turn_id"])
    assert original["outcome"] == "revealed" and result["counts"]["revealed"] == 1
    repractice = [i for i in result["items"] if i["practice"]]
    assert len(repractice) == 1 and repractice[0]["outcome"] == "first_try"
    skill = next(s for s in client.get("/api/learning/progress", headers=me).json()["skills"] if s["revealed"])
    assert skill["revealed"] == 1


# --- challenge -----------------------------------------------------------------------------------------------------

def test_challenge_grammar_mistakes_cost_hearts_and_end_the_stage(client, me):
    session = start(client, me, "en.to_be.basic", mode="challenge", variant="gate")
    assert session["hearts"] == 3 and session["variant"] == "gate"
    for expected_hearts in (2, 1, 0):
        turn = session["open_turns"][0]
        response = answer(client, me, session, turn, value=wrong(turn)).json()
        assert response["result"]["hearts_delta"] == -1 and response["result"]["correct_answer"] and response["result"]["explanation"]
        session = response["session"]
        assert session["hearts"] == expected_hearts
    assert session["status"] == "failed" and session["end_reason"] == "out_of_hearts"
    assert session["reward"] == {"status": "not_eligible", "exp": 0}
    late = post(client, me, session, "answer", turn_id="x" * 16, client_event_id=eid(), answer="o1")
    assert late.status_code == 409 and late.json()["code"] == "session_ended"
    result = client.get(f"/api/learning/sessions/{session['id']}/result", headers=me).json()
    assert result["counts"]["wrong"] == 3 and result["open_review_count"] >= 1
    assert start(client, me, "en.to_be.basic", mode="challenge")["status"] == "active"  # play again


def test_challenge_combo_and_score_are_computed_by_the_server(client, me):
    session = start(client, me, "en.present_simple.basic", mode="challenge", variant="bridge")
    scores = []
    for _ in range(3):
        response = answer(client, me, session, session["open_turns"][0]).json()
        scores.append(response["result"]["score_delta"])
        session = response["session"]
    assert scores == [120, 140, 160] and session["combo"] == 3 and session["score"] == 420
    rejected = client.post(f"/api/learning/sessions/{session['id']}/answer", headers=me,
                           json={"turn_id": session["open_turns"][0]["turn_id"], "client_event_id": eid(),
                                 "answer": right(session["open_turns"][0]), "score": 99999, "hearts": 99})
    assert rejected.json()["session"]["score"] == 420 + 180 and rejected.json()["session"]["hearts"] == 3


def test_meteor_miss_needs_travel_time_and_costs_one_heart_once(client, me, clock):
    from app.learning_vocab import travel_for
    session = start(client, me, "en.animals.starter", mode="challenge")
    turn = session["open_turns"][0]
    # Meteors fall slowly; longer words and phrases ("wild animal") slower still, at most 40 s.
    assert 24 <= turn["travel_seconds"] == travel_for(stored_answer(turn)["display"], 24) <= 40
    assert turn["prompt"]["letters"] == [len(stored_answer(turn)["display"])]  # the length is shown, not the word
    early = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid())
    assert early.status_code == 409 and early.json()["code"] == "miss_too_early"
    assert turn["on_screen_ms"] == 0
    clock.advance(seconds=13)
    reopened = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()["open_turns"][0]
    assert reopened["on_screen_ms"] == 13000  # a reopened game puts the meteor back where it was
    event_id = eid()
    missed = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=event_id).json()
    assert missed["result"]["outcome"] == "missed" and missed["session"]["hearts"] == VOCAB_HEARTS - 1 and missed["result"]["correct_answer"]
    replay = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=event_id).json()
    assert replay["replayed"] and replay["session"]["hearts"] == VOCAB_HEARTS - 1


def test_targets_wait_in_practice_mode(client, me, clock):
    session = start(client, me, "math.arithmetic.grade2")
    turn = session["open_turns"][0]
    assert turn["travel_seconds"] == 0
    clock.advance(seconds=50)
    response = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid())
    assert response.status_code == 409 and response.json()["code"] == "miss_not_allowed"


def test_falling_words_allow_three_at_once_in_both_modes(client, me):
    """The app opens a new falling word on its own timer: up to three fall at once, in Học tập and Thử thách, in both
    shooting games; asking for "this many in all" (refill) never opens more."""
    for mode, variant in (("challenge", None), ("practice", None), ("challenge", "word_shooter"), ("practice", "word_shooter")):
        session = start(client, me, "en.animals.starter", mode=mode, **({"variant": variant} if variant else {}))
        assert len(post(client, me, session, "next", count=2, refill=True).json()["session"]["open_turns"]) == 2
        assert len(post(client, me, session, "next", count=2, refill=True).json()["session"]["open_turns"]) == 2  # a retry
        more = post(client, me, session, "next", count=3).json()["session"]
        assert len(more["open_turns"]) == 3
        assert len(post(client, me, session, "next", count=1).json()["session"]["open_turns"]) == 3  # never a fourth
        turn = more["open_turns"][1]  # tap another target
        assert answer(client, me, more, turn).json()["result"]["correct"]
        post(client, me, session, "abandon")
    defense = start(client, me, "math.arithmetic.grade2", mode="challenge")
    assert len(post(client, me, defense, "next", count=3).json()["session"]["open_turns"]) == 2  # other games: as before


# --- vocabulary: Anh → Việt (word_shooter) and Việt → Anh (meteor) ------------------------------------------------

def test_word_shooter_shows_the_english_word_and_its_meaning_only_after_the_hit(client, me):
    session = start(client, me, variant="word_shooter")
    assert session["game"] == "word_shooter" and session["variant"] == "word_shooter" and session["hearts_max"] == VOCAB_HEARTS
    turn = session["open_turns"][0]
    word = stored_answer(turn)
    assert turn["kind"] == "word_spelling" and turn["prompt"]["word"] == word["display"] and turn["skill_label"] == "Gõ từ"
    assert word["meaning_vi"] not in json.dumps(turn, ensure_ascii=False)  # the meaning comes with the hit
    typo = answer(client, me, session, turn, value=word["display"][::-1] + "x").json()
    assert typo["result"]["correct"] is False and typo["result"]["retry_allowed"] and typo["result"]["word"] is None
    assert typo["result"]["hearts_delta"] == 0 and typo["session"]["hearts"] == VOCAB_HEARTS  # a wrong answer: no heart lost
    hit = answer(client, me, session, turn, value=f"  {word['display'].upper()} ").json()["result"]
    assert hit["correct"] and hit["outcome"] == "corrected"
    assert hit["word"] == {"en": word["display"], "vi": word["meaning_vi"], "phonetic": word["phonetic"]}


def test_word_shooter_accepts_only_the_word_shown(client, db):
    from app.learning_engine import check_text
    from app.learning_vocab import snapshot
    from app.models import LearningVocabEntry
    entries = list(db.scalars(select(LearningVocabEntry)))
    spelled = [snapshot("en.vocab.mix", e, "word_spelling", "new") for e in entries]
    recalled = {e.entry_key: snapshot("en.vocab.mix", e, "vocab_typing", "new") for e in entries}
    assert len(spelled) >= 400 and all(q["answer"]["accepted"] == [q["answer"]["display"]] for q in spelled)
    rabbit = next(q for q in spelled if q["answer"]["display"] == "rabbit")
    assert not check_text("bunny", rabbit["answer"]["accepted"]) and not check_text("rabit", rabbit["answer"]["accepted"])
    assert check_text("bunny", recalled["rabbit"]["answer"]["accepted"])  # Việt → Anh accepts declared equivalents
    assert all(q["answer"]["meaning_vi"] not in json.dumps(q["prompt"], ensure_ascii=False) for q in spelled)


def test_the_two_vocabulary_games_keep_separate_progress(client, me):
    shooter = play_all(client, me, start(client, me, variant="word_shooter"))
    complete(client, me, shooter)
    intro = client.get(f"/api/learning/sessions/{shooter['id']}/intro", headers=me).json()["intro"]
    assert len(intro["words"]) == VOCAB_STAGE_WORDS  # the lesson before playing teaches the words drawn for it
    skills = client.get("/api/learning/progress?subject=english", headers=me).json()["skills"]
    assert len(skills) == VOCAB_STAGE_WORDS and all(s["skill_type"] == "spelling" and s["skill_key"].startswith("en.spell.") for s in skills)
    assert not any(s["skill_type"] == "word" for s in skills)  # retyping a word shown never counts as knowing it
    # Việt → Anh starts from scratch: the words typed in Anh → Việt are still new words there.
    meteor = start(client, me)
    words = client.get(f"/api/learning/sessions/{meteor['id']}/intro", headers=me).json()["intro"]["words"]
    assert all(w["pick"] == "Từ mới" for w in words)
    complete(client, me, play_all(client, me, meteor))
    skills = client.get("/api/learning/progress?subject=english", headers=me).json()["skills"]
    assert sum(1 for s in skills if s["skill_type"] == "word") == VOCAB_STAGE_WORDS
    assert sum(1 for s in skills if s["skill_type"] == "spelling") == VOCAB_STAGE_WORDS


def test_mixed_vocabulary_starts_at_the_easiest_level_and_moves_up_after_good_stages(client, me):
    first = start(client, me, "en.vocab.mix")
    taught = drawn(first)
    assert len({w["word"] for w in taught}) == VOCAB_STAGE_WORDS and {w["difficulty"] for w in taught} == {1}
    assert {w["level"] for w in taught} == {"Mức 1"}  # no CEFR label is claimed without a source for it
    complete(client, me, play_all(client, me, first))  # every word right at the first try
    second = start(client, me, "en.vocab.mix")
    assert {w["difficulty"] for w in drawn(second)} == {1}  # 12 words are not enough to move on
    assert not {w["word"] for w in drawn(second)} & {w["word"] for w in taught}  # the last stage's words are not repeated
    complete(client, me, play_all(client, me, second))
    third = drawn(start(client, me, "en.vocab.mix"))
    assert {w["difficulty"] for w in third} <= {1, 2} and any(w["difficulty"] == 2 for w in third)
    # The other game has its own level: Anh → Việt still starts at the easiest words.
    post(client, me, client.get("/api/learning/sessions/current", headers=me).json()["session"], "abandon")
    assert {w["difficulty"] for w in drawn(start(client, me, "en.vocab.mix", variant="word_shooter"))} == {1}


def test_a_topic_draws_only_its_own_words(client, me, db):
    from app.models import LearningVocabEntry
    animals = set(db.scalars(select(LearningVocabEntry.word).where(LearningVocabEntry.topic == "animals")))
    session = start(client, me, "en.animals.starter")
    taught = drawn(session)
    assert len(taught) == VOCAB_STAGE_WORDS and {w["word"] for w in taught} <= animals
    assert session["topic"]["code"] == "animals" and session["level"]["code"] == "auto"


def test_a_vocabulary_stage_never_starts_short_nor_repeats_a_word_to_fill_up(client, me, db):
    """Too few words of the topic at the user's level: the stage does not start (a clear code), it is never shorter
    nor padded with a word asked twice."""
    from app.models import LearningSession, LearningVocabEntry
    keep = list(db.scalars(select(LearningVocabEntry).where(LearningVocabEntry.topic == "animals", LearningVocabEntry.status == "active")
                           .order_by(LearningVocabEntry.entry_key)))
    for entry in keep[VOCAB_STAGE_WORDS - 1:]:
        entry.status = "retired"
    db.commit()
    lesson = lesson_id(client, me, "en.animals.starter")
    response = client.post("/api/learning/sessions", headers=me, json={"lesson_id": lesson, "mode": "practice", "timezone": "Asia/Ho_Chi_Minh"})
    assert response.status_code == 409 and response.json()["code"] == "not_enough_words"
    assert db.scalar(select(func.count()).select_from(LearningSession)) == 0


def test_a_shot_hits_the_matching_word_closest_to_the_ground_and_only_that_one(client, me):
    from app.db import SessionLocal
    from app.models import LearningSessionItem
    for variant in ("meteor", "word_shooter"):
        session = start(client, me, mode="challenge", variant=variant)
        first, second = post(client, me, session, "next", count=1).json()["session"]["open_turns"]
        # Aimed at the first word, typed the second one: the second is destroyed.
        shot = answer(client, me, session, first, value=right(second)).json()
        assert shot["result"]["correct"] and shot["result"]["turn_id"] == second["turn_id"]
        assert first["turn_id"] in {t["turn_id"] for t in shot["session"]["open_turns"]}
        post(client, me, session, "abandon")

    session = start(client, me, mode="challenge")
    first, second = post(client, me, session, "next", count=1).json()["session"]["open_turns"]
    with SessionLocal() as db:  # two falling words with the same answer
        rows = {i.turn_id: i for i in db.scalars(select(LearningSessionItem).where(LearningSessionItem.turn_id.in_([first["turn_id"], second["turn_id"]])))}
        rows[second["turn_id"]].answer_json = rows[first["turn_id"]].answer_json
        db.commit()
    shot = answer(client, me, session, second, value=right(first)).json()
    assert shot["result"]["turn_id"] == first["turn_id"]  # the one issued first is the closest to the ground
    assert [t["turn_id"] for t in shot["session"]["open_turns"]][:1] == [second["turn_id"]]  # one shot, one word


def test_challenge_words_fall_and_a_miss_shows_the_word_pair(client, me, clock):
    session = start(client, me, mode="challenge", variant="word_shooter")
    turn = session["open_turns"][0]
    assert session["hearts_max"] == VOCAB_HEARTS and 24 <= turn["travel_seconds"] < 28
    wrong_shot = answer(client, me, session, turn, value="zzzz").json()
    assert wrong_shot["result"]["hearts_delta"] == 0 and wrong_shot["result"]["retry_allowed"]  # fix it while it falls
    clock.advance(seconds=13)
    missed = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid()).json()
    word = stored_answer(turn)
    assert missed["session"]["hearts"] == VOCAB_HEARTS - 1 and missed["result"]["word"]["en"] == word["display"]
    assert missed["result"]["word"]["vi"] == word["meaning_vi"]
    post(client, me, session, "abandon")
    groups = client.get("/api/learning/review?subject=english", headers=me).json()["groups"]
    assert groups[0]["items"][0]["label"].startswith("Mặt chữ: ")
    review = client.post("/api/learning/review/sessions", headers=me, json={"topic_id": groups[0]["topic"]["id"]}).json()
    assert review["game"] == "word_shooter" and review["open_turns"][0]["kind"] == "word_spelling"


def test_a_shot_word_opens_no_word_the_app_opens_them_on_its_timer(client, me, clock):
    """Falling words: the app sends hold_next and opens new words on its own timer (/next, refill). A new word starts at
    the top with its own time, never with the time the last word or its shot took."""
    for mode in ("practice", "challenge"):
        session = start(client, me, mode=mode)
        turn = session["open_turns"][0]
        missed = post(client, me, session, "answer", turn_id=turn["turn_id"], client_event_id=eid(), answer="zzzz", hold_next=True).json()
        assert missed["result"]["retry_allowed"] and [t["turn_id"] for t in missed["session"]["open_turns"]] == [turn["turn_id"]]
        clock.advance(seconds=9)  # it fell a while before it was answered
        shot = post(client, me, session, "answer", turn_id=turn["turn_id"], client_event_id=eid(), answer=right(turn), hold_next=True).json()
        assert shot["result"]["correct"] and shot["session"]["open_turns"] == [] and not shot["session"]["can_complete"]
        clock.advance(seconds=3)  # the bullet flies, the word breaks, its meaning shows
        after = post(client, me, session, "next", count=1, refill=True).json()["session"]["open_turns"]
        assert len(after) == 1 and after[0]["turn_id"] != turn["turn_id"] and after[0]["on_screen_ms"] == 0
        again = post(client, me, session, "next", count=1, refill=True).json()["session"]["open_turns"]
        assert [t["turn_id"] for t in again] == [after[0]["turn_id"]]  # asked twice: still one new word
        post(client, me, session, "abandon")

    session = start(client, me, mode="challenge")
    turn = session["open_turns"][0]
    clock.advance(seconds=turn["travel_seconds"])
    missed = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid(), hold_next=True).json()
    assert missed["result"]["outcome"] == "missed" and missed["session"]["open_turns"] == []
    post(client, me, session, "abandon")
    # Without hold_next (other games, older apps) the next turn opens with the answer, as before.
    session = start(client, me, "en.to_be.basic", variant="gate")
    assert answer(client, me, session, session["open_turns"][0]).json()["session"]["open_turns"]


def test_the_answer_kept_is_what_the_user_typed_chose_or_built(client, me):
    from app.db import SessionLocal
    from app.models import LearningEvent
    gate = start(client, me, "en.to_be.basic", variant="gate")
    turn = gate["open_turns"][0]
    option = next(o for o in turn["prompt"]["options"] if o["id"] == right(turn))
    answer(client, me, gate, turn)
    post(client, me, gate, "abandon")
    bridge = start(client, me, "en.to_be.basic", variant="bridge")
    turn = bridge["open_turns"][0]
    built = " ".join(t["text"] for t in sorted(turn["prompt"]["tokens"], key=lambda t: right(turn).index(t["id"])))
    answer(client, me, bridge, turn)
    with SessionLocal() as db:
        texts = [e.answer_text for e in db.scalars(select(LearningEvent).where(LearningEvent.event_type == "answer")
                                                   .order_by(LearningEvent.id.desc()).limit(2))]
    assert texts == [built, option["text"]]  # the sentence and the option, not piece or option ids


# --- state machine ------------------------------------------------------------------------------------------------

def test_session_state_transitions(client, me):
    from app.errors import APIError
    from app.learning import transition
    from app.models import LearningSession

    session = start(client, me)
    turn = session["open_turns"][0]
    paused = post(client, me, session, "pause", client_event_id=eid()).json()["session"]
    assert paused["status"] == "paused"
    assert post(client, me, session, "pause").json()["session"]["status"] == "paused"  # idempotent
    blocked = answer(client, me, session, turn)
    assert blocked.status_code == 409 and blocked.json()["code"] == "session_paused"
    assert post(client, me, session, "resume").json()["session"]["status"] == "active"
    early = post(client, me, session, "complete")
    assert early.status_code == 409 and early.json()["code"] == "session_incomplete"
    ended = post(client, me, session, "abandon").json()["session"]
    assert ended["status"] == "abandoned" and ended["reward"]["status"] == "not_eligible"
    assert post(client, me, session, "abandon").status_code == 200
    for action in ("resume", "pause", "complete"):
        response = post(client, me, session, action)
        assert response.status_code == 409 and response.json()["code"] == "session_ended", action
    for status, target in (("completed", "active"), ("failed", "paused"), ("abandoned", "completed"), ("paused", "failed")):
        with pytest.raises(APIError):
            transition(LearningSession(status=status), target)


def test_only_one_open_session_and_idempotent_start(client, me):
    body = {"lesson_id": lesson_id(client, me, "en.school.starter"), "mode": "practice", "timezone": "UTC"}
    key = {"Idempotency-Key": "start-0001-abcdef"}
    first = client.post("/api/learning/sessions", headers={**me, **key}, json=body)
    retry = client.post("/api/learning/sessions", headers={**me, **key}, json=body)
    assert first.status_code == retry.status_code == 201 and first.json()["id"] == retry.json()["id"]
    other = client.post("/api/learning/sessions", headers=me, json=body)
    assert other.status_code == 409 and other.json()["code"] == "open_session_exists"
    current = client.get("/api/learning/sessions/current", headers=me).json()["session"]
    assert current["id"] == first.json()["id"]


def test_other_users_cannot_read_or_change_a_session(client, me):
    session = start(client, me)
    turn = session["open_turns"][0]
    intruder = person(client, "Khoa").headers
    assert client.get(f"/api/learning/sessions/{session['id']}", headers=intruder).status_code == 404
    assert client.get(f"/api/learning/sessions/{session['id']}/result", headers=intruder).status_code == 404
    assert client.get(f"/api/learning/sessions/{session['id']}/intro", headers=intruder).status_code == 404
    for action, body in (("answer", {"turn_id": turn["turn_id"], "client_event_id": eid(), "answer": "cat"}),
                         ("hint", {"turn_id": turn["turn_id"], "client_event_id": eid()}),
                         ("reveal", {"turn_id": turn["turn_id"], "client_event_id": eid()}),
                         ("pause", {}), ("complete", {}), ("abandon", {})):
        response = client.post(f"/api/learning/sessions/{session['id']}/{action}", headers=intruder, json=body)
        assert response.status_code == 404 and response.json()["code"] == "session_not_found", action
    assert client.get("/api/learning/sessions/current", headers=intruder).json()["session"] is None
    assert client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()["open_turns"][0]["attempts"] == 0


# --- time, pause and recovery -------------------------------------------------------------------------------------

def test_pause_stops_the_clock(client, me, clock):
    session = start(client, me)
    clock.advance(seconds=30)
    paused = post(client, me, session, "pause").json()["session"]
    assert paused["active_ms"] == 30_000
    clock.advance(minutes=10)
    assert client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()["active_ms"] == 30_000
    post(client, me, session, "resume")
    clock.advance(seconds=20)
    assert client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()["active_ms"] == 50_000


def test_closed_app_is_paused_and_the_session_restored(client, me, clock):
    session = start(client, me, "math.arithmetic.grade3", mode="challenge")
    turn = session["open_turns"][0]
    clock.advance(minutes=30)  # app killed without pausing, network gone, ...
    restored = client.get("/api/learning/sessions/current", headers=me).json()["session"]
    assert restored["status"] == "paused" and restored["hearts"] == 3
    assert restored["active_ms"] == 60_000  # at most the idle cap was counted
    assert restored["open_turns"][0]["turn_id"] == turn["turn_id"]  # same question to continue
    resumed = post(client, me, session, "resume").json()["session"]
    assert resumed["status"] == "active" and answer(client, me, resumed, turn).json()["result"]["correct"]


def test_time_up_finishes_the_open_turn_then_end_or_extend(client, me, clock, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "learning_idle_cap_seconds", 3600)
    session = start(client, me, duration_minutes=5)
    clock.advance(minutes=6)
    state = answer(client, me, session, session["open_turns"][0]).json()["session"]  # the open turn may still be answered
    assert state["time_up"] and state["open_turns"] == [] and not state["can_complete"] and state["status"] == "active"
    extended = post(client, me, session, "extend", minutes=5, client_event_id=eid()).json()["session"]
    assert not extended["time_up"] and len(extended["open_turns"]) == 1 and extended["duration_seconds"] == 600
    ended = post(client, me, session, "abandon", reason="time_up").json()["session"]
    assert ended["status"] == "abandoned" and ended["end_reason"] == "time_up"  # running out of time is not a loss


# --- idempotency and concurrency ----------------------------------------------------------------------------------

def test_repeated_answer_is_not_scored_twice(client, me):
    session = start(client, me, "en.to_be.basic", mode="challenge", variant="gate")
    turn, event_id = session["open_turns"][0], eid()
    first = answer(client, me, session, turn, event_id=event_id).json()
    again = answer(client, me, session, turn, event_id=event_id).json()
    assert not first["replayed"] and again["replayed"] and again["result"] == first["result"]
    assert again["session"]["score"] == first["session"]["score"] == 120
    reused = post(client, me, session, "hint", turn_id=turn["turn_id"], client_event_id=event_id)
    assert reused.status_code == 409 and reused.json()["code"] == "idempotency_conflict"


def test_concurrent_duplicate_answers_apply_once(client, me):
    session = start(client, me, "math.arithmetic.grade2", mode="challenge")
    turn, event_id = session["open_turns"][0], eid()
    value = right(turn)
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: answer(client, me, session, turn, value=value, event_id=event_id), range(6)))
    assert all(r.status_code == 200 for r in responses), [r.json() for r in responses]
    assert sum(1 for r in responses if not r.json()["replayed"]) == 1
    state = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()
    assert state["score"] == 120 and state["resolved_count"] == 1


def test_concurrent_completion_grants_the_reward_once(client, me, db):
    from app.models import ExpEvent
    session = play_all(client, me, start(client, me, "math.compare.grade2"))
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(lambda _: post(client, me, session, "complete"), range(5)))
    assert all(r.status_code == 200 for r in responses), [r.json() for r in responses]
    assert {r.json()["session"]["reward"]["exp"] for r in responses} == {10}
    assert db.scalar(select(func.sum(ExpEvent.amount)).where(ExpEvent.source == "learning")) == 10


# --- rewards -------------------------------------------------------------------------------------------------------

def test_stage_reward_once_per_subject_per_day_but_progress_keeps_counting(client, me):
    first = complete(client, me, play_all(client, me, start(client, me, "en.animals.starter")))
    replay = complete(client, me, play_all(client, me, start(client, me, "en.school.starter")))
    other_subject = complete(client, me, play_all(client, me, start(client, me, "math.arithmetic.grade2")))
    assert first["reward"]["status"] == "granted"
    assert replay["reward"] == {"status": "already_claimed", "exp": 0}
    assert other_subject["reward"] == {"status": "granted", "exp": 10}
    assert len(client.get("/api/learning/progress?subject=english", headers=me).json()["skills"]) == 2 * VOCAB_STAGE_WORDS


def test_failed_abandoned_and_review_sessions_get_no_completion_reward(client, me):
    session = start(client, me, "en.to_be.basic", mode="challenge", variant="gate")
    for _ in range(3):
        session = answer(client, me, session, session["open_turns"][0], value=wrong(session["open_turns"][0])).json()["session"]
    assert session["reward"]["exp"] == 0
    review = client.post("/api/learning/review/sessions", headers=me, json={"topic_id": session["topic"]["id"]})
    assert review.status_code == 201 and review.json()["kind"] == "review"
    done = complete(client, me, play_all(client, me, review.json()))
    assert done["reward"] == {"status": "not_eligible", "exp": 0}
    assert client.get("/api/learning/review", headers=me).json()["total"] == 0  # first-try answers cleared the list


def test_a_review_session_can_wait_paused_for_the_countdown(client, me):
    session = start(client, me, "en.to_be.basic", variant="gate")
    answer(client, me, session, session["open_turns"][0], value=wrong(session["open_turns"][0]))
    assert client.post(f"/api/learning/sessions/{session['id']}/abandon", headers=me, json={}).status_code == 200
    review = client.post("/api/learning/review/sessions", headers=me,
                         json={"topic_id": session["topic"]["id"], "start_paused": True}).json()
    assert review["status"] == "paused" and review["active_ms"] == 0
    resumed = client.post(f"/api/learning/sessions/{review['id']}/resume", headers=me, json={}).json()["session"]
    assert resumed["status"] == "active"


def test_learning_exp_shares_the_daily_task_cap(client, me, db):
    from app.models import ExpEvent, User
    user = db.scalar(select(User).where(User.email == "mai@example.com"))
    db.add(ExpEvent(user_id=user.id, pet_id=user.pet, source="task", reference_id="quest:test", amount=55))
    db.commit()
    english = complete(client, me, play_all(client, me, start(client, me, "en.animals.starter")))
    math = complete(client, me, play_all(client, me, start(client, me, "math.arithmetic.grade2")))
    assert english["reward"] == {"status": "capped", "exp": 5}
    assert math["reward"] == {"status": "daily_cap_reached", "exp": 0}
    quest = client.post("/api/pet/quests/focus/complete", headers=me).json()
    assert quest["awarded_exp"] == 0 and quest["daily_exp_remaining"] == 0  # tasks see the learning EXP too


def test_completing_the_daily_learning_task_replaces_the_stage_reward(client, me, db):
    from app.models import ExpEvent
    assert client.put("/api/onboarding/daily-tasks", headers=me, json={"task_ids": ["learning", "health"]}).status_code == 200
    english = complete(client, me, play_all(client, me, start(client, me, "en.school.starter")))
    assert english["reward"] == {"status": "daily_task", "exp": 10}
    quests = {q["id"]: q["progress"] for q in client.get("/api/pet/space", headers=me).json()["quests"]}
    assert quests == {"learning": 1, "health": 0}
    assert db.scalar(select(func.count()).select_from(ExpEvent).where(ExpEvent.source == "learning")) == 0
    math = complete(client, me, play_all(client, me, start(client, me, "math.missing_number.grade2")))
    assert math["reward"] == {"status": "granted", "exp": 10}  # the task is done: the other subject gets its stage reward


def test_reward_day_follows_the_account_timezone(client, me, clock, monkeypatch):
    from app import progression
    monkeypatch.setattr(progression, "utcnow", clock.now)
    client.put("/api/study/pomodoro-settings", headers=me, json={"timezone": "Asia/Ho_Chi_Minh"})
    clock.t = datetime(2026, 10, 26, 16, 30, tzinfo=timezone.utc)  # 23:30 in Vietnam
    first = complete(client, me, play_all(client, me, start(client, me, "en.animals.starter")))
    clock.advance(hours=1)  # still 26 October in UTC, already 27 October in Vietnam
    second = complete(client, me, play_all(client, me, start(client, me, "en.school.starter")))
    clock.advance(hours=2)
    third = complete(client, me, play_all(client, me, start(client, me, "en.animals.starter")))
    assert [s["reward"]["status"] for s in (first, second, third)] == ["granted", "granted", "already_claimed"]


# --- content versions, review and weak content -------------------------------------------------------------------

def test_new_content_version_does_not_change_a_running_session(client, me, db, monkeypatch):
    from app import learning_content
    from app.models import LearningLesson, LearningSession

    from app import learning_vocab
    assert learning_content.seed_learning_content(db) == 0  # unchanged lessons publish nothing
    db.commit()
    session = start(client, me)
    turn = session["open_turns"][0]
    old = stored_answer(turn)
    # Edit that word in the bank (a data file re-imported) while the stage is running.
    rows, report = learning_vocab.check()
    edited = [learning_vocab.Row(**{**r.__dict__, "meaning_vi": r.meaning_vi + " (mới)"}) if r.key == old["entry_key"] else r for r in rows]
    # With the checker's report, as the app imports: rows it keeps as drafts stay drafts.
    assert learning_vocab.import_rows(db, edited, report=report) == {"updated": 1, "unchanged": len(rows) - 1}
    db.commit()
    assert learning_vocab.import_rows(db, edited, report=report) == {"unchanged": len(rows)}  # importing again changes nothing
    db.commit()
    # The running stage keeps the word it was given; the bank has the new meaning for the next stages.
    current = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()["open_turns"][0]
    assert current["prompt"]["meaning_vi"] == old["meaning_vi"]
    assert answer(client, me, session, turn, value=old["display"]).json()["result"]["correct"]
    from app.models import LearningVocabEntry
    assert db.scalar(select(LearningVocabEntry.meaning_vi).where(LearningVocabEntry.entry_key == old["entry_key"])).endswith("(mới)")
    lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == "en.animals.starter"))
    assert db.get(LearningSession, session["id"]).lesson_version_id and lesson.current_version >= 1


def test_math_review_practises_the_weak_problem_type(client, me):
    session = start(client, me, "math.missing_number.grade2", mode="challenge")
    turn = session["open_turns"][0]
    answer(client, me, session, turn, value=wrong(turn))
    weak_label = turn["skill_label"]
    post(client, me, session, "abandon")
    groups = client.get("/api/learning/review?subject=math", headers=me).json()["groups"]
    assert groups[0]["items"][0]["label"] == weak_label
    review = client.post("/api/learning/review/sessions", headers=me, json={"topic_id": groups[0]["topic"]["id"]}).json()
    assert review["required_count"] >= 2 and review["open_turns"][0]["skill_label"] == weak_label


def test_weaker_content_is_drawn_more_often():
    from app.learning import weakness
    from app.learning_engine import generate_math_items
    assert weakness(10, False) > weakness(90, False) and weakness(None, False) > weakness(100, False)
    assert weakness(50, True) > weakness(50, False)
    g = {"ops": ["add", "sub", "mul", "div"], "add_max": 1000, "mul_min": 2, "mul_max": 9}  # enough distinct problems
    items = generate_math_items(5, "arithmetic", g, 60, weights={"math.arith.div": weakness(0, True), "math.arith.add": weakness(100, False),
                                                                  "math.arith.sub": weakness(100, False), "math.arith.mul": weakness(100, False)})
    counts = {op: sum(1 for i in items if i["skill_key"] == f"math.arith.{op}") for op in ("add", "sub", "mul", "div")}
    assert counts["div"] > max(counts["add"], counts["sub"], counts["mul"])


def test_english_content_is_random_per_session(client, me):
    def words_of(session):
        words = {w["word"] for w in drawn(session)}
        post(client, me, session, "abandon")
        return words

    draws = [words_of(start(client, me)) for _ in range(4)]
    assert all(len(d) == VOCAB_STAGE_WORDS for d in draws) and len({frozenset(d) for d in draws}) > 1

    def sentences(session):
        turns = []
        while session["open_turns"] and len(turns) < 4:
            turn = session["open_turns"][0]
            turns.append(stored_answer(turn)["display"])
            session = answer(client, me, session, turn).json()["session"]
        post(client, me, session, "abandon")
        return turns

    first, second = (sentences(start(client, me, "en.present_simple.basic")) for _ in range(2))
    assert first != second


def test_session_can_start_paused_while_its_lesson_is_shown(client, me, clock):
    session = start(client, me, start_paused=True)
    assert session["status"] == "paused" and session["open_turns"] == []
    # The intro never gives away a word still to come (the Việt → Anh answer, the Anh → Việt meaning).
    intro = client.get(f"/api/learning/sessions/{session['id']}/intro", headers=me).json()["intro"]
    assert intro["words"] == []
    assert len(drawn(session)) == VOCAB_STAGE_WORDS and all(w["difficulty"] == 1 and w["pick"] == "new" for w in drawn(session))
    clock.advance(minutes=5)  # a paused session does not use its time
    resumed = post(client, me, session, "resume").json()["session"]
    assert resumed["status"] == "active" and resumed["active_ms"] == 0 and len(resumed["open_turns"]) == 1
    turn = resumed["open_turns"][0]
    assert turn["prompt"]["meaning_vi"] in {w["meaning_vi"] for w in drawn(session)}
    played = answer(client, me, session, turn).json()
    intro = client.get(f"/api/learning/sessions/{session['id']}/intro", headers=me).json()["intro"]
    assert [w["word"] for w in intro["words"]] == [played["result"]["word"]["en"]]  # words met so far


# --- vocabulary stages: 15 words, hearts lost only by words that land --------------------------------------------------

@pytest.mark.parametrize("variant", ["meteor", "word_shooter"])
def test_a_vocabulary_stage_has_fifteen_different_words_that_fall_in_hoc_tap(client, me, clock, variant):
    session = start(client, me, variant=variant)
    words = drawn(session)
    assert len(words) == session["required_count"] == VOCAB_STAGE_WORDS and len({w["word"] for w in words}) == VOCAB_STAGE_WORDS
    assert session["hearts"] == session["hearts_max"] == VOCAB_HEARTS
    turn = session["open_turns"][0]
    assert turn["travel_seconds"] >= 24  # Học tập: the words fall to the ground too, each on its own time
    # A wrong answer costs nothing: it is fixed while the word falls.
    assert answer(client, me, session, turn, value="zzzz").json()["session"]["hearts"] == VOCAB_HEARTS
    early = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid())
    assert early.status_code == 409 and early.json()["code"] == "miss_too_early"
    clock.advance(seconds=turn["travel_seconds"])
    event = eid()
    missed = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=event).json()
    assert missed["result"]["outcome"] == "missed" and missed["session"]["hearts"] == VOCAB_HEARTS - 1
    assert missed["session"]["resolved_count"] == 1  # "Đã xử lý 1/15": a missed word counts
    # The same landing sent again (a retry, or a second report) never costs a second heart.
    assert post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=event).json()["session"]["hearts"] == VOCAB_HEARTS - 1
    again = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid())
    assert again.status_code == 409 and again.json()["code"] == "turn_not_open"
    assert client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()["hearts"] == VOCAB_HEARTS - 1


def test_a_word_shot_just_above_the_ground_counts_once_and_never_also_as_a_miss(client, me, clock):
    session = start(client, me, mode="challenge")
    turn = session["open_turns"][0]
    clock.advance(seconds=turn["travel_seconds"])  # it is on the ground now, the bullet was already flying
    shot = answer(client, me, session, turn).json()
    assert shot["result"]["correct"] and shot["result"]["score_delta"] > 0
    late = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid())
    assert late.status_code == 409 and late.json()["code"] == "turn_not_open"
    again = answer(client, me, session, turn)
    assert again.status_code == 409 and again.json()["code"] == "turn_not_open"  # never scored twice
    now = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()
    assert now["hearts"] == VOCAB_HEARTS and now["score"] == shot["session"]["score"] and now["resolved_count"] == 1


def test_out_of_hearts_ends_the_stage_and_opens_no_more_words_and_a_replay_has_every_heart(client, me, clock):
    session = start(client, me)
    for lost in range(1, VOCAB_HEARTS + 1):
        turn = session["open_turns"][0]
        clock.advance(seconds=turn["travel_seconds"])
        session = post(client, me, session, "miss", turn_id=turn["turn_id"], client_event_id=eid()).json()["session"]
        assert session["hearts"] == VOCAB_HEARTS - lost
        if session["status"] == "active" and not session["open_turns"]:
            session = post(client, me, session, "next", count=1, refill=True).json()["session"]
    assert session["status"] == "failed" and session["end_reason"] == "out_of_hearts" and session["open_turns"] == []
    assert session["reward"] == {"status": "not_eligible", "exp": 0} and session["resolved_count"] == VOCAB_HEARTS
    refused = post(client, me, session, "next", count=1, refill=True)
    assert refused.status_code == 409  # no word after the end
    replay = start(client, me)
    assert replay["hearts"] == replay["hearts_max"] == VOCAB_HEARTS


def test_a_revealed_word_is_not_asked_again_so_a_stage_stays_fifteen_words(client, me):
    session = start(client, me)
    turn = session["open_turns"][0]
    revealed = post(client, me, session, "reveal", turn_id=turn["turn_id"], client_event_id=eid()).json()
    assert revealed["result"]["outcome"] == "revealed" and revealed["result"]["practice_added"] is False
    session = play_all(client, me, revealed["session"])
    assert session["can_complete"] and session["resolved_count"] == session["required_count"] == VOCAB_STAGE_WORDS
    done = complete(client, me, session)
    assert done["status"] == "completed"
    result = client.get(f"/api/learning/sessions/{session['id']}/result", headers=me).json()
    assert result["counts"]["revealed"] == 1 and not any(i["practice"] for i in result["items"])
    skill = next(s for s in client.get("/api/learning/progress", headers=me).json()["skills"] if s["revealed"])
    assert skill["revealed"] == 1 and not skill["mastered"]  # a revealed word is never counted as known
