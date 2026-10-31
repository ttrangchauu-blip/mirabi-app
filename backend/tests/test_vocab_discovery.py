"""Khám phá từ mới and Ôn tập: no word twice in a game, levels opened by the grade and by discovering every word of a
level, a celebration shown once, an adaptive share of harder words, and the school year of every discovery."""
import random

import pytest
from sqlalchemy import func, select, update

from app.vocab_discovery import (CHALLENGE_START, CHALLENGE_STEP, Known, Word, challenge_from, hard_share, hardness,
                                 pick_discovery, pick_review, policy_for)
from conftest import bearer, login, register
from test_learning_api import complete, drawn, eid, play_all, post, stored_answer

PLAY = "/api/learning/play"
PROGRESS = "/api/learning/vocabulary/progress"


# --- picking (pure) ---------------------------------------------------------------------------------------------

def pool(levels=(1, 2, 3), per_level=40, topic="food") -> list[Word]:
    return [Word(f"l{lv}_{i}", f"word{lv}x{i}", lv, topic, 3 + i % 9) for lv in levels for i in range(per_level)]


def test_a_discovery_stage_holds_only_new_words_of_the_open_levels_each_once_easy_to_hard():
    words = pool()
    discovered = {w.canonical for w in words[:10]}
    picked = pick_discovery(words, discovered, {1, 2}, 15, CHALLENGE_START, random.Random(1))
    assert len(picked) == 15 == len({w.canonical for w in picked})
    assert not {w.canonical for w in picked} & discovered
    assert {w.level for w in picked} <= {1, 2}  # level 3 is not open
    assert picked == sorted(picked, key=hardness)  # easy to hard


def test_two_senses_of_one_word_count_as_one_word():
    words = [Word("bank.money", "bank", 1, "money", 4), Word("bank.river", "bank", 1, "environment", 4)] + pool(per_level=20)
    for seed in range(20):
        picked = pick_discovery(words, set(), {1}, 15, 50, random.Random(seed))
        assert [w.canonical for w in picked].count("bank") <= 1
    assert not [w for w in pick_discovery(words, {"bank"}, {1}, 30, 50, random.Random(0)) if w.canonical == "bank"]


def test_with_seven_new_words_left_a_stage_has_seven_and_with_none_it_is_empty():
    words = pool(levels=(1,), per_level=22)
    seen = {w.canonical for w in words[:15]}
    left = pick_discovery(words, seen, {1}, 15, 30, random.Random(2))
    assert len(left) == 7 and not {w.canonical for w in left} & seen  # never 8 old words to fill up
    assert pick_discovery(words, {w.canonical for w in words}, {1}, 15, 30, random.Random(2)) == []


def test_ten_stages_in_a_row_never_repeat_a_word():
    words = pool(levels=(1, 2), per_level=100)
    seen: set[str] = set()
    for stage in range(10):
        picked = pick_discovery(words, seen, {1, 2}, 15, 30 + stage * 5, random.Random(stage))
        assert len(picked) == 15 and not {w.canonical for w in picked} & seen
        seen |= {w.canonical for w in picked}
    assert len(seen) == 150


def test_a_higher_challenge_brings_harder_words_but_never_the_hardest_at_once():
    words = pool(levels=(1, 2), per_level=200)
    def mean_hardness(challenge):
        ranks = {w.key: i for i, w in enumerate(sorted(words, key=hardness))}
        return sum(sum(ranks[w.key] for w in pick_discovery(words, set(), {1, 2}, 15, challenge, random.Random(s)))
                   for s in range(10)) / 150
    low, mid, high = mean_hardness(0), mean_hardness(50), mean_hardness(100)
    assert low < mid < high
    hardest = {w.key for w in sorted(words, key=hardness)[-50:]}
    assert not any(w.key in hardest for w in pick_discovery(words, set(), {1, 2}, 15, 100, random.Random(3)))
    assert hard_share(0) < hard_share(50) < hard_share(100) <= 0.7


def test_the_challenge_moves_one_step_per_stage_up_after_good_ones_and_down_after_bad_ones():
    assert challenge_from([]) == CHALLENGE_START
    good, bad, middle = (14, 15, 4.0), (5, 15, 9.0), (11, 15, 6.0)
    assert challenge_from([good]) == CHALLENGE_START + CHALLENGE_STEP  # never more than one step for one stage
    assert challenge_from([good, good, good]) == CHALLENGE_START + 3 * CHALLENGE_STEP
    assert challenge_from([good, bad]) == CHALLENGE_START
    assert challenge_from([bad, bad, bad, bad, bad]) == 0  # bounded
    assert challenge_from([middle, middle]) == CHALLENGE_START
    assert challenge_from([(15, 15, 30.0)]) == CHALLENGE_START  # right but slow: not yet harder
    assert challenge_from([(2, 3, 2.0)]) == CHALLENGE_START  # too few answers to say anything


