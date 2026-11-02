"""Học tập by lesson: Chương trình → Khối lớp → Môn học → Chương/Chủ đề → Bài học → Trò chơi.

The programme (app/data/catalog/programme.json) lists, for every grade 1–12, the subjects and educational activities of
Vietnam's Chương trình giáo dục phổ thông 2018 as amended (Thông tư 32/2018, 20/2021, 13/2022, 17/2025), named as at
that grade, with their type (bắt buộc, lựa chọn, tự chọn) and what Mirabi supports. The lessons
(app/data/catalog/lessons/*.json, one file per subject) are grouped by chapter or topic, in the order of the curriculum.
A lesson is either `ready` (it publishes games, each with enough reviewed content of its own) or `planned` (listed, never
playable). A game only ever draws the content of the lesson played: never another lesson's, never another grade's, never
a repeated question to fill a stage. The vocabulary games are the one exception, by design: a lesson's `words` are its
core words, served first, and its games then go on with new words of the same and related themes (vocab_lesson.py),
never the words of a higher grade's or a locked lesson.

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

from . import curriculum_games as cg, game_registry as gr, lesson_games as lg

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
# How a chapter's lessons open (learning_unlocks.py): one after the other, or all with the chapter. On a subject's file,
# `free` opens every chapter and lesson of the subject at once, for subjects whose lessons do not build on each other.
PROGRESSIONS = ("sequential", "free")
REVIEW_STATUSES = ("draft", "checked", "teacher_reviewed")  # a ready lesson is at least `checked`
REVIEW_LABEL = {"draft": "Bản nháp", "checked": "Mirabi biên soạn và đã soát", "teacher_reviewed": "Giáo viên đã thẩm định"}
ORGANIZATIONS = ("topic", "textbook")

# The drawn world a lesson's games are played in (the app draws it above the lesson's own game): Math Kingdom, Space
# Adventure, Word Forest, Magic Laboratory, Time Traveler, Treasure Explorer. A subject not listed has none yet. Lịch sử
# và Địa lí plays its Địa lí chapters ("Địa lí: …") on the map and the rest in time; a lesson may name its own (`world`),
# for the grade 4–5 chapters that mix both.
WORLDS = ("kingdom", "space", "forest", "lab", "time", "map")
SUBJECT_WORLD = {"math": "kingdom", "english": "space", "vietnamese": "forest", "science": "lab", "physics": "lab",
                 "chemistry": "lab", "biology": "lab", "history": "time", "geography": "map", "history_geography": "time"}

# The games a lesson can publish. `kind`: what plays it (a gameplay shared by every lesson that uses it).
GAMES = {
    "order": {"name": "Sắp xếp thứ tự", "content": "tasks"},
    "match": {"name": "Ghép cặp", "content": "tasks"},
    "choice": {"name": "Chọn đáp án có giải thích", "content": "tasks"},
    "lab": {"name": "Phòng thí nghiệm", "content": "tasks"},
    "sorting": {"name": "Phân loại cùng pet", "content": "set"},
    "spelling_detective": {"name": "Thám tử chính tả", "content": "items"},
    "word_builder": {"name": "Ghép chữ", "content": "items"},
    "code_path": {"name": "Lập trình đường đi", "content": "levels"},
    "defense": {"name": "Bảo vệ căn cứ", "content": "math"},
    "math_bridge": {"name": "Xây cầu toán học", "content": "math"},
    "meteor": {"name": "Bắn thiên thạch (Việt → Anh)", "content": "words"},
    "word_shooter": {"name": "Bắn từ tiếng Anh (Anh → Việt)", "content": "words"},
    # The subject gameplays (lesson_games.py): a timeline, a sentence line, a geometry workshop, an equation to balance.
    **{game: {"name": lg.NAMES[game], "content": "tasks"} for game in lg.GAMES},
}
CONTENT_GAMES = ("order", "match", "choice", "lab", "sorting", "spelling_detective", "word_builder", "code_path", *lg.GAMES)
MATH_GAMES = ("defense", "math_bridge")
VOCAB_GAMES = ("meteor", "word_shooter")
CHOICE_STYLES = ("quiz", "situation", "reading", "predict", "reflect")
MATH_TOPICS = {"defense": ("arithmetic", "order_of_operations"), "math_bridge": ("missing_number", "compare")}

# The fewest questions a published game may have (fewer: the lesson cannot publish it) and the most a stage asks.
MIN_TASKS = {"order": 4, "match": 3, "choice": 5, "lab": 3, "sorting": 8, "spelling_detective": 6, "word_builder": 6, "code_path": 3,
             "meteor": 6, "word_shooter": 6, **lg.MIN_TASKS}
MAX_TURNS = {"order": 8, "match": 6, "choice": 10, "lab": 6, "sorting": 10, "spelling_detective": 10, "word_builder": 10, "code_path": 5,
             "defense": 12, "math_bridge": 12, "meteor": 15, "word_shooter": 15, **lg.MAX_TURNS}
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
        if game in lg.GAMES:
            signature = lg.validate_task(game, t, lim, w, problems)
            if signature is None:
                continue
        elif game == "order":
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
        elif game == "lab":
            if not _validate_lab(spec, t, lim, w, problems):
                continue
            signature = ("lab", t.get("goal"), tuple(sorted(p["key"] for p in t["parts"])))
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


def _validate_lab(spec: dict, t: dict, lim: dict, w: str, problems: list[str]) -> bool:
    """Phòng thí nghiệm: a known scene, parts with their art and why they fit or not, slots that can all be filled
    with an accepted part, and at least one part that does not fit (something to find out)."""
    scene = cg.LAB_SCENES.get(spec.get("scene"))
    if scene is None:
        problems.append(f"{w}: scene must be one of {', '.join(cg.LAB_SCENES)}")
        return False
    _text(t.get("goal"), w, problems, lim["question"], "goal")
    _text(t.get("result"), w, problems, 300, "result (what the experiment shows)")
    parts, slots = t.get("parts") or [], t.get("slots") or []
    keys = [p.get("key") for p in parts]
    if not 2 <= len(parts) <= 6 or len(set(keys)) != len(keys):
        problems.append(f"{w}: 2–6 parts with different keys")
        return False
    for p in parts:
        _text(p.get("name"), w, problems, lim["text"], "part name")
        _text(p.get("why"), w, problems, 400, "why (every part explains itself)")
        if p.get("art") not in scene["art"]:
            problems.append(f"{w}: part {p.get('key')} has no drawing for this scene ({p.get('art')})")
    ids = [s.get("id") for s in slots]
    if not slots or len(set(ids)) != len(ids) or any(i not in scene["slots"] for i in ids):
        problems.append(f"{w}: slots must be different ones of {', '.join(scene['slots'])}")
        return False
    if spec["scene"] == "plant" and ids != [f"s{i + 1}" for i in range(len(ids))]:
        problems.append(f"{w}: the stages are slots s1, s2… in order")
    for s in slots:
        _text(s.get("label"), w, problems, 40, "slot label")
        if not s.get("accept") or any(k not in keys for k in s["accept"]):
            problems.append(f"{w}: slot {s.get('id')} accepts known parts")
            return False
    if not cg.lab_solvable(slots):
        problems.append(f"{w}: no way to fill every slot with a part it accepts")
    if all(set(s["accept"]) == set(keys) for s in slots):
        problems.append(f"{w}: every part fits everywhere: nothing to find out")
    if spec["scene"] in cg.LAB_TARGETS and t.get("target") not in cg.LAB_TARGETS[spec["scene"]]:
        problems.append(f"{w}: target must be one of {', '.join(cg.LAB_TARGETS[spec['scene']])}")
    if spec["scene"] == "water" and (t.get("start") not in cg.LAB_TARGETS["water"] or t.get("start") == t.get("target")):
        problems.append(f"{w}: water needs a start state other than the target")
    return True


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
    if data.get("progression", "sequential") not in PROGRESSIONS:
        problems.append(f"{name}: progression must be one of {', '.join(PROGRESSIONS)}")
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
        if chapter.get("progression", "sequential") not in PROGRESSIONS:
            problems.append(f"{cwhere}: progression must be one of {', '.join(PROGRESSIONS)}")
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
                elif not req.startswith(f"{abbr}{grade}."):  # another grade's lesson is never completed this school year
                    problems.append(f"{where}: requires {req}, which is not a lesson of grade {grade}")
            if lesson.get("requires") and not lesson.get("requires_note"):
                problems.append(f"{where}: a prerequisite is explained (requires_note)")
            if not isinstance(lesson.get("optional", False), bool):
                problems.append(f"{where}: optional is true or false")
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
            if any(not isinstance(g.get("optional", False), bool) for g in games):
                problems.append(f"{where}: a game's optional is true or false")
            elif games and all(g.get("optional") for g in games):
                # Completing nothing never completes a lesson (nor opens the next one).
                problems.append(f"{where}: at least one game is required (not optional)")
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
                # A lesson that gets a new gameplay keeps the learners who completed it: a pass of the game it
                # replaces (or of an earlier one it adds to) counts as a pass of this one (lesson_api.lesson_state).
                credit = spec.get("credit_from")
                if credit is not None and (credit not in GAMES or credit == game):
                    problems.append(f"{gwhere}: credit_from names another game (the one this replaces or adds to)")
            if lesson.get("activity") is not None and lesson["activity"] not in gr.ACTIVITIES:
                problems.append(f"{where}: activity must be one of game_registry.ACTIVITIES")
            if lesson.get("world") is not None and lesson["world"] not in WORLDS:
                problems.append(f"{where}: world must be one of {', '.join(WORLDS)}")
            done = lesson.get("completion") or {}
            if done and not (0 < done.get("min_first_try", 0.8) <= 1 and done.get("games", "all") in ("all", "any")):
                problems.append(f"{where}: completion is {{min_first_try: 0–1, games: all | any}}")
    return problems


def content_version(lesson: dict) -> str:
    """Changes whenever the lesson does: its games publish a new version, old sessions keep their copy. The world it
    is drawn in and its declared activity (game_registry) say nothing about its content (not part of the version)."""
    content = {k: v for k, v in lesson.items() if k not in ("world", "activity")}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


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
            # What opens what (learning_unlocks.py) must never go round in a loop, whatever the `order` fields say.
            loop = find_cycle(unlock_edges(_unlock_path(sorted((c for c in data["chapters"] if c["grade"] == grade), key=_order),
                                                        data.get("progression") == "free")))
            if loop:
                problems.append(f"{code} grade {grade}: the unlock rules go round in a loop: {' → '.join(loop)}")
    if problems:
        raise ContentError("; ".join(problems[:20]))
    return {"subjects": subjects, "lessons": lessons}


def _order(entry: dict) -> tuple:
    return (entry.get("order", 0), entry["key"])


# ---------------------------------------------------------------------------------------------------------------
# Unlock rules: what opens a chapter or a lesson (learning_unlocks.py applies them to a learner's progress)
# ---------------------------------------------------------------------------------------------------------------

def _unlock_path(chaps: list[dict], free_subject: bool = False) -> list[dict]:
    """A subject's chapters at a grade, in order, each with its lessons in order and what opens them:
    - a chapter opens once every required lesson of `needs` (the nearest earlier chapter that has one) is completed;
      the first chapter, or one after chapters with nothing required, opens at once;
    - in an open chapter a lesson opens once its `after` (the required lesson before it; none in a `free` chapter)
      and its own `requires` are completed.
    Required: a ready lesson not marked `optional`. A lesson still being written is never open and holds nothing back.
    In a `free` subject every chapter and lesson opens at once (a lesson's own `requires` still applies)."""
    out: list[dict] = []
    before: dict | None = None
    for c in chaps:
        free = free_subject or c.get("progression", "sequential") == "free"
        lessons, after = [], None
        for lesson_ in sorted(c["lessons"], key=_order):
            ready = lesson_["status"] == "ready"
            required = ready and not lesson_.get("optional", False)
            lessons.append({"key": lesson_["key"], "title": lesson_["title"], "ready": ready, "required": required,
                            "requires": list(lesson_.get("requires", [])), "after": None if free else after})
            if required:
                after = lesson_["key"]
        chapter = {"key": c["key"], "title": c["title"], "free": free, "lessons": lessons,
                   "required": [x["key"] for x in lessons if x["required"]],
                   "after": before["key"] if before and not free_subject else None,
                   "after_title": before["title"] if before and not free_subject else None,
                   "needs": list(before["required"]) if before and not free_subject else []}
        out.append(chapter)
        if chapter["required"]:
            before = chapter
    return out


def unlock_path(subject: str, grade: int) -> list[dict]:
    data = catalog()["subjects"].get(subject) or {}
    return _unlock_path(chapters(subject, grade), data.get("progression") == "free")


def unlock_edges(path: list[dict]) -> dict[str, list[str]]:
    """node → the nodes it waits for ("c:<chapter>", "l:<lesson>")."""
    edges: dict[str, list[str]] = {}
    for c in path:
        edges[f"c:{c['key']}"] = [f"l:{k}" for k in c["needs"]]
        for x in c["lessons"]:
            edges[f"l:{x['key']}"] = [f"c:{c['key']}"] + [f"l:{k}" for k in ([x["after"]] if x["after"] else []) + x["requires"]]
    return edges


def find_cycle(edges: dict[str, list[str]]) -> list[str] | None:
    """A loop of the graph (its nodes, the first one repeated at the end), or None."""
    state: dict[str, int] = {}  # 1: being visited, 2: done
    stack: list[str] = []

    def visit(node: str) -> list[str] | None:
        state[node] = 1
        stack.append(node)
        for nxt in edges.get(node, ()):
            if state.get(nxt) == 1:
                return stack[stack.index(nxt):] + [nxt]
            if nxt not in state and (found := visit(nxt)):
                return found
        state[node] = 2
        stack.pop()
        return None

    for node in edges:
        if node not in state and (found := visit(node)):
            return found
    return None


def chapters(subject: str, grade: int) -> list[dict]:
    data = catalog()["subjects"].get(subject)
    if data is None:
        return []
    return sorted((c for c in data["chapters"] if c["grade"] == grade), key=_order)


def lesson(key: str) -> dict | None:
    return catalog()["lessons"].get(key)


def world_of(entry: dict) -> str | None:
    """The world a lesson's games are drawn in (WORLDS), or None."""
    if entry["lesson"].get("world"):
        return entry["lesson"]["world"]
    if entry["subject"] == "history_geography" and entry["chapter"]["title"].startswith("Địa lí"):
        return "map"
    return SUBJECT_WORLD.get(entry["subject"])


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
                # discover: Khám phá từ mới (vocab_lesson.py): the core words first, then new words beyond them.
                "generator": {"vocab_bank": {"words": list(spec["words"]), "discover": True}, **common}}
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
            if game in lg.GAMES:
                snap, label = lg.snapshot(game, t, rng, title), lg.label(game, t)
            elif game == "order":
                snap, label = cg.order_steps(t, rng, title), t["prompt"]
            elif game == "match":
                snap, label = cg.match_pairs(t, rng, title), t["prompt"]
            elif game == "lab":
                snap, label = cg.lab_experiment(t, rng, title, spec["scene"]), t["goal"]
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


GAME_SHORT = {"order": "Sắp xếp", "match": "Ghép cặp", "choice": "Chọn đáp án", "lab": "Thí nghiệm", "sorting": "Phân loại", "spelling_detective": "Chính tả",
              "word_builder": "Ghép chữ", "code_path": "Lập trình", "defense": "Bảo vệ căn cứ", "math_bridge": "Xây cầu toán",
              "meteor": "Việt → Anh", "word_shooter": "Anh → Việt", "timeline": "Dòng thời gian", "sentence": "Xây câu",
              "geometry": "Hình học", "balance": "Cân bằng PT"}


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
