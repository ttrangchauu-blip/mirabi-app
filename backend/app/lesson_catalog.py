"""Học tập by lesson: Chương trình → Khối lớp → Môn học → Chương/Chủ đề → Bài học → Trò chơi.

The programme (app/data/catalog/programme.json) lists, for every grade 1–12, the subjects and educational activities of
Vietnam's Chương trình giáo dục phổ thông 2018 as amended (Thông tư 32/2018, 20/2021, 13/2022, 17/2025), named as at
that grade, with their type (bắt buộc, lựa chọn, tự chọn) and what Mirabi supports. The lessons
(app/data/catalog/lessons/*.json, one file per subject) are grouped by chapter or topic, in the order of the curriculum.
A lesson is either `ready` (it publishes games, each with enough reviewed content of its own) or `planned` (listed, never
playable). A game only ever draws the content of the lesson played: never another lesson's, never another grade's, never
a repeated question to fill a stage.

Everything here is pure (no database), validated when loaded (an invalid file stops the server rather than serving a
wrong lesson) and checked with `python -m app.lesson_catalog check [files]`. Sessions freeze a copy of each question and
the lesson's content version, so editing a lesson never changes an old result. Rules: docs/LEARNING_GAMES.md.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import sys
from functools import lru_cache
from pathlib import Path

from . import curriculum_games as cg

DATA = Path(__file__).parent / "data" / "catalog"
LESSONS_DIR = DATA / "lessons"
GRADES = tuple(range(1, 13))

# Short subject codes that start every chapter and lesson key ("toan2.bang_nhan_2"): keys stay stable and short enough
# for the database columns (lesson code 60, question and skill keys 80).
ABBR = {"vietnamese": "tv", "math": "toan", "english": "ta", "civics": "gd", "science": "kh", "history_geography": "lsdl",
        "history": "ls", "geography": "dl", "physics": "vl", "chemistry": "hh", "biology": "sh", "info_tech": "thcn",
        "informatics": "th", "technology": "cn", "music": "an", "fine_arts": "mt", "pe": "tc", "defense": "qp",
        "experience": "tn"}
LESSON_KEY = re.compile(r"^[a-z]{2,4}(?:[1-9]|1[0-2])\.[a-z0-9_]{2,26}$")
TASK_KEY = re.compile(r"^[a-z0-9_]{1,16}$")

STATUSES = ("ready", "planned")
REVIEW_STATUSES = ("draft", "checked", "teacher_reviewed")  # a ready lesson is at least `checked`
REVIEW_LABEL = {"draft": "Bản nháp", "checked": "Mirabi biên soạn và đã soát", "teacher_reviewed": "Giáo viên đã thẩm định"}
ORGANIZATIONS = ("topic", "textbook")

# The games a lesson can publish. `kind`: what plays it (a gameplay shared by every lesson that uses it).
GAMES = {
    "order": {"name": "Sắp xếp thứ tự", "content": "tasks"},
    "match": {"name": "Ghép cặp", "content": "tasks"},
    "choice": {"name": "Chọn đáp án có giải thích", "content": "tasks"},
    "sorting": {"name": "Phân loại cùng pet", "content": "set"},
    "spelling_detective": {"name": "Thám tử chính tả", "content": "items"},
    "word_builder": {"name": "Ghép chữ", "content": "items"},
    "code_path": {"name": "Lập trình đường đi", "content": "levels"},
    "defense": {"name": "Bảo vệ căn cứ", "content": "math"},
    "math_bridge": {"name": "Xây cầu toán học", "content": "math"},
    "meteor": {"name": "Bắn thiên thạch (Việt → Anh)", "content": "words"},
    "word_shooter": {"name": "Bắn từ tiếng Anh (Anh → Việt)", "content": "words"},
}
CONTENT_GAMES = ("order", "match", "choice", "sorting", "spelling_detective", "word_builder", "code_path")
MATH_GAMES = ("defense", "math_bridge")
VOCAB_GAMES = ("meteor", "word_shooter")
CHOICE_STYLES = ("quiz", "situation", "reading", "predict", "reflect")
MATH_TOPICS = {"defense": ("arithmetic", "order_of_operations"), "math_bridge": ("missing_number", "compare")}

# The fewest questions a published game may have (fewer: the lesson cannot publish it) and the most a stage asks.
MIN_TASKS = {"order": 4, "match": 3, "choice": 5, "sorting": 8, "spelling_detective": 6, "word_builder": 6, "code_path": 3,
             "meteor": 6, "word_shooter": 6}
MAX_TURNS = {"order": 8, "match": 6, "choice": 10, "sorting": 10, "spelling_detective": 10, "word_builder": 10, "code_path": 5,
             "defense": 12, "math_bridge": 12, "meteor": 15, "word_shooter": 15}
MATH_TURNS = 10
VOCAB_FULL_STAGE = 15  # learning_engine.VOCAB_STAGE_WORDS: fewer words is a short stage, said as such


def limits(grade: int) -> dict:
    """How much a task may ask of a learner of this grade: cards, pairs, options and text lengths. Lớp 1–2 read little
    and tap little; secondary school can read a passage."""
    if grade <= 2:
        return {"items": 4, "pairs": 4, "options": 3, "text": 40, "question": 140, "passage": 350}
    if grade <= 5:
        return {"items": 5, "pairs": 5, "options": 4, "text": 70, "question": 220, "passage": 700}
    return {"items": 6, "pairs": 5, "options": 4, "text": 110, "question": 320, "passage": 1400}


class ContentError(ValueError):
    """A catalog file that must not be served."""


# ---------------------------------------------------------------------------------------------------------------
# The programme: subjects per grade
# ---------------------------------------------------------------------------------------------------------------

@lru_cache(maxsize=None)
def programme() -> dict:
    data = json.loads((DATA / "programme.json").read_text(encoding="utf-8"))
    problems = []
    seen = set()
    for s in data["subjects"]:
        if s["code"] in seen:
            problems.append(f"duplicate subject {s['code']}")
        seen.add(s["code"])
        covered: set[int] = set()
        for offer in s["offers"]:
            low, high = offer["grades"]
            if not (1 <= low <= high <= 12) or offer["type"] not in data["types"] or not offer.get("name"):
                problems.append(f"{s['code']}: bad offer {offer}")
            if covered & set(range(low, high + 1)):
                problems.append(f"{s['code']}: two offers for one grade")
            covered |= set(range(low, high + 1))
    if problems:
        raise ContentError("programme.json: " + "; ".join(problems))
    return data


def subject_meta(code: str) -> dict | None:
    return next((s for s in programme()["subjects"] if s["code"] == code), None)


def offer(code: str, grade: int) -> dict | None:
    """The subject as taught at this grade (its name and type), None when it is not taught then."""
    meta = subject_meta(code)
    if meta is None:
        return None
    return next((o for o in meta["offers"] if o["grades"][0] <= grade <= o["grades"][1]), None)


def subject_name(code: str, grade: int | None) -> str:
    found = offer(code, grade) if grade else None
    meta = subject_meta(code)
    return found["name"] if found else (meta["offers"][-1]["name"] if meta else code)


def subjects_for(grade: int) -> list[dict]:
    """Every subject and educational activity of a grade, in the programme's order, with what Mirabi supports."""
    data = programme()
    out = []
    for meta in data["subjects"]:
        found = offer(meta["code"], grade)
        if found is None:
            continue
        out.append({"code": meta["code"], "name": found["name"], "type": found["type"], "type_label": data["types"][found["type"]],
                    "note": found.get("note"), "unsupported": meta.get("unsupported"), "practice_note": meta.get("practice_note"),
                    "icon": meta["icon"], "bg": meta["bg"], "color": meta["color"]})
    return out