def test_review_puts_wrong_words_first_then_those_due_and_each_word_once():
    now = 1_000_000_000.0
    day = 86400
    known = [Known("fresh", "fresh", 95, 0, now - day),  # mastered, seen yesterday: not due
             Known("due", "due", 50, 0, now - 5 * day),  # mastery 50 waits 3 days: due
             Known("wrong", "wrong", 20, 3, now - 60), Known("wrong2", "wrong2", 10, 1, now - 60),
             Known("bank.money", "bank", 30, 0, now - 9 * day), Known("bank.river", "bank", 30, 0, now - 9 * day)]
    picked = [k.key for k in pick_review(known, {"wrong", "wrong2"}, now, 12)]
    assert picked[:2] == ["wrong", "wrong2"]  # most mistakes first
    assert picked.index("due") < picked.index("fresh") and picked[-1] == "fresh"
    assert sum(k.startswith("bank.") for k in picked) == 1


def test_a_grade_starts_low_and_never_reaches_beyond_its_ceiling():
    assert (policy_for("grade1").start, policy_for("grade1").ceiling) == (1, 1)
    assert policy_for("grade4").ceiling == 2 and "law" in policy_for("grade4").blocked_topics
    assert (policy_for("grade8").start, policy_for("grade8").ceiling) == (2, 4)
    assert (policy_for("grade11").start, policy_for("grade11").ceiling) == (3, 5)
    assert (policy_for("adult").start, policy_for("adult").ceiling) == (1, 5)


# --- through the API (the real bank) ------------------------------------------------------------------------------

def learner(client, email="an@example.com", **profile) -> dict:
    assert register(client, email=email, **profile).status_code == 201
    return bearer(login(client, email=email).json()["access_token"])


def play_stage(client, me, game="meteor", **body) -> dict:
    response = client.post(PLAY, headers=me, json={"game": game, "mode": "practice", "timezone": "Asia/Ho_Chi_Minh", **body})
    assert response.status_code == 201, response.json()
    return response.json()


def finish(client, me, session) -> dict:
    session = post(client, me, session, "resume").json()["session"]
    return complete(client, me, play_all(client, me, session))


def progress(client, me, game="meteor") -> dict:
    response = client.get(PROGRESS, headers=me, params={"game": game})
    assert response.status_code == 200, response.json()
    return response.json()


def keep_only(db, topic: str, n: int, difficulty: int = 1) -> list[str]:
    """Test setup: a bank where level 1 has `n` words (of one topic); every other level-1 word is retired."""
    from app.models import LearningVocabEntry as E
    keep = list(db.scalars(select(E.entry_key).where(E.status == "active", E.difficulty == difficulty, E.topic == topic)
                           .order_by(E.entry_key)))
    words, kept = set(), []
    for key in keep:  # one sense per word, so n entries are n words
        word = db.scalar(select(E.word).where(E.entry_key == key)).lower()
        if word not in words and len(kept) < n:
            words.add(word)
            kept.append(key)
    db.execute(update(E).where(E.difficulty == difficulty, E.entry_key.not_in(kept), E.status == "active").values(status="retired"))
    db.commit()
    return kept


def test_ten_stages_and_a_new_sign_in_never_bring_a_word_back(client):
    me = learner(client, age=16, school_grade="grade10")
    seen: set[str] = set()
    for _ in range(9):
        words = {w["word"].lower() for w in drawn(finish(client, me, play_stage(client, me)))}
        assert len(words) == 15 and not words & seen
        seen |= words
    # Signed in again (another phone): the history is the account's, not the device's.
    other_phone = bearer(login(client, email="an@example.com").json()["access_token"])
    words = {w["word"].lower() for w in drawn(finish(client, other_phone, play_stage(client, other_phone)))}
    assert len(words) == 15 and not words & seen
    assert progress(client, other_phone)["discovered"] == 150
    # The other game has its own history: its first stage is new words there, whatever was played here.
    assert len(drawn(play_stage(client, me, game="word_shooter"))) == 15


def test_only_words_put_on_screen_are_discovered_and_replay_brings_new_ones(client, db):
    from app.models import VocabDiscovery
    me = learner(client, age=11, school_grade="grade6")
    session = play_stage(client, me)
    words = [w["word"].lower() for w in drawn(session)]
    assert db.scalar(select(func.count()).select_from(VocabDiscovery)) == 0  # paused before the countdown: nothing shown
    session = post(client, me, session, "resume").json()["session"]
    turn = session["open_turns"][0]
    post(client, me, session, "answer", turn_id=turn["turn_id"], client_event_id=eid(), answer=stored_answer(turn)["accepted"][0])
    post(client, me, session, "abandon")
    shown = set(db.scalars(select(VocabDiscovery.canonical)))
    assert 1 <= len(shown) < 15 and shown <= set(words)
    replay = {w["word"].lower() for w in drawn(play_stage(client, me))}  # "Chơi lại"
    assert not replay & shown


