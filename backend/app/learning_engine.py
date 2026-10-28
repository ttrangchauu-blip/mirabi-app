"""Pure rules of the learning games: answer checking, deterministic Math generation, scoring and mastery.

Nothing here touches the database, so every rule is unit-tested directly (tests/test_learning_engine.py).
Math answers are always computed by this code from a generated expression tree: user input is parsed as a
number, never evaluated, and no AI is involved in deciding whether an answer is right.
"""
from __future__ import annotations

import random
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# ---------------------------------------------------------------------------------------------------------------
# Kinds, policies and scoring
# ---------------------------------------------------------------------------------------------------------------

# What a wrong answer does. "retry": the user may correct it (the object keeps moving in Challenge).
# "reveal": the answer and explanation are shown and the turn ends ("Tiếp tục").
WRONG_POLICY = {
    "vocab_typing": "retry",
    "word_spelling": "retry",
    "math_input": "retry",
    "missing_number": "retry",
    "gate_choice": "reveal",
    "bridge_order": "reveal",
    "compare": "reveal",
}
# Kinds whose wrong answers cost a heart in Challenge. For moving targets (meteor, monster) only a miss does.
# In Học tập targets never land, so every wrong answer costs a heart.
HEART_ON_WRONG = {"gate_choice", "bridge_order", "missing_number", "compare"}
# Kinds shown as moving targets: a miss (target reached the ground/base) is only possible for these.
MOVING_KINDS = {"vocab_typing", "word_spelling", "math_input"}
# Falling words answered by typing: a shot hits whichever open target it matches (see learning.answer_event).
TYPED_TARGET_KINDS = {"vocab_typing", "word_spelling"}
# Vocabulary turns: vocab_typing = Việt → Anh (recall the English word), word_spelling = Anh → Việt (type the shown word).
VOCAB_KINDS = ("vocab_typing", "word_spelling")

GAME_KINDS = {
    "meteor": {"vocab_typing"},
    "word_shooter": {"word_spelling"},
    "grammar": {"gate_choice", "bridge_order"},
    "defense": {"math_input"},
    "math_bridge": {"missing_number", "compare"},
}


def game_of(game_type: str, variant: str | None) -> str:
    """The game the user picked: grammar lessons offer "Chọn cổng đúng" (gate) and "Xây cầu bằng từ" (bridge);
    "grammar" means both mixed. Vocabulary lessons offer "Bắn thiên thạch" (meteor, Việt → Anh, the default) and
    "Bắn từ vựng" (word_shooter, Anh → Việt). Every other lesson has one game."""
    if game_type == "grammar":
        return variant if variant in ("gate", "bridge") else "grammar"
    if game_type == "meteor":
        return "word_shooter" if variant == "word_shooter" else "meteor"
    return game_type


def default_variant(game_type: str, variant: str | None) -> str | None:
    """The variant stored on a session: the game picked within a lesson that offers several."""
    if game_type == "grammar":
        return variant or "mixed"
    if game_type == "meteor":
        return variant or "meteor"
    return None


def hearts_for(game_type: str, mode: str) -> int:
    """Vocabulary in Học tập: each word waits for the user and nothing costs a heart. Everything else has 3."""
    return 0 if game_type == "meteor" and mode == "practice" else DEFAULT_SCORING["hearts"]

DEFAULT_SCORING = {
    "first_try": 100,
    "hinted": 60,
    "corrected": 40,
    "practice_turn": 20,
    "combo_step": 20,
    "combo_cap": 5,
    "hearts": 3,
    "max_attempts": 12,
    "max_practice_turns": 10,
    # A miss is only accepted once the target has been on screen for this share of its travel time.
    "miss_min_share": 0.5,
}

MASTERY_DELTA = {"first_try": 20, "hinted": 8, "corrected": 5, "wrong": -15, "revealed": -15, "missed": -10}
PRACTICE_MASTERY_DELTA = 5  # a correct re-practice after "Xem đáp án" never counts as a first-try success
MASTERED_AT = 80


