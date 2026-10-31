"""Math gameplays of the lesson catalog (registered with the others in lesson_games.py).

- Trục số (`number_line`): numbers (whole, negative, fractions, decimals, or a rounded value) are dragged onto a
  number line and dropped on a tick. The backend reads the tick each one landed on; the app never gets the values.
- Giải toán từng bước (`step_solver`): a word problem is solved one step at a time. Each step asks a question; the
  learner builds the calculation from the problem's numbers (and the results of earlier steps) and types its result.
  A right step is confirmed by the backend before the next one opens (`advance`), so the plan is never shown ahead.
"""
from __future__ import annotations

import random
import re
from fractions import Fraction

from .learning_engine import InvalidAnswer, normalize_text
from .lesson_game_kit import ids, number, show, text_field, tokens, written_as_fraction

GAMES = ("number_line", "step_solver")
KIND = {"number_line": "number_line_place", "step_solver": "step_solve"}
NAMES = {"number_line": "Cầu trục số", "step_solver": "Giải toán từng bước"}
OPEN_LABEL = {"number_line_place": "Trục số", "step_solve": "Giải từng bước"}
MIN_TASKS = {"number_line": 4, "step_solver": 3}
MAX_TURNS = {"number_line": 8, "step_solver": 5}
STAGED = frozenset({"step_solve"})

# ---------------------------------------------------------------------------------------------------------------
# Cầu trục số
# ---------------------------------------------------------------------------------------------------------------

LABEL_MODES = ("all", "majors", "ends")
MAX_POSITIONS = 100


def _line(task: dict) -> tuple[Fraction, Fraction, Fraction, Fraction]:
    line = task["line"]
    start, end, step = number(line["from"]), number(line["to"]), number(line["step"])
    return start, end, step, number(line.get("snap", line["step"]))


