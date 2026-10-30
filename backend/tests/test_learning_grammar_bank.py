"""The grammar bank: validation and quality gate, answer checking, shuffling, stage picking, import and both games."""
import json
import random
import re
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.learning_engine import VOCAB_STAGE_WORDS
from sqlalchemy import func, select, update

from app.learning_engine import InvalidAnswer, check_bridge, check_choice
from app.learning_grammar_bank import (CHOICE_COLUMNS, MAX_PER_POINT, ORDER_COLUMNS, POINT, POINTS, History, Question,
                                       check, effective_status, import_items, mastered_points, order_text, pick_questions,
                                       shuffled_tokens, snapshot, working_difficulty)
from test_learning_api import answer, complete, eid, me, post, right, stored_answer, wrong  # noqa: F401 (fixture)

FIXTURES = sorted((Path(__file__).parent / "data" / "grammar").glob("*.tsv"))


def choice_file(tmp_path, *rows, name="x.choice.tsv"):
    path = tmp_path / name
    path.write_text("\t".join(CHOICE_COLUMNS) + "\n" + "\n".join("\t".join(r) for r in rows) + "\n", encoding="utf-8")
    return path


def order_file(tmp_path, *rows, name="x.order.tsv"):
    path = tmp_path / name
    path.write_text("\t".join(ORDER_COLUMNS) + "\n" + "\n".join("\t".join(r) for r in rows) + "\n", encoding="utf-8")
    return path


def c_row(key="pp.c.001", prompt="She has lived in this town ___ 2019.", options="since|for|from|in", answer_="since",
          hint="Sau chỗ trống là một mốc thời gian.", form="aff", point="present_perfect_for_since", difficulty="3"):
    return [key, point, difficulty, "home", form, "Nói về thời gian sống ở đây", prompt, options, answer_, hint,
            "since đi với mốc thời gian; for đi với khoảng thời gian.", "Cô ấy đã sống ở thị trấn này từ năm 2019.", "test", "draft"]


def o_row(key="pp.o.001", tokens="have/you/ever/been/to Japan", alternatives="", sentence="Have you ever been to Japan?",
          form="q", point="present_perfect"):
    return [key, point, "3", "travel", form, "Hỏi về trải nghiệm", tokens, alternatives, sentence, "Bạn đã từng đến Nhật Bản chưa?",
            "Câu hỏi bắt đầu bằng trợ động từ.", "Have + chủ ngữ + ever + V3?", "test", "draft"]


# --- curriculum ---------------------------------------------------------------------------------------------------

def test_the_curriculum_covers_basic_to_advanced_structures():
    codes = {code for code, *_ in POINTS}
    assert len(codes) == len(POINTS) >= 80
    assert {d for _, d, _, _ in POINTS} == {1, 2, 3, 4, 5, 6}
    for needed in ("pronoun_subject", "noun_plural", "article_a_an", "be_present", "present_simple_negative_question",
                   "past_simple_affirmative", "present_perfect", "time_clauses", "modal_obligation", "prep_time",
                   "conjunction_basic", "countable_uncountable", "comparative", "superlative", "adverb_manner",
                   "gerund_infinitive", "passive_simple", "conditional_zero_first", "conditional_third",
                   "relative_clause_defining", "reported_statement", "inversion", "subjunctive"):
        assert needed in codes, needed


# --- validation ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("row,message", [
    (c_row(prompt="She has lived here since 2019."), "exactly one"),
    (c_row(answer_="ago"), "answer must be one of the options"),
    (c_row(options="since|since|for"), "two options are the same"),
    (c_row(options="since|for"), "3 or 4 options"),
    (c_row(point="present_perfect_forever"), "unknown grammar point"),
    (c_row(difficulty="6"), "too far"),
    (c_row(form="maybe"), "form"),
])
def test_invalid_choice_questions_are_rejected(tmp_path, row, message):
    items, report = check([choice_file(tmp_path, row)])
    assert not items and any(message in e for e in report.errors), report.errors