def correct_outcome(wrong_attempts: int, hints_used: int) -> str:
    if wrong_attempts:
        return "corrected"
    return "hinted" if hints_used else "first_try"


def score_for(outcome: str, combo_before: int, rules: dict, *, practice_turn: bool) -> tuple[int, int]:
    """(points, new combo) for a correctly answered Challenge turn."""
    if practice_turn:
        return rules["practice_turn"], combo_before
    combo = combo_before + 1 if outcome == "first_try" else 0
    bonus = min(combo, rules["combo_cap"]) * rules["combo_step"] if outcome == "first_try" else 0
    return rules[outcome] + bonus, combo


def mastery_after(current: int, outcome: str, *, practice_turn: bool) -> int:
    if practice_turn:
        delta = PRACTICE_MASTERY_DELTA if outcome in ("first_try", "hinted", "corrected") else MASTERY_DELTA.get(outcome, 0)
    else:
        delta = MASTERY_DELTA.get(outcome, 0)
    return max(0, min(100, current + delta))


# ---------------------------------------------------------------------------------------------------------------
# English
# ---------------------------------------------------------------------------------------------------------------

_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "`": "'", "´": "'"})


def normalize_text(value: str) -> str:
    """Case-insensitive, whitespace-normalized form used to compare English answers."""
    text = unicodedata.normalize("NFKC", value or "").translate(_APOSTROPHES).lower()
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip(" .!?,;:").strip()


class InvalidAnswer(ValueError):
    """Empty or malformed input. It is rejected, never counted as a wrong answer."""


def check_text(answer: str, accepted: list[str]) -> bool:
    given = normalize_text(answer)
    if not given:
        raise InvalidAnswer("empty")
    return given in {normalize_text(a) for a in accepted}


def check_choice(answer: str, options: list[dict], correct: str) -> bool:
    if answer not in {o["id"] for o in options}:
        raise InvalidAnswer("unknown option")
    return answer == correct


def normalize_sentence(value: str) -> str:
    """A sentence compared without case, spacing or punctuation ("If it rains, we stay." = "if it rains we stay")."""
    text = re.sub(r"[^\w\s'-]", " ", normalize_text(value))
    return re.sub(r"\s+", " ", text).strip()


def bridge_sentence(token_ids: list[str], tokens: list[dict]) -> str:
    """The sentence built from token ids. Every token must be used exactly once."""
    by_id = {t["id"]: t["text"] for t in tokens}
    if len(token_ids) != len(tokens) or set(token_ids) != set(by_id) or len(set(token_ids)) != len(token_ids):
        raise InvalidAnswer("incomplete bridge")
    return " ".join(by_id[t] for t in token_ids)


def check_bridge(token_ids: list[str], tokens: list[dict], accepted: list[str]) -> bool:
    """Pieces are compared by their text, so two pieces with the same word (two ids) can be placed either way; case
    and punctuation never make an answer wrong."""
    return normalize_sentence(bridge_sentence(token_ids, tokens)) in {normalize_sentence(a) for a in accepted}


def vocab_hints(word: str) -> list[str]:
    # The number of letters is always shown (letter boxes), so the hints reveal the first, then the last letter.
    return [f"Chữ cái đầu: “{word[0]}”", f"Chữ cái cuối: “{word[-1]}”"]


def spelling_hints(word: str) -> list[str]:
    # Anh → Việt: the word is on screen, so the hints help to type it letter by letter, never with its meaning.
    parts = word.split()
    counts = " + ".join(str(len(p)) for p in parts)
    return [f"Từ có {counts} chữ cái" + (f" ({len(parts)} từ)" if len(parts) > 1 else ""),
            "Gõ từng chữ: " + " · ".join(" ".join(p) for p in parts)]


# ---------------------------------------------------------------------------------------------------------------
# Numbers: parsing user input (no eval)
# ---------------------------------------------------------------------------------------------------------------