def electives(grade: int) -> list[str]:
    """The subjects a THPT learner picks from (môn lựa chọn), excluding those Mirabi has no lessons for at all."""
    pick = programme()["elective_pick"]
    if not pick["grades"][0] <= grade <= pick["grades"][1]:
        return []
    return [s["code"] for s in subjects_for(grade) if s["type"] == "elective" and not s["unsupported"]]


# ---------------------------------------------------------------------------------------------------------------
# Loading and validating the lessons
# ---------------------------------------------------------------------------------------------------------------

def lesson_files() -> list[Path]:
    return sorted(LESSONS_DIR.glob("*.json"))


def _text(value, where: str, problems: list[str], limit: int, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where}: {name} is required")
    elif len(value) > limit:
        problems.append(f"{where}: {name} is longer than {limit} characters for this grade")


def _texts(values, where: str, problems: list[str], name: str, at_least: int = 1) -> None:
    if not isinstance(values, list) or len(values) < at_least or any(not isinstance(v, str) or not v.strip() for v in values):
        problems.append(f"{where}: {name} needs at least {at_least} line(s) of text")


def _task_keys(tasks: list, where: str, problems: list[str]) -> None:
    keys = [t.get("key") for t in tasks]
    if any(not isinstance(k, str) or not TASK_KEY.match(k) for k in keys):
        problems.append(f"{where}: every task needs a key of a–z, 0–9, _ (at most 16)")
    if len(set(keys)) != len(keys):
        problems.append(f"{where}: duplicate task key")


