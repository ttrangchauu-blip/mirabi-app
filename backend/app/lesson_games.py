"""The subject gameplays of the lesson catalog: each is its own way of playing, not a quiz with another background.

- Hành trình dòng thời gian (`timeline`, Lịch sử): events are put on the markers of a timeline. Events of the same
  year share one marker (either order is right); events of one year in a known order (`seq`) get a marker each.
- Xây câu (`sentence`, Tiếng Anh): word tiles are put on the sentence line; a tile that does not belong (a distractor)
  is left out. Several orders can be right (`accepted`) and the same word twice is two tiles that can be swapped.
- Xưởng hình học (`geometry`, Toán): an angle is opened by turning its arm on a protractor, or a rectangle is drawn on
  a centimetre grid by dragging its corner; the backend measures what was built.
- Cân bằng phương trình (`balance`, Hoá học / KHTN): the coefficients of an equation are set; the backend counts the
  atoms of each element on both sides.
- More in lesson_games_math.py (Cầu trục số, Giải toán từng bước) and lesson_games_reading.py (Thám tử đọc hiểu, Soi
  câu); their registries are merged at the end of this module, so the catalog and the engine see one list.

Each has the same parts as the other lesson games (lesson_catalog.py, curriculum_games.py): `validate_task` (an
invalid lesson stops the server), a snapshot builder (`snapshot`: what the app gets, never the answer), `check` (right
or wrong, and why) and `kept` (what may stay in place after a wrong answer); a gameplay solved in steps also has `advance` (a right step
before the last: what the prompt becomes and what to say). Everything here is pure (no database).
"""
from __future__ import annotations

import random
import re
from fractions import Fraction
from functools import reduce
from math import gcd

from . import lesson_games_math as _math, lesson_games_reading as _reading
from .learning_engine import InvalidAnswer, normalize_text
from .lesson_game_kit import ids as _ids, number, show, text_field as _text, tokens as _tokens

GAMES = ("timeline", "sentence", "geometry", "balance")
KIND = {"timeline": "timeline_place", "sentence": "sentence_build", "geometry": "geometry_build", "balance": "equation_balance"}
KINDS = frozenset(KIND.values())
NAMES = {"timeline": "Hành trình dòng thời gian", "sentence": "Xây câu", "geometry": "Xưởng hình học", "balance": "Cân bằng phương trình"}
OPEN_LABEL = {"timeline_place": "Dòng thời gian", "sentence_build": "Xây câu", "geometry_build": "Hình học", "equation_balance": "Phương trình"}
MIN_TASKS = {"timeline": 3, "sentence": 4, "geometry": 4, "balance": 4}
MAX_TURNS = {"timeline": 6, "sentence": 8, "geometry": 8, "balance": 8}


# ---------------------------------------------------------------------------------------------------------------
# Hành trình dòng thời gian
# ---------------------------------------------------------------------------------------------------------------

YEARS_MODES = ("shown", "hidden")


def year_label(year: int) -> str:
    return f"{-year} TCN" if year < 0 else str(year)


def _marker_key(event: dict) -> tuple[int, int]:
    return (event["year"], event.get("seq", 0))


def _markers(events: list[dict]) -> list[dict]:
    """The markers of a timeline in time order: one per (year, seq), with the events it holds and its label."""
    out: dict[tuple[int, int], dict] = {}
    for e in events:
        m = out.setdefault(_marker_key(e), {"key": _marker_key(e), "label": e.get("label") or year_label(e["year"]), "events": []})
        m["events"].append(e["text"])
    return [out[k] for k in sorted(out)]