@pytest.mark.parametrize("row,message", [
    (o_row(tokens="have/you/ever/been/to Japan?"), "no punctuation"),
    (o_row(tokens="have/you/ever/gone/to Japan"), "must make sentence_en"),
    (o_row(alternatives="you/have/ever/been/to China"), "same pieces"),
    (o_row(tokens="have you ever been to Japan"), "3 to 12 pieces"),
])
def test_invalid_order_questions_are_rejected(tmp_path, row, message):
    items, report = check([order_file(tmp_path, row)])
    assert not items and any(message in e for e in report.errors), report.errors


def test_copies_that_only_change_a_name_or_a_number_are_held_back(tmp_path):
    items, report = check([choice_file(tmp_path, c_row(),
                                       c_row(key="pp.c.002", prompt="Tom has lived in this town ___ 2020."),
                                       c_row(key="pp.c.003", prompt="He has lived in this town ___ 2015."),
                                       c_row(key="pp.c.004", prompt="We have worked at the market ___ last spring."))])
    assert len(items) == 4
    assert set(report.issues) == {"pp.c.002", "pp.c.003"}
    assert all("near_duplicate" in report.issues[k][0] for k in report.issues)
    assert effective_status(items[1], report) == "draft"
    # The very same sentence twice is a duplicate record: dropped.
    items, report = check([choice_file(tmp_path, c_row(), c_row(key="pp.c.009"))])
    assert len(items) == 1 and any("duplicate of pp.c.001" in e for e in report.errors)


def test_doubtful_questions_stay_drafts(tmp_path):
    items, report = check([choice_file(tmp_path, c_row(hint="Dùng since với mốc thời gian."),
                                       c_row(key="pp.c.002", prompt="Have you lived in this town ___ 2019?", form="aff"),
                                       c_row(key="pp.c.003", prompt="I haven't seen my cousins ___ last summer.", form="neg"))])
    assert "hint_gives_answer" in report.issues["pp.c.001"][0]
    assert "form_mismatch" in report.issues["pp.c.002"][0]
    assert "pp.c.003" not in report.issues
    items, report = check([order_file(tmp_path, o_row(tokens="Have/you/ever/been/to Japan"))])
    assert "capital_gives_order" in report.issues["pp.o.001"][0]


def test_the_bundled_bank_is_valid_and_large_enough():
    """What is served is reviewed, and every grammar point that has questions can fill stages of both games, in the
    three forms. The curriculum (POINTS) is larger than the bank: a point without questions is simply never drawn."""
    items, report = check()
    assert report.ok, report.errors[:10]
    active = [i for i in items if effective_status(i, report) == "active"]
    assert not [i.key for i in active if report.issues.get(i.key)]  # nothing with a quality issue is ever served
    games = Counter(i.game for i in active)
    # The pattern-made "Sắp xếp câu" questions are retired: their pieces were cut by length and their time and place
    # phrases can move to the front, orders no one declared as right answers.
    assert games["choice"] >= 4000 and games["order"] >= 200, games
    assert not [i.key for i in active if i.game == "order" and ".auto." in i.key]
    points = {i.point for i in active}
    assert len(points) >= 4 and points <= set(POINT)
    per_game = Counter((i.point, i.game) for i in active)
    # Enough for several stages of each game without a question twice in one (a stage is 12 choices or 10 orders).
    assert all(per_game[(p, "choice")] >= 5 * 12 and per_game[(p, "order")] >= 5 * 10 for p in points), per_game
    # Written questions (not pattern-made) in every form, for every point and game: negatives and questions too.
    forms = Counter((i.point, i.game, i.form) for i in active if ".auto." not in i.key)
    assert all(forms[(p, g, f)] >= 10 for p in points for g in ("choice", "order") for f in ("aff", "neg", "q")), forms
    assert all(abs(i.difficulty - POINT[i.point]["difficulty"]) <= 1 for i in active)
    assert len({i.topic for i in active}) >= 20