def _validate_tasks(game: str, spec: dict, grade: int, where: str, problems: list[str]) -> int:
    """The number of distinct questions the game has (0 when its content is invalid)."""
    lim = limits(grade)
    tasks = spec.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        problems.append(f"{where}: tasks are required")
        return 0
    _task_keys(tasks, where, problems)
    signatures = set()
    for t in tasks:
        w = f"{where}/{t.get('key')}"
        _text(t.get("explanation"), w, problems, 600, "explanation")
        if t.get("hint") is not None:
            _text(t.get("hint"), w, problems, 200, "hint")
        if game == "order":
            _text(t.get("prompt"), w, problems, lim["question"], "prompt")
            items = t.get("items") or []
            if not 3 <= len(items) <= lim["items"]:
                problems.append(f"{w}: 3–{lim['items']} cards to order for this grade")
            if len(set(items)) != len(items):
                problems.append(f"{w}: two cards with the same text")
            for item in items:
                _text(item, w, problems, lim["text"], "card")
            signature = ("order", tuple(items))
        elif game == "match":
            _text(t.get("prompt"), w, problems, lim["question"], "prompt")
            pairs = t.get("pairs") or []
            if not 3 <= len(pairs) <= lim["pairs"] or any(not isinstance(p, list) or len(p) != 2 for p in pairs):
                problems.append(f"{w}: 3–{lim['pairs']} pairs [left, right] for this grade")
                continue
            lefts, rights = [p[0] for p in pairs], [p[1] for p in pairs]
            if len(set(lefts)) != len(lefts) or len(set(rights)) != len(rights):
                problems.append(f"{w}: every left and every right card must differ (one pairing only)")
            for text in lefts + rights:
                _text(text, w, problems, lim["text"], "card")
            signature = ("match", tuple(sorted(zip(lefts, rights))))  # the same pairs: the same question
        else:  # choice
            if t.get("passage") is not None:
                _text(t.get("passage"), w, problems, lim["passage"], "passage")
            _text(t.get("question"), w, problems, lim["question"], "question")
            options = t.get("options") or []
            graded = t.get("graded", True)
            if not 2 <= len(options) <= lim["options"]:
                problems.append(f"{w}: 2–{lim['options']} options for this grade")
            texts = [o.get("text") for o in options]
            if len(set(texts)) != len(texts):
                problems.append(f"{w}: two options with the same text")
            for o in options:
                _text(o.get("text"), w, problems, lim["text"] * 2, "option")
                _text(o.get("why"), w, problems, 400, "why (every option explains itself)")
            if graded and not any(o.get("ok") for o in options):
                problems.append(f"{w}: a graded question needs at least one acceptable option")
            if graded and all(o.get("ok") for o in options):
                problems.append(f"{w}: every option is right: make it ungraded (graded: false, tự đánh giá)")
            if not graded and spec.get("style") != "reflect":
                problems.append(f"{w}: ungraded questions belong to a reflect (tự đánh giá) game")
            signature = ("choice", t.get("passage"), t.get("question"))
        if signature in signatures:
            problems.append(f"{w}: the same question twice (never repeat content to fill a stage)")
        signatures.add(signature)
    if game == "choice" and spec.get("style", "quiz") not in CHOICE_STYLES:
        problems.append(f"{where}: style must be one of {', '.join(CHOICE_STYLES)}")
    return len(signatures)


def _validate_set(spec: dict, grade: int, where: str, problems: list[str]) -> int:
    s = spec.get("set") or {}
    lim = limits(grade)
    _text(s.get("title"), where, problems, lim["question"], "set title")
    groups = s.get("groups") or []
    ids = [g.get("id") for g in groups]
    if not 2 <= len(groups) <= (3 if grade <= 2 else 4) or len(set(ids)) != len(ids):
        problems.append(f"{where}: 2–{3 if grade <= 2 else 4} distinct groups for this grade")
    for g in groups:
        _text(g.get("label"), where, problems, 40, "group label")
        if not g.get("icon"):
            problems.append(f"{where}: group {g.get('id')} needs an icon")
    cards = s.get("cards") or []
    _task_keys(cards, where, problems)
    texts = [c.get("text") for c in cards]
    if len(set(texts)) != len(texts):
        problems.append(f"{where}: two cards with the same text")
    for c in cards:
        if c.get("group") not in ids:
            problems.append(f"{where}/{c.get('key')}: unknown group")
        _text(c.get("text"), where, problems, lim["text"], "card text")
        _text(c.get("explanation"), where, problems, 300, "card explanation")
    if any(sum(1 for c in cards if c.get("group") == g) < 2 for g in ids):
        problems.append(f"{where}: every group needs at least two cards")
    return len(cards)


