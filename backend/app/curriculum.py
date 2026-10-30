"""What Học tập offers a grade: the subjects of the curriculum the app follows, named as at that grade, and the games
that have reviewed content for it.

The curriculum is Vietnam's general education programme (Chương trình giáo dục phổ thông 2018). The confirmed grade
decides the content; a learner outside school (Sinh viên, Người đi làm/Học tự do) picks subjects and a level instead.
A subject or game without enough content for the grade is not offered (no short, padded or untested stage); the app
says which grades a game supports. Keep the game ids in step with mobile/src/learning/labels.ts (GAME_INFO).
"""
from __future__ import annotations

from typing import Literal, get_args

from . import curriculum_games as cg
from .study_profile import GRADE_LABELS

CURRICULUM = "GDPT2018"
CURRICULUM_NAME = "Chương trình giáo dục phổ thông 2018"

FreeLevel = Literal["basic", "intermediate", "advanced"]
FREE_LEVELS: tuple[str, ...] = get_args(FreeLevel)
FREE_LEVEL_LABELS = {"basic": "Cơ bản", "intermediate": "Trung cấp", "advanced": "Nâng cao"}
FREE_GRADES = ("university", "adult")


def subject_name(code: str, grade: int | None) -> str | None:
    """The subject's name at a grade (None: not taught then). Learners outside school (grade None) see the plain name."""
    if code == "vietnamese":
        return None if grade is None else "Tiếng Việt" if grade <= 5 else "Ngữ văn"
    if code == "math":
        return "Toán"
    if code == "english":
        return "Tiếng Anh" if grade is None or grade >= 3 else None
    if code == "science":
        if grade is None:
            return None
        return "Tự nhiên và Xã hội" if grade <= 3 else "Khoa học" if grade <= 5 else "Khoa học tự nhiên" if grade <= 9 else None
    if code == "informatics":
        return "Tin học" if grade is None or grade >= 3 else None
    return None


SUBJECT_ORDER = ("vietnamese", "math", "english", "science", "informatics")

# game: (subject, first grade, last grade, offered to learners outside school)
GAMES = {
    "word_builder": ("vietnamese", 1, 2, False),
    "spelling_detective": ("vietnamese", 2, 5, False),
    "defense": ("math", 1, 12, True),
    "math_bridge": ("math", 1, 12, True),
    "word_shooter": ("english", 3, 12, True),
    "meteor": ("english", 3, 12, True),
    "gate": ("english", 3, 12, True),
    "bridge": ("english", 3, 12, True),
    "sorting": ("science", 1, 5, False),
    "code_path": ("informatics", 3, 12, True),
}
GameKey = Literal["word_builder", "spelling_detective", "defense", "math_bridge", "word_shooter", "meteor", "gate", "bridge",
                  "sorting", "code_path"]


def grade_number(grade: str | None) -> int | None:
    return int(grade[5:]) if grade and grade.startswith("grade") else None


def grades_label(game: str) -> str:
    _, low, high, free = GAMES[game]
    label = f"Lớp {low}" if low == high else f"Lớp {low}–{high}"
    return label + (" · người học tự do" if free else "")


def _offered(game: str, grade: int | None, level: str | None, math_levels: dict[str, set[str]]) -> bool:
    subject, low, high, free = GAMES[game]
    if grade is None:  # outside school: the subjects open to them, at the level they chose
        if not free or level is None:
            return False
    elif not low <= grade <= high:
        return False
    if game in cg.GAMES:
        return cg.available(game, grade if grade is not None else level)
    if subject == "math":  # Math content exists for some grades only (lessons per grade)
        levels = math_levels.get(game, set())
        return bool(levels) if grade is None else f"grade{grade}" in levels
    return True  # English: the banks adapt to the learner's results


def band_for(grade: str | None, level: str | None) -> int | str | None:
    """What a stage of a curriculum game is built for: the school grade, or the level of a learner outside school."""
    number = grade_number(grade)
    return number if number is not None else level if level in FREE_LEVELS else None


def programme(grade: str | None, level: str | None, math_levels: dict[str, set[str]]) -> dict | None:
    """The subjects and games for a grade (`grade`), or for a learner outside school at a level (`level`). None when
    neither is known (the app then asks for the grade, or shows what it showed before)."""
    if grade is None and level is None:
        return None
    number = grade_number(grade)
    outside = grade in FREE_GRADES or (grade is None and level is not None)
    level = level if outside and level in FREE_LEVELS else None
    subjects = []
    for code in SUBJECT_ORDER:
        name = subject_name(code, None if outside else number)
        if name is None:
            continue
        games = [g for g, (subject, *_rest) in GAMES.items() if subject == code
                 and _offered(g, None if outside else number, level, math_levels)]
        if games:
            subjects.append({"code": code, "name": name,
                             "games": [{"id": g, "grades": grades_label(g)} for g in games]})
    if outside:
        label = f"{GRADE_LABELS.get(grade, 'Học tự do')} · {FREE_LEVEL_LABELS[level]}" if level else GRADE_LABELS.get(grade, "Học tự do")
    else:
        label = GRADE_LABELS.get(grade, "")
    note = None
    if outside and level is None:
        note = "Chọn trình độ để xem các môn và trò chơi phù hợp."
    elif not subjects:
        first = min(low for _, low, _, _ in GAMES.values())
        note = f"Chưa có trò chơi cho {label}. Các trò chơi bắt đầu từ Lớp {first}: bạn có thể chọn lớp khác để làm quen."
    return {"curriculum": CURRICULUM_NAME, "grade": grade, "level": level, "outside_school": outside, "label": label,
            "subjects": subjects, "note": note,
            "levels": [{"id": lv, "label": FREE_LEVEL_LABELS[lv]} for lv in FREE_LEVELS] if outside else []}


def offered(game: str, grade: str | None, level: str | None, math_levels: dict[str, set[str]]) -> bool:
    outside = grade in FREE_GRADES or (grade is None and level is not None)
    return game in GAMES and _offered(game, None if outside else grade_number(grade), level if outside else None, math_levels)