def test_generated_pronoun_questions_have_one_right_answer_and_vietnamese_meanings():
    """The pattern-made questions have no situation to tell two pronouns of one kind apart: their wrong options are
    other kinds (an object or possessive form in the subject's place...), and the meaning shown is all Vietnamese."""
    import re
    kinds = {"pronoun_subject": {"i", "you", "he", "she", "it", "we", "they"},
             "pronoun_object": {"me", "you", "him", "her", "it", "us", "them"},
             "possessive_adjective": {"my", "your", "his", "her", "its", "our", "their"}}
    english = {"i", "you", "he", "she", "we", "they", "me", "him", "her", "us", "them", "ready", "busy", "careful", "patient", "quiet"}
    items, _ = check()
    generated = [i for i in items if ".auto." in i.key]
    assert generated
    for it in generated:
        if it.game == "choice" and it.point in kinds:
            others = [o.lower() for o in it.options if o != it.answer]
            assert not any(o in kinds[it.point] for o in others), (it.key, it.options)
        assert not {w.lower() for w in re.findall(r"\w+", it.sentence_vi)} & english, (it.key, it.sentence_vi)


# --- answer checking and shuffling ----------------------------------------------------------------------------------

def test_order_answers_accept_every_declared_order_repeated_words_case_and_punctuation():
    tokens = [{"id": "w1", "text": "the"}, {"id": "w2", "text": "cat"}, {"id": "w3", "text": "sat on"}, {"id": "w4", "text": "the"},
              {"id": "w5", "text": "mat"}, {"id": "w6", "text": "today"}]
    accepted = [order_text(["the", "cat", "sat on", "the", "mat", "today"]), order_text(["today", "the", "cat", "sat on", "the", "mat"])]
    assert check_bridge(["w1", "w2", "w3", "w4", "w5", "w6"], tokens, accepted)
    assert check_bridge(["w4", "w2", "w3", "w1", "w5", "w6"], tokens, accepted)  # the two "the" pieces are interchangeable
    assert check_bridge(["w6", "w1", "w2", "w3", "w4", "w5"], tokens, accepted)  # the other declared order
    assert not check_bridge(["w2", "w1", "w3", "w4", "w5", "w6"], tokens, accepted)
    assert check_bridge(["w1", "w2"], [{"id": "w1", "text": "Hello"}, {"id": "w2", "text": "WORLD"}], ["Hello, world!"])
    with pytest.raises(InvalidAnswer):
        check_bridge(["w1", "w1", "w3", "w4", "w5", "w6"], tokens, accepted)  # every piece once


def test_pieces_are_never_shuffled_into_a_right_answer():
    tokens = ["I", "usually", "walk", "to school", "in the morning"]
    accepted = [order_text(tokens), order_text(["in the morning", "I", "usually", "walk", "to school"])]
    for seed in range(300):
        assert order_text(shuffled_tokens(tokens, accepted, random.Random(seed))) not in accepted


def bank_row(**kw):
    base = dict(item_key="pp.c.001", game="choice", point="present_perfect_for_since", difficulty=3, form="aff",
                context_vi="Ngữ cảnh", prompt="She has lived here ___ 2019.", options_json=json.dumps(["since", "for", "from", "in"]),
                answer="since", tokens_json="[]", accepted_json='["since"]', sentence_en="She has lived here since 2019.",
                sentence_vi="Cô ấy sống ở đây từ 2019.", hint_vi="Mốc thời gian.", explanation_vi="Giải thích.",
                pattern="present_perfect_for_since|since", content_version=3)
    base.update(kw)
    return SimpleNamespace(**base)


def test_choice_options_are_shuffled_and_the_answer_mapping_follows():
    positions = set()
    for seed in range(40):
        snap = snapshot("en.grammar.bank", bank_row(), "new", random.Random(seed))
        options = snap["prompt"]["options"]
        right_id = snap["answer"]["option"]
        assert next(o["text"] for o in options if o["id"] == right_id) == "since"
        assert check_choice(right_id, options, right_id) and [o["id"] for o in options] == ["o1", "o2", "o3", "o4"]
        positions.add(right_id)
        # The prompt sent to the app never holds the answer.
        assert "since" not in json.dumps({k: v for k, v in snap["prompt"].items() if k != "options"})
        assert snap["answer"]["content_version"] == 3 and snap["skill_key"] == "en.grammar.choice.present_perfect_for_since"
    assert len(positions) >= 3  # the right answer is not always in the same place


