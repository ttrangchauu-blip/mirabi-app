"""Khám phá từ mới in a lesson's vocabulary games (app/vocab_lesson.py): the lesson's own words first, then new words of
its themes, related themes and the next level; never a word of a higher grade's or a locked lesson, never a word again
in the same game (whatever the lesson), easy to hard, and 409 vocabulary_exhausted instead of old words.
The pure picker is tested on small banks; the API tests play whole stages of the test catalog's lesson."""
import json
import random
from types import SimpleNamespace

from sqlalchemy import select

from app import lesson_catalog as lc
from app import vocab_discovery as vd
from app import vocab_lesson as vl
from app.db import SessionLocal
from app.models import LearningSessionItem, VocabDiscovery

from test_lesson_catalog import account, answer, fixture_catalog, right_answer, start  # noqa: F401 (fixture)


def word(key, level=1, topic="animals", canon=None):
    return vd.Word(key, canon or key, level, topic, float(len(key)))


def bank(n_core=20, n_topic=40, n_related=30, n_next=20, n_other=30):
    core = [word(f"core{i}", 1, "animals") for i in range(n_core)]
    topic = [word(f"topic{i}", 1 + i % 2, "animals") for i in range(n_topic)]
    related = [word(f"rel{i}", 1 + i % 2, "environment") for i in range(n_related)]
    above = [word(f"next{i}", 3, "animals") for i in range(n_next)]
    other = [word(f"other{i}", 1, "law") for i in range(n_other)]  # neither the lesson's theme nor related
    return core + topic + related + above + other, [w.key for w in core]


def scope(allowed, words, found=frozenset(), unlocked=frozenset({1, 2}), ceiling=3, blocked=frozenset(),
          opened=frozenset({"environment"}), challenge=vd.CHALLENGE_START):
    return vl.build_scope(allowed, words, set(found), set(unlocked), ceiling, set(blocked), set(opened), challenge)


def play_through(allowed, words, rounds=100, **kw):
    """Stage after stage, every word put on screen is discovered: the stages until nothing new is left."""
    found: set[str] = set()
    stages = []
    for r in range(rounds):
        sc = scope(allowed, words, found=found, **kw)
        picked = vl.pick(sc, vd.STAGE_WORDS, random.Random(r))
        if not picked:
            break
        stages.append(picked)
        found |= {w.canonical for w, _ in picked}
    return stages


# ---------- the picker ----------

def test_a_lesson_of_20_words_goes_on_with_new_words_of_its_theme_after_them():
    allowed, words = bank()
    stages = play_through(allowed, words)
    first, second = stages[0], stages[1]
    assert [s for _, s in first] == ["core"] * 15  # its own words first
    sources = [s for _, s in second]
    assert sources.count("core") == 5 and sources.count("topic") == 10  # the last 5, then the theme: never a short stage
    assert all(w.topic == "animals" for w, s in second if s == "topic")  # extension words are of the lesson's theme
    # The order of the tiers: a tier comes in only once the ones before it are used up (a stage is then sorted easy
    # to hard, so tiers can share the stage where one ends and the next begins).
    tiers = ["core", "topic", "related", "next_level"]
    span = {t: [i for i, stage in enumerate(stages) if any(s == t for _, s in stage)] for t in tiers}
    assert all(span[t] for t in tiers)
    assert all(span[a][-1] <= span[b][0] for a, b in zip(tiers, tiers[1:]))
    assert all(w.topic != "law" for stage in stages for w, _ in stage)  # an unrelated theme never comes in


def test_no_word_ever_comes_back_and_none_is_left_out_until_everything_is_discovered():
    allowed, words = bank()
    stages = play_through(allowed, words)
    served = [w.canonical for stage in stages for w, _ in stage]
    assert len(served) == len(set(served))  # never twice, in a stage or across stages
    assert all(len(stage) <= 15 and len({w.canonical for w, _ in stage}) == len(stage) for stage in stages)
    expected = {w.canonical for w in allowed if w.topic != "law"}
    assert set(served) == expected  # 20 core + 40 theme + 30 related + 20 next level
    assert len(stages) == 8 and len(stages[-1]) == 110 - 7 * 15  # the last stage is the 5 words left, not padded


