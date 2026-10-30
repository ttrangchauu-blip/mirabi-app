"""The vocabulary bank: bundled data, validation and quality gate, lifecycle, bulk import and how a stage picks its words."""
import random
from collections import Counter

import pytest
from sqlalchemy import func, select

from app.learning_engine import normalize_text
from app.learning_vocab import (COLUMNS, DIFFICULTIES, PASS_SEEN, POS, TOPIC_CODES, Entry, Seen, check, effective_status,
                                import_rows, pick_entries, promote, set_statuses, travel_for, working_level)

HEADER = "\t".join(COLUMNS)


def tsv(tmp_path, *rows: str, name="extra.tsv"):
    path = tmp_path / name
    path.write_text(HEADER + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


def row(key="kettle", word="kettle", pos="noun", difficulty="2", topic="home", meaning="ấm đun nước", context="",
        example="Put the kettle on.", example_vi="Bắc ấm nước lên nhé.", accepted="", phonetic="/ˈketl/", status="active"):
    return "\t".join([key, word, pos, difficulty, topic, meaning, context, example, example_vi, accepted, phonetic, "", status])


# --- the bundled bank ---------------------------------------------------------------------------------------------

def test_bundled_bank_is_valid_and_large_enough():
    rows, report = check()
    assert report.ok, report.errors[:10]
    active = [r for r in rows if effective_status(r, report) == "active"]
    # Nothing with a quality issue is ever active.
    assert not [r.key for r in active if report.issues.get(r.key)]
    words = {normalize_text(r.word) for r in active}
    # Reviewed words only: the dictionary import with placeholder contexts (and wrong meanings) is never served.
    assert len(words) >= 8000, f"{len(words)} unique active words"
    assert not [r.key for r in active if r.context_vi and r.context_vi.startswith("Dùng trong ngữ cảnh")]
    topics = Counter(r.topic for r in active)
    assert len(topics) >= 30 and set(topics) <= TOPIC_CODES
    assert set(r.difficulty for r in active) == set(DIFFICULTIES)
    pos = Counter(r.pos for r in active)
    assert all(pos[p] >= 300 for p in ("noun", "verb", "adjective")) and pos["adverb"] >= 100
    assert pos["phrasal_verb"] + pos["collocation"] + pos["phrase"] + pos["idiom"] >= 1500
    # Every entry has its meaning, an example and its translation; a word with several senses has them apart.
    assert all(r.meaning_vi and r.example_en and r.example_vi for r in active)
    # No CEFR label without a source for it.
    assert not [r.key for r in active if r.cefr and r.source.startswith("mirabi")]


def test_words_with_several_senses_are_split_with_their_context():
    rows, report = check()
    senses = {}
    for r in rows:
        if effective_status(r, report) == "active":
            senses.setdefault(normalize_text(r.word), []).append(r)
    multi = {w: s for w, s in senses.items() if len(s) > 1}
    assert {"cold", "bank", "book", "change", "date", "fine"} <= set(multi)
    for word, items in multi.items():
        assert all(r.context_vi for r in items), word
        assert len({r.meaning_vi for r in items}) == len(items) and len({r.key for r in items}) == len(items)


# --- validation (errors drop a row) and quality gate (issues keep it a draft) ---------------------------------------

@pytest.mark.parametrize("bad,message", [
    (row(meaning=""), "missing meaning_vi"),
    (row(difficulty="7"), "difficulty"),
    (row(topic="space"), "unknown topic"),
    (row(pos="thing"), "part of speech"),
    (row(word="kettle!"), "letters"),
    (row(word="k3ttle"), "letters"),
    (row(key="Kettle!"), "key"),
    (row(accepted="tea-pot!"), "accepted"),
    (row(status="published"), "status"),
])
def test_invalid_rows_are_rejected(tmp_path, bad, message):
    rows, report = check([tsv(tmp_path, bad)])
    assert not rows and any(message in e for e in report.errors), report.errors


def test_phrases_with_apostrophes_can_be_typed(tmp_path):
    rows, report = check([tsv(tmp_path, row(key="im_afraid_not", word="I'm afraid not", pos="phrase", meaning="e là không",
                                            context="từ chối lịch sự", example="I'm afraid not, the shop is closed.",
                                            example_vi="E là không, cửa hàng đóng cửa rồi.", phonetic=""))])
    assert report.ok and rows[0].word == "I'm afraid not" and not report.issues


def test_duplicates_are_dropped_and_doubtful_rows_stay_drafts(tmp_path):
    rows, report = check([tsv(tmp_path, row(), row())])
    assert any("already used" in e for e in report.errors) and len(rows) == 1
    rows, report = check([tsv(tmp_path, row(), row(key="kettle2"))])  # the same sense under another key
    assert any("duplicate of kettle" in e for e in report.errors) and len(rows) == 1
    # Two senses of one word: each needs its context.
    rows, report = check([tsv(tmp_path, row(key="light.weight", word="light", pos="adjective", meaning="nhẹ", example="This bag is light."),
                              row(key="light.lamp", word="light", meaning="ánh sáng", example="Turn on the light."))])
    assert len(rows) == 2 and all("senses_need_context" in report.issues[r.key][0] for r in rows)
    assert {effective_status(r, report) for r in rows} == {"draft"}  # active in the file, but never served
    # Two words for one meaning: Việt → Anh could not know which one is right (the first one stays playable).
    rows, report = check([tsv(tmp_path, row(key="big", word="big", pos="adjective", meaning="to, lớn", example="A big house."),
                              row(key="large", word="large", pos="adjective", meaning="to, lớn", example="A large house."))])
    assert "big" not in report.issues and "ambiguous_meaning" in report.issues["large"][0]
    # ...unless each one accepts the other.
    rows, report = check([tsv(tmp_path, row(key="big", word="big", pos="adjective", meaning="to, lớn", example="A big house.", accepted="large"),
                              row(key="large", word="large", pos="adjective", meaning="to, lớn", example="A large house.", accepted="big"))])
    assert len(rows) == 2 and not report.issues


def test_a_meaning_another_word_also_has_needs_a_context_and_imported_contexts_do_not_count(tmp_path):
    # "lớn" is also a meaning of "big" (to, lớn): Việt → Anh on "lớn" alone would mark "big" wrong.
    rows, report = check([tsv(tmp_path, row(key="big", word="big", pos="adjective", meaning="to, lớn", example="A big house."),
                              row(key="large", word="large", pos="adjective", meaning="lớn", example="A large house."))])
    assert "big" not in report.issues and "covered_meaning" in report.issues["large"][0]
    assert effective_status(next(r for r in rows if r.key == "large"), report) == "draft"
    # A context that says which word is meant, or accepting the other word, makes it playable.
    for fix in ({"context": "kích thước, số lượng lớn hơn mức thường (hay dùng trong văn viết)"}, {"accepted": "big"}):
        rows, report = check([tsv(tmp_path, row(key="big", word="big", pos="adjective", meaning="to, lớn", example="A big house."),
                                  row(key="large", word="large", pos="adjective", meaning="lớn", example="A large house.", **fix))])
        assert not report.issues, fix
    # Another part of speech is another question ("lớn lên" is a verb): no conflict.
    rows, report = check([tsv(tmp_path, row(key="big", word="big", pos="adjective", meaning="to, lớn", example="A big house."),
                              row(key="grow", word="grow", pos="verb", meaning="lớn", example="Children grow fast."))])
    assert not report.issues
    # An imported "context" that only repeats the meaning is no context: the entry is never served.
    rows, report = check([tsv(tmp_path, row(key="scud", word="scud", meaning="Máy bay.", example="A scud flew over.",
                                            context="Dùng trong ngữ cảnh travel; nghĩa cụ thể: Máy bay."))])
    assert "placeholder_context" in report.issues["scud"][0] and effective_status(rows[0], report) == "draft"


def test_a_meaning_that_shows_the_word_is_never_asked_viet_to_anh():
    from app.learning_vocab import gives_answer
    assert gives_answer("chuột hamster", "thú cưng nhỏ", ["hamster"])
    assert gives_answer("cảm thấy", "nói về cảm xúc: feel happy, feel sad", ["feel"])
    assert gives_answer("có lẽ", "cách nói lịch sự hơn maybe", ["perhaps", "maybe"])  # an accepted answer too
    assert not gives_answer("con mèo", "thú cưng kêu meo meo", ["cat"])
    assert not gives_answer("vui vẻ", "categorically happy", ["cat"])  # only the whole word counts
    rows, report = check()
    shown = {r.key for r in rows if effective_status(r, report) == "active" and gives_answer(r.meaning_vi, r.context_vi, r.accepted)}
    assert "hamster" in shown and "cat" not in shown


def test_inflected_forms_spelling_variants_and_unused_examples_are_not_new_words(tmp_path):
    rows, report = check([tsv(tmp_path,
                              row(key="cat", word="cat", topic="animals", meaning="con mèo", example="The cat sleeps."),
                              row(key="cats", word="cats", topic="animals", meaning="những con mèo", example="Two cats sleep."),
                              row(key="colour", word="colour", meaning="màu sắc", example="What colour is it?"),
                              row(key="color", word="color", meaning="màu", example="What color is it?"),
                              row(key="spoon", word="spoon", meaning="cái thìa", example="Pass me the fork."),
                              row(key="water", word="water", meaning="water", example="Drink some water."))])
    issues = {k: v[0].split(":")[0] for k, v in report.issues.items()}
    assert issues == {"cats": "inflected_duplicate", "color": "spelling_variant", "spoon": "example_missing_word",
                      "water": "untranslated"}


def test_examples_may_use_inflected_and_irregular_forms(tmp_path):
    rows, report = check([tsv(tmp_path, row(key="study", word="study", pos="verb", meaning="học", example="She studied hard."),
                              row(key="give_up", word="give up", pos="phrasal_verb", meaning="từ bỏ", example="He never gave up.", phonetic=""),
                              row(key="child", word="child", meaning="đứa trẻ", example="The children are playing."))])
    assert not report.issues, report.issues


def test_trailing_optional_columns_may_be_left_out_and_new_rows_are_drafts(tmp_path):
    path = tmp_path / "short.tsv"
    path.write_text("\t".join(COLUMNS[:11]) + "\nkettle\tkettle\tnoun\t2\thome\tấm đun nước\t\tPut the kettle on.\tBắc ấm nước lên nhé.\n",
                    encoding="utf-8")
    rows, report = check([path])
    assert len(rows) == 1 and rows[0].accepted == ["kettle"] and rows[0].source == "mirabi-original"
    assert rows[0].status == "draft" and rows[0].cefr is None


def test_files_of_the_first_format_are_still_read(tmp_path):
    legacy = "key\tword\tpos\tlevel\ttopic\tmeaning_vi\tcontext_vi\texample_en\texample_vi\taccepted\tphonetic\tsource"
    path = tmp_path / "old.tsv"
    path.write_text(legacy + "\nkettle\tkettle\tnoun\tB1\thome\tấm đun nước\t\tPut the kettle on.\tBắc ấm nước lên nhé.\t\t\t\n", encoding="utf-8")
    rows, report = check([path])
    assert report.ok and rows[0].difficulty == 3 and rows[0].cefr is None and rows[0].status == "active"


# --- lifecycle: draft -> checked -> active ------------------------------------------------------------------------

def test_qa_and_publish_move_only_clean_rows_and_rewrite_the_status_column(tmp_path):
    path = tsv(tmp_path, row(status="draft"), row(key="mug", word="mug", meaning="cốc to", example="Pass me the cup.", status="draft"))
    rows, report = check([path])
    changes = promote(rows, report, "draft", "checked")
    assert changes == {"kettle": "checked"}  # the mug's example does not use the word: it stays a draft
    assert set_statuses([path], changes) == 1
    rows, report = check([path])
    assert {r.key: r.status for r in rows} == {"kettle": "checked", "mug": "draft"}
    set_statuses([path], promote(rows, report, "checked", "active"))
    rows, _ = check([path])
    assert {r.key: r.status for r in rows} == {"kettle": "active", "mug": "draft"}
    assert path.read_text(encoding="utf-8").splitlines()[1].split("\t")[5] == "ấm đun nước"  # other cells untouched


# --- import -------------------------------------------------------------------------------------------------------

def test_import_upserts_by_key_never_deletes_and_versions_content(tmp_path, client, db):
    from app.models import LearningVocabEntry

    def new_word(meaning="cái rổ", **kw):  # a word the bundled bank (already imported here) does not have
        return row(key="colander", word="colander", meaning=meaning, example="Drain the pasta in the colander.",
                   example_vi="Để ráo mì trong cái rổ.", phonetic="/ˈkʌləndər/", **kw)
    rows, report = check([tsv(tmp_path, new_word())])
    assert import_rows(db, rows, report=report) == {"inserted": 1}
    assert import_rows(db, rows, report=report) == {"unchanged": 1}  # running it again creates nothing
    assert db.scalar(select(func.count()).select_from(LearningVocabEntry).where(LearningVocabEntry.entry_key == "colander")) == 1
    changed, report = check([tsv(tmp_path, new_word(meaning="cái rổ lọc"))])
    assert import_rows(db, changed, report=report) == {"updated": 1}
    entry = db.scalar(select(LearningVocabEntry).where(LearningVocabEntry.entry_key == "colander"))
    assert entry.meaning_vi == "cái rổ lọc" and entry.status == "active" and entry.content_version == 2
    assert entry.difficulty == 2 and entry.cefr is None
    drafted, report = check([tsv(tmp_path, new_word(meaning="cái rổ lọc", status="draft"))])
    assert import_rows(db, drafted, report=report) == {"status_changed": 1}  # a status change is not a new version
    db.refresh(entry)
    assert entry.status == "draft" and entry.content_version == 2
    other, report = check([tsv(tmp_path, row(key="mug", word="mug", meaning="cái cốc to", example="A mug of tea.", phonetic="/mʌɡ/"))])
    counts = import_rows(db, other, retire_missing=True, report=report)
    assert counts["inserted"] == 1 and counts["retired"] >= 1
    db.refresh(entry)
    assert entry.status == "retired"  # kept for the sessions that used it, no longer drawn


def test_rows_with_quality_issues_are_imported_as_drafts(tmp_path, client, db):
    from app.models import LearningVocabEntry
    rows, report = check([tsv(tmp_path, row(key="spoon", word="spoon", meaning="cái thìa", example="Pass me the fork."))])
    import_rows(db, rows, report=report)
    entry = db.scalar(select(LearningVocabEntry).where(LearningVocabEntry.entry_key == "spoon"))
    assert entry.status == "draft" and "example_missing_word" in entry.review_notes


def test_the_bundled_bank_imports_once(client, db):
    from app.learning_vocab import import_bundled
    from app.models import LearningVocabEntry
    total = db.scalar(select(func.count()).select_from(LearningVocabEntry))
    assert import_bundled(db) == {"already_imported": 1}  # startup imported these files: skipped
    counts = import_bundled(db, force=True)  # and even forced, a second run changes nothing
    assert set(counts) == {"unchanged"} and db.scalar(select(func.count()).select_from(LearningVocabEntry)) == total


# --- level and word choice ----------------------------------------------------------------------------------------

def bank(per_level=30):
    return [Entry(f"d{d}_{i}", f"word{d}x{i}", d) for d in DIFFICULTIES for i in range(per_level)]


def test_level_starts_at_the_easiest_and_rises_only_with_first_try_answers():
    b = bank()
    assert working_level(b, {}) == 1
    d1 = [e for e in b if e.difficulty == 1][:PASS_SEEN]
    assert working_level(b, {e.key: Seen(1, 1, 20) for e in d1}) == 2
    assert working_level(b, {e.key: Seen(1, 1, 20) for e in d1[:PASS_SEEN - 1]}) == 1  # not enough words seen
    shaky = {e.key: Seen(2, 1, 5) for e in d1}  # half right at the first try
    assert working_level(b, shaky) == 1


def test_a_stage_has_different_words_at_the_users_level_and_mixes_new_review_and_learned():
    b = bank()
    d1 = [e for e in b if e.difficulty == 1]
    seen = {e.key: Seen(1, 1, 90, last_seen=i) for i, e in enumerate(d1[:8])}
    seen[d1[8].key] = Seen(2, 0, 10)  # answered wrong: on the review list
    picked = pick_entries(b, level=1, seen=seen, review={d1[8].key, d1[9].key}, recent=set(), count=12, rng=random.Random(1))
    keys = [e.key for e, _ in picked]
    assert len(keys) == 12 == len(set(keys))  # never twice in a stage
    assert all(e.difficulty == 1 for e, _ in picked)  # nothing above the user's level
    reasons = Counter(r for _, r in picked)
    assert reasons["review"] == 2 and reasons["learned"] == 2 and reasons["new"] == 8
    assert {d1[8].key, d1[9].key} <= set(keys)


def test_two_senses_of_one_word_are_never_in_the_same_stage():
    pool = [Entry("bank.money", "bank", 1), Entry("bank.river", "bank", 1)] + [Entry(f"w{i}", f"word{i}", 1) for i in range(20)]
    for seed in range(20):
        words = [e.word for e, _ in pick_entries(pool, level=1, seen={}, review=set(), recent=set(), count=12, rng=random.Random(seed))]
        assert words.count("bank") <= 1


def test_recent_words_are_not_drawn_again_while_others_are_left():
    b = bank(per_level=20)
    first = pick_entries(b, level=1, seen={}, review=set(), recent=set(), count=12, rng=random.Random(2))
    recent = {e.key for e, _ in first}
    second = pick_entries(b, level=1, seen={}, review=set(), recent=recent, count=12, rng=random.Random(3))
    # 20 easy words: the 8 not shown last time come first; the rest comes back from the words drawn (and never answered)
    # last time, before any harder word.
    assert len({e.key for e, _ in second} - recent) == 8 and all(e.difficulty == 1 for e, _ in second)


def test_a_right_answer_is_not_reviewed_again_at_once():
    b = bank(per_level=20)
    d1 = [e for e in b if e.difficulty == 1]
    first = {e.key: Seen(1, 1, 20) for e in d1[:12]}  # one right answer each: mastery 20, but nothing to review
    picked = pick_entries(b, level=1, seen=first, review=set(), recent={e.key for e in d1[:12]}, count=12, rng=random.Random(6))
    reasons = Counter(r for _, r in picked)
    assert reasons["review"] == 0 and sum(1 for e, r in picked if r == "new" and e.difficulty == 1) == 8


def test_when_new_words_run_out_the_stage_becomes_a_purposeful_review():
    b = [e for e in bank(per_level=12) if e.difficulty == 1]
    seen = {e.key: Seen(2, 1, 30) for e in b}  # every word of the level seen, half of them missed
    review = {e.key for e in b[:6]}
    picked = pick_entries(b, level=1, seen=seen, review=review, recent=set(), count=12, rng=random.Random(4))
    reasons = Counter(r for _, r in picked)
    assert len(picked) == 12 and reasons == {"review": 6, "learned": 6}  # never empty, never harder words
    # A small pool (6 words at the user's level) is filled with words of the next level only, never two levels up.
    small = bank(per_level=6)
    picked = pick_entries(small, level=1, seen={}, review=set(), recent=set(), count=12, rng=random.Random(7))
    assert Counter(e.difficulty for e, _ in picked) == {1: 6, 2: 6}
    # A topic whose words are all above the user's level still gives a stage, with its easiest words.
    hard = [e for e in bank() if e.difficulty in (5, 6)]
    picked = pick_entries(hard, level=1, seen={}, review=set(), recent=set(), count=12, rng=random.Random(5))
    assert picked and all(e.difficulty == 5 for e, _ in picked)


def test_long_words_and_phrases_fall_slower():
    assert travel_for("cat", 24) == 24
    assert travel_for("environment", 24) > travel_for("tree", 24)
    assert travel_for("as soon as possible", 24) > travel_for("possible", 24)
    assert travel_for("a blessing in disguise", 24) <= 40 and travel_for("cat", 0) == 0
    assert travel_for("I'm afraid not", 24) == travel_for("Im afraid not", 24)


def test_parts_of_speech_cover_phrases_and_collocations():
    assert {"noun", "verb", "adjective", "adverb", "phrasal_verb", "collocation", "phrase", "idiom"} <= POS