def _validate_timeline(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    _text(task.get("prompt"), where, problems, lim["question"], "prompt")
    if task.get("years", "shown") not in YEARS_MODES:
        problems.append(f"{where}: years must be shown or hidden")
    events = task.get("events") or []
    if not 3 <= len(events) <= lim["items"]:
        problems.append(f"{where}: 3–{lim['items']} events for this grade")
        return None
    texts = [e.get("text") for e in events]
    if len(set(texts)) != len(texts):
        problems.append(f"{where}: two events with the same text")
    for e in events:
        _text(e.get("text"), where, problems, lim["text"], "event")
        if not isinstance(e.get("year"), int) or isinstance(e.get("year"), bool) or e["year"] == 0 or not -3000 <= e["year"] <= 2100:
            problems.append(f"{where}: every event has a year (an integer, negative for TCN, never 0)")
            return None
        if "seq" in e and (not isinstance(e["seq"], int) or e["seq"] < 0):
            problems.append(f"{where}: seq orders events of one year (an integer ≥ 0)")
            return None
        if e.get("label") is not None:
            _text(e.get("label"), where, problems, 24, "label")
    labels: dict[tuple[int, int], set] = {}
    for e in events:
        labels.setdefault(_marker_key(e), set()).add(e.get("label") or year_label(e["year"]))
    if any(len(v) > 1 for v in labels.values()):
        problems.append(f"{where}: events sharing a marker (same year and seq) need the same label")
    if len(labels) < 2:
        problems.append(f"{where}: at least two different times (otherwise there is nothing to order)")
    return ("timeline", tuple(sorted(texts)))


def timeline_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The markers in time order (m1 first) with their labels and how many events each holds; the events shuffled with
    ids that say nothing. Which event goes on which marker is only in the answer. In `hidden` mode the app hides the
    labels until the timeline is complete (they are dates, not the answer)."""
    markers = _markers(task["events"])
    mids = _ids("m", len(markers))
    events = [dict(e) for e in task["events"]]
    rng.shuffle(events)
    eids = {e["text"]: i for e, i in zip(events, _ids("e", len(events)))}
    marker_of = {eids[text]: mid for m, mid in zip(markers, mids) for text in m["events"]}
    return {"kind": "timeline_place", "question_id": None, "prompt": {
                "title": title, "prompt": task["prompt"], "years": task.get("years", "shown"),
                "markers": [{"id": mid, "label": m["label"], "slots": len(m["events"])} for m, mid in zip(markers, mids)],
                "events": [{"id": eids[e["text"]], "text": e["text"]} for e in events]},
            "answer": {"marker_of": marker_of,
                       "display": " → ".join(f"{m['label']}: {', '.join(m['events'])}" for m in markers)},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def _placements(prompt: dict, answer) -> dict[str, str]:
    """event → marker, every event once, no marker over its capacity. Raises InvalidAnswer for anything else."""
    tokens = _tokens(answer, expected_pairs=True)
    markers = {m["id"]: m["slots"] for m in prompt["markers"]}
    events = {e["id"] for e in prompt["events"]}
    placed: dict[str, str] = {}
    for token in tokens:
        marker, event = token.split(":")
        if marker not in markers or event not in events or event in placed:
            raise InvalidAnswer("unknown or repeated event")
        placed[event] = marker
    if set(placed) != events:
        raise InvalidAnswer("every event goes on the timeline")
    for marker, slots in markers.items():
        if sum(1 for m in placed.values() if m == marker) != slots:
            raise InvalidAnswer("a marker holds exactly its number of events")
    return placed


def _check_timeline(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    placed = _placements(prompt, answer)
    labels = {m["id"]: m["label"] for m in prompt["markers"]}
    texts = {e["id"]: e["text"] for e in prompt["events"]}
    right = [e for e, m in placed.items() if expected["marker_of"][e] == m]
    given = "; ".join(f"{labels[m]}: {texts[e]}" for e, m in sorted(placed.items(), key=lambda x: x[1]))
    if len(right) == len(placed):
        return True, None, given, None
    if not right:
        return False, "wrong_time", given, "Chưa sự kiện nào đúng mốc."
    return False, "wrong_time", given, f"Có {len(right)}/{len(placed)} sự kiện đúng mốc."


# ---------------------------------------------------------------------------------------------------------------
# Xây câu
# ---------------------------------------------------------------------------------------------------------------

def _norm_seq(texts: list[str]) -> tuple[str, ...]:
    return tuple(normalize_text(t) for t in texts)


def _validate_sentence(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    if task.get("prompt") is not None:
        _text(task.get("prompt"), where, problems, lim["question"], "prompt")
    if task.get("vi") is not None:
        _text(task.get("vi"), where, problems, lim["question"], "vi (the meaning)")
    tiles = task.get("tiles") or []
    distractors = task.get("distractors") or []
    if not 3 <= len(tiles) <= lim["items"] + 1:
        problems.append(f"{where}: 3–{lim['items'] + 1} tiles for this grade")
        return None
    if len(distractors) > 2 or len(tiles) + len(distractors) > lim["items"] + 2:
        problems.append(f"{where}: at most 2 distractors and {lim['items'] + 2} tiles in all for this grade")
    for t in tiles + distractors:
        _text(t, where, problems, lim["text"], "tile")
    if any(not isinstance(t, str) for t in tiles + distractors):
        return None
    if {normalize_text(d) for d in distractors} & {normalize_text(t) for t in tiles}:
        problems.append(f"{where}: a distractor is the same as a tile of the sentence")
    if len({normalize_text(d) for d in distractors}) != len(distractors):
        problems.append(f"{where}: the same distractor twice")
    seen = {_norm_seq(tiles)}
    for alt in task.get("accepted") or []:
        if not isinstance(alt, list) or sorted(map(normalize_text, alt)) != sorted(map(normalize_text, tiles)):
            problems.append(f"{where}: an accepted order uses exactly the sentence's tiles")
            continue
        if _norm_seq(alt) in seen:
            problems.append(f"{where}: an accepted order is listed twice")
        seen.add(_norm_seq(alt))
    return ("sentence", _norm_seq(tiles))


def sentence_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The tiles (with the distractors) shuffled, ids that say nothing; how many go in the sentence (`length`). The right
    orders are only in the answer, compared by text: the same word twice is two tiles that can be swapped."""
    tiles = list(task["tiles"]) + list(task.get("distractors") or [])
    rng.shuffle(tiles)
    accepted = [list(task["tiles"])] + [list(a) for a in task.get("accepted") or []]
    return {"kind": "sentence_build", "question_id": None, "prompt": {
                "title": title, "prompt": task.get("prompt") or "Kéo các thẻ vào dòng để tạo câu đúng.", "vi": task.get("vi"),
                "tiles": [{"id": i, "text": t} for i, t in zip(_ids("t", len(tiles)), tiles)], "length": len(task["tiles"]),
                "lang": "en"},
            "answer": {"accepted": accepted, "distractors": list(task.get("distractors") or []), "display": " ".join(task["tiles"])},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def _sentence_ids(prompt: dict, answer) -> list[str]:
    ids = _tokens(answer)
    tiles = {t["id"] for t in prompt["tiles"]}
    if any(i not in tiles for i in ids) or len(set(ids)) != len(ids) or len(ids) != prompt["length"]:
        raise InvalidAnswer(f"expected {prompt['length']} different tiles")
    return ids


def _sentence_prefix(texts: list[str], accepted: list[list[str]]) -> int:
    """How many tiles from the start are right (the longest start shared with a right order)."""
    built = _norm_seq(texts)
    best = 0
    for alt in accepted:
        target = _norm_seq(alt)
        n = 0
        while n < len(built) and n < len(target) and built[n] == target[n]:
            n += 1
        best = max(best, n)
    return best


def _check_sentence(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    ids = _sentence_ids(prompt, answer)
    text = {t["id"]: t["text"] for t in prompt["tiles"]}
    texts = [text[i] for i in ids]
    given = " ".join(texts)
    if _norm_seq(texts) in {_norm_seq(a) for a in expected["accepted"]}:
        return True, None, given, None
    extra = [t for t in texts if normalize_text(t) in {normalize_text(d) for d in expected["distractors"]}]
    if extra:
        return False, "extra_word", given, f"Thẻ “{extra[0]}” không thuộc câu này."
    at = _sentence_prefix(texts, expected["accepted"]) + 1
    lead = "Thẻ đầu tiên" if at == 1 else f"Từ vị trí {at}"
    return False, "wrong_order", given, f"{lead} (“{texts[at - 1]}”) chưa đúng chỗ."


def _kept_sentence(prompt: dict, expected: dict, answer) -> list[str]:
    ids = _sentence_ids(prompt, answer)
    text = {t["id"]: t["text"] for t in prompt["tiles"]}
    return ids[:_sentence_prefix([text[i] for i in ids], expected["accepted"])]


# ---------------------------------------------------------------------------------------------------------------
# Xưởng hình học
# ---------------------------------------------------------------------------------------------------------------

ANGLE_CLASSES = {"acute": "góc nhọn", "right": "góc vuông", "obtuse": "góc tù", "straight": "góc bẹt"}
ANGLE_RULE = {"acute": "Góc nhọn bé hơn 90°.", "right": "Góc vuông bằng 90°.", "obtuse": "Góc tù lớn hơn 90° và bé hơn 180°.",
              "straight": "Góc bẹt bằng 180°."}
GRID_MAX = 12


def angle_class(degrees: int) -> str:
    return "acute" if degrees < 90 else "right" if degrees == 90 else "obtuse" if degrees < 180 else "straight"


def rect_fits(w: int, h: int, target: dict) -> bool:
    if "area" in target and w * h != target["area"]:
        return False
    if "perimeter" in target and 2 * (w + h) != target["perimeter"]:
        return False
    if target.get("square") and w != h:
        return False
    if "sides" in target and sorted((w, h)) != sorted(target["sides"]):
        return False
    return True


def rect_solutions(cols: int, rows: int, target: dict) -> list[tuple[int, int]]:
    return [(w, h) for w in range(1, cols + 1) for h in range(1, rows + 1) if rect_fits(w, h, target)]


def _validate_geometry(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    _text(task.get("prompt"), where, problems, lim["question"], "prompt")
    kind = task.get("kind")
    target = task.get("target") or {}
    if kind == "angle":
        step = task.get("step", 5)
        if step not in (1, 5, 10, 15):
            problems.append(f"{where}: step is 1, 5, 10 or 15 degrees")
            return None
        if set(target) - {"degrees", "class"} or not target:
            problems.append(f"{where}: an angle target is {{degrees}} or {{class}}")
            return None
        if "degrees" in target and (not isinstance(target["degrees"], int) or not 0 < target["degrees"] <= 180 or target["degrees"] % step):
            problems.append(f"{where}: target degrees must be 1–180 and a multiple of the step ({step}°)")
        if "class" in target and target["class"] not in ANGLE_CLASSES:
            problems.append(f"{where}: class must be one of {', '.join(ANGLE_CLASSES)}")
        if "degrees" in target and "class" in target and angle_class(target["degrees"]) != target["class"]:
            problems.append(f"{where}: the degrees and the class disagree")
        return ("geometry", "angle", task.get("prompt"))
    if kind == "rect":
        grid = task.get("grid") or [10, 8]
        if not (isinstance(grid, list) and len(grid) == 2 and all(isinstance(g, int) and 2 <= g <= GRID_MAX for g in grid)):
            problems.append(f"{where}: grid is [columns, rows], 2–{GRID_MAX} each")
            return None
        if not target or set(target) - {"area", "perimeter", "square", "sides"}:
            problems.append(f"{where}: a rectangle target uses area, perimeter, square and/or sides")
            return None
        if "sides" in target and not (isinstance(target["sides"], list) and len(target["sides"]) == 2
                                      and all(isinstance(s, int) and s > 0 for s in target["sides"])):
            problems.append(f"{where}: sides is [a, b]")
            return None
        if not rect_solutions(grid[0], grid[1], target):
            problems.append(f"{where}: no rectangle on this grid meets the target")
        return ("geometry", "rect", task.get("prompt"))
    problems.append(f"{where}: kind must be angle or rect")
    return None


def geometry_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """What to build and the tool to build it with. The target's numbers are in the task's own words (the prompt): the
    app never gets the answer, it sends what was built and the backend measures it."""
    kind = task["kind"]
    target = task["target"]
    if kind == "angle":
        # The arm starts away from the target, so the angle is always made, never found ready.
        prompt = {"shape": "angle", "angle_step": task.get("step", 5), "readout": task.get("readout", True),
                  "initial": 30 if target.get("class") != "acute" and target.get("degrees", 90) > 60 else 120}
        display = f"{target['degrees']}°" if "degrees" in target else ANGLE_CLASSES[target["class"]].capitalize()
    else:
        cols, rows = task.get("grid") or [10, 8]
        prompt = {"shape": "rect", "cols": cols, "rows": rows, "measure_unit": task.get("unit", "cm"), "initial": [1, 1]}
        w, h = rect_solutions(cols, rows, target)[0]
        display = f"Hình {w} × {h} {task.get('unit', 'cm')}" + (" (hoặc hình khác cùng yêu cầu)" if len(rect_solutions(cols, rows, target)) > 1 else "")
    return {"kind": "geometry_build", "question_id": None,
            "prompt": {"title": title, "prompt": task["prompt"], "context": task.get("context"), **prompt},
            "answer": {"shape": kind, "target": target, "display": display},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


_SHAPE = re.compile(r"^(angle):(\d{1,3})$|^(rect):(\d{1,2})x(\d{1,2})$")


def _check_geometry(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    tokens = _tokens(answer)
    match = _SHAPE.match(tokens[0]) if len(tokens) == 1 else None
    if not match or (match.group(1) or match.group(3)) != prompt["shape"]:
        raise InvalidAnswer("expected angle:<degrees> or rect:<w>x<h>")
    target = expected["target"]
    if prompt["shape"] == "angle":
        degrees = int(match.group(2))
        if degrees > 180 or degrees % prompt["angle_step"]:
            raise InvalidAnswer("an angle of 0–180° on the protractor's steps")
        given = f"{degrees}°"
        if degrees == 0:
            return False, "invalid_shape", given, "Hai cạnh đang trùng nhau nên chưa có góc."
        if "degrees" in target:
            if degrees == target["degrees"]:
                return True, None, given, None
            if not prompt.get("readout", True):
                more = "nhỏ" if degrees < target["degrees"] else "lớn"
                return False, "wrong_measure", given, f"Góc em tạo còn {more} hơn {target['degrees']}°."
            return False, "wrong_measure", given, f"Góc em tạo là {degrees}°, cần {target['degrees']}°."
        made = angle_class(degrees)
        if made == target["class"]:
            return True, None, given, None
        return False, "wrong_class", given, (f"Góc {degrees}° là {ANGLE_CLASSES[made]}, chưa phải {ANGLE_CLASSES[target['class']]}. "
                                             f"{ANGLE_RULE[target['class']]}")
    w, h = int(match.group(4)), int(match.group(5))
    if w > prompt["cols"] or h > prompt["rows"]:
        raise InvalidAnswer("the rectangle is bigger than the grid")
    unit = prompt.get("measure_unit", "cm")
    given = f"{w} × {h} {unit}"
    if w == 0 or h == 0:
        return False, "invalid_shape", given, "Một cạnh dài 0 nên chưa thành hình chữ nhật."
    if rect_fits(w, h, target):
        return True, None, given, None
    need = []  # only what the shape built does not meet
    if target.get("square") and w != h:
        need.append("bốn cạnh bằng nhau (hình vuông)")
    if "sides" in target and sorted((w, h)) != sorted(target["sides"]):
        need.append(f"hai cạnh {target['sides'][0]} {unit} và {target['sides'][1]} {unit}")
    if "area" in target and w * h != target["area"]:
        need.append(f"diện tích {target['area']} {unit}²")
    if "perimeter" in target and 2 * (w + h) != target["perimeter"]:
        need.append(f"chu vi {target['perimeter']} {unit}")
    return False, "wrong_size", given, (f"Hình {w} × {h} có diện tích {w * h} {unit}² và chu vi {2 * (w + h)} {unit}. "
                                        f"Cần {', '.join(need)}.")


# ---------------------------------------------------------------------------------------------------------------
# Cân bằng phương trình
# ---------------------------------------------------------------------------------------------------------------

# The elements a lower-secondary or upper-secondary equation uses; a formula with another symbol is refused (a typo).
ELEMENTS = frozenset("H He Li C N O F Na Mg Al Si P S Cl K Ca Cr Mn Fe Co Ni Cu Zn Br Ag Sn I Ba Au Hg Pb".split())
MAX_COEFFICIENT = 12
_TOKEN = re.compile(r"([A-Z][a-z]?)(\d*)|(\()|(\))(\d*)")
SUB = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def parse_formula(formula: str) -> dict[str, int]:
    """Atoms of one formula unit: "Ca(OH)2" → {Ca: 1, O: 2, H: 2}. Raises ValueError for anything else."""
    if not isinstance(formula, str) or not re.fullmatch(r"[A-Za-z0-9()]{1,24}", formula):
        raise ValueError(f"not a formula: {formula!r}")
    stack: list[dict[str, int]] = [{}]
    pos = 0
    while pos < len(formula):
        m = _TOKEN.match(formula, pos)
        if not m:
            raise ValueError(f"not a formula: {formula!r}")
        element, count, opening, closing, times = m.groups()
        if element:
            if element not in ELEMENTS:
                raise ValueError(f"unknown element {element} in {formula}")
            stack[-1][element] = stack[-1].get(element, 0) + int(count or 1)
        elif opening:
            stack.append({})
        else:
            if len(stack) == 1:
                raise ValueError(f"unbalanced brackets in {formula}")
            group = stack.pop()
            for el, n in group.items():
                stack[-1][el] = stack[-1].get(el, 0) + n * int(times or 1)
        pos = m.end()
    if len(stack) != 1 or not stack[0]:
        raise ValueError(f"not a formula: {formula!r}")
    return stack[0]


def _elements(species: list[dict]) -> list[str]:
    seen: list[str] = []
    for s in species:
        for el in s["atoms"]:
            if el not in seen:
                seen.append(el)
    return seen


def _counts(species: list[dict], coefficients: list[int]) -> dict[str, tuple[int, int]]:
    """element → (atoms on the left, atoms on the right)."""
    out: dict[str, list[int]] = {el: [0, 0] for el in _elements(species)}
    for s, c in zip(species, coefficients):
        for el, n in s["atoms"].items():
            out[el][0 if s["side"] == "left" else 1] += c * n
    return {el: (a, b) for el, (a, b) in out.items()}


def balance_solutions_dimension(species: list[dict]) -> int:
    """The dimension of the coefficients that balance the equation (1: one answer up to a factor). Gaussian
    elimination over the fractions of the atom-balance matrix."""
    elements = _elements(species)
    rows = [[Fraction(s["atoms"].get(el, 0) * (1 if s["side"] == "left" else -1)) for s in species] for el in elements]
    rank, cols = 0, len(species)
    for col in range(cols):
        pivot = next((r for r in range(rank, len(rows)) if rows[r][col] != 0), None)
        if pivot is None:
            continue
        rows[rank], rows[pivot] = rows[pivot], rows[rank]
        for r in range(len(rows)):
            if r != rank and rows[r][col] != 0:
                factor = rows[r][col] / rows[rank][col]
                rows[r] = [a - factor * b for a, b in zip(rows[r], rows[rank])]
        rank += 1
    return cols - rank


def _species(task: dict) -> list[dict]:
    return ([{"formula": f, "side": "left", "atoms": parse_formula(f)} for f in task["reactants"]]
            + [{"formula": f, "side": "right", "atoms": parse_formula(f)} for f in task["products"]])


def equation_text(species: list[dict], coefficients: list[int]) -> str:
    def side(name: str) -> str:
        return " + ".join(f"{'' if c == 1 else c}{s['formula'].translate(SUB)}" for s, c in zip(species, coefficients) if s["side"] == name)
    return f"{side('left')} → {side('right')}"


def _validate_balance(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    reactants, products, coefficients = task.get("reactants"), task.get("products"), task.get("coefficients")
    if not (isinstance(reactants, list) and isinstance(products, list) and reactants and products):
        problems.append(f"{where}: reactants and products are lists of formulas")
        return None
    if len(reactants) + len(products) > 5:
        problems.append(f"{where}: at most 5 substances in one equation")
        return None
    try:
        species = _species(task)
    except ValueError as exc:
        problems.append(f"{where}: {exc}")
        return None
    if len({s["formula"] for s in species}) != len(species):
        problems.append(f"{where}: the same substance twice")
    if not (isinstance(coefficients, list) and len(coefficients) == len(species)
            and all(isinstance(c, int) and 1 <= c <= MAX_COEFFICIENT for c in coefficients)):
        problems.append(f"{where}: coefficients: one integer 1–{MAX_COEFFICIENT} per substance, in order")
        return None
    left = {el for s in species if s["side"] == "left" for el in s["atoms"]}
    right = {el for s in species if s["side"] == "right" for el in s["atoms"]}
    if left != right:
        problems.append(f"{where}: the two sides do not have the same elements")
    elif any(a != b for a, b in _counts(species, coefficients).values()):
        problems.append(f"{where}: the coefficients do not balance the equation")
    elif reduce(gcd, coefficients) != 1:
        problems.append(f"{where}: the coefficients are not the smallest ones (divide by {reduce(gcd, coefficients)})")
    elif balance_solutions_dimension(species) != 1:
        problems.append(f"{where}: the equation can be balanced in several unrelated ways (one answer only)")
    if all(c == 1 for c in coefficients) and len(species) > 2:
        problems.append(f"{where}: already balanced with every coefficient 1: nothing to do")
    if task.get("prompt") is not None:
        _text(task.get("prompt"), where, problems, lim["question"], "prompt")
    return ("balance", tuple(task["reactants"]), tuple(task["products"]))


def balance_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The substances in the equation's order with their atoms (counting them is the learner's work, the app only
    multiplies what it was given), every coefficient starting at 1. The coefficients are only in the answer."""
    species = _species(task)
    return {"kind": "equation_balance", "question_id": None, "prompt": {
                "title": title, "prompt": task.get("prompt") or "Chọn hệ số để số nguyên tử mỗi nguyên tố ở hai vế bằng nhau.",
                "species": [{"id": sid, "formula": s["formula"], "side": s["side"], "atoms": s["atoms"]}
                            for sid, s in zip(_ids("s", len(species)), species)],
                "elements": _elements(species), "max": MAX_COEFFICIENT, "condition": task.get("condition")},
            "answer": {"coefficients": list(task["coefficients"]), "display": equation_text(species, task["coefficients"])},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def _coefficients(prompt: dict, answer) -> list[int]:
    tokens = _tokens(answer)
    if len(tokens) != len(prompt["species"]) or any(not t.isdigit() or not 1 <= int(t) <= prompt["max"] for t in tokens):
        raise InvalidAnswer(f"one coefficient 1–{prompt['max']} per substance")
    return [int(t) for t in tokens]


def _check_balance(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    coefficients = _coefficients(prompt, answer)
    given = equation_text(prompt["species"], coefficients)
    off = [(el, a, b) for el, (a, b) in _counts(prompt["species"], coefficients).items() if a != b]
    if off:
        return False, "unbalanced", given, "Chưa cân bằng: " + "; ".join(f"{el} vế trái {a}, vế phải {b}" for el, a, b in off) + "."
    factor = reduce(gcd, coefficients)
    if factor > 1:
        return False, "not_reduced", given, f"Đã cân bằng nhưng chưa tối giản: chia tất cả hệ số cho {factor}."
    return True, None, given, None


# ---------------------------------------------------------------------------------------------------------------
# Shared entry points
# ---------------------------------------------------------------------------------------------------------------

VALIDATE = {"timeline": _validate_timeline, "sentence": _validate_sentence, "geometry": _validate_geometry, "balance": _validate_balance}
SNAPSHOT = {"timeline": timeline_snapshot, "sentence": sentence_snapshot, "geometry": geometry_snapshot, "balance": balance_snapshot}
_CHECK = {"timeline_place": _check_timeline, "sentence_build": _check_sentence, "geometry_build": _check_geometry,
          "equation_balance": _check_balance}


# The math and reading gameplays join the registry.
_MORE = (_math, _reading)
GAMES = GAMES + tuple(g for m in _MORE for g in m.GAMES)
KIND = {**KIND, **{g: k for m in _MORE for g, k in m.KIND.items()}}
KINDS = frozenset(KIND.values())
NAMES = {**NAMES, **{g: n for m in _MORE for g, n in m.NAMES.items()}}
OPEN_LABEL = {**OPEN_LABEL, **{k: n for m in _MORE for k, n in m.OPEN_LABEL.items()}}
MIN_TASKS = {**MIN_TASKS, **{g: n for m in _MORE for g, n in m.MIN_TASKS.items()}}
MAX_TURNS = {**MAX_TURNS, **{g: n for m in _MORE for g, n in m.MAX_TURNS.items()}}
STAGED = frozenset(k for m in _MORE for k in m.STAGED)
for _m in _MORE:
    VALIDATE.update(_m.VALIDATE)
    SNAPSHOT.update(_m.SNAPSHOT)
    _CHECK.update(_m.CHECK)
_KEPT = {k: f for m in _MORE for k, f in m.KEPT.items()}
_ADVANCE = {k: f for m in _MORE for k, f in m.ADVANCE.items()}
_LABEL = {g: m.label for m in _MORE for g in m.GAMES}


def validate_task(game: str, task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    """The task's signature (two equal ones are the same question), None when it cannot be served."""
    return VALIDATE[game](task, lim, where, problems)


def snapshot(game: str, task: dict, rng: random.Random, title: str) -> dict:
    return SNAPSHOT[game](task, rng, title)


def label(game: str, task: dict) -> str:
    if game in _LABEL:
        return _LABEL[game](game, task)
    if game == "balance":
        return equation_text(_species(task), [1] * (len(task["reactants"]) + len(task["products"])))
    return task.get("prompt") or " ".join(task.get("tiles", []))


def check(kind: str, prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    """(correct, error type, what was answered, why a wrong answer is wrong). Raises InvalidAnswer for a malformed one."""
    try:
        return _CHECK[kind](prompt, expected, answer)
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, InvalidAnswer):
            raise
        raise InvalidAnswer(str(exc)) from exc


def kept(kind: str, prompt: dict, expected: dict, answer) -> list[str] | None:
    """After a wrong answer: the events on their right marker ("m2:e1"), or the sentence's right start (tile ids in
    order). The shapes and the coefficients stay as they are in the app (nothing to lock)."""
    if kind == "timeline_place":
        return [f"{m}:{e}" for e, m in _placements(prompt, answer).items() if expected["marker_of"][e] == m]
    if kind == "sentence_build":
        return _kept_sentence(prompt, expected, answer)
    if kind in _KEPT:
        return _KEPT[kind](prompt, expected, answer)
    return None


def advance(kind: str, prompt: dict, expected: dict, answer) -> tuple[dict, str] | None:
    """A gameplay solved in steps: when `answer` is a right step before the last, (what the prompt becomes, what to say);
    None otherwise (the answer is then `check`ed as usual). Raises InvalidAnswer for a malformed answer."""
    if kind not in _ADVANCE:
        return None
    try:
        return _ADVANCE[kind](prompt, expected, answer)
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, InvalidAnswer):
            raise
        raise InvalidAnswer(str(exc)) from exc