def test_with_nothing_new_left_the_stage_is_empty_never_old_words():
    allowed, words = bank()
    everything = {w.canonical for w in allowed}
    assert vl.pick(scope(allowed, words, found=everything), 15, random.Random(1)) == []


def test_a_word_of_two_themes_is_one_word():
    allowed, words = bank(n_core=3, n_topic=0, n_related=0, n_next=0, n_other=0)
    allowed += [word("bat.animal", 1, "animals", canon="bat"), word("bat.sport", 1, "environment", canon="bat")]
    stages = play_through(allowed, words)
    served = [w.canonical for stage in stages for w, _ in stage]
    assert served.count("bat") == 1
    # Discovered in this game through another lesson or free practice: not new here either.
    assert all(w.canonical != "bat" for w, _ in vl.pick(scope(allowed, words, found={"bat"}), 15, random.Random(2)))


def test_words_of_a_higher_grade_or_a_locked_lesson_are_never_served():
    allowed, words = bank()
    locked = {"topic0", "topic1", "rel0"}
    stages = play_through(allowed, words, blocked=locked)
    served = {w.key for stage in stages for w, _ in stage}
    assert not served & locked
    # The lesson's own words stay its own even when another lesson lists them too.
    stages = play_through(allowed, words, blocked={"core0"})
    assert "core0" in {w.key for stage in stages[:2] for w, s in stage if s == "core"}


def test_the_bundled_catalog_blocks_higher_grades_and_locked_lessons_of_the_grade():
    lc.catalog.cache_clear()
    try:
        own = set(lc.game_spec(lc.lesson("ta3.tu_vung_gia_dinh"), "meteor")["words"])
        higher = set(lc.game_spec(lc.lesson("ta4.ngoi_nha"), "meteor")["words"])
        lower = set(lc.game_spec(lc.lesson("ta1.con_vat"), "meteor")["words"])
        blocked = vl._higher_or_locked_words(3, unlocked=set())  # ta3's lesson locked
        assert own <= blocked and higher <= blocked and not lower & blocked
        assert not own & vl._higher_or_locked_words(3, unlocked={"ta3.tu_vung_gia_dinh"})
    finally:
        lc.catalog.cache_clear()


def test_related_themes_must_be_opened_by_the_grade():
    allowed, words = bank()
    stages = play_through(allowed, words, opened=frozenset())  # the grade has not opened "environment"
    assert all(w.topic != "environment" for stage in stages for w, _ in stage)


def test_levels_stay_within_the_open_ones_plus_the_next_never_above_the_grade():
    allowed, words = bank()
    assert all(w.level <= 2 for stage in play_through(allowed, words, ceiling=2) for w, _ in stage)  # no next level
    stages = play_through(allowed, words, ceiling=3)
    assert {w.level for stage in stages for w, s in stage if s == "next_level"} == {3}
    # Easy to hard within every stage.
    assert all([vd.hardness(w) for w, _ in stage] == sorted(vd.hardness(w) for w, _ in stage) for stage in stages)


def test_doing_well_brings_a_few_harder_words_doing_badly_none():
    allowed, words = bank()
    found = {f"core{i}" for i in range(20)}  # the lesson's own words are done
    easy = vl.pick(scope(allowed, words, found=found, challenge=20), 15, random.Random(3))
    good = vl.pick(scope(allowed, words, found=found, challenge=65), 15, random.Random(3))
    great = vl.pick(scope(allowed, words, found=found, challenge=90), 15, random.Random(3))
    count = lambda p: sum(s == "next_level" for _, s in p)
    assert (count(easy), count(good), count(great)) == (0, 2, 3)  # gradually, never a whole stage at once
    # Doing badly: the easier new words of the theme come first.
    levels = [w.level for w, s in easy if s == "topic"]
    assert sum(lv == 1 for lv in levels) >= sum(lv == 2 for lv in levels)


