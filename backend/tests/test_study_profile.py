"""Age and school grade: registration, Cài đặt, validation, upgrade of older databases and the Học tập suggestions."""
import json
import random
from typing import get_args

import pytest
from sqlalchemy import create_engine, select, text

from app import learning_content, learning_vocab
from app.learning import GameId
from app.learning_vocab import Entry, pick_entries
from app.migrations import upgrade_schema
from app.models import LearningSessionItem, LearningVocabEntry
from app.study_profile import (AGE_MAX, AGE_MIN, GRADE_IDS, grade_fits_age, preferred_vocab_topics, recommendations,
                               suggest_grade)
from conftest import bearer, login, register


def headers(client, **profile) -> dict:
    assert register(client, **profile).status_code == 201
    return bearer(login(client).json()["access_token"])


# ---------- the curriculum configuration ----------

@pytest.mark.parametrize("age, grade", [(4, "preschool"), (5, "preschool"), (6, "grade1"), (10, "grade5"), (17, "grade12"),
                                        (18, "university"), (22, "university"), (23, "adult"), (AGE_MAX, "adult")])
def test_age_suggests_a_grade(age, grade):
    assert suggest_grade(age) == grade


def test_every_suggestion_fits_its_age_and_every_age_has_choices():
    for age in range(AGE_MIN, AGE_MAX + 1):
        assert grade_fits_age(suggest_grade(age), age)
        choices = [g for g in GRADE_IDS if grade_fits_age(g, age)]
        assert len(choices) >= (1 if age == AGE_MIN else 2)  # from 5 on the user can always change the suggestion


def test_suggestions_only_name_existing_content():
    games = set(get_args(GameId))
    vocab_topics = {code for code, _, _ in learning_vocab.TOPICS}
    math_levels = {code for code, _, _ in learning_content.LEVELS["math"]}
    math_topics = {code for code, *_ in learning_content.TOPICS["math"]}
    for grade in GRADE_IDS:
        rec = recommendations(grade)
        assert set(rec["subjects"]) <= {"english", "math", "vietnamese", "science", "informatics"} and rec["subjects"]
        assert set(rec["games"]) <= games and rec["games"]
        assert rec["math_level"] in math_levels
        assert set(rec["topics"]["english"]) <= vocab_topics and rec["topics"]["english"]
        assert set(rec["topics"]["math"]) <= math_topics
    assert recommendations(None) is None and recommendations("grade13") is None


# ---------- registration ----------

def test_register_saves_age_and_confirmed_grade(client):
    res = register(client, age=11, school_grade="grade5")  # suggestion is grade 6; the user said grade 5
    assert res.status_code == 201
    assert (res.json()["age"], res.json()["school_grade"]) == (11, "grade5")
    me = client.get("/api/auth/me", headers=bearer(login(client).json()["access_token"])).json()
    assert (me["age"], me["school_grade"]) == (11, "grade5")


def test_register_without_profile_still_works_for_older_apps(client):
    res = register(client)
    assert res.status_code == 201
    assert res.json()["age"] is None and res.json()["school_grade"] is None


@pytest.mark.parametrize("profile", [
    {"age": 10},                                   # grade missing
    {"school_grade": "grade5"},                    # age missing
    {"age": AGE_MIN - 1, "school_grade": "preschool"},
    {"age": AGE_MAX + 1, "school_grade": "adult"},
    {"age": "10", "school_grade": "grade5"},      # free text is not a number
    {"age": 10.5, "school_grade": "grade5"},
    {"age": True, "school_grade": "grade1"},
    {"age": 10, "school_grade": "grade13"},
    {"age": 10, "school_grade": "Lớp 5"},
    {"age": 30, "school_grade": "grade1"},        # does not fit the age
    {"age": 6, "school_grade": "university"},
    {"age": 20, "school_grade": "preschool"},
])
def test_register_rejects_invalid_profile(client, profile):
    assert register(client, **profile).status_code == 422
    assert login(client).status_code == 401  # nothing was created


