"""Content and rules of the curriculum games: Ghép chữ, Thám tử chính tả, Phân loại cùng pet, Lập trình đường đi.

The content is written and reviewed by hand in app/data/curriculum/*.json: every question carries its curriculum, subject,
grades, topic, difficulty, answer, explanation and version, and is validated when it is loaded (an invalid file stops
the server rather than serving a wrong question). Nothing here touches the database, so every rule is unit-tested
directly (tests/test_curriculum_games.py). Sessions freeze a copy of each question, as for the other games.
"""
from __future__ import annotations

import hashlib
import json
import random
from functools import lru_cache
from pathlib import Path

from .learning_engine import InvalidAnswer, normalize_text

DATA = Path(__file__).parent / "data" / "curriculum"

GAMES = ("word_builder", "spelling_detective", "sorting", "code_path")
KIND = {"word_builder": "word_build", "spelling_detective": "spell_fix", "sorting": "sort_card", "code_path": "code_path",
        # The lesson games (lesson_catalog.py): one gameplay each, the content comes from the lesson played.
        "order": "order_steps", "match": "match_pairs", "choice": "choice_explain"}
KINDS = frozenset(KIND.values())
LESSON_GAMES = ("order", "match", "choice")
# Questions in a stage. The app's guides say the same (mobile learning/tutorials.ts CURRICULUM_STAGE): keep in step.
STAGE_TURNS = {"word_builder": 10, "spelling_detective": 10, "sorting": 10, "code_path": 5}
# Wrong attempts allowed on one question: Lập trình đường đi lets the user run and fix a program as often as needed.
MAX_ATTEMPTS = {"code_path": 99}
# Labels of a question that is still open: they never give its answer away.
OPEN_LABEL = {"word_build": "Ghép chữ", "spell_fix": "Thám tử chính tả", "sort_card": "Phân loại", "code_path": "Lập trình",
              "order_steps": "Sắp xếp", "match_pairs": "Ghép cặp", "choice_explain": "Chọn đáp án"}
TIER_OF_GRADE = {**{g: "basic" for g in (3, 4, 5)}, **{g: "intermediate" for g in (6, 7, 8, 9)},
                 **{g: "advanced" for g in (10, 11, 12)}}
TIERS = ("basic", "intermediate", "advanced")

Band = int | str  # a school grade 1–12, or a level (Lập trình đường đi for learners outside school)


class ContentError(ValueError):
    """A content file that must not be served."""


# ---------------------------------------------------------------------------------------------------------------
# Loading and validating the content
# ---------------------------------------------------------------------------------------------------------------

def _path(game: str) -> Path:
    return DATA / f"{game}.json"


@lru_cache(maxsize=None)
def bank(game: str) -> dict:
    data = json.loads(_path(game).read_text(encoding="utf-8"))
    problems = validate(game, data)
    if problems:
        raise ContentError(f"{_path(game).name}: " + "; ".join(problems[:10]))
    return data


def bank_hash(game: str) -> str:
    """Changes whenever the file does: the lessons publish a new version, and old sessions keep their frozen copy."""
    return hashlib.sha256(_path(game).read_bytes()).hexdigest()[:16]


def _common(item: dict, where: str, problems: list[str], subject: str) -> None:
    for name in ("key", "curriculum", "subject", "topic", "difficulty", "version"):
        if item.get(name) in (None, ""):
            problems.append(f"{where}: missing {name}")
    if item.get("subject") != subject:
        problems.append(f"{where}: subject must be {subject}")


def _grades(item: dict, where: str, problems: list[str], low: int, high: int) -> None:
    grades = item.get("grades")
    if not (isinstance(grades, list) and len(grades) == 2 and low <= grades[0] <= grades[1] <= high):
        problems.append(f"{where}: grades must be [from, to] within {low}–{high}")