def _validate_items(game: str, spec: dict, grade: int, where: str, problems: list[str]) -> int:
    """Ghép chữ and Thám tử chính tả: the same rules as their banks (curriculum_games.validate)."""
    items = spec.get("items") or []
    _task_keys(items, where, problems)
    filled = [{**i, "curriculum": "GDPT2018", "subject": "vietnamese", "grades": [grade, grade], "topic": "lesson",
               "difficulty": i.get("difficulty", 1), "version": 1} for i in items]
    data = {"items": filled}
    if game == "word_builder" and grade > 2:
        problems.append(f"{where}: Ghép chữ is for grades 1–2")
        return 0
    if game == "spelling_detective" and not 2 <= grade <= 9:
        problems.append(f"{where}: Thám tử chính tả is for grades 2–9")
        return 0
    if game == "spelling_detective":  # the bank's grade check (2–5) is the bank's; a lesson's grade was checked above
        for i in filled:
            i["grades"] = [2, 2]
    elif game == "word_builder":
        for i in filled:
            i["grades"] = [1, 1]
    found = cg.validate(game, data)
    problems += [f"{where}: {p}" for p in found]
    if game == "word_builder":
        answers = [i.get("answer") for i in items]
        if len(set(answers)) != len(answers):
            problems.append(f"{where}: the same word twice")
    else:
        sentences = [i.get("sentence") for i in items]
        if len(set(sentences)) != len(sentences):
            problems.append(f"{where}: the same sentence twice")
    return len(items)


def _validate_levels(spec: dict, where: str, problems: list[str]) -> int:
    levels = {lv["key"] for lv in cg.bank("code_path")["levels"]}
    keys = spec.get("levels") or []
    if len(set(keys)) != len(keys) or any(k not in levels for k in keys):
        problems.append(f"{where}: levels must be distinct keys of code_path.json")
    return len(set(keys) & levels)


def _validate_math(game: str, spec: dict, where: str, problems: list[str]) -> int:
    from .learning_engine import generate_math_items
    math = spec.get("math") or {}
    if math.get("topic") not in MATH_TOPICS[game]:
        problems.append(f"{where}: math.topic must be one of {', '.join(MATH_TOPICS[game])} for {game}")
        return 0
    if math["topic"] != "order_of_operations" and not isinstance(math.get("add_max"), int):
        problems.append(f"{where}: math.add_max is required")
        return 0
    try:
        items = generate_math_items(1, math["topic"], math, MATH_TURNS)
    except Exception as exc:  # noqa: BLE001 - a generator setting that cannot make problems
        problems.append(f"{where}: the generator settings do not work ({exc})")
        return 0
    if len({str(i["prompt"]) for i in items}) < MATH_TURNS:
        problems.append(f"{where}: the generator cannot make {MATH_TURNS} different problems")
    return MATH_TURNS


@lru_cache(maxsize=None)
def vocab_keys() -> frozenset[str]:
    """The active senses of the bundled vocabulary bank (the files are the source of truth for their keys)."""
    from .learning_vocab import check, effective_status
    rows, report = check()
    return frozenset(r.key for r in rows if effective_status(r, report) == "active")


def _validate_words(spec: dict, where: str, problems: list[str]) -> int:
    words = spec.get("words") or []
    if len(set(words)) != len(words):
        problems.append(f"{where}: the same word twice")
    missing = [w for w in words if w not in vocab_keys()]
    if missing:
        problems.append(f"{where}: not in the vocabulary bank: {', '.join(missing[:5])}")
    return len(set(words)) - len(set(missing))