_NUMBER = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")


def parse_number(raw: str) -> Decimal:
    """'12', '-3', '−3', '2,5', '2.5' -> Decimal. Raises InvalidAnswer for anything else (including empty)."""
    text = unicodedata.normalize("NFKC", raw or "").replace("−", "-").replace("–", "-").replace(" ", "").strip()
    if not _NUMBER.fullmatch(text):
        raise InvalidAnswer("not a number")
    try:
        return Decimal(text.replace(",", "."))
    except InvalidOperation as exc:  # pragma: no cover - the regex already guarantees a valid literal
        raise InvalidAnswer("not a number") from exc


def check_number(raw: str, expected: str, tolerance: str | None = None) -> bool:
    """Exact comparison; a tolerance only applies when the question asks for rounding."""
    value = parse_number(raw)
    target = Decimal(expected)
    if tolerance is not None:
        return abs(value - target) <= Decimal(tolerance)
    return value == target


# ---------------------------------------------------------------------------------------------------------------
# Math expressions
# ---------------------------------------------------------------------------------------------------------------

SYMBOL = {"add": "+", "sub": "−", "mul": "×", "div": ":"}
PRECEDENCE = {"add": 1, "sub": 1, "mul": 2, "div": 2}
OP_LABEL = {"add": "phép cộng", "sub": "phép trừ", "mul": "phép nhân", "div": "phép chia"}


@dataclass(frozen=True)
class Num:
    value: int


@dataclass(frozen=True)
class Op:
    op: str
    left: "Num | Op"
    right: "Num | Op"
    paren: bool = False


class NotExact(ValueError):
    pass


def apply(op: str, a: int, b: int) -> int:
    if op == "add":
        return a + b
    if op == "sub":
        return a - b
    if op == "mul":
        return a * b
    if b == 0 or a % b:
        raise NotExact(f"{a} : {b}")
    return a // b


def evaluate(node: "Num | Op") -> int:
    if isinstance(node, Num):
        return node.value
    return apply(node.op, evaluate(node.left), evaluate(node.right))


def fmt(n: int) -> str:
    return f"−{-n}" if n < 0 else str(n)


def render(node: "Num | Op", leftmost: bool = True) -> str:
    if isinstance(node, Num):
        return fmt(node.value) if node.value >= 0 or leftmost else f"({fmt(node.value)})"
    inner = f"{render(node.left, leftmost and not node.paren)} {SYMBOL[node.op]} {render(node.right, False)}"
    return f"({inner})" if node.paren else inner


def steps(node: "Num | Op") -> list[str]:
    """School order: brackets first, then × and : left to right, then + and − left to right.

    The trees are built with that precedence, so a post-order walk visits operations in exactly that order.
    """
    out: list[str] = []

    def walk(n):
        if isinstance(n, Num):
            return n.value
        a, b = walk(n.left), walk(n.right)
        value = apply(n.op, a, b)
        out.append(f"{fmt(a)} {SYMBOL[n.op]} {b if b >= 0 else f'({fmt(b)})'} = {fmt(value)}")
        return value

    walk(node)
    return out


def left_to_right(node: "Num | Op") -> int | None:
    """The value a learner gets by ignoring × / : precedence (brackets still respected). None if not exact."""
    def flatten(n, acc):
        if isinstance(n, Op) and not n.paren:
            flatten(n.left, acc)
            acc.append(n.op)
            flatten(n.right, acc)
        else:
            acc.append(n)
        return acc

    def unit(n):
        if isinstance(n, Num):
            return n.value
        return left_to_right(Op(n.op, n.left, n.right))

    try:
        seq = flatten(node, [])
        value = unit(seq[0])
        for i in range(1, len(seq), 2):
            right = unit(seq[i + 1])
            if value is None or right is None:
                return None
            value = apply(seq[i], value, right)
        return value
    except NotExact:
        return None