def test_a_short_stage_then_the_end_of_new_words_without_any_reset(client, db):
    me = learner(client, age=7, school_grade="grade2")  # level 1 only
    kept = keep_only(db, "animals", 22)
    first = finish(client, me, play_stage(client, me))
    assert first["required_count"] == 15
    second = play_stage(client, me)
    assert second["required_count"] == 7  # the 7 words left, not 8 old ones to fill up
    assert second["status"] == "paused" and finish(client, me, second)["reward"]["status"] in ("granted", "already_claimed")
    third = client.post(PLAY, headers=me, json={"game": "meteor", "mode": "practice", "timezone": "UTC"})
    assert third.status_code == 409 and third.json()["code"] == "vocabulary_exhausted"
    body = progress(client, me)
    assert body["discovered"] == len(kept) == 22 and body["new_words_left"] == 0  # the history is kept, never reset
    review = play_stage(client, me, vocab="review")  # Ôn tập brings them back
    assert review["kind"] == "review" and 1 <= review["required_count"] <= 12


def test_discovering_a_whole_level_opens_the_next_one_and_is_celebrated_once(client, db):
    from app.models import LearningVocabEntry as E, VocabLevelProgress
    me = learner(client, age=9, school_grade="grade4")  # levels 1 and 2
    start = progress(client, me)
    assert [l["status"] for l in start["levels"]] == ["unlocked", "locked", "above_grade", "above_grade", "above_grade"]
    assert start["celebration"] is None and start["current_level"] == 1
    keep_only(db, "food", 15)
    stage = drawn(finish(client, me, play_stage(client, me)))
    assert {w["difficulty"] for w in stage} == {1}  # level 2 was still locked
    body = progress(client, me)
    assert [l["status"] for l in body["levels"]][:2] == ["completed", "unlocked"] and body["current_level"] == 2
    party = body["celebration"]
    assert party["level"] == 1 and party["words"] == 15 and party["next_level"] == 2
    assert "Bạn đã khám phá 15 từ" in party["message"]
    assert progress(client, me)["celebration"] == party  # until it is shown
    shown = client.post("/api/learning/vocabulary/levels/meteor/1/celebrated", headers=me)
    assert shown.status_code == 200 and client.post("/api/learning/vocabulary/levels/meteor/1/celebrated", headers=me).status_code == 200
    assert progress(client, me)["celebration"] is None
    assert client.post("/api/learning/vocabulary/levels/meteor/2/celebrated", headers=me).status_code == 404
    # The next stage reaches level 2.
    assert any(w["difficulty"] == 2 for w in drawn(play_stage(client, me)))
    post(client, me, client.get("/api/learning/sessions/current", headers=me).json()["session"], "abandon")
    # New words added to level 1 later: the level stays completed and open, nothing is celebrated again, and the new
    # words are new words to discover.
    db.execute(update(E).where(E.difficulty == 1, E.topic == "food", E.status == "retired").values(status="active"))
    db.commit()
    later = progress(client, me)
    assert later["levels"][0]["status"] == "completed" and later["levels"][0]["discovered"] == 15 and later["celebration"] is None
    assert db.scalar(select(func.count()).select_from(VocabLevelProgress).where(VocabLevelProgress.level == 1)) == 1
    assert any(w["difficulty"] == 1 for w in drawn(play_stage(client, me)))


def test_a_grade_never_gets_words_above_its_level_or_from_topics_left_out(client, db):
    from app.models import LearningVocabEntry as E
    me = learner(client, age=6, school_grade="grade1")
    for _ in range(3):
        stage = drawn(finish(client, me, play_stage(client, me)))
        assert {w["difficulty"] for w in stage} == {1}
    keys = [w["entry_key"] for w in progress_keys(db)]
    assert not set(db.scalars(select(E.topic).where(E.entry_key.in_(keys)))) & policy_for("grade1").blocked_topics
    refused = client.post(PLAY, headers=me, json={"game": "meteor", "mode": "practice", "timezone": "UTC", "topic": "law"})
    assert refused.status_code == 409 and refused.json()["code"] == "topic_not_available"
    # The grade is the account's: another one sent by the app is refused.
    other = client.post(PLAY, headers=me, json={"game": "meteor", "mode": "practice", "timezone": "UTC", "grade": "grade9"})
    assert other.status_code == 403 and other.json()["code"] == "grade_locked"
    assert all(l["status"] == "above_grade" for l in progress(client, me)["levels"][1:])