def validate_file(data: dict, name: str = "lessons") -> list[str]:
    problems: list[str] = []
    subject = data.get("subject")
    meta = subject_meta(subject) if subject else None
    if meta is None or subject not in ABBR:
        return [f"{name}: unknown subject {subject}"]
    if meta.get("unsupported"):
        return [f"{name}: {subject} is marked unsupported in programme.json"]
    if not isinstance(data.get("version"), int):
        problems.append(f"{name}: version (an integer) is required")
    if data.get("organization") not in ORGANIZATIONS:
        problems.append(f"{name}: organization must be topic or textbook")
    if data.get("organization") == "textbook" and not (data.get("textbook") or {}).get("series"):
        problems.append(f"{name}: a textbook organization names its series and edition (textbook.series, textbook.edition)")
    _text(data.get("source_note"), name, problems, 600, "source_note")
    chapter_keys, lesson_keys = set(), set()
    abbr = ABBR[subject]
    for chapter in data.get("chapters", []):
        grade = chapter.get("grade")
        cwhere = f"{name}/{chapter.get('key')}"
        if not isinstance(grade, int) or offer(subject, grade) is None:
            problems.append(f"{cwhere}: {subject} is not taught in grade {grade}")
            continue
        key = chapter.get("key", "")
        if not (isinstance(key, str) and key.startswith(f"{abbr}{grade}.") and len(key) <= 40 and LESSON_KEY.match(key)):
            problems.append(f"{cwhere}: chapter key must look like {abbr}{grade}.<slug> (at most 40)")
        if key in chapter_keys:
            problems.append(f"{cwhere}: duplicate chapter key")
        chapter_keys.add(key)
        _text(chapter.get("title"), cwhere, problems, 80, "title")
        if not chapter.get("lessons"):
            problems.append(f"{cwhere}: a chapter lists its lessons (planned ones too)")
        for lesson in chapter.get("lessons", []):
            lkey = lesson.get("key", "")
            where = f"{name}/{lkey}"
            if not (isinstance(lkey, str) and lkey.startswith(f"{abbr}{grade}.") and len(lkey) <= 36 and LESSON_KEY.match(lkey)):
                problems.append(f"{where}: lesson key must look like {abbr}{grade}.<slug> (at most 36)")
            if lkey in lesson_keys or lkey in chapter_keys:
                problems.append(f"{where}: duplicate key")
            lesson_keys.add(lkey)
            _text(lesson.get("title"), where, problems, 90, "title")
            if re.fullmatch(r"(?i)\s*bài\s*\d+\s*", lesson.get("title") or ""):
                problems.append(f"{where}: the title must say what the lesson is about, not only its number")
            _text(lesson.get("description"), where, problems, 200, "description")
            if lesson.get("status") not in STATUSES:
                problems.append(f"{where}: status must be ready or planned")
                continue
            if data.get("organization") == "textbook" and not lesson.get("textbook_ref"):
                problems.append(f"{where}: a textbook lesson says which lesson of the book it follows (textbook_ref)")
            for req in lesson.get("requires", []):
                if req not in lesson_keys or req == lkey:
                    problems.append(f"{where}: requires {req}, which is not an earlier lesson of this file")
            if lesson.get("requires") and not lesson.get("requires_note"):
                problems.append(f"{where}: a prerequisite is explained (requires_note)")
            if lesson["status"] == "planned":
                if lesson.get("games"):
                    problems.append(f"{where}: a planned lesson publishes no game")
                continue
            review = lesson.get("review") or {}
            if review.get("status") not in REVIEW_STATUSES[1:]:
                problems.append(f"{where}: a ready lesson is at least checked (review.status)")
            _texts(lesson.get("objectives"), where, problems, "objectives")
            _texts(lesson.get("summary"), where, problems, "summary")
            for ex in lesson.get("examples", []):
                _text(ex.get("title"), where, problems, 90, "example title")
                _texts(ex.get("lines"), where, problems, "example lines")
            games = lesson.get("games") or []
            if not games:
                problems.append(f"{where}: a ready lesson publishes at least one game")
            ids = [g.get("game") for g in games]
            if len(set(ids)) != len(ids):
                problems.append(f"{where}: a game is published once per lesson")
            for spec in games:
                game = spec.get("game")
                gwhere = f"{where}/{game}"
                if game not in GAMES:
                    problems.append(f"{gwhere}: unknown game")
                    continue
                _text(spec.get("title"), gwhere, problems, 40, "title")
                kind = GAMES[game]["content"]
                if kind == "tasks":
                    count = _validate_tasks(game, spec, grade, gwhere, problems)
                elif kind == "set":
                    count = _validate_set(spec, grade, gwhere, problems)
                elif kind == "items":
                    count = _validate_items(game, spec, grade, gwhere, problems)
                elif kind == "levels":
                    count = _validate_levels(spec, gwhere, problems)
                elif kind == "math":
                    count = _validate_math(game, spec, gwhere, problems)
                else:
                    count = _validate_words(spec, gwhere, problems)
                if kind != "math" and count < MIN_TASKS[game]:
                    problems.append(f"{gwhere}: {count} question(s); this game needs at least {MIN_TASKS[game]} different ones")
                turns = spec.get("turns")
                if turns is not None and (not isinstance(turns, int) or turns < 1 or turns > min(count, MAX_TURNS[game])):
                    problems.append(f"{gwhere}: turns must be 1–{min(count, MAX_TURNS[game])} (never more than the questions it has)")
            done = lesson.get("completion") or {}
            if done and not (0 < done.get("min_first_try", 0.8) <= 1 and done.get("games", "all") in ("all", "any")):
                problems.append(f"{where}: completion is {{min_first_try: 0–1, games: all | any}}")
    return problems