# ---------------------------------------------------------------------------------------------------------------
# Math generation. Every item is a plain dict (stored as a frozen snapshot on the session):
# {kind, question_key, skill_key, skill_label, prompt, answer, hints, explanation}
# ---------------------------------------------------------------------------------------------------------------

def _rand(rng: random.Random, lo: int, hi: int, negative: bool) -> int:
    value = rng.randint(lo, hi)
    return -value if negative and rng.random() < 0.4 else value


def _arith(rng: random.Random, op: str, g: dict) -> tuple[Op, int]:
    neg = g.get("allow_negative", False)
    top = g["add_max"]
    lo_mul, hi_mul = g.get("mul_min", 2), g.get("mul_max", 9)
    if op == "add":
        a = _rand(rng, 1, top - 1, neg)
        b = _rand(rng, 1, top - abs(a) if not neg else top, neg)
        return Op("add", Num(a), Num(b)), a + b
    if op == "sub":
        a = _rand(rng, 2, top, neg)
        b = _rand(rng, 1, a - 1 if not neg and a > 1 else top, neg) if not neg else _rand(rng, 1, top, True)
        return Op("sub", Num(a), Num(b)), a - b
    if op == "mul":
        big = g.get("big_mul", False)
        a = rng.randint(11, 99) if big and rng.random() < 0.5 else rng.randint(lo_mul, hi_mul)
        b = rng.randint(lo_mul, hi_mul)
        if neg and rng.random() < 0.4:
            a = -a
        return Op("mul", Num(a), Num(b)), a * b
    # div: build from an exact product so the quotient is an integer and the divisor is never 0
    b = rng.randint(lo_mul, hi_mul)
    q = rng.randint(lo_mul, hi_mul) if not g.get("big_mul") else rng.randint(2, 30)
    if neg and rng.random() < 0.4:
        q = -q
    return Op("div", Num(q * b), Num(b)), q