def validate(game: str, data: dict) -> list[str]:
    problems: list[str] = []
    keys: set[str] = set()
    if game == "word_builder":
        for item in data.get("items", []):
            where = f"item {item.get('key')}"
            _common(item, where, problems, "vietnamese")
            _grades(item, where, problems, 1, 2)
            pieces, answer = item.get("pieces") or [], item.get("answer", "")
            joined = ("" if item.get("unit") == "letter" else " ").join(pieces)
            if item.get("unit") not in ("letter", "syllable") or len(pieces) < 2 or joined != answer:
                problems.append(f"{where}: the pieces must make the answer")
            if not item.get("picture") or not item.get("explanation") or not item.get("hints"):
                problems.append(f"{where}: picture, hints and explanation are required")
            if item.get("key") in keys:
                problems.append(f"{where}: duplicate key")
            keys.add(item.get("key"))
    elif game == "spelling_detective":
        for item in data.get("items", []):
            where = f"item {item.get('key')}"
            _common(item, where, problems, "vietnamese")
            _grades(item, where, problems, 2, 5)
            words = item.get("sentence", "").split()
            plain = [w.strip(".,!?;:") for w in words]
            right, wrong, options = item.get("right"), item.get("wrong"), item.get("options") or []
            if plain.count(right) != 1:
                problems.append(f"{where}: the corrected syllable must appear exactly once")
            if not wrong or wrong == right or wrong in plain:
                problems.append(f"{where}: the misspelling must differ from every syllable of the sentence")
            if len(options) < 2 or len(set(options)) != len(options) or right not in options or wrong not in options:
                problems.append(f"{where}: options must hold the right and the wrong spelling, once each")
            if not item.get("explanation") or not item.get("hints"):
                problems.append(f"{where}: hints and explanation are required")
            if item.get("key") in keys:
                problems.append(f"{where}: duplicate key")
            keys.add(item.get("key"))
    elif game == "sorting":
        for s in data.get("sets", []):
            where = f"set {s.get('key')}"
            _common(s, where, problems, "science")
            _grades(s, where, problems, 1, 5)
            groups = {g.get("id") for g in s.get("groups", [])}
            if len(groups) < 2 or len(groups) != len(s.get("groups", [])):
                problems.append(f"{where}: at least two distinct groups")
            cards = s.get("cards", [])
            if len(cards) < STAGE_TURNS["sorting"]:
                problems.append(f"{where}: at least {STAGE_TURNS['sorting']} cards")
            if len({c.get('key') for c in cards}) != len(cards):
                problems.append(f"{where}: duplicate card key")
            for c in cards:
                if c.get("group") not in groups or not c.get("text") or not c.get("explanation"):
                    problems.append(f"{where}/{c.get('key')}: a known group, a text and an explanation are required")
            if any(sum(1 for c in cards if c.get("group") == g) < 2 for g in groups):
                problems.append(f"{where}: every group needs at least two cards")
            if s.get("key") in keys:
                problems.append(f"{where}: duplicate key")
            keys.add(s.get("key"))
    elif game == "code_path":
        for level in data.get("levels", []):
            where = f"level {level.get('key')}"
            _common(level, where, problems, "informatics")
            if level.get("tier") not in TIERS:
                problems.append(f"{where}: unknown tier")
            try:
                outcome = run_program(level, level.get("solution", []))
            except (InvalidAnswer, KeyError, TypeError) as exc:
                problems.append(f"{where}: invalid level or solution ({exc})")
                continue
            if not outcome["ok"]:
                problems.append(f"{where}: the solution does not reach the goal")
            if block_count(level["solution"]) > level.get("max_blocks", 0):
                problems.append(f"{where}: the solution uses more blocks than allowed")
            if level.get("key") in keys:
                problems.append(f"{where}: duplicate key")
            keys.add(level.get("key"))
    else:
        problems.append(f"unknown game {game}")
    return problems


# ---------------------------------------------------------------------------------------------------------------
# Which content a grade gets
# ---------------------------------------------------------------------------------------------------------------

def tier_of(band: Band) -> str | None:
    return band if band in TIERS else TIER_OF_GRADE.get(band) if isinstance(band, int) else None


# A question written for an earlier grade is still asked, but never more than this many grades later (too easy).
GRADES_BACK = 2


def _covers(item: dict, band: Band) -> bool:
    low, high = item["grades"]
    return isinstance(band, int) and low <= band <= high and band - low <= GRADES_BACK


def pool(game: str, band: Band) -> list[dict]:
    data = bank(game)
    if game == "sorting":
        return [s for s in data["sets"] if _covers(s, band)]
    if game == "code_path":
        tier = tier_of(band)
        return [lv for lv in data["levels"] if lv["tier"] == tier]
    return [i for i in data["items"] if _covers(i, band)]