# --- picking a stage ------------------------------------------------------------------------------------------------

def pool(points=6, per_point=10, difficulties=(1, 2, 3)):
    return [Question(f"p{p}d{d}.{i}", f"point{p}d{d}", d, f"point{p}d{d}|pattern{i % 5}")
            for d in difficulties for p in range(points) for i in range(per_point)]


def pick(items, **kw):
    args = dict(level=1, history={}, review=set(), recent_items=set(), recent_patterns=set(), recent_points=Counter(),
                mastered=set(), count=12, rng=random.Random(kw.pop("seed", 1)))
    args.update(kw)
    return pick_questions(items, **args)


def test_a_stage_has_different_questions_at_the_users_level_with_variety():
    picked = pick(pool())
    keys = [q.key for q, _ in picked]
    assert len(keys) == 12 == len(set(keys))
    assert all(q.difficulty == 1 for q, _ in picked)
    assert max(Counter(q.point for q, _ in picked).values()) <= MAX_PER_POINT
    assert len({q.pattern for q, _ in picked}) == 12  # one question per structure pattern


def test_review_new_and_learned_questions_are_mixed():
    items = pool()
    d1 = [q for q in items if q.difficulty == 1]
    history = {q.key: History(1, 1, last_seen=i) for i, q in enumerate(d1[:10])}
    history[d1[20].key] = History(2, 0)
    picked = pick(items, history=history, review={d1[20].key, d1[21].key})
    reasons = Counter(r for _, r in picked)
    assert reasons["review"] == 2 and reasons["learned"] == 2 and reasons["new"] == 8
    assert {d1[20].key, d1[21].key} <= {q.key for q, _ in picked}


def test_recent_questions_and_patterns_are_avoided_while_others_are_left():
    items = pool()
    first = pick(items, seed=3)
    second = pick(items, seed=4, recent_items={q.key for q, _ in first}, recent_patterns={q.pattern for q, _ in first},
                  recent_points=Counter(q.point for q, _ in first))
    assert not {q.key for q, _ in first} & {q.key for q, _ in second}
    assert not {q.pattern for q, _ in first} & {q.pattern for q, _ in second}


def test_when_new_questions_run_out_the_stage_reviews_instead_of_coming_back_empty():
    small = pool(points=2, per_point=4, difficulties=(1,))
    history = {q.key: History(2, 1) for q in small}
    picked = pick(small, history=history, review={small[0].key})
    assert len(picked) == len(small) and all(r in ("review", "learned") for _, r in picked)
    # Only the next difficulty fills a stage the user's level can't fill, never two levels up.
    picked = pick(pool(points=1, per_point=5, difficulties=(1, 2, 3)))
    assert {q.difficulty for q, _ in picked} == {1, 2}


def test_difficulty_rises_with_first_try_answers_and_one_right_answer_is_not_mastery():
    items = pool(points=3, per_point=10)
    d1 = [q for q in items if q.difficulty == 1]
    assert working_difficulty(items, {}) == 1
    assert working_difficulty(items, {q.key: History(1, 1) for q in d1[:24]}) == 2
    assert working_difficulty(items, {q.key: History(2, 1) for q in d1[:24]}) == 1  # half right: stay
    point = d1[0].point
    one = {d1[0].key: History(1, 1)}
    assert point not in mastered_points(items, one)
    five = {q.key: History(1, 1, session=1) for q in d1 if q.point == point}
    assert point not in mastered_points(items, five)  # all in one stage
    spread = {q.key: History(1, 1, session=i % 2) for i, q in enumerate(d1) if q.point == point}
    assert point in mastered_points(items, spread)
    shaky = {q.key: History(3, 1) for q in d1 if q.point == point}
    assert point not in mastered_points(items, shaky)


# --- import and the games ---------------------------------------------------------------------------------------------

def use_fixture_bank(db):
    """Only the fixture questions are active (the bundled bank is retired in this test database)."""
    from app.models import LearningGrammarItem
    db.execute(update(LearningGrammarItem).values(status="retired"))
    items, report = check(FIXTURES)
    import_items(db, items, report=report)
    db.commit()
    return items