def _arith_hints(op: str, a: int, b: int) -> list[str]:
    if op == "add":
        tens, units = (b // 10) * 10, b % 10
        first = "Cộng hàng đơn vị trước, nhớ sang hàng chục nếu tổng từ 10 trở lên."
        split = f"Tách {b} = {tens} + {units}: tính {a} + {tens} trước, rồi cộng thêm {units}." if b >= 10 and units and a >= 0 else \
            "Đếm thêm từ số lớn hơn."
        return [first, split]
    if op == "sub":
        first = "Trừ hàng đơn vị trước; nếu không đủ thì mượn 1 chục."
        if b >= 0 and a >= 0:
            tens, units = (b // 10) * 10, b % 10
            split = f"Tách {b} = {tens} + {units}: tính {a} − {tens} trước, rồi trừ tiếp {units}." if b >= 10 and units else \
                f"Đếm lùi {b} bước từ {a}."
        else:
            split = "Trừ một số âm bằng cộng với số đối của nó." if b < 0 else "Số lớn hơn quyết định dấu của kết quả."
        return [first, split]
    if op == "mul":
        return [f"Nhớ lại bảng nhân {abs(b)}.", f"{fmt(a)} × {b} nghĩa là {b} lần số {fmt(a)}."]
    return [f"Tìm số nhân với {b} thì được {fmt(a)}.", f"{b} × ? = {fmt(a)}"]


def gen_arithmetic(rng: random.Random, g: dict, op: str) -> dict:
    node, value = _arith(rng, op, g)
    a, b = node.left.value, node.right.value  # type: ignore[union-attr]
    expression = render(node)
    return {
        "kind": "math_input", "question_key": f"math.arith.{op}", "skill_key": f"math.arith.{op}",
        "skill_label": OP_LABEL[op].capitalize(),
        "prompt": {"expression": expression, "allow_negative": bool(g.get("allow_negative"))},
        "answer": {"value": str(value), "op": op, "operands": [a, b]},
        "hints": _arith_hints(op, a, b),
        "explanation": f"{expression} = {fmt(value)}",
    }


ORDER_TEMPLATES_2 = [
    lambda n: Op("add", n(), Op("mul", n(), n())),
    lambda n: Op("sub", n(big=True), Op("mul", n(), n())),
    lambda n: Op("add", n(), Op("div", n(), n())),
    lambda n: Op("mul", Op("add", n(), n(), paren=True), n()),
    lambda n: Op("div", Op("sub", n(big=True), n(), paren=True), n()),
    lambda n: Op("mul", n(), Op("sub", n(), n(), paren=True)),
]
ORDER_TEMPLATES_3 = [
    lambda n: Op("sub", Op("add", n(), Op("mul", n(), n())), n()),
    lambda n: Op("sub", Op("mul", n(), n()), Op("div", n(), n())),
    lambda n: Op("sub", Op("mul", Op("add", n(), n(), paren=True), n()), n()),
    lambda n: Op("sub", n(big=True), Op("div", Op("add", n(), n(), paren=True), n())),
    lambda n: Op("add", Op("mul", n(), n()), Op("mul", n(), n())),
]


def _tree_ok(node, allow_negative: bool, limit: int) -> bool:
    """Exact division everywhere, no negative intermediate results unless allowed, everything within `limit`."""
    try:
        def walk(n):
            if isinstance(n, Num):
                return n.value
            value = apply(n.op, walk(n.left), walk(n.right))
            if (value < 0 and not allow_negative) or abs(value) > limit or (value == 0 and n.op == "sub"):
                raise NotExact("range")  # also skips trivial parts like (3 − 3)
            return value
        walk(node)
        return True
    except NotExact:
        return False


def gen_order_of_operations(rng: random.Random, g: dict) -> dict:
    templates = ORDER_TEMPLATES_3 if g.get("ops_count", 2) >= 3 else ORDER_TEMPLATES_2
    small = g.get("operand_max", 10)
    limit = g.get("add_max", 100)
    for _ in range(500):
        def n(big: bool = False):
            return Num(rng.randint(10, limit) if big else rng.randint(2, small))
        node = rng.choice(templates)(n)
        if not _tree_ok(node, g.get("allow_negative", False), limit):
            continue
        naive = left_to_right(node)
        value = evaluate(node)
        # Prefer problems where the order matters, so the skill is actually practised.
        if naive == value and rng.random() < 0.8:
            continue
        break
    else:  # pragma: no cover - fallback that always satisfies the constraints
        node = Op("add", Num(2), Op("mul", Num(3), Num(4)))
        value = 14
    expression = render(node)
    worked = steps(node)
    rule = "Trong ngoặc làm trước; rồi nhân, chia từ trái sang phải; cuối cùng cộng, trừ từ trái sang phải."
    return {
        "kind": "math_input", "question_key": "math.order_ops", "skill_key": "math.order_ops",
        "skill_label": "Thứ tự thực hiện phép tính",
        "prompt": {"expression": expression, "allow_negative": bool(g.get("allow_negative"))},
        "answer": {"value": str(value), "left_to_right": left_to_right(node)},
        # Steps without the final one, so hints never give the result away.
        "hints": [rule, *[f"Bước {i + 1}: {s}" for i, s in enumerate(worked[:-1])]],
        "explanation": "; ".join(worked) + f". Vậy {expression} = {fmt(value)}",
    }


MISSING_TEMPLATES = {
    # (display, solve) with the unknown as "__"; solve() gives the unique value.
    "add": [("__ + {b} = {c}", "{c} − {b}"), ("{a} + __ = {c}", "{c} − {a}")],
    "sub": [("__ − {b} = {c}", "{c} + {b}"), ("{a} − __ = {c}", "{a} − {c}")],
    "mul": [("__ × {b} = {c}", "{c} : {b}"), ("{a} × __ = {c}", "{c} : {a}")],
    "div": [("__ : {b} = {c}", "{c} × {b}"), ("{a} : __ = {c}", "{a} : {c}")],
}
MISSING_RULE = {
    ("add", 0): "Muốn tìm số hạng chưa biết, lấy tổng trừ đi số hạng đã biết.",
    ("add", 1): "Muốn tìm số hạng chưa biết, lấy tổng trừ đi số hạng đã biết.",
    ("sub", 0): "Muốn tìm số bị trừ, lấy hiệu cộng với số trừ.",
    ("sub", 1): "Muốn tìm số trừ, lấy số bị trừ trừ đi hiệu.",
    ("mul", 0): "Muốn tìm thừa số chưa biết, lấy tích chia cho thừa số đã biết.",
    ("mul", 1): "Muốn tìm thừa số chưa biết, lấy tích chia cho thừa số đã biết.",
    ("div", 0): "Muốn tìm số bị chia, lấy thương nhân với số chia.",
    ("div", 1): "Muốn tìm số chia, lấy số bị chia chia cho thương.",
}


def missing_solutions(op: str, slot: int, a: int, b: int, c: int, search: range) -> list[int]:
    """Brute-force check used to guarantee a single answer in the range being learned."""
    found = []
    for x in search:
        left, right = (x, b) if slot == 0 else (a, x)
        try:
            if apply(op, left, right) == c:
                found.append(x)
        except NotExact:
            continue
    return found


def gen_missing_number(rng: random.Random, g: dict, op: str) -> dict:
    top = g["add_max"]
    lo_mul, hi_mul = g.get("mul_min", 2), g.get("mul_max", 9)
    slot = rng.randint(0, 1)
    if op == "add":
        a, b = rng.randint(1, top - 1), 0
        b = rng.randint(1, top - a)
        c = a + b
    elif op == "sub":
        a = rng.randint(2, top)
        b = rng.randint(1, a - 1)
        c = a - b
    elif op == "mul":
        a, b = rng.randint(lo_mul, hi_mul), rng.randint(lo_mul, hi_mul)  # never 0, so the factor is unique
        c = a * b
    else:
        b, c = rng.randint(lo_mul, hi_mul), rng.randint(lo_mul, hi_mul)
        a = b * c
    unknown = a if slot == 0 else b
    shown, solve = MISSING_TEMPLATES[op][slot]
    equation = shown.format(a=a, b=b, c=c)
    worked = solve.format(a=a, b=b, c=c)
    wrong_inverse = None
    if op == "sub" and slot == 0:
        wrong_inverse = c - b
    elif op == "add":
        wrong_inverse = c + (b if slot == 0 else a)
    return {
        "kind": "missing_number", "question_key": f"math.missing.{op}", "skill_key": f"math.missing.{op}",
        "skill_label": f"Tìm số còn thiếu ({OP_LABEL[op]})",
        "prompt": {"equation": equation, "allow_negative": False},
        "answer": {"value": str(unknown), "op": op, "slot": slot, "a": a, "b": b, "c": c, "wrong_inverse": wrong_inverse},
        "hints": [MISSING_RULE[(op, slot)], f"Tính: {worked}"],
        "explanation": f"{worked} = {unknown}. Thử lại: {equation.replace('__', str(unknown))} ✓",
    }


COMPARE_OPTIONS = [{"id": "<", "text": "<"}, {"id": "=", "text": "="}, {"id": ">", "text": ">"}]


def gen_compare(rng: random.Random, g: dict) -> dict:
    neg = g.get("allow_negative", False)
    top = g["add_max"]
    if g.get("expressions", True) and rng.random() < 0.7:
        op = rng.choice([o for o in g.get("ops", ["add", "sub"]) if o in ("add", "sub", "mul")] or ["add"])
        node, left = _arith(rng, op, {**g, "big_mul": False})
        left_text = render(node)
    else:
        left = _rand(rng, 0, top, neg)
        node, left_text = None, fmt(left)
    roll = rng.random()
    if roll < 0.25:
        right = left
    else:
        delta = rng.randint(1, max(2, min(10, top // 5)))
        right = left + delta if roll < 0.625 else left - delta
        if right < 0 and not neg:
            right = left + delta
    sign = "<" if left < right else ">" if left > right else "="
    hints = ["So sánh hai số: số nào lớn hơn thì dấu mở về phía số đó."]
    if node is not None:
        hints.insert(0, f"Tính vế trái trước: {left_text} = ?")
    if neg:
        hints.append("Với số âm: số nào xa 0 hơn về phía âm thì nhỏ hơn.")
    worked = f"{left_text} = {fmt(left)}; " if node is not None else ""
    return {
        "kind": "compare", "question_key": "math.compare", "skill_key": "math.compare.neg" if neg else "math.compare",
        "skill_label": "So sánh số nguyên" if neg else "So sánh số",
        "prompt": {"left": left_text, "right": fmt(right), "options": COMPARE_OPTIONS},
        "answer": {"value": sign, "left": left, "right": right},
        "hints": hints,
        "explanation": f"{worked}{fmt(left)} {sign} {fmt(right)}",
    }


def generate_math_item(rng: random.Random, topic: str, g: dict, weights: dict[str, float] | None = None) -> dict:
    """One problem for a Math topic. `weights` (skill_key -> weight) favour the user's weaker problem types."""
    ops = g.get("ops", ["add", "sub", "mul", "div"])
    if topic == "order_of_operations":
        return gen_order_of_operations(rng, g)
    if topic == "compare":
        return gen_compare(rng, g)
    prefix = "math.arith." if topic == "arithmetic" else "math.missing."
    w = [max(0.05, (weights or {}).get(prefix + op, 1.0)) for op in ops]
    op = rng.choices(ops, weights=w)[0]
    return gen_arithmetic(rng, g, op) if topic == "arithmetic" else gen_missing_number(rng, g, op)


def generate_math_items(seed: int, topic: str, g: dict, count: int,
                        weights: dict[str, float] | None = None, only_key: str | None = None) -> list[dict]:
    """Deterministic: the same seed and config always give the same problems (sessions store the seed)."""
    rng = random.Random(seed)
    items: list[dict] = []
    seen: set[str] = set()
    attempts = 0
    while len(items) < count and attempts < count * 50:
        attempts += 1
        item = generate_math_item(rng, topic, g, weights)
        if only_key and item["question_key"] != only_key:
            continue
        signature = str(item["prompt"])
        if signature in seen and attempts < count * 25:
            continue
        seen.add(signature)
        items.append(item)
    return items


def math_error_type(item: dict, value: Decimal) -> str | None:
    """Classify a wrong numeric answer when the data allows it; None when the cause can't be determined."""
    answer = item["answer"]
    correct = Decimal(answer["value"])
    if value == -correct and correct != 0:
        return "sign_error"
    if item["kind"] == "math_input" and "left_to_right" in answer:
        if answer["left_to_right"] is not None and value == Decimal(answer["left_to_right"]):
            return "order_of_operations"
        return None
    if item["kind"] == "missing_number":
        if answer.get("wrong_inverse") is not None and value == Decimal(answer["wrong_inverse"]):
            return "wrong_inverse_operation"
        return "off_by_one" if abs(value - correct) == 1 else None
    if item["kind"] == "math_input":
        op, (a, b) = answer["op"], answer["operands"]
        others = {"add": a - b, "sub": a + b, "mul": a + b, "div": a * b}
        if value == others[op] and value != correct:
            return "wrong_operation"
        if op in ("add", "sub") and abs(value - correct) == 10:
            return "carry_error" if op == "add" else "borrow_error"
        if op == "mul" and abs(value - correct) in (abs(a), abs(b)):
            return "times_table_slip"
        if abs(value - correct) == 1:
            return "off_by_one"
    return None


def compare_error_type(item: dict, chosen: str) -> str | None:
    correct = item["answer"]["value"]
    if {chosen, correct} == {"<", ">"}:
        return "reversed_sign"
    return "equality_confusion" if "=" in (chosen, correct) else None