def _validate_number_line(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    text_field(task.get("prompt"), where, problems, lim["question"], "prompt")
    line = task.get("line")
    if not isinstance(line, dict):
        problems.append(f"{where}: line {{from, to, step}} is required")
        return None
    try:
        start, end, step, snap = _line(task)
    except (KeyError, ValueError) as exc:
        problems.append(f"{where}: line has a bad number ({exc})")
        return None
    if end <= start or step <= 0 or snap <= 0:
        problems.append(f"{where}: the line goes from a smaller number to a bigger one, with a positive step")
        return None
    if (end - start) % step or step % snap:
        problems.append(f"{where}: the line's length is a whole number of steps, and a step a whole number of snaps")
        return None
    if (end - start) / snap > MAX_POSITIONS:
        problems.append(f"{where}: at most {MAX_POSITIONS} positions on the line (a bigger snap or a shorter line)")
        return None
    if (end - start) / step > 20:
        problems.append(f"{where}: at most 20 labelled steps (they would not fit on a phone)")
    if line.get("labels", "majors") not in LABEL_MODES:
        problems.append(f"{where}: labels must be all, majors or ends")
    if line.get("labels") == "all" and (end - start) / snap > 20:
        problems.append(f"{where}: labels: all only with at most 20 positions")
    points = task.get("points") or []
    if not 1 <= len(points) <= min(4, lim["items"]):
        problems.append(f"{where}: 1–{min(4, lim['items'])} points to place")
        return None
    values = []
    for p in points:
        text_field(p.get("label"), where, problems, 32, "point label")
        try:
            v = number(p.get("value"))
        except ValueError:
            problems.append(f"{where}: point {p.get('label')!r} has no exact value")
            return None
        if not start <= v <= end or (v - start) % snap:
            problems.append(f"{where}: point {p.get('label')!r} ({show(v)}) is not on a position of the line")
        values.append(v)
    if len(set(values)) != len(values):
        problems.append(f"{where}: two points on the same position")
    if len({normalize_text(p.get('label') or '') for p in points}) != len(points):
        problems.append(f"{where}: two points with the same label")
    for m in task.get("marks") or []:
        text_field(m.get("label"), where, problems, 24, "mark label")
        try:
            if not start <= number(m.get("value")) <= end:
                problems.append(f"{where}: a mark is outside the line")
        except ValueError:
            problems.append(f"{where}: a mark has no exact value")
    if len(task.get("marks") or []) > 3:
        problems.append(f"{where}: at most 3 marks")
    return ("number_line", show(start), show(end), tuple(sorted((normalize_text(p["label"]), show(v)) for p, v in zip(points, values))))


def number_line_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The line as ticks (0..`ticks`, a tick every snap; every `major`-th one long), its labels at their ticks, fixed
    marks (a number already shown, e.g. the one to round) and the points to place, shuffled with ids that say nothing.
    Where each point goes is only in the answer, as a tick."""
    start, end, step, snap = _line(task)
    ticks = int((end - start) / snap)
    major = int(step / snap)
    mode = task["line"].get("labels", "majors")
    shown = range(0, ticks + 1, 1 if mode == "all" else major) if mode != "ends" else (0, ticks)
    frac = written_as_fraction(*task["line"].values())
    labels = [{"at": i, "text": show(start + i * snap, frac)} for i in shown]
    points = [dict(p) for p in task["points"]]
    rng.shuffle(points)
    pids = ids("p", len(points))
    marks = [{"at": float((number(m["value"]) - start) / (end - start)), "text": m["label"]} for m in task.get("marks") or []]
    return {"kind": "number_line_place", "question_id": None, "prompt": {
                "title": title, "prompt": task["prompt"], "ticks": ticks, "major": major, "labels": labels, "marks": marks,
                "points": [{"id": i, "label": p["label"]} for i, p in zip(pids, points)]},
            "answer": {"tick_of": {i: int((number(p["value"]) - start) / snap) for i, p in zip(pids, points)},
                       "display": "; ".join(f"{p['label']} → {show(number(p['value']), frac)}" for p in task["points"])},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def _ticks(prompt: dict, answer) -> dict[str, int]:
    """point → tick, every point once, on the line. Raises InvalidAnswer for anything else."""
    placed: dict[str, int] = {}
    points = {p["id"] for p in prompt["points"]}
    for token in tokens(answer, expected_pairs=True):
        point, tick = token.split(":")
        if point not in points or point in placed or not tick.isdigit() or int(tick) > prompt["ticks"]:
            raise InvalidAnswer("a point on a tick of the line, each once")
        placed[point] = int(tick)
    if set(placed) != points:
        raise InvalidAnswer("every point goes on the line")
    return placed


def _check_number_line(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    placed = _ticks(prompt, answer)
    names = {p["id"]: p["label"] for p in prompt["points"]}
    given = "; ".join(f"{names[p]} @ {t}" for p, t in placed.items())
    wrong = [p for p, t in placed.items() if expected["tick_of"][p] != t]
    if not wrong:
        return True, None, given, None
    first = wrong[0]
    side = "phải" if placed[first] > expected["tick_of"][first] else "trái"
    lead = (f"“{names[first]}” đang lệch về bên {side}." if len(wrong) == 1
            else f"Có {len(wrong)}/{len(placed)} số chưa đúng chỗ; “{names[first]}” đang lệch về bên {side}.")
    kept = " Các số đúng chỗ được giữ lại." if len(wrong) < len(placed) else ""
    return False, "wrong_position", given, f"{lead}{kept} Đếm lại các vạch nhé."


def _kept_number_line(prompt: dict, expected: dict, answer) -> list[str]:
    return [f"{p}:{t}" for p, t in _ticks(prompt, answer).items() if expected["tick_of"][p] == t]


# ---------------------------------------------------------------------------------------------------------------
# Giải toán từng bước
# ---------------------------------------------------------------------------------------------------------------

OPS = {"+": "+", "-": "−", "−": "−", "×": "×", "x": "×", "*": "×", ":": ":", "÷": ":", "/": ":"}
_EXPR = re.compile(r"^\s*(\S+)\s*([-+−×x*:÷/])\s*(\S+)\s*$")


def _apply(a: Fraction, op: str, b: Fraction) -> Fraction:
    if op == "+":
        return a + b
    if op == "−":
        return a - b
    if op == "×":
        return a * b
    if b == 0:
        raise ValueError("division by zero")
    return a / b


def _operand(text: str, results: list[Fraction]) -> Fraction:
    if re.fullmatch(r"r\d", text):
        k = int(text[1:])
        if not 1 <= k <= len(results):
            raise ValueError(f"{text} is not an earlier step")
        return results[k - 1]
    return number(text)


def _parse_expr(expr: str, results: list[Fraction]) -> tuple[Fraction, str, Fraction]:
    m = _EXPR.match(expr or "")
    if not m:
        raise ValueError(f"expected 'a op b', got {expr!r}")
    return _operand(m.group(1), results), OPS[m.group(2)], _operand(m.group(3), results)


def _same(x: tuple[Fraction, str, Fraction], y: tuple[Fraction, str, Fraction]) -> bool:
    if x == y:
        return True
    return x[1] in "+×" and x[1] == y[1] and (x[0], x[2]) == (y[2], y[0])


def _validate_step_solver(task: dict, lim: dict, where: str, problems: list[str]) -> tuple | None:
    text_field(task.get("problem"), where, problems, lim["passage"], "problem")
    given = task.get("numbers") or []
    if not 2 <= len(given) <= 6:
        problems.append(f"{where}: 2–6 numbers from the problem")
        return None
    try:
        values = [number(n) for n in given]
    except ValueError as exc:
        problems.append(f"{where}: {exc}")
        return None
    if len(set(values)) != len(values):
        problems.append(f"{where}: the same number twice in numbers")
    flat = re.sub(r"[\s.]", "", task.get("problem") or "")
    for n in given:
        if re.sub(r"[\s.]", "", str(n)) not in flat:
            problems.append(f"{where}: {n} is not written in the problem")
    steps = task.get("steps") or []
    if not 1 <= len(steps) <= 4:
        problems.append(f"{where}: 1–4 steps")
        return None
    results: list[Fraction] = []
    for k, s in enumerate(steps, 1):
        text_field(s.get("ask"), where, problems, lim["question"], f"step {k} ask")
        if s.get("unit") is not None:
            text_field(s.get("unit"), where, problems, 20, f"step {k} unit")
        try:
            a, op, b = _parse_expr(s.get("expr"), results)
            result = number(s.get("result"))
            for alt in s.get("accepted") or []:
                if _apply(*_parse_expr(alt, results)) != result:
                    problems.append(f"{where}: step {k}: accepted {alt!r} does not give {s.get('result')}")
        except (ValueError, KeyError) as exc:
            problems.append(f"{where}: step {k}: {exc}")
            return None
        for operand in (a, b):
            if operand not in values and operand not in results:
                problems.append(f"{where}: step {k} uses {show(operand)}, which is neither in numbers nor an earlier result")
        try:
            if _apply(a, op, b) != result:
                problems.append(f"{where}: step {k}: {s['expr']} is not {s.get('result')}")
        except ValueError as exc:
            problems.append(f"{where}: step {k}: {exc}")
        if result < 0 and lim["items"] <= 5:  # primary school (lớp 1–5) has no negative numbers
            problems.append(f"{where}: step {k}: a negative result before grade 6")
        results.append(result)
    return ("step_solver", normalize_text(task.get("problem") or ""))


def _chips(given: list, results: list[Fraction]) -> list[dict]:
    frac = written_as_fraction(*given)
    return ([{"id": f"n{i + 1}", "text": show(number(n), frac)} for i, n in enumerate(given)]
            + [{"id": f"r{i + 1}", "text": show(r, frac), "step": i + 1} for i, r in enumerate(results)])


def step_solver_snapshot(task: dict, rng: random.Random, title: str) -> dict:
    """The problem, its numbers as chips (in the problem's order) and the first step's question only; how many steps
    there are. The calculations are only in the answer; each later question comes when the step before is right."""
    steps = task["steps"]
    results: list[Fraction] = []
    plan = []
    for s in steps:
        a, op, b = _parse_expr(s["expr"], results)
        result = number(s["result"])
        plan.append({"expr": [a, op, b], "accepted": [list(_parse_expr(x, results)) for x in s.get("accepted") or []],
                     "result": result, "ask": s["ask"], "unit": s.get("unit")})
        results.append(result)
    final = steps[-1]
    return {"kind": "step_solve", "question_id": None, "prompt": {
                "title": title, "prompt": "Giải từng bước: chọn phép tính rồi điền kết quả.", "problem": task["problem"],
                "chips": _chips(task["numbers"], []), "at_step": 1, "steps": len(steps), "ask": steps[0]["ask"],
                "ask_unit": steps[0].get("unit"), "done": []},
            "answer": {"numbers": [str(n) for n in task["numbers"]],
                       "plan": [{**p, "expr": [str(p["expr"][0]), p["expr"][1], str(p["expr"][2])],
                                 "accepted": [[str(x[0]), x[1], str(x[2])] for x in p["accepted"]], "result": str(p["result"])}
                                for p in plan],
                       "display": f"Đáp số: {show(number(final['result']), written_as_fraction(*task['numbers']))}"
                                  f"{' ' + final['unit'] if final.get('unit') else ''}"},
            "hints": [h for h in [task.get("hint")] if h], "explanation": task["explanation"]}


def _step_answer(prompt: dict, answer) -> tuple[str, str, str, Fraction]:
    """[left chip, operator, right chip, typed result]."""
    parts = tokens(answer)
    chips = {c["id"] for c in prompt["chips"]}
    if len(parts) != 4 or parts[0] not in chips or parts[2] not in chips or parts[1] not in OPS:
        raise InvalidAnswer("expected [chip, operator, chip, result]")
    try:
        typed = number(parts[3])
    except ValueError:
        raise InvalidAnswer("the result is not a number")
    return parts[0], OPS[parts[1]], parts[2], typed


def _judge_step(prompt: dict, expected: dict, answer) -> tuple[bool, bool, str, dict]:
    """(operation right, result right, what was built, this step's plan)."""
    left, op, right, typed = _step_answer(prompt, answer)
    plan = expected["plan"][prompt["at_step"] - 1]
    frac = written_as_fraction(*expected["numbers"])
    text = {c["id"]: c["text"] for c in prompt["chips"]}
    value = {f"n{i + 1}": number(n) for i, n in enumerate(expected["numbers"])}
    value.update({f"r{i + 1}": Fraction(p["result"]) for i, p in enumerate(expected["plan"][:prompt["at_step"] - 1])})
    if left not in value or right not in value:
        raise InvalidAnswer("unknown chip")
    built = (value[left], op, value[right])
    wanted = [tuple((Fraction(e[0]), e[1], Fraction(e[2]))) for e in [plan["expr"], *plan["accepted"]]]
    op_right = any(_same(built, w) for w in wanted)
    given = f"{text[left]} {op} {text[right]} = {show(typed, frac)}"
    return op_right, op_right and typed == Fraction(plan["result"]), given, plan


def _check_step_solver(prompt: dict, expected: dict, answer) -> tuple[bool, str | None, str, str | None]:
    op_right, result_right, given, plan = _judge_step(prompt, expected, answer)
    if result_right:
        return prompt["at_step"] == prompt["steps"], None, given, None  # a step before the last is `advance`d, not checked
    calc = given.split(" = ")[0]
    if op_right:
        return False, "calc", given, f"Phép tính {calc} chọn đúng rồi, nhưng kết quả chưa đúng. Tính lại nhé."
    return False, "wrong_operation", given, (f"Phép tính {calc} chưa trả lời câu hỏi “{plan['ask']}”. "
                                             "Đọc lại đề: cần gộp, bớt, gấp lên hay chia ra?")


def _kept_step_solver(prompt: dict, expected: dict, answer) -> list[str]:
    op_right, _, _, _ = _judge_step(prompt, expected, answer)
    return tokens(answer)[:3] if op_right else []


def _advance_step_solver(prompt: dict, expected: dict, answer) -> tuple[dict, str] | None:
    """A right step before the last: the next question opens and the result becomes a chip to use."""
    if prompt["at_step"] >= prompt["steps"]:
        return None
    op_right, result_right, given, plan = _judge_step(prompt, expected, answer)
    if not result_right:
        return None
    k = prompt["at_step"]
    nxt = expected["plan"][k]
    results = [Fraction(p["result"]) for p in expected["plan"][:k]]
    unit = f" {plan['unit']}" if plan.get("unit") else ""
    frac = written_as_fraction(*expected["numbers"])
    done = [*prompt.get("done", []), {"step": k, "ask": plan["ask"], "work": given, "result": show(results[-1], frac) + unit}]
    update = {"at_step": k + 1, "ask": nxt["ask"], "ask_unit": nxt.get("unit"), "done": done,
              "chips": _chips(expected["numbers"], results)}
    return update, f"Bước {k} đúng: {given}{unit}. Kết quả thành một thẻ số mới. Sang bước {k + 1}!"


VALIDATE = {"number_line": _validate_number_line, "step_solver": _validate_step_solver}
SNAPSHOT = {"number_line": number_line_snapshot, "step_solver": step_solver_snapshot}
CHECK = {"number_line_place": _check_number_line, "step_solve": _check_step_solver}
KEPT = {"number_line_place": _kept_number_line, "step_solve": _kept_step_solver}
ADVANCE = {"step_solve": _advance_step_solver}


def label(game: str, task: dict) -> str:
    return task.get("prompt") or task.get("problem") or ""