def test_import_runs_again_without_duplicates_and_versions_changed_content(client, db, tmp_path):
    from app.models import LearningGrammarItem
    items = use_fixture_bank(db)
    before = db.scalar(select(func.count()).select_from(LearningGrammarItem))
    items, report = check(FIXTURES)
    assert import_items(db, items, report=report) == {"unchanged": len(items)}
    assert db.scalar(select(func.count()).select_from(LearningGrammarItem)) == before
    target = next(i for i in items if i.key == "t.be.c.001")
    target.explanation_vi += " (sửa)"
    assert import_items(db, [target], report=report) == {"updated": 1}
    row = db.scalar(select(LearningGrammarItem).where(LearningGrammarItem.item_key == "t.be.c.001"))
    assert row.content_version == 2 and row.explanation_vi.endswith("(sửa)")
    assert db.scalar(select(LearningGrammarItem.status).where(LearningGrammarItem.item_key == "t.draft.c.001")) == "draft"


def play(client, headers, game, mode="practice"):
    response = client.post("/api/learning/play", headers=headers, json={"game": game, "mode": mode, "timezone": "Asia/Ho_Chi_Minh"})
    assert response.status_code == 201, response.json()
    session = response.json()
    assert session["status"] == "paused" and session["kind"] == "lesson"
    return post(client, headers, session, "resume").json()["session"]


@pytest.mark.parametrize("game,kind,lesson", [("word_shooter", "word_spelling", "en.vocab.mix"),
                                              ("meteor", "vocab_typing", "en.vocab.mix"),
                                              ("gate", "gate_choice", "en.grammar.bank"),
                                              ("bridge", "bridge_order", "en.grammar.bank")])
def test_each_game_starts_right_away_from_the_banks(client, me, db, game, kind, lesson):
    use_fixture_bank(db)
    session = play(client, me, game)
    assert session["lesson"]["code"] == lesson and session["game"] == game
    assert session["required_count"] == {"bridge": 10, "gate": 12}.get(game, VOCAB_STAGE_WORDS)
    turn = session["open_turns"][0]
    assert turn["kind"] == kind
    stored = stored_answer(turn)
    assert stored.get("entry_key") or stored.get("item_key", "").startswith("t.")
    text = json.dumps(turn)
    for secret in ("accepted", "\"option\"", "item_key", "entry_key", "sentence_vi" if kind == "gate_choice" else "explanation"):
        assert secret not in text
    if kind == "vocab_typing":
        # Việt → Anh: the English word is the answer (a whole word: "kill" is in the field name "skill_label").
        assert not re.search(rf"{re.escape(stored['display'])}", text)
    if kind == "gate_choice":
        assert stored["display"] not in text and turn["prompt"]["context_vi"]


def test_vocabulary_games_draw_beyond_the_first_word_list(client, me, db):
    from app.models import LearningVocabEntry
    db.execute(update(LearningVocabEntry).where(LearningVocabEntry.source == "mirabi-original").values(status="retired"))
    db.commit()
    for game in ("word_shooter", "meteor"):
        session = play(client, me, game)
        keys = {stored_answer(t)["entry_key"] for t in session["open_turns"]}
        sources = set(db.scalars(select(LearningVocabEntry.source).where(LearningVocabEntry.entry_key.in_(keys))))
        assert keys and "mirabi-original" not in sources
        post(client, me, session, "abandon")


def test_a_grammar_stage_records_history_and_progress_per_point_and_game(client, me, db):
    from app.models import LearningItemHistory
    use_fixture_bank(db)
    session = play(client, me, "gate")
    seen = []
    while session["open_turns"]:
        turn = session["open_turns"][0]
        seen.append(stored_answer(turn)["item_key"])
        result = answer(client, me, session, turn).json()
        assert result["result"]["correct"] and result["result"]["correct_answer"] and result["result"]["explanation"]
        session = result["session"]
    assert "t.draft.c.001" not in seen  # a draft is never served
    assert complete(client, me, session)["status"] == "completed"
    rows = db.scalars(select(LearningItemHistory).where(LearningItemHistory.game == "choice")).all()
    assert len(rows) == 12 and all(r.first_try == 1 for r in rows)
    skills = {s["skill_key"]: s for s in client.get("/api/learning/progress?subject=english", headers=me).json()["skills"]}
    point = skills["en.grammar.choice.be_present"]
    assert point["first_try_questions"] >= 3 and not point["mastered"]  # one good stage is not mastery
    assert "en.grammar.order.be_present" not in skills  # each game keeps its own progress


