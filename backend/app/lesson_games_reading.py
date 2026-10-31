"""Reading and language gameplays of the lesson catalog (registered with the others in lesson_games.py).

- Thám tử đọc hiểu (`story_detective`, Tiếng Việt / Tiếng Anh): a short text is read sentence by sentence. First the
  learner taps the sentence that proves the answer (the clue); only when the backend confirms it (`advance`) do the
  answers to choose from come. Reading for evidence, not guessing among options.
- Soi câu (`sentence_xray`, Tiếng Việt / Tiếng Anh): the words of a sentence are painted with highlighters, one per
  role (sự vật / hoạt động / đặc điểm; Ai? / làm gì?; sự vật được so sánh / từ so sánh / sự vật so sánh...). Words
  with no role stay unpainted. The backend compares every word's colour.
"""
from __future__ import annotations

import random
import re

from .learning_engine import InvalidAnswer, normalize_text
from .lesson_game_kit import ids, text_field, tokens

GAMES = ("story_detective", "sentence_xray")
KIND = {"story_detective": "story_evidence", "sentence_xray": "sentence_paint"}
NAMES = {"story_detective": "Thám tử đọc hiểu", "sentence_xray": "Soi câu"}
OPEN_LABEL = {"story_evidence": "Đọc hiểu", "sentence_paint": "Soi câu"}
MIN_TASKS = {"story_detective": 4, "sentence_xray": 4}
MAX_TURNS = {"story_detective": 6, "sentence_xray": 8}
STAGED = frozenset({"story_evidence"})
LANGS = ("vi", "en")

# ---------------------------------------------------------------------------------------------------------------
# Thám tử đọc hiểu
# ---------------------------------------------------------------------------------------------------------------

_SENTENCE_END = re.compile(r"(?<=[.!?…])[”\"’)]?\s+(?=[\"“‘(A-ZÀ-Ỹ0-9-–—])")


def sentences(passage) -> list[str]:
    """A passage as its sentences: a list as written, or a text split after . ! ? … before a capital."""
    if isinstance(passage, list):
        return [s.strip() for s in passage]
    out, start = [], 0
    for m in _SENTENCE_END.finditer(passage):
        out.append(passage[start:m.end()].strip())
        start = m.end()
    out.append(passage[start:].strip())
    return [s for s in out if s]


