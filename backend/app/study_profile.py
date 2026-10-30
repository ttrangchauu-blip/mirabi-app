"""Age and school grade on the profile, and the learning suggestions they give.

Age only suggests a grade (a child starts grade 1 the year they turn 6); the user confirms or changes it, since age
does not tell which grade someone is actually in. Not everyone is at school: "preschool", "university" and "adult"
(working or self-study) are grades too.

Keep AGE_MIN, AGE_MAX, GRADES, suggest_grade and grade_fits_age in sync with mobile/src/studyProfile.ts.
"""
from typing import Literal, get_args

AGE_MIN, AGE_MAX = 4, 100

GradeId = Literal["preschool", "grade1", "grade2", "grade3", "grade4", "grade5", "grade6", "grade7", "grade8", "grade9",
                  "grade10", "grade11", "grade12", "university", "adult"]
GRADE_IDS: tuple[str, ...] = get_args(GradeId)
GRADE_LABELS = {"preschool": "Chưa đi học", **{f"grade{n}": f"Lớp {n}" for n in range(1, 13)},
                "university": "Sinh viên", "adult": "Người đi làm/Học tự do"}


def _school_year(grade: str) -> int | None:
    return int(grade.removeprefix("grade")) if grade.startswith("grade") else None


def suggest_grade(age: int) -> str:
    if age < 6:
        return "preschool"
    if age <= 17:
        return f"grade{age - 5}"
    return "university" if age <= 22 else "adult"


def grade_fits_age(grade: str, age: int) -> bool:
    """Whether a grade is plausible at this age. Wide on purpose: early or late starts and repeated years are common."""
    year = _school_year(grade)
    if year is not None:
        return year + 4 <= age <= year + 9
    return {"preschool": age <= 7, "university": age >= 16, "adult": age >= 15}[grade]


def check_study_profile(age: int, grade: str) -> None:
    if not grade_fits_age(grade, age):
        raise ValueError(f"School grade “{GRADE_LABELS[grade]}” does not fit age {age}")


# What each stage of schooling is offered first in Học tập. Suggestions only: every subject, game and topic stays open.
# Math levels and topics are learning_content codes; English topics are vocabulary bank topics (learning_vocab.TOPICS).
_STAGES = {
    "early": {  # preschool, grades 1–2 (English is taught from grade 3)
        "subjects": ["vietnamese", "math", "science"], "games": ["word_builder", "sorting", "math_bridge"], "math_level": "grade2",
        "topics": {"english": ["animals", "family", "food", "home", "school"], "math": ["arithmetic", "compare"]}},
    "primary": {  # grades 3–5
        "subjects": ["vietnamese", "math", "english", "science"],
        "games": ["spelling_detective", "word_shooter", "gate", "defense", "math_bridge", "sorting"], "math_level": "grade3",
        "topics": {"english": ["school", "animals", "food", "sports", "weather", "time"], "math": ["arithmetic", "missing_number"]}},
    "lower_secondary": {  # grades 6–9
        "subjects": ["english", "math", "informatics"], "games": ["meteor", "bridge", "defense", "code_path"], "math_level": "grade6",
        "topics": {"english": ["school", "sports", "entertainment", "science", "emotions", "environment"],
                   "math": ["arithmetic", "compare"]}},
    "upper_secondary": {  # grades 10–12
        "subjects": ["english", "informatics"], "games": ["meteor", "bridge", "code_path"], "math_level": "grade6",
        "topics": {"english": ["science", "technology", "environment", "society", "careers", "thinking"], "math": []}},
    "university": {
        "subjects": ["english", "informatics"], "games": ["meteor", "bridge", "code_path"], "math_level": "grade6",
        "topics": {"english": ["thinking", "technology", "careers", "media", "communication", "travel"], "math": []}},
    "adult": {
        "subjects": ["english", "informatics"], "games": ["meteor", "bridge", "code_path"], "math_level": "grade6",
        "topics": {"english": ["work", "communication", "travel", "money", "health", "business"], "math": []}},
}
# Math levels the content has (grade2, grade3, grade4, grade6): grades 4–5 practise grade 4.
_MATH_LEVEL = {"grade4": "grade4", "grade5": "grade4"}


def _stage(grade: str) -> str:
    year = _school_year(grade)
    if year is None:
        return "early" if grade == "preschool" else grade
    return "early" if year <= 2 else "primary" if year <= 5 else "lower_secondary" if year <= 9 else "upper_secondary"


def recommendations(grade: str | None) -> dict | None:
    """The suggestions for a grade, or None while the profile has no grade (the app asks for it in Học tập)."""
    if grade not in GRADE_LABELS:
        return None
    stage = _STAGES[_stage(grade)]
    return {"grade": grade, "grade_label": GRADE_LABELS[grade], "subjects": stage["subjects"], "games": stage["games"],
            "math_level": _MATH_LEVEL.get(grade, stage["math_level"]),
            "topics": {subject: list(codes) for subject, codes in stage["topics"].items()}}


def preferred_vocab_topics(grade: str | None) -> frozenset[str]:
    rec = recommendations(grade)
    return frozenset(rec["topics"]["english"]) if rec else frozenset()