def test_wrong_answers_show_the_answer_and_come_back_for_review_in_a_later_stage(client, me, db):
    use_fixture_bank(db)
    session = play(client, me, "gate")
    turn = session["open_turns"][0]
    missed_key = stored_answer(turn)["item_key"]
    result = answer(client, me, session, turn, value=wrong(turn)).json()["result"]
    assert result["correct"] is False and result["correct_answer"] and result["explanation"] and result["practice_added"]
    post(client, me, session, "abandon")
    review = client.get("/api/learning/review?subject=english", headers=me).json()
    assert any(missed_key in i["label"] or i["skill_key"].startswith("en.grammar.choice.") for g in review["groups"] for i in g["items"])
    again = play(client, me, "gate")
    from app.db import SessionLocal
    from app.models import LearningSessionItem
    with SessionLocal() as s:
        answers = [json.loads(a) for a in s.scalars(select(LearningSessionItem.answer_json).where(LearningSessionItem.session_id == again["id"]))]
    assert any(a["item_key"] == missed_key and a["pick"] == "review" for a in answers)


def test_order_questions_accept_alternative_orders_through_the_api(client, me, db):
    from app.db import SessionLocal
    from app.models import LearningSessionItem
    use_fixture_bank(db)
    session = play(client, me, "bridge")
    with SessionLocal() as s:
        items = s.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session["id"])).all()
        target = next((i for i in items if json.loads(i.answer_json)["item_key"] == "t.af.o.001"), None)
    turns = session["open_turns"]
    while target is not None and turns and turns[0]["turn_id"] != target.turn_id:
        session = answer(client, me, session, turns[0]).json()["session"]
        turns = session["open_turns"]
    if target is None:
        pytest.skip("the alternative-order question was not drawn in this stage")
    turn = turns[0]
    from test_learning_api import order_ids
    ids = order_ids(turn["prompt"]["tokens"], "in the morning i usually walk to school")
    result = answer(client, me, session, turn, value=ids).json()["result"]
    assert result["correct"] and result["correct_answer"] == "I usually walk to school in the morning."
    assert turn["prompt"]["end"] == "." and turn["prompt"]["meaning_vi"]


def test_the_lesson_of_a_grammar_stage_shows_rules_never_questions(client, me, db):
    use_fixture_bank(db)
    session = play(client, me, "gate")
    intro = client.get(f"/api/learning/sessions/{session['id']}/intro", headers=me).json()["intro"]
    assert intro["kind"] == "grammar" and intro["rules"]
    assert {r["form"] for r in intro["rules"]} <= {POINT[p]["name"] for p in POINT}
    text = json.dumps(intro, ensure_ascii=False)
    assert "My grandmother" not in text and "doesn't drink" not in text


def test_editing_the_bank_never_changes_a_session_already_started(client, me, db):
    from app.models import LearningGrammarItem
    use_fixture_bank(db)
    session = play(client, me, "gate")
    turn = session["open_turns"][0]
    key = stored_answer(turn)["item_key"]
    db.execute(update(LearningGrammarItem).where(LearningGrammarItem.item_key == key)
               .values(prompt="Changed ___ sentence.", content_version=LearningGrammarItem.content_version + 1))
    db.commit()
    again = client.get(f"/api/learning/sessions/{session['id']}", headers=me).json()
    assert again["open_turns"][0]["prompt"] == turn["prompt"]
    assert answer(client, me, session, turn).json()["result"]["correct"]  # checked against the frozen copy
    from app.models import LearningSession
    stored = json.loads(db.scalar(select(LearningSession.scoring_json).where(LearningSession.id == session["id"])))
    assert stored["content_release"]["grammar"] and stored["content_release"]["vocabulary"]