PREFIX = {"word_builder": "vi", "spelling_detective": "vi", "sorting": "sci", "code_path": "it"}


def lesson_bands(game: str) -> list[Band]:
    """The bands a game has a lesson for: grades with enough content, or the three levels of Lập trình đường đi."""
    if game == "code_path":
        return [t for t in TIERS if available(game, t)]
    return [g for g in range(1, 13) if available(game, g)]


def lesson_code(game: str, band: Band) -> str:
    """The lesson a stage is played in: one per game and grade (Lập trình đường đi: one per level)."""
    part = tier_of(band) if game == "code_path" else f"g{band}"
    return f"{PREFIX[game]}.{game}.{part}"


def available(game: str, band: Band) -> bool:
    """Only offered where there is enough reviewed content for a whole stage: never a short or padded one."""
    if game == "sorting":
        return any(len(s["cards"]) >= STAGE_TURNS[game] for s in pool(game, band))
    return len(pool(game, band)) >= STAGE_TURNS[game]


# ---------------------------------------------------------------------------------------------------------------
# Building the questions of a stage (frozen on the session)
# ---------------------------------------------------------------------------------------------------------------

def _weighted(items: list, count: int, rng: random.Random, weight) -> list:
    """Without replacement, weaker ones more likely (the same draw as the English games)."""
    order = sorted(items, key=lambda x: rng.random() ** (1 / weight(x)), reverse=True)
    return order[:count]


def _shuffled_ids(texts: list[str], rng: random.Random, prefix: str) -> list[dict]:
    """Pieces in a shuffled order that is never the answer itself; ids follow the shuffled order, so they say nothing."""
    order = list(range(len(texts)))
    for _ in range(20):
        rng.shuffle(order)
        if order != sorted(order):
            break
    return [{"id": f"{prefix}{n + 1}", "text": texts[i]} for n, i in enumerate(order)]


def _word_build(item: dict, rng: random.Random) -> dict:
    unit = item["unit"]
    return {"kind": "word_build", "question_id": None, "question_key": f"word_builder.{item['key']}",
            "skill_key": f"vi.build.{item['key']}", "skill_label": "Ghép chữ" if unit == "letter" else "Ghép tiếng",
            "prompt": {"picture": item["picture"], "unit": unit, "tiles": _shuffled_ids(item["pieces"], rng, "t")},
            "answer": {"display": item["answer"], "accepted": [item["answer"]], "unit": unit, "version": item["version"]},
            "hints": item["hints"], "explanation": item["explanation"]}


def _spell_fix(item: dict, rtopics: dict, rng: random.Random) -> dict:
    tokens, wrong_id = [], None
    for i, word in enumerate(item["sentence"].split()):
        core = word.strip(".,!?;:")
        text = word.replace(core, item["wrong"], 1) if core == item["right"] else word
        tokens.append({"id": f"w{i + 1}", "text": text})
        if core == item["right"]:
            wrong_id = f"w{i + 1}"
    options = list(item["options"])
    rng.shuffle(options)
    options = [{"id": f"o{i + 1}", "text": text} for i, text in enumerate(options)]
    right_option = next(o["id"] for o in options if o["text"] == item["right"])
    return {"kind": "spell_fix", "question_id": None, "question_key": f"spelling_detective.{item['key']}",
            "skill_key": f"vi.spell.{item['key']}", "skill_label": f"Chính tả · {rtopics.get(item['topic'], item['topic'])}",
            "prompt": {"step": "find", "tokens": tokens},
            "answer": {"wrong_id": wrong_id, "options": options, "right_option": right_option, "right": item["right"],
                       "wrong": item["wrong"], "display": item["sentence"], "version": item["version"]},
            "hints": item["hints"], "explanation": item["explanation"]}


def _sort_card(s: dict, card: dict) -> dict:
    group = next(g for g in s["groups"] if g["id"] == card["group"])
    return {"kind": "sort_card", "question_id": None, "question_key": f"sorting.{s['key']}.{card['key']}",
            "skill_key": f"sci.sort.{s['key']}.{card['key']}", "skill_label": f"Phân loại · {card['text']}",
            "prompt": {"title": s["title"], "groups": s["groups"], "card": {"text": card["text"], "picture": card.get("picture", "")}},
            "answer": {"group": card["group"], "display": group["label"], "why": card["explanation"], "version": s["version"]},
            "hints": [], "explanation": card["explanation"]}