def progress_keys(db) -> list[dict]:
    from app.models import VocabDiscovery
    return [{"entry_key": d.entry_key} for d in db.scalars(select(VocabDiscovery))]


def test_a_topic_stage_draws_only_that_topic_and_good_stages_raise_the_challenge(client, db):
    from app.models import LearningVocabEntry as E
    me = learner(client, age=13, school_grade="grade8")
    session = play_stage(client, me, topic="animals")
    animals = set(db.scalars(select(E.word).where(E.topic == "animals")))
    assert {w["word"] for w in drawn(session)} <= animals and session["topic"]["code"] == "animals"
    finish(client, me, session)
    assert progress(client, me)["challenge"] == CHALLENGE_START + CHALLENGE_STEP  # right at once, quickly
    finish(client, me, play_stage(client, me))
    assert progress(client, me)["challenge"] == CHALLENGE_START + 2 * CHALLENGE_STEP
    topics = {t["code"]: t for t in progress(client, me)["topics"]}
    assert topics["animals"]["new_words_left"] < topics["animals"]["total"]


def test_review_writes_no_discovery_and_a_school_year_keeps_its_own_words(client, db):
    from app import education
    from app.models import User, VocabDiscovery, VocabLevelProgress
    me = learner(client, age=10, school_grade="grade5")
    finish(client, me, play_stage(client, me))
    user = db.scalar(select(User).where(User.email == "an@example.com"))
    year = education.learning_year(db, user.id)
    assert year is not None and set(db.scalars(select(VocabDiscovery.academic_year))) == {year}
    before = db.scalar(select(func.count()).select_from(VocabDiscovery))
    levels_before = [(r.level, r.completed_at) for r in db.scalars(select(VocabLevelProgress))]
    finish(client, me, play_stage(client, me, vocab="review"))
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(VocabDiscovery)) == before
    assert [(r.level, r.completed_at) for r in db.scalars(select(VocabLevelProgress))] == levels_before
    # The word list of a school year and of another one.
    words = client.get("/api/learning/vocabulary/history", headers=me, params={"year": year}).json()
    assert words["total"] == 15 and all(i["level"] == 1 and i["topic"] for i in words["items"])
    assert client.get("/api/learning/vocabulary/history", headers=me, params={"year": year - 1}).json()["total"] == 0
    # Reviewing a finished year (Kho lưu trữ) is an archive stage: it never fills this year's "Cần ôn".
    archived = client.post("/api/learning/vocabulary/practice", headers=me,
                           json={"game": "meteor", "year": year - 1, "entry_keys": ["x"], "timezone": "UTC"})
    assert archived.status_code == 409 and archived.json()["code"] == "no_words_to_practice"


def test_the_notebook_filters_by_memory_topic_and_level(client, db):
    me = learner(client, age=12, school_grade="grade7")
    finish(client, me, play_stage(client, me))
    body = client.get("/api/learning/vocabulary/history", headers=me).json()
    assert body["counts"]["all"] == 15 and body["counts"]["learned"] + body["counts"]["mastered"] == 15
    topic = body["items"][0]["topic"]
    by_topic = client.get("/api/learning/vocabulary/history", headers=me, params={"topic": topic}).json()
    assert by_topic["total"] >= 1 and all(i["topic"] == topic for i in by_topic["items"])
    assert {t["code"] for t in body["topics"]} >= {topic}
    assert client.get("/api/learning/vocabulary/history", headers=me, params={"level": 5}).json()["total"] == 0
    assert all(i["memory"] in ("learned", "mastered") for i in body["items"])
    assert client.get("/api/learning/vocabulary/history", headers=me, params={"filter": "review"}).json()["total"] == 0


@pytest.mark.parametrize("game", ["meteor", "word_shooter"])
def test_progress_needs_sign_in_and_a_known_game(client, game):
    assert client.get(PROGRESS, params={"game": game}).status_code == 401
    me = learner(client, age=8, school_grade="grade3")
    assert client.get(PROGRESS, headers=me, params={"game": "gate"}).status_code == 422
    body = progress(client, me, game)
    assert body["game"] == game and body["discovered"] == 0 and body["new_words_left"] > 100 and body["review_due"] == 0


def test_words_kept_for_older_grades_are_never_served_to_younger_ones(db):
    """vocab_grade_limits.tsv: romance words and insults wait until lớp 6, whatever their level; outside school no limit."""
    from app.vocab_discovery import bank_rows, grade_limits, senses
    limits = grade_limits()
    assert limits["boyfriend"] == 6 and limits["stupid"] == 6
    rows = bank_rows(db)
    keys = lambda grade: {w.key for w in senses(rows, policy_for(grade), "word_shooter")}
    assert not keys("grade3") & set(limits)
    assert {"boyfriend", "stupid", "kiss"} <= keys("grade6") and {"boyfriend", "stupid"} <= keys("adult")
