"""“Từ đã học”: the vocabulary history read from the turns of both games, per sense and direction, and practising again."""
import pytest
from sqlalchemy import select

from test_learning_api import answer, eid, play_all, post, right, stored_answer
from together import person

HISTORY = "/api/learning/vocabulary/history"


@pytest.fixture()
def mai(client):
    return person(client, "Mai")


def stage(client, who, keys: list[str], game: str = "meteor") -> dict:
    """A stage of exactly these words (test setup: the games normally pick the words themselves)."""
    from app.db import SessionLocal
    from app.learning import create_session
    from app.models import LearningLesson, User
    spell = "spell." if game == "word_shooter" else ""
    with SessionLocal() as db:
        lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == "en.vocab.mix"))
        s = create_session(db, db.get(User, who.id), lesson=lesson, mode="practice", duration_minutes=15, variant=None,
                           device_zone="Asia/Ho_Chi_Minh", kind="lesson", idempotency_key=None,
                           review_keys=[f"en.vocab.mix.{spell}{k}" for k in keys])
        sid = s.id
    return client.get(f"/api/learning/sessions/{sid}", headers=who.headers).json()


def key_of(turn: dict) -> str:
    return stored_answer(turn)["entry_key"]


def history(client, who, **params) -> dict:
    response = client.get(HISTORY, headers=who.headers, params=params)
    assert response.status_code == 200, response.json()
    return response.json()


def by_key(body: dict) -> dict:
    return {i["entry_key"]: i for i in body["items"]}


def detail(client, who, key: str) -> dict:
    response = client.get(f"{HISTORY}/{key}", headers=who.headers)
    assert response.status_code == 200, response.json()
    return response.json()


def play(client, who, session: dict, plan: dict[str, str]) -> dict:
    """Answers each open turn as planned for its word: right, wrong_then_right, reveal (then the re-practice right)."""
    while session["status"] == "active" and session["open_turns"]:
        turn = session["open_turns"][0]
        todo = "right" if turn["practice"] else plan.get(key_of(turn), "right")
        if todo == "wrong_then_right":
            wrong = answer(client, who.headers, session, turn, value="zzzz").json()
            assert wrong["result"]["correct"] is False and wrong["result"]["retry_allowed"]
            turn = next(t for t in wrong["session"]["open_turns"] if t["turn_id"] == turn["turn_id"])
            session = answer(client, who.headers, wrong["session"], turn).json()["session"]
        elif todo == "reveal":
            session = post(client, who.headers, session, "reveal", turn_id=turn["turn_id"], client_event_id=eid()).json()["session"]
        else:
            session = answer(client, who.headers, session, turn).json()["session"]
    if session["can_complete"]:
        session = post(client, who.headers, session, "complete").json()["session"]
    return session


def test_empty_history_and_authentication(client, mai):
    assert history(client, mai) == {"items": [], "total": 0, "limit": 15, "offset": 0, "counts": {"all": 0, "correct": 0, "review": 0},
                                     "due": {"en_vi": 0, "vi_en": 0}}
    assert client.get(HISTORY).status_code == 401


def test_each_sense_is_its_own_entry_and_only_answers_without_help_count_as_right(client, mai):
    session = stage(client, mai, ["bank.money", "bank.river", "cold.weather"])
    play(client, mai, session, {"bank.money": "right", "bank.river": "wrong_then_right", "cold.weather": "reveal"})
    body = history(client, mai)
    items = by_key(body)
    assert set(items) == {"bank.money", "bank.river", "cold.weather"}
    money, river = items["bank.money"], items["bank.river"]
    assert money["word"] == river["word"] == "bank" and money["meaning_vi"] != river["meaning_vi"]  # two senses, two entries
    assert money["status"] == "correct" and money["directions"]["vi_en"] == {
        "correct": 1, "wrong": 0, "unanswered": 0, "last_result": "correct", "last_at": money["last_seen_at"]}
    assert river["status"] == "review" and river["wrong"] == 1  # wrong first, then fixed: still to review
    assert body["counts"] == {"all": 3, "correct": 1, "review": 2} and body["due"] == {"en_vi": 0, "vi_en": 2}

    cold = detail(client, mai, "cold.weather")
    assert cold["status"] == "review" and cold["directions"]["vi_en"]["wrong"] == 1 and cold["correct"] == 0
    assert [a["outcome"] for a in cold["attempts"]] == ["first_try", "revealed"]  # newest first
    assert [a["practice"] for a in cold["attempts"]] == [True, False]  # the re-practice is shown, never counted
    assert cold["phonetic"] and cold["example_en"] and cold["can_practice"]  # from the bank


