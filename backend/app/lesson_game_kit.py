"""Small pieces shared by the subject gameplays (lesson_games.py, lesson_games_math.py, lesson_games_reading.py):
content checks, ids that say nothing, answers as lists of pieces, and exact numbers written the Vietnamese way."""
from __future__ import annotations

import re
from fractions import Fraction

from .learning_engine import InvalidAnswer


def text_field(value, where: str, problems: list[str], limit: int, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where}: {name} is required")
    elif len(value) > limit:
        problems.append(f"{where}: {name} is longer than {limit} characters for this grade")


def ids(prefix: str, count: int) -> list[str]:
    return [f"{prefix}{i + 1}" for i in range(count)]


def tokens(answer, expected_pairs: bool = False) -> list[str]:
    if not isinstance(answer, list) or not answer or any(not isinstance(a, str) for a in answer):
        raise InvalidAnswer("expected a list of pieces")
    if expected_pairs and any(a.count(":") != 1 for a in answer):
        raise InvalidAnswer("expected id:value pairs")
    return answer


_NUMBER = re.compile(r"^[−-]?\d+(?:[.,]\d+)?(?:/\d+)?$")


def number(value) -> Fraction:
    """An exact number from content or from what was typed: 47, "1 368", "2,5" (decimal comma), "3/4", "−5".
    Raises ValueError for anything else."""
    if isinstance(value, bool):
        raise ValueError("not a number")
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, float):
        return Fraction(str(value))
    if not isinstance(value, str):
        raise ValueError("not a number")
    text = value.strip().replace(" ", "").replace(" ", "")
    if re.fullmatch(r"[−-]?\d{1,3}(\.\d{3})+", text):  # 1.368 is "one thousand three hundred sixty-eight" in Vietnamese
        text = text.replace(".", "")
    if not _NUMBER.match(text):
        raise ValueError(f"not a number: {value!r}")
    text = text.replace("−", "-").replace(",", ".")
    if "/" in text:
        top, bottom = text.split("/")
        if Fraction(bottom) == 0:
            raise ValueError("division by zero")
        return Fraction(top) / Fraction(bottom)
    return Fraction(text)


def written_as_fraction(*values) -> bool:
    """Content that writes its numbers as fractions ("3/4") wants fractions back, not decimals."""
    return any(isinstance(v, str) and "/" in v for v in values)


def show(value: Fraction, fractions: bool = False) -> str:
    """How a number is written for the learner: 1368, 12 000, −5, 2,5; 3/4 with `fractions` (or when it is not a short
    decimal)."""
    sign = "−" if value < 0 else ""
    value = abs(value)
    if value.denominator == 1:
        whole = value.numerator
        return sign + (f"{whole:,}".replace(",", " ") if whole >= 10000 else str(whole))
    if fractions:
        return f"{sign}{value.numerator}/{value.denominator}"
    d = value.denominator
    while d % 2 == 0:
        d //= 2
    while d % 5 == 0:
        d //= 5
    if d == 1 and len(str(value.denominator)) <= 3:  # a decimal: 2,5 · 0,125
        places = max(len(str(value.denominator)) - 1, 1)
        for p in range(1, 4):
            if (value * 10 ** p).denominator == 1:
                places = p
                break
        return sign + f"{float(value):.{places}f}".replace(".", ",")
    return f"{sign}{value.numerator}/{value.denominator}"