def solution_text(tokens: list[str]) -> str:
    words, out = {"forward": "Tiến", "left": "Rẽ trái", "right": "Rẽ phải", "end": "]"}, []
    for token in tokens:
        out.append(f"Lặp {token.split(':')[1]} lần [" if token.startswith("repeat:") else words[token])
    return " · ".join(out).replace("[ · ", "[").replace(" · ]", "]")


def _code_path(level: dict, number: int) -> dict:
    hints = [f"Đếm xem pet cần đi bao nhiêu ô trước khi rẽ. Màn này cho tối đa {level['max_blocks']} lệnh."]
    if "repeat" in level["blocks"]:
        hints.append("Tìm đoạn đường lặp lại giống nhau và đặt nó vào khối Lặp lại.")
    return {"kind": "code_path", "question_id": None, "question_key": f"code_path.{level['key']}",
            "skill_key": f"it.path.{level['key']}", "skill_label": f"Lập trình · màn {level['key']}",
            "prompt": {"number": number, "cols": level["cols"], "rows": level["rows"], "start": level["start"],
                       "goal": level["goal"], "walls": level["walls"], "blocks": level["blocks"], "max_blocks": level["max_blocks"]},
            "answer": {"display": solution_text(level["solution"]), "solution": level["solution"], "version": level["version"]},
            "hints": hints, "explanation": f"Một chương trình đúng: {solution_text(level['solution'])}."}


def stage_items(game: str, band: Band, seed: int, mastery: dict[str, int], weakness, review_keys: list[str] | None = None) -> list[dict]:
    """The questions of one stage for this band: weaker ones more likely, each at most once. A review stage asks the
    questions of `review_keys` (question keys) again."""
    rng = random.Random(seed)
    data = bank(game)
    weight = lambda skill_key: weakness(mastery.get(skill_key), False)
    if game == "sorting":
        sets = {s["key"]: s for s in data["sets"]}
        if review_keys is not None:
            chosen = [(sets[k.split(".")[1]], c) for k in review_keys if k.count(".") == 2 and k.split(".")[1] in sets
                      for c in sets[k.split(".")[1]]["cards"] if c["key"] == k.split(".")[2]]
            # One set per stage (its groups stay the same): the set with the most cards to review.
            if not chosen:
                return []
            best = max({s["key"] for s, _ in chosen}, key=lambda key: sum(1 for s, _ in chosen if s["key"] == key))
            cards = [c for s, c in chosen if s["key"] == best][:STAGE_TURNS[game]]
            rng.shuffle(cards)
            return [_sort_card(sets[best], c) for c in cards]
        candidates = [s for s in pool(game, band) if len(s["cards"]) >= STAGE_TURNS[game]]
        if not candidates:
            return []
        s = rng.choice(candidates)
        cards = _weighted(s["cards"], STAGE_TURNS[game], rng, lambda c: weight(f"sci.sort.{s['key']}.{c['key']}"))
        rng.shuffle(cards)
        return [_sort_card(s, c) for c in cards]
    if game == "code_path":
        levels = {lv["key"]: lv for lv in data["levels"]}
        if review_keys is not None:
            chosen = [levels[k.split(".", 1)[1]] for k in review_keys if k.split(".", 1)[-1] in levels][:STAGE_TURNS[game]]
        else:
            chosen = _weighted(pool(game, band), STAGE_TURNS[game], rng, lambda lv: weight(f"it.path.{lv['key']}"))
        chosen.sort(key=lambda lv: (lv["difficulty"], lv["key"]))  # easier first
        return [_code_path(lv, i + 1) for i, lv in enumerate(chosen)]
    items = {i["key"]: i for i in data["items"]}
    if review_keys is not None:
        chosen = [items[k.split(".", 1)[1]] for k in review_keys if k.split(".", 1)[-1] in items][:STAGE_TURNS[game]]
        rng.shuffle(chosen)
    else:
        prefix = "vi.build." if game == "word_builder" else "vi.spell."
        chosen = _weighted(pool(game, band), STAGE_TURNS[game], rng, lambda i: weight(prefix + i["key"]))
    if game == "word_builder":
        return [_word_build(i, rng) for i in chosen]
    return [_spell_fix(i, data.get("topics", {}), rng) for i in chosen]