def content_version(lesson: dict) -> str:
    """Changes whenever the lesson does: its games publish a new version, old sessions keep their copy."""
    return hashlib.sha256(json.dumps(lesson, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def catalog() -> dict:
    """Every lesson file, validated, indexed by subject and lesson key. Raises ContentError for any problem."""
    subjects: dict[str, dict] = {}
    lessons: dict[str, dict] = {}
    problems: list[str] = []
    for path in lesson_files():
        data = _load(path)
        found = validate_file(data, path.name)
        if found:
            problems += found
            continue
        if data["subject"] in subjects:
            problems.append(f"{path.name}: a second file for {data['subject']}")
            continue
        subjects[data["subject"]] = data
        for chapter in data["chapters"]:
            for lesson in chapter["lessons"]:
                if lesson["key"] in lessons:
                    problems.append(f"{path.name}: lesson {lesson['key']} is also in another file")
                lessons[lesson["key"]] = {"lesson": lesson, "chapter": chapter, "subject": data["subject"], "grade": chapter["grade"],
                                          "file": data, "version": content_version(lesson)}
    if problems:
        raise ContentError("; ".join(problems[:20]))
    # Next lesson: the next one of the same subject and grade, in chapter then lesson order.
    for code, data in subjects.items():
        for grade in GRADES:
            ordered = [lesson["key"] for chapter in sorted((c for c in data["chapters"] if c["grade"] == grade), key=_order)
                       for lesson in sorted(chapter["lessons"], key=_order)]
            for i, key in enumerate(ordered):
                lessons[key]["next"] = ordered[i + 1] if i + 1 < len(ordered) else None
                lessons[key]["position"] = i
    return {"subjects": subjects, "lessons": lessons}


def _order(entry: dict) -> tuple:
    return (entry.get("order", 0), entry["key"])


def chapters(subject: str, grade: int) -> list[dict]:
    data = catalog()["subjects"].get(subject)
    if data is None:
        return []
    return sorted((c for c in data["chapters"] if c["grade"] == grade), key=_order)


def lesson(key: str) -> dict | None:
    return catalog()["lessons"].get(key)


def game_spec(entry: dict, game: str) -> dict | None:
    return next((g for g in entry["lesson"].get("games", []) if g["game"] == game), None) if entry["lesson"]["status"] == "ready" else None


def turns_of(spec: dict) -> int:
    """The questions in one stage of a lesson's game: as many as it asks for, never more than it has."""
    game = spec["game"]
    if game in MATH_GAMES:
        return spec.get("turns") or MATH_TURNS
    count = {"tasks": lambda: len(spec["tasks"]), "set": lambda: len(spec["set"]["cards"]), "items": lambda: len(spec["items"]),
             "levels": lambda: len(spec["levels"]), "words": lambda: len(spec["words"])}[GAMES[game]["content"]]()
    return spec.get("turns") or min(count, MAX_TURNS[game])


def short_stage(spec: dict) -> bool:
    """A vocabulary lesson with fewer than the usual 15 words: a short stage, shown with its number of words."""
    return spec["game"] in VOCAB_GAMES and turns_of(spec) < VOCAB_FULL_STAGE


def lesson_code(key: str, game: str) -> str:
    """The database lesson a stage of this lesson's game is played in (one per lesson and game)."""
    return f"cat.{key}.{game}"


def game_config(entry: dict, spec: dict) -> dict:
    """The game configuration published for a lesson's game (a learning_lesson_versions row)."""
    game = spec["game"]
    common = {"lesson": entry["lesson"]["key"], "game": game, "grade": entry["grade"], "content": entry["version"]}
    if game in MATH_GAMES:
        math = dict(spec["math"])
        topic = math.pop("topic")
        return {"game_type": game, "turns": turns_of(spec), "travel_seconds": spec.get("travel_seconds", 20),
                "max_targets": {"practice": 1, "challenge": 2 if game == "defense" else 1},
                "generator": {**math, "math_topic": topic, **common}}
    if game in VOCAB_GAMES:
        return {"game_type": "meteor", "turns": turns_of(spec), "travel_seconds": 24, "variants": [game],
                "max_targets": {"practice": 1, "challenge": 2},
                "generator": {"vocab_bank": {"words": list(spec["words"])}, **common}}
    return {"game_type": game, "turns": turns_of(spec), "travel_seconds": 0, "max_targets": {"practice": 1, "challenge": 1},
            "generator": {"catalog": True, **common}}


def intro(entry: dict, spec: dict) -> dict:
    lesson_ = entry["lesson"]
    return {"kind": "lesson", "title": lesson_["title"], "objectives": lesson_["objectives"], "summary": lesson_["summary"],
            "examples": lesson_.get("examples", []), "game": spec["title"]}


# ---------------------------------------------------------------------------------------------------------------
# Building a stage (frozen on the session)
# ---------------------------------------------------------------------------------------------------------------

def question_key(lesson_key: str, game: str, task_key: str) -> str:
    return f"{lesson_key}:{game}:{task_key}"


def _keyed(snap: dict, lesson_key: str, game: str, task_key: str, label: str, skill_key: str | None = None) -> dict:
    return {**snap, "question_key": question_key(lesson_key, game, task_key), "skill_key": skill_key or f"cat.{lesson_key}.{task_key}",
            "skill_label": label[:120]}


def _label(text: str, limit: int = 60) -> str:
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def stage_items(lesson_key: str, game: str, seed: int, mastery: dict[str, int], weakness,
                review_keys: list[str] | None = None, version: str | None = None) -> list[dict]:
    """The questions of one stage of a lesson's game: only that lesson's content, weaker ones more likely, each at most
    once. A review stage asks the questions of `review_keys` again. Math and vocabulary stages are built elsewhere
    (generated problems, the vocabulary bank) from the lesson's settings."""
    entry = lesson(lesson_key)
    spec = game_spec(entry, game) if entry else None
    if spec is None or game not in CONTENT_GAMES:
        return []
    rng = random.Random(seed)
    turns = turns_of(spec)
    title = spec["title"]
    weight = lambda key: weakness(mastery.get(key), False)
    wanted = None
    if review_keys is not None:
        prefix = f"{lesson_key}:{game}:"
        wanted = [k[len(prefix):] for k in review_keys if k.startswith(prefix)]

    def pick(pool: list[dict], skill) -> list[dict]:
        if wanted is not None:
            by_key = {x["key"]: x for x in pool}
            chosen = [by_key[k] for k in wanted if k in by_key][:turns]
            rng.shuffle(chosen)
            return chosen
        order = sorted(pool, key=lambda x: rng.random() ** (1 / weight(skill(x))), reverse=True)
        return order[:turns]

    if GAMES[game]["content"] == "tasks":
        style = spec.get("style", "quiz")
        chosen = pick(spec["tasks"], lambda t: f"cat.{lesson_key}.{t['key']}")
        out = []
        for t in chosen:
            if game == "order":
                snap, label = cg.order_steps(t, rng, title), t["prompt"]
            elif game == "match":
                snap, label = cg.match_pairs(t, rng, title), t["prompt"]
            else:
                snap, label = cg.choice_explain(t, rng, title, style), t["question"]
            out.append(_keyed(snap, lesson_key, game, t["key"], f"{title} · {_label(label)}"))
        return out
    if game == "sorting":
        s = {**spec["set"], "key": lesson_key, "version": version or 1}
        chosen = pick(s["cards"], lambda c: f"cat.{lesson_key}.{c['key']}")
        rng.shuffle(chosen)
        return [_keyed(cg._sort_card(s, c), lesson_key, game, c["key"], f"Phân loại · {c['text']}") for c in chosen]
    if game == "code_path":
        levels = {lv["key"]: lv for lv in cg.bank("code_path")["levels"]}
        pool = [levels[k] for k in spec["levels"]]
        chosen = pick(pool, lambda lv: f"it.path.{lv['key']}")
        chosen.sort(key=lambda lv: (lv["difficulty"], lv["key"]))  # easier first
        return [_keyed(cg._code_path(lv, i + 1), lesson_key, game, lv["key"], f"Lập trình · màn {i + 1}", f"it.path.{lv['key']}")
                for i, lv in enumerate(chosen)]
    items = [{"topic": "lesson", **i, "version": version or 1} for i in spec["items"]]
    chosen = pick(items, lambda i: f"cat.{lesson_key}.{i['key']}")
    if game == "word_builder":
        return [_keyed(cg._word_build(i, rng), lesson_key, game, i["key"], f"Ghép chữ · {i['answer']}") for i in chosen]
    return [_keyed(cg._spell_fix(i, {}, rng), lesson_key, game, i["key"], f"Chính tả · {spec['title']}") for i in chosen]


# ---------------------------------------------------------------------------------------------------------------
# Inventory (docs and the check command)
# ---------------------------------------------------------------------------------------------------------------

def inventory() -> list[dict]:
    """Per grade and subject: chapters, lessons (ready / planned), the games published and how many questions."""
    rows = []
    for grade in GRADES:
        for s in subjects_for(grade):
            chaps = chapters(s["code"], grade)
            lessons_ = [lesson_ for c in chaps for lesson_ in c["lessons"]]
            ready = [lesson_ for lesson_ in lessons_ if lesson_["status"] == "ready"]
            games: dict[str, int] = {}
            questions = 0
            for lesson_ in ready:
                for spec in lesson_["games"]:
                    games[spec["game"]] = games.get(spec["game"], 0) + 1
                    content = GAMES[spec["game"]]["content"]
                    questions += {"tasks": lambda: len(spec["tasks"]), "set": lambda: len(spec["set"]["cards"]),
                                  "items": lambda: len(spec["items"]), "levels": lambda: len(spec["levels"]),
                                  "words": lambda: len(spec["words"]), "math": lambda: 0}[content]()
            rows.append({"grade": grade, "subject": s["code"], "name": s["name"], "type": s["type_label"], "chapters": len(chaps),
                         "lessons": len(lessons_), "ready": len(ready), "games": games, "questions": questions,
                         "generated": sum(1 for lesson_ in ready for spec in lesson_["games"] if spec["game"] in MATH_GAMES),
                         "unsupported": s["unsupported"]})
    return rows


GAME_SHORT = {"order": "Sắp xếp", "match": "Ghép cặp", "choice": "Chọn đáp án", "sorting": "Phân loại", "spelling_detective": "Chính tả",
              "word_builder": "Ghép chữ", "code_path": "Lập trình", "defense": "Bảo vệ căn cứ", "math_bridge": "Xây cầu toán",
              "meteor": "Việt → Anh", "word_shooter": "Anh → Việt"}


def markdown_inventory() -> str:
    """Per grade: every subject, its chapters, lessons (ready / listed), the games its ready lessons publish and how
    many reviewed questions they hold (generated Math problems are counted as lessons, not questions)."""
    out = []
    for grade in GRADES:
        rows = [r for r in inventory() if r["grade"] == grade]
        ready = sum(r["ready"] for r in rows)
        out += [f"### Lớp {grade}", "", f"{sum(1 for r in rows if not r['unsupported'])} môn/hoạt động có trong Mirabi trên {len(rows)} "
                f"của chương trình · {ready} bài sẵn sàng · {sum(r['questions'] for r in rows)} câu hỏi/nhiệm vụ đã soát", "",
                "| Môn | Loại | Chương | Bài sẵn sàng / trong danh mục | Trò chơi (số bài dùng) | Câu hỏi | Trạng thái |",
                "|---|---|---|---|---|---|---|"]
        for r in rows:
            games = ", ".join(f"{GAME_SHORT[g]} ×{n}" for g, n in sorted(r["games"].items(), key=lambda x: -x[1])) or "—"
            if r["unsupported"]:
                state = "Không hỗ trợ: " + r["unsupported"]
            elif not r["lessons"]:
                state = "Chưa có bài"
            elif r["ready"] == r["lessons"]:
                state = "Đủ bài trong danh mục"
            else:
                state = f"Còn {r['lessons'] - r['ready']} bài đang biên soạn"
            generated = f" (+{r['generated']} trò sinh đề)" if r["generated"] else ""
            out.append(f"| {r['name']} | {r['type']} | {r['chapters']} | {r['ready']} / {r['lessons']} | {games} | {r['questions']}{generated} | {state} |")
        out.append("")
    return "\n".join(out)


def main(argv: list[str]) -> int:  # python -m app.lesson_catalog check [files] | inventory [--markdown]
    if not argv or argv[0] not in ("check", "inventory"):
        print("usage: python -m app.lesson_catalog check [files] | inventory")
        return 2
    if argv[0] == "check":
        paths = [Path(a) for a in argv[1:]] or lesson_files()
        bad = 0
        for path in paths:
            problems = validate_file(_load(path), path.name)
            for p in problems:
                print(p)
            bad += len(problems)
            if not problems:
                data = _load(path)
                lessons_ = [lesson_ for c in data["chapters"] for lesson_ in c["lessons"]]
                print(f"{path.name}: ok · {len(data['chapters'])} chapters · {len(lessons_)} lessons · "
                      f"{sum(1 for lesson_ in lessons_ if lesson_['status'] == 'ready')} ready")
        if not argv[1:] and not bad:
            catalog()  # cross-file checks
        return 1 if bad else 0
    if argv[1:] == ["--markdown"]:  # the table of docs/LESSON_INVENTORY.md
        print(markdown_inventory())
        return 0
    for row in inventory():
        games = ", ".join(f"{g}×{n}" for g, n in sorted(row["games"].items())) or "—"
        status = "không hỗ trợ" if row["unsupported"] else f"{row['ready']}/{row['lessons']} bài sẵn sàng"
        print(f"Lớp {row['grade']:>2} · {row['name']:<40} · {row['chapters']} chương · {status} · {games} · {row['questions']} câu")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main(sys.argv[1:]))