def test_a_lesson_never_goes_far_below_its_own_level():
    core = [word(f"core{i}", 3, "animals") for i in range(5)]
    allowed = core + [word(f"l{lv}_{i}", lv, "animals") for lv in (1, 2, 3) for i in range(5)]
    sc = scope(allowed, [w.key for w in core], unlocked={1, 2, 3}, ceiling=4)
    assert {w.level for w in sc.topic} == {2, 3}


def test_every_bundled_vocabulary_lesson_has_hundreds_of_words_within_its_grade():
    lc.catalog.cache_clear()
    try:
        rows = vl.report()
    finally:
        lc.catalog.cache_clear()
    assert len(rows) == 12
    for row in rows:
        for game in vd.GAMES:
            r = row[game]
            assert r["total"] >= 80, (row["lesson"], game, r)  # was 15: the lesson's own words only
            assert max(map(int, r["by_level"])) <= row["ceiling"]
    assert all(row["meteor"]["total"] >= 400 for row in rows if row["grade"] >= 7)


# ---------- through the API ----------

def _stage_words(session_id: int) -> list[dict]:
    with SessionLocal() as db:
        items = db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session_id)
                           .order_by(LearningSessionItem.position)).all()
        return [json.loads(i.answer_json) for i in items]


def play_stage(client, me, key, game):
    """Start a stage and answer every word right; returns its words (entry keys) in the order served."""
    session = start(client, me, key, game)
    words = [a["entry_key"] for a in _stage_words(session["id"])]
    while not session["can_complete"]:
        turn = session["open_turns"][0]
        res = answer(client, me, session["id"], turn["turn_id"], right_answer(turn)).json()
        assert res["result"]["correct"], res
        session = res["session"]
        if not session["open_turns"] and not session["can_complete"]:
            session = client.post(f"/api/learning/sessions/{session['id']}/next", headers=me, json={"count": 3}).json()["session"]
    done = client.post(f"/api/learning/sessions/{session['id']}/complete", headers=me, json={}).json()["session"]
    assert done["status"] == "completed"
    return words


def canon(entry_key: str) -> str:
    with SessionLocal() as db:
        from app.models import LearningVocabEntry
        return vd.canonical(db.scalar(select(LearningVocabEntry.word).where(LearningVocabEntry.entry_key == entry_key)))


def test_play_again_brings_new_words_beyond_the_lesson_and_keeps_its_progress(fixture_catalog, client):
    me = account(client, age=9, school_grade="grade3")
    own = set(lc.game_spec(lc.lesson("ta3.tu_vung_gia_dinh"), "word_shooter")["words"])  # 8 words
    detail = client.get("/api/learning/lesson-catalog/ta3.tu_vung_gia_dinh", headers=me).json()
    shooter = next(g for g in detail["games"] if g["game"] == "word_shooter")
    assert shooter["turns"] == 15 and not shooter["short_stage"]  # 8 own words + new ones: a whole stage
    assert shooter["explore"]["core_total"] == 8 and shooter["explore"]["new_words_left"] > 60

    first = play_stage(client, me, "ta3.tu_vung_gia_dinh", "word_shooter")
    assert len(first) == 15 and own <= set(first)  # every own word, then 7 of the theme
    seen = {canon(k) for k in first}
    for _ in range(3):  # "Chơi lại": only words never shown in this game
        stage = play_stage(client, me, "ta3.tu_vung_gia_dinh", "word_shooter")
        words = {canon(k) for k in stage}
        assert len(stage) == len(words) == 15 and not words & seen
        seen |= words
    with SessionLocal() as db:
        found = set(db.scalars(select(VocabDiscovery.canonical).where(VocabDiscovery.game == "word_shooter")))
    assert seen <= found  # kept on the server, per account and game

    detail = client.get("/api/learning/lesson-catalog/ta3.tu_vung_gia_dinh", headers=me).json()
    shooter = next(g for g in detail["games"] if g["game"] == "word_shooter")
    assert shooter["explore"]["core_completed"] and shooter["explore"]["core_discovered"] == 8
    assert shooter["progress"]["stages"] == 4 and shooter["progress"]["passed"]  # the lesson's own progress, unchanged rules
    # The other game keeps its own history: its first stage starts with the lesson's own words again.
    meteor = {canon(k) for k in play_stage(client, me, "ta3.tu_vung_gia_dinh", "meteor")}
    assert meteor & {canon(k) for k in own}