def order_steps(task: dict, rng: random.Random, title: str) -> dict:
    """Sắp xếp thứ tự (vòng đời, dòng thời gian, quy trình, câu): the cards in a shuffled order; the right order is only
    in the answer. Card ids follow the shuffled order, so they say nothing."""
    cards = _shuffled_ids(task["items"], rng, "c")
    by_text = {c["text"]: c["id"] for c in cards}
    return {"kind": "order_steps", "question_id": None, "prompt": {
                "title": title, "prompt": task["prompt"], "cards": cards,
                "first": task.get("first_label"), "last": task.get("last_label")},
            "answer": {"order": [by_text[text] for text in task["items"]], "display": " → ".join(task["items"])},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def match_pairs(task: dict, rng: random.Random, title: str) -> dict:
    """Ghép cặp: the left and the right column each shuffled on their own; a pair is answered as "a1b3"."""
    lefts = _shuffled_ids([left for left, _ in task["pairs"]], rng, "a")
    rights = _shuffled_ids([right for _, right in task["pairs"]], rng, "b")
    lid, rid = {c["text"]: c["id"] for c in lefts}, {c["text"]: c["id"] for c in rights}
    return {"kind": "match_pairs", "question_id": None, "prompt": {
                "title": title, "prompt": task["prompt"], "lefts": lefts, "rights": rights,
                "left_label": task.get("left_label"), "right_label": task.get("right_label")},
            "answer": {"pairs": {lid[left]: rid[right] for left, right in task["pairs"]},
                       "display": "; ".join(f"{left} – {right}" for left, right in task["pairs"])},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def choice_explain(task: dict, rng: random.Random, title: str, style: str) -> dict:
    """Chọn đáp án có giải thích (tình huống, đọc hiểu, dự đoán hiện tượng, kiến thức): every option says why it is or
    is not right. Several options can be right when the lesson judges by criteria; `graded: false` (tự đánh giá) has no
    wrong answer at all."""
    options = [dict(o) for o in task["options"]]
    rng.shuffle(options)
    ids = [f"o{i + 1}" for i in range(len(options))]
    graded = task.get("graded", True)
    ok = [i for i, o in zip(ids, options) if o.get("ok") or not graded]
    return {"kind": "choice_explain", "question_id": None, "prompt": {
                "title": title, "style": style, "passage": task.get("passage"), "question": task["question"],
                "options": [{"id": i, "text": o["text"]} for i, o in zip(ids, options)], "graded": graded},
            "answer": {"ok": ok, "why": {i: o["why"] for i, o in zip(ids, options)}, "graded": graded,
                       "display": " / ".join(o["text"] for o in options if o.get("ok")) if graded else "Tự đánh giá"},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


# ---------------------------------------------------------------------------------------------------------------
# Lập trình đường đi: the program and the pet's walk
# ---------------------------------------------------------------------------------------------------------------

STEP = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}
TURN = {"left": {"N": "W", "W": "S", "S": "E", "E": "N"}, "right": {"N": "E", "E": "S", "S": "W", "W": "N"}}
MAX_STEPS = 200


def block_count(tokens: list[str]) -> int:
    """What the program bar shows: every block, a loop counting as one (its closing bracket is not a block)."""
    return sum(1 for t in tokens if t != "end")


def expand(tokens: list[str], allowed: list[str] | None = None) -> list[str]:
    """The moves a program makes. A loop holds 2–9 repeats of at least one move, and loops are not nested.
    Raises InvalidAnswer for anything else (it is not a wrong answer: the app never builds such a program)."""
    allowed = allowed or ["forward", "left", "right", "repeat"]
    moves: list[str] = []
    body: list[str] | None = None
    times = 0
    for token in tokens:
        if token.startswith("repeat:"):
            count = token.split(":", 1)[1]
            if "repeat" not in allowed or body is not None or not count.isdigit() or not 2 <= int(count) <= 9:
                raise InvalidAnswer("bad loop")
            body, times = [], int(count)
        elif token == "end":
            if not body:
                raise InvalidAnswer("empty or unopened loop")
            moves += body * times
            body = None
        elif token in ("forward", "left", "right") and token in allowed:
            (body if body is not None else moves).append(token)
        else:
            raise InvalidAnswer(f"unknown block {token}")
    if body is not None:
        raise InvalidAnswer("unclosed loop")
    if not moves:
        raise InvalidAnswer("empty program")
    return moves


def run_program(level: dict, tokens: list[str]) -> dict:
    """Walk the pet: it stops on the goal (success), on an obstacle or the edge (it does not enter it), or after the
    last move. `path` lists every position (x, y, facing) from the start; `step` is the move that ended the walk."""
    moves = expand(tokens, level.get("blocks"))
    walls = {tuple(w) for w in level["walls"]}
    x, y, facing = level["start"]["x"], level["start"]["y"], level["start"]["dir"]
    goal = (level["goal"]["x"], level["goal"]["y"])
    path = [(x, y, facing)]
    for n, move in enumerate(moves[:MAX_STEPS], start=1):
        if move == "forward":
            nx, ny = x + STEP[facing][0], y + STEP[facing][1]
            if not (0 <= nx < level["cols"] and 0 <= ny < level["rows"]):
                return {"ok": False, "reason": "edge", "step": n, "path": path}
            if (nx, ny) in walls:
                return {"ok": False, "reason": "wall", "step": n, "path": path}
            x, y = nx, ny
        else:
            facing = TURN[move][facing]
        path.append((x, y, facing))
        if (x, y) == goal:
            return {"ok": True, "reason": "goal", "step": n, "path": path}
    return {"ok": False, "reason": "short", "step": len(moves), "path": path}


# ---------------------------------------------------------------------------------------------------------------
# Checking an answer
# ---------------------------------------------------------------------------------------------------------------

def _ids(answer, allowed: set[str], exact: int | None = None) -> list[str]:
    if not isinstance(answer, list) or any(a not in allowed for a in answer):
        raise InvalidAnswer("unknown piece")
    if exact is not None and len(answer) != exact:
        raise InvalidAnswer("wrong number of pieces")
    return answer


def spell_found(prompt: dict, expected: dict, answer) -> bool | None:
    """Thám tử chính tả, first step (the word): True if the misspelled word was tapped, False for another word. None in
    the second step (the spelling), checked by check()."""
    if prompt.get("step") != "find":
        return None
    word = _ids(answer, {t["id"] for t in prompt["tokens"]}, exact=1)[0]
    return word == expected["wrong_id"]


def check(kind: str, prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    """(correct, error type, what was answered, feedback for a wrong answer). Raises InvalidAnswer for a malformed one."""
    if kind == "word_build":
        tiles = {t["id"]: t["text"] for t in prompt["tiles"]}
        ids = _ids(answer, set(tiles), exact=len(tiles))
        if len(set(ids)) != len(ids):
            raise InvalidAnswer("a piece used twice")
        built = ("" if prompt["unit"] == "letter" else " ").join(tiles[i] for i in ids)
        ok = normalize_text(built) in {normalize_text(a) for a in expected["accepted"]}
        piece = "chữ" if prompt["unit"] == "letter" else "tiếng"
        return ok, None if ok else "wrong_order", built, None if ok else f"Chưa đúng: “{built}”. Thử đổi thứ tự các {piece} nhé."
    if kind == "spell_fix":
        if prompt.get("step") == "find":  # a word that is spelled right was tapped (the right one is spell_found)
            word = _ids(answer, {t["id"] for t in prompt["tokens"]}, exact=1)[0]
            text = next(t["text"] for t in prompt["tokens"] if t["id"] == word).strip(".,!?;:")
            return False, "wrong_word", text, f"“{text}” viết đúng rồi. Đọc lại câu và tìm tiếng viết sai nhé."
        options = {o["id"]: o["text"] for o in prompt["options"]}
        word, option = _ids(answer, {prompt["found"], *options}, exact=2)
        if word != prompt["found"] or option not in options:
            raise InvalidAnswer("expected the found word and an option")
        ok = option == expected["right_option"]
        return ok, None if ok else "wrong_fix", options[option], None if ok else (
            f"“{options[option]}” chưa đúng trong câu này. Chọn cách viết khác nhé.")
    if kind == "sort_card":
        groups = {g["id"]: g["label"] for g in prompt["groups"]}
        if not isinstance(answer, str) or answer not in groups:
            raise InvalidAnswer("unknown group")
        ok = answer == expected["group"]
        return ok, None if ok else "wrong_group", groups[answer], None if ok else (
            f"Chưa đúng, thẻ chưa thuộc nhóm “{groups[answer]}”. {expected['why']}")
    if kind == "code_path":
        if not isinstance(answer, list):
            raise InvalidAnswer("expected blocks")
        if block_count(answer) > prompt["max_blocks"]:
            raise InvalidAnswer("too many blocks")
        level = {**prompt}
        outcome = run_program(level, answer)
        given = solution_text(answer)
        if outcome["ok"]:
            return True, None, given, None
        feedback = {"wall": f"Pet gặp vật cản ở bước {outcome['step']}. Sửa lệnh rồi chạy lại nhé.",
                    "edge": f"Pet đi ra ngoài bản đồ ở bước {outcome['step']}. Sửa lệnh rồi chạy lại nhé.",
                    "short": "Pet đã chạy hết lệnh nhưng chưa tới đích. Thêm hoặc sửa lệnh nhé."}[outcome["reason"]]
        return False, f"path_{outcome['reason']}", given, feedback
    if kind == "order_steps":
        cards = {c["id"]: c["text"] for c in prompt["cards"]}
        ids = _ids(answer, set(cards), exact=len(cards))
        if len(set(ids)) != len(ids):
            raise InvalidAnswer("a card used twice")
        in_place = sum(1 for a, b in zip(ids, expected["order"]) if a == b)
        ok = in_place == len(ids)
        return ok, None if ok else "wrong_order", " → ".join(cards[i] for i in ids), None if ok else (
            f"Có {in_place}/{len(ids)} thẻ đúng vị trí. Đổi chỗ các thẻ còn lại rồi kiểm tra lại nhé.")
    if kind == "match_pairs":
        pairs = _pairs(prompt, answer)
        right = sum(1 for a, b in pairs.items() if expected["pairs"].get(a) == b)
        ok = right == len(expected["pairs"])
        texts = {c["id"]: c["text"] for c in prompt["lefts"] + prompt["rights"]}
        given = "; ".join(f"{texts[a]} – {texts[b]}" for a, b in pairs.items())
        return ok, None if ok else "wrong_pair", given, None if ok else (
            f"Đúng {right}/{len(pairs)} cặp. Các cặp đúng được giữ lại, ghép lại những cặp còn lại nhé.")
    if kind == "choice_explain":
        options = {o["id"]: o["text"] for o in prompt["options"]}
        if not isinstance(answer, str) or answer not in options:
            raise InvalidAnswer("unknown option")
        ok = answer in expected["ok"]
        return ok, None if ok else "wrong_choice", options[answer], expected["why"].get(answer)
    raise InvalidAnswer(f"unknown kind {kind}")


def _pairs(prompt: dict, answer) -> dict[str, str]:
    """A whole board of pairs ("a1b3", every left once, every right once). Raises InvalidAnswer for anything else."""
    lefts, rights = {c["id"] for c in prompt["lefts"]}, {c["id"] for c in prompt["rights"]}
    if not isinstance(answer, list) or len(answer) != len(lefts):
        raise InvalidAnswer("expected one pair per left card")
    pairs: dict[str, str] = {}
    for token in answer:
        a, _, b = token.partition("b")
        b = "b" + b
        if a not in lefts or b not in rights or a in pairs or b in pairs.values():
            raise InvalidAnswer("bad pair")
        pairs[a] = b
    return pairs


def kept(kind: str, prompt: dict, expected: dict, answer) -> list[str] | None:
    """After a wrong answer: what the app may keep in place (cards in the right place, pairs that are right), so only
    the rest is redone. None for the other games."""
    try:
        if kind == "order_steps":
            return [a for a, b in zip(answer, expected["order"]) if a == b]
        if kind == "match_pairs":
            return [a + b for a, b in _pairs(prompt, answer).items() if expected["pairs"].get(a) == b]
    except (InvalidAnswer, TypeError):
        return None
    return None