def test_both_directions_are_kept_apart_and_the_latest_answer_of_each_decides(client, mai):
    played = stage(client, mai, ["cold.illness"], game="word_shooter")
    assert played["game"] == "word_shooter"
    play(client, mai, played, {})
    entry = by_key(history(client, mai))["cold.illness"]
    assert entry["status"] == "correct" and set(entry["directions"]) == {"en_vi"}

    # Việt → Anh: a wrong answer, then the stage ends with the turn open (recorded as wrong).
    meteor = stage(client, mai, ["cold.illness"])
    turn = meteor["open_turns"][0]
    answer(client, mai.headers, meteor, turn, value="zzzz")
    post(client, mai.headers, meteor, "abandon", reason="user_ended")
    entry = by_key(history(client, mai))["cold.illness"]
    assert entry["status"] == "review"  # Anh → Việt right does not cover Việt → Anh
    assert entry["directions"]["en_vi"]["last_result"] == "correct" and entry["directions"]["vi_en"]["last_result"] == "wrong"
    first_seen = entry["first_seen_at"]

    # "Luyện lại" in Việt → Anh, right this time: a review stage of the existing game, no completion reward.
    xp = client.get("/api/profile", headers=mai.headers).json()["xp"]
    started = client.post(f"{HISTORY.rsplit('/', 1)[0]}/practice", headers=mai.headers,
                          json={"game": "meteor", "entry_keys": ["cold.illness"], "timezone": "Asia/Ho_Chi_Minh"})
    assert started.status_code == 201, started.json()
    practice = started.json()
    assert practice["kind"] == "review" and practice["game"] == "meteor" and practice["required_count"] == 1
    done = play_all(client, mai.headers, practice)
    finished = post(client, mai.headers, done, "complete").json()["session"]
    assert finished["status"] == "completed" and finished["reward"]["exp"] == 0
    assert client.get("/api/profile", headers=mai.headers).json()["xp"] == xp

    entry = by_key(history(client, mai))["cold.illness"]
    assert entry["status"] == "correct" and entry["first_seen_at"] == first_seen and entry["last_seen_at"] > first_seen
    assert entry["directions"]["vi_en"] == {**entry["directions"]["vi_en"], "correct": 1, "wrong": 1, "last_result": "correct"}
    assert len(detail(client, mai, "cold.illness")["attempts"]) == 3


def test_an_interrupted_stage_shows_the_word_on_screen_as_unanswered_and_never_the_words_still_to_come(client, mai):
    session = stage(client, mai, ["bank.money", "cold.weather", "bank.river"])
    shown = key_of(session["open_turns"][0])
    paused = post(client, mai.headers, session, "pause").json()["session"]  # the app was closed mid-stage
    items = by_key(history(client, mai))
    assert list(items) == [shown]  # the other words were never on screen
    assert items[shown]["status"] == "review" and items[shown]["unanswered"] == 1

    # Back in the app, the same turn is answered: the same attempt is now right, not a second one.
    resumed = post(client, mai.headers, paused, "resume").json()["session"]
    answer(client, mai.headers, resumed, resumed["open_turns"][0])
    attempts = detail(client, mai, shown)["attempts"]
    assert len(attempts) == 1 and attempts[0]["result"] == "correct"

    current = client.get(f"/api/learning/sessions/{session['id']}", headers=mai.headers).json()
    post(client, mai.headers, current, "abandon", reason="user_ended")
    items = by_key(history(client, mai))
    left = [k for k, v in items.items() if v["unanswered"]]
    assert len(items) == 2 and len(left) == 1 and items[left[0]]["status"] == "review"


def test_a_resent_answer_or_a_replayed_sync_counts_once(client, mai):
    session = stage(client, mai, ["bank.money"])
    turn = session["open_turns"][0]
    event = eid()
    first = answer(client, mai.headers, session, turn, event_id=event)
    again = answer(client, mai.headers, session, turn, event_id=event)
    assert first.status_code == again.status_code == 200 and again.json()["replayed"]
    entry = by_key(history(client, mai))["bank.money"]
    assert entry["correct"] == 1 and entry["wrong"] == 0 and len(detail(client, mai, "bank.money")["attempts"]) == 1