# ---------- Cài đặt / Học tập ----------

def test_existing_account_fills_in_and_edits_its_profile(client):
    me = headers(client)
    assert client.get("/api/learning/catalog", headers=me).json()["study_profile"] is None
    res = client.put("/api/profile/study", headers=me, json={"age": 8, "school_grade": "grade3"})
    assert res.status_code == 200 and (res.json()["age"], res.json()["school_grade"]) == (8, "grade3")
    rec = client.get("/api/learning/catalog", headers=me).json()["study_profile"]
    assert rec["grade"] == "grade3" and rec["grade_label"] == "Lớp 3" and rec["math_level"] == "grade3"
    res = client.put("/api/profile/study", headers=me, json={"age": 30, "school_grade": "adult"})
    assert res.json()["school_grade"] == "adult"
    assert client.get("/api/learning/catalog", headers=me).json()["study_profile"]["subjects"] == ["english", "informatics"]


@pytest.mark.parametrize("body", [{}, {"age": 8}, {"school_grade": "grade3"}, {"age": 8, "school_grade": "grade12"},
                                  {"age": "8", "school_grade": "grade3"}, {"age": None, "school_grade": None}])
def test_study_profile_update_is_validated(client, body):
    me = headers(client, age=8, school_grade="grade3")
    assert client.put("/api/profile/study", headers=me, json=body).status_code == 422
    assert client.get("/api/auth/me", headers=me).json()["school_grade"] == "grade3"  # unchanged


def test_study_profile_update_requires_sign_in(client):
    assert client.put("/api/profile/study", json={"age": 8, "school_grade": "grade3"}).status_code == 401


def test_quick_vocabulary_stage_prefers_the_grade_topics(client, db):
    me = headers(client, age=7, school_grade="grade2")
    res = client.post("/api/learning/play", headers=me, json={"game": "word_shooter", "mode": "practice", "timezone": "UTC"})
    assert res.status_code == 201, res.json()
    keys = [json.loads(a)["entry_key"] for a in db.scalars(select(LearningSessionItem.answer_json).where(
        LearningSessionItem.session_id == res.json()["id"]))]
    topics = list(db.scalars(select(LearningVocabEntry.topic).where(LearningVocabEntry.entry_key.in_(keys))))
    assert topics and set(topics) <= preferred_vocab_topics("grade2")


def test_preferred_topics_only_reorder_new_words_of_the_same_difficulty():
    pool = [Entry(f"a{i}", f"apple{i}", 1, "food") for i in range(10)] + [Entry(f"b{i}", f"bank{i}", 1, "money") for i in range(10)]
    picked = pick_entries(pool, level=1, seen={}, review=set(), recent=set(), count=6, rng=random.Random(3),
                          preferred=frozenset({"money"}))
    assert {e.topic for e, _ in picked} == {"money"}
    # Without a preference the draw is unchanged (same seed, same words as before topics existed).
    plain = [Entry(e.key, e.word, e.difficulty) for e in pool]
    assert ([e.key for e, _ in pick_entries(pool, level=1, seen={}, review=set(), recent=set(), count=6, rng=random.Random(3))]
            == [e.key for e, _ in pick_entries(plain, level=1, seen={}, review=set(), recent=set(), count=6, rng=random.Random(3))])


# ---------- older databases ----------

def test_upgrade_adds_the_profile_columns_and_keeps_existing_users(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("""CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) UNIQUE, password_hash VARCHAR(255),
            display_name VARCHAR(80), level INTEGER, xp INTEGER, coins INTEGER, gems INTEGER, avatar_theme VARCHAR(40),
            equipped_item VARCHAR(80), created_at DATETIME)"""))
        conn.execute(text("INSERT INTO users (email, password_hash, display_name, xp) VALUES ('old@example.com', 'h', 'Old', 900)"))
    upgrade_schema(engine)
    upgrade_schema(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email, display_name, xp, age, school_grade FROM users")).one() == (
            "old@example.com", "Old", 900, None, None)