def test_words_left_unseen_when_a_stage_ends_early_stay_new(fixture_catalog, client):
    me = account(client, age=9, school_grade="grade3")
    session = start(client, me, "ta3.tu_vung_gia_dinh", "word_shooter")
    shown = {a["entry_key"] for a in _stage_words(session["id"])[:1]}
    client.post(f"/api/learning/sessions/{session['id']}/abandon", headers=me, json={"reason": "user_ended"})
    with SessionLocal() as db:
        found = set(db.scalars(select(VocabDiscovery.entry_key).where(VocabDiscovery.game == "word_shooter")))
    assert found and len(found) < 15  # only the words put on screen
    again = start(client, me, "ta3.tu_vung_gia_dinh", "word_shooter")
    assert not shown & {a["entry_key"] for a in _stage_words(again["id"])}


def test_an_exhausted_lesson_says_so_and_offers_review_instead_of_old_words(fixture_catalog, client, monkeypatch):
    me = account(client, age=9, school_grade="grade3")
    play_stage(client, me, "ta3.tu_vung_gia_dinh", "word_shooter")
    real = vl.build_scope

    def nothing_new(allowed, words, found, *args, **kwargs):  # the whole scope discovered
        sc = real(allowed, words, found, *args, **kwargs)
        sc.found |= {w.canonical for w in sc.core + sc.topic + sc.related + sc.next_level}
        return sc
    monkeypatch.setattr(vl, "build_scope", nothing_new)
    res = start(client, me, "ta3.tu_vung_gia_dinh", "word_shooter", expect=409)
    assert res["code"] == "vocabulary_exhausted"
    detail = client.get("/api/learning/lesson-catalog/ta3.tu_vung_gia_dinh", headers=me).json()
    shooter = next(g for g in detail["games"] if g["game"] == "word_shooter")
    assert shooter["explore"]["exhausted"] and shooter["turns"] == 0
    review = client.post("/api/learning/play", headers=me, json={"game": "word_shooter", "mode": "practice", "vocab": "review"})
    assert review.status_code == 201 and review.json()["kind"] == "review"  # Ôn tập: words already met


def test_an_archive_replay_keeps_the_lessons_own_words(fixture_catalog, client):
    """Kho lưu trữ reviews a finished year's lesson: its own words only, and nothing is discovered."""
    from app.learning import create_session
    from app.models import LearningLesson, User
    account(client, age=9, school_grade="grade3")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "lesson@example.com"))
        lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == lc.lesson_code("ta3.tu_vung_gia_dinh", "word_shooter")))
        s = create_session(db, user, lesson=lesson, mode="practice", duration_minutes=25, variant="word_shooter",
                           device_zone="UTC", kind="archive", idempotency_key=None, start_paused=True, archive_year=2025)
        keys = {json.loads(i.answer_json)["entry_key"] for i in db.scalars(
            select(LearningSessionItem).where(LearningSessionItem.session_id == s.id))}
    own = set(lc.game_spec(lc.lesson("ta3.tu_vung_gia_dinh"), "word_shooter")["words"])
    assert keys == own