def _validate_story(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    passage = task.get("passage")
    if not isinstance(passage, (str, list)) or not passage:
        problems.append(f"{where}: passage (a text or a list of sentences) is required")
        return None
    parts = sentences(passage)
    if any(not isinstance(s, str) or not s for s in parts):
        problems.append(f"{where}: an empty sentence in the passage")
        return None
    if sum(len(s) for s in parts) > lim["passage"]:
        problems.append(f"{where}: the passage is longer than {lim['passage']} characters for this grade")
    if not 3 <= len(parts) <= 14:
        problems.append(f"{where}: 3–14 sentences in the passage (got {len(parts)})")
    text_field(task.get("question"), where, problems, lim["question"], "question")
    if task.get("lang", "vi") not in LANGS:
        problems.append(f"{where}: lang must be vi or en")
    evidence = task.get("evidence") or []
    if not evidence or any(not isinstance(e, int) or isinstance(e, bool) or not 1 <= e <= len(parts) for e in evidence):
        problems.append(f"{where}: evidence lists the sentence numbers (from 1) that prove the answer")
        return None
    if len(evidence) * 2 > len(parts):
        problems.append(f"{where}: at most half the sentences are evidence (otherwise any tap is right)")
    if task.get("clue") is not None:
        text_field(task.get("clue"), where, problems, lim["question"], "clue")
    options = task.get("options") or []
    if not 2 <= len(options) <= lim["options"]:
        problems.append(f"{where}: 2–{lim['options']} options for this grade")
        return None
    if sum(1 for o in options if o.get("ok") is True) != 1:
        problems.append(f"{where}: exactly one right option")
    if len({normalize_text(o.get('text') or '') for o in options}) != len(options):
        problems.append(f"{where}: two options with the same text")
    for o in options:
        text_field(o.get("text"), where, problems, lim["text"], "option")
        text_field(o.get("why"), where, problems, lim["question"], "option why")
    return ("story_detective", normalize_text(" ".join(parts))[:80], normalize_text(task.get("question") or ""))


def story_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The passage as tappable sentences (s1…, in order: it is a text) and the question. The options are not sent yet:
    they come with the second step, once the clue is found."""
    parts = sentences(task["passage"])
    options = [dict(o) for o in task["options"]]
    rng.shuffle(options)
    oids = ids("o", len(options))
    return {"kind": "story_evidence", "question_id": None, "prompt": {
                "title": title, "prompt": "Chạm vào câu trong bài chứng minh câu trả lời.", "question": task["question"],
                "lang": task.get("lang", "vi"), "sentences": [{"id": i, "text": s} for i, s in zip(ids("s", len(parts)), parts)],
                "phase": "find"},
            "answer": {"evidence": [f"s{e}" for e in task["evidence"]],
                       "options": [{"id": i, "text": o["text"]} for i, o in zip(oids, options)],
                       "right": next(i for i, o in zip(oids, options) if o.get("ok") is True),
                       "why": {i: o["why"] for i, o in zip(oids, options)},
                       "clue": task.get("clue"),
                       "display": next(o["text"] for o in options if o.get("ok") is True)},
            "hints": [h for h in [task.get("clue") or task.get("hint")] if h], "explanation": task["explanation"]}


def _one(prompt_ids: set[str], answer) -> str:
    parts = tokens(answer)
    if len(parts) != 1 or parts[0] not in prompt_ids:
        raise InvalidAnswer("expected one piece")
    return parts[0]


def _check_story(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    if prompt.get("phase") == "find":
        picked = _one({s["id"] for s in prompt["sentences"]}, answer)
        text = next(s["text"] for s in prompt["sentences"] if s["id"] == picked)
        if picked in expected["evidence"]:
            return False, None, text, None  # right, but only a step: `advance` opens the options
        clue = expected.get("clue")
        return False, "wrong_evidence", text, ("Câu này chưa chứng minh được câu trả lời. "
                                               + (f"Gợi ý: {clue}" if clue else "Tìm câu có từ khoá của câu hỏi nhé."))
    picked = _one({o["id"] for o in prompt["options"]}, answer)
    text = next(o["text"] for o in prompt["options"] if o["id"] == picked)
    if picked == expected["right"]:
        return True, None, text, None
    return False, "wrong_answer", text, expected["why"][picked] + " Đọc lại câu bằng chứng em đã tìm nhé."


def _advance_story(prompt: dict, expected: dict, answer) -> tuple[dict, str] | None:
    if prompt.get("phase") != "find":
        return None
    picked = _one({s["id"] for s in prompt["sentences"]}, answer)
    if picked not in expected["evidence"]:
        return None
    return ({"phase": "answer", "found": picked, "options": expected["options"], "prompt": "Dựa vào câu bằng chứng, chọn câu trả lời."},
            "Đúng, câu này là manh mối! Giờ dựa vào nó để trả lời.")


# ---------------------------------------------------------------------------------------------------------------
# Soi câu
# ---------------------------------------------------------------------------------------------------------------

_PIECE = re.compile(r"\[([^\]|]+)\|(\d)\]|(\S+)")
_PUNCT = re.compile(r"^[\W_]+$")


def pieces(sentence: str) -> list[tuple[str, int | None]]:
    """“[Mẹ|1] đang [nấu|2] [cơm|1].” → (Mẹ, 1), (đang, 0), (nấu, 2), (cơm, 1), (., None). A bracket keeps a phrase as
    one piece; a piece of punctuation only cannot be painted (None)."""
    out: list[tuple[str, int | None]] = []
    for m in _PIECE.finditer(sentence):
        if m.group(1) is not None:
            out.append((m.group(1).strip(), int(m.group(2))))
        else:
            word = m.group(3)
            out.append((word, None if _PUNCT.match(word) else 0))
    return out


def _validate_xray(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    text_field(task.get("prompt"), where, problems, lim["question"], "prompt")
    roles = task.get("roles") or []
    if not 1 <= len(roles) <= 3:
        problems.append(f"{where}: 1–3 roles (highlighters)")
        return None
    for r in roles:
        text_field(r, where, problems, 24, "role")
    if task.get("lang", "vi") not in LANGS:
        problems.append(f"{where}: lang must be vi or en")
    sentence = task.get("sentence")
    if not isinstance(sentence, str) or not sentence.strip():
        problems.append(f"{where}: sentence is required")
        return None
    parts = pieces(sentence)
    paintable = [p for p in parts if p[1] is not None]
    if not 3 <= len(paintable) <= 18:
        problems.append(f"{where}: 3–18 pieces to paint")
    used = {r for _, r in paintable if r}
    if any(r > len(roles) for r in used):
        problems.append(f"{where}: a piece has a role number with no highlighter")
    if used != set(range(1, len(roles) + 1)):
        problems.append(f"{where}: every role is used at least once")
    if not any(r == 0 for _, r in paintable) and len(roles) == 1:
        problems.append(f"{where}: with one highlighter some pieces must stay unpainted")
    return ("sentence_xray", tuple(roles), normalize_text(re.sub(r"[\[\]|\d]", "", sentence)))


def xray_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The sentence as pieces (w1…, in order; punctuation pieces cannot be painted) and the highlighters. The roles of
    the pieces are only in the answer."""
    parts = pieces(task["sentence"])
    wids = ids("w", len(parts))
    return {"kind": "sentence_paint", "question_id": None, "prompt": {
                "title": title, "prompt": task["prompt"], "lang": task.get("lang", "vi"),
                "roles": [{"id": f"c{i + 1}", "name": r} for i, r in enumerate(task["roles"])],
                "words": [{"id": w, "text": t, **({"fixed": True} if r is None else {})} for w, (t, r) in zip(wids, parts)]},
            "answer": {"role_of": {w: r for w, (_, r) in zip(wids, parts) if r is not None},
                       "display": " · ".join(f"{name}: " + ", ".join(t for t, r in parts if r == i + 1)
                                             for i, name in enumerate(task["roles"]))},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def _paint(prompt: dict, answer) -> dict[str, int]:
    """piece → role (1…), only the painted ones. An empty answer (nothing painted) is a list with the token "none"."""
    words = {w["id"] for w in prompt["words"] if not w.get("fixed")}
    count = len(prompt["roles"])
    painted: dict[str, int] = {}
    parts = tokens(answer)
    if parts == ["none"]:
        return painted
    for token in parts:
        if token.count(":") != 1:
            raise InvalidAnswer("expected piece:highlighter pairs")
        word, colour = token.split(":")
        if word not in words or word in painted or not re.fullmatch(r"c\d", colour) or not 1 <= int(colour[1:]) <= count:
            raise InvalidAnswer("a piece painted once with one of the highlighters")
        painted[word] = int(colour[1:])
    return painted


def _check_xray(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    painted = _paint(prompt, answer)
    text = {w["id"]: w["text"] for w in prompt["words"]}
    roles = [r["name"] for r in prompt["roles"]]
    given = "; ".join(f"{text[w]}={roles[c - 1]}" for w, c in painted.items()) or "(chưa tô)"
    wrong = [w for w, r in expected["role_of"].items() if painted.get(w, 0) != r]
    if not wrong:
        return True, None, given, None
    first = wrong[0]
    if painted.get(first):
        why = f"“{text[first]}” chưa phải {roles[painted[first] - 1].lower()}."
    else:
        why = f"“{text[first]}” cũng cần được tô màu."
    if expected["role_of"][first] == 0 and painted.get(first):
        why = f"“{text[first]}” không thuộc màu nào, để trống nhé."
    more = f" Còn {len(wrong)} chỗ chưa đúng." if len(wrong) > 1 else ""
    return False, "wrong_role", given, why + more + " Những từ tô đúng được giữ lại."


def _kept_xray(prompt: dict, expected: dict, answer) -> list[str]:
    painted = _paint(prompt, answer)
    return [f"{w}:c{c}" for w, c in painted.items() if expected["role_of"].get(w) == c]


VALIDATE = {"story_detective": _validate_story, "sentence_xray": _validate_xray}
SNAPSHOT = {"story_detective": story_snapshot, "sentence_xray": xray_snapshot}
CHECK = {"story_evidence": _check_story, "sentence_paint": _check_xray}
KEPT = {"sentence_paint": _kept_xray}
ADVANCE = {"story_evidence": _advance_story}


def label(game: str, task: dict) -> str:
    if game == "sentence_xray":
        return re.sub(r"\[([^\]|]+)\|\d\]", r"\1", task.get("sentence") or "")
    return task.get("question") or ""