def test_real_stages_of_both_games_are_recorded_and_replays_update_the_same_entries(client, mai):
    seen = {}
    for game in ("meteor", "word_shooter", "meteor"):  # the last one is "Chơi lại"
        started = client.post("/api/learning/play", headers=mai.headers, json={"game": game, "timezone": "Asia/Ho_Chi_Minh"}).json()
        session = post(client, mai.headers, started, "resume").json()["session"]
        session = play_all(client, mai.headers, session)
        post(client, mai.headers, session, "complete")
        from app.db import SessionLocal
        from app.models import LearningSessionItem
        import json
        with SessionLocal() as db:
            for item in db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"])):
                seen.setdefault(json.loads(item.answer_json)["entry_key"], set()).add(item.kind)
    body = history(client, mai)
    assert body["total"] == len(seen) and body["counts"]["all"] == len(seen)  # one entry per word, however often
    for item in history(client, mai, limit=100)["items"]:
        assert set(item["directions"]) == {"vi_en" if k == "vocab_typing" else "en_vi" for k in seen[item["entry_key"]]}
        assert item["status"] == "correct" and item["word"] and item["meaning_vi"]
    everything = history(client, mai, limit=100)["items"]
    times = [i["last_seen_at"] for i in everything]
    assert times == sorted(times, reverse=True)  # most recently studied first

    # 15 words a page by default; pages follow each other without gaps or repeats, filtered pages count their own total.
    assert len(seen) > 15 and body["total"] == len(seen) and len(body["items"]) == 15 and body["limit"] == 15
    second = history(client, mai, offset=15)
    assert [i["entry_key"] for i in body["items"] + second["items"]] == [i["entry_key"] for i in everything][:30]
    assert history(client, mai, offset=len(seen))["items"] == []
    assert client.get(HISTORY, headers=mai.headers, params={"limit": 0}).status_code == 422
    assert client.get(HISTORY, headers=mai.headers, params={"limit": 101}).status_code == 422


def test_search_by_word_or_meaning_and_filters(client, mai):
    session = stage(client, mai, ["bank.money", "bank.river", "cold.weather"])
    play(client, mai, session, {"bank.river": "wrong_then_right"})
    assert {i["entry_key"] for i in history(client, mai, q="BANK")["items"]} == {"bank.money", "bank.river"}
    assert [i["entry_key"] for i in history(client, mai, q="tien")["items"]] == ["bank.money"]  # "tiền", without accents
    assert [i["entry_key"] for i in history(client, mai, q="sông")["items"]] == ["bank.river"]
    assert [i["entry_key"] for i in history(client, mai, filter="review")["items"]] == ["bank.river"]
    assert {i["entry_key"] for i in history(client, mai, filter="correct")["items"]} == {"bank.money", "cold.weather"}
    assert history(client, mai, filter="review", q="tien")["items"] == []


def test_practising_the_review_group_uses_the_words_due_and_the_chosen_game(client, mai):
    session = stage(client, mai, ["bank.money", "bank.river", "cold.weather", "cold.illness"])
    play(client, mai, session, {"bank.river": "wrong_then_right", "cold.weather": "reveal"})
    response = client.post("/api/learning/vocabulary/practice", headers=mai.headers, json={"game": "word_shooter"})
    assert response.status_code == 201, response.json()
    practice = response.json()
    assert practice["kind"] == "review" and practice["game"] == "word_shooter" and practice["required_count"] == 2
    from app.db import SessionLocal
    from app.models import LearningSessionItem
    import json
    with SessionLocal() as db:
        items = list(db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == practice["id"])))
        assert {json.loads(i.answer_json)["entry_key"] for i in items} == {"bank.river", "cold.weather"}
        assert {i.kind for i in items} == {"word_spelling"}


def test_history_is_private(client, mai):
    play(client, mai, stage(client, mai, ["bank.money"]), {})
    other = person(client, "Linh")
    assert history(client, other)["items"] == []
    assert client.get(f"{HISTORY}/bank.money", headers=other.headers).status_code == 404
    response = client.post("/api/learning/vocabulary/practice", headers=other.headers,
                           json={"game": "meteor", "entry_keys": ["bank.money"]})
    assert response.status_code == 409 and response.json()["code"] == "no_words_to_practice"
    assert client.post("/api/learning/vocabulary/practice", headers=mai.headers, json={"game": "meteor"}).json()["code"] == "no_words_to_practice"
