"""Học tập by lesson: Học tập → Chọn môn → Chọn bài → Chọn trò → Cách chơi → 3-2-1 → Chơi → Kết quả.

The programme of a grade (every subject, with what Mirabi supports), the lessons of a subject by chapter, one lesson
with its objectives, summary, games and progress, and "play this game of this lesson". The content is
lesson_catalog.py's; a stage is an ordinary learning session (learning.create_session), so answers, progress, the
review list, history and EXP follow the rules of every game. Progress per grade → subject → lesson → game is read from
the user's sessions (each one records its lesson, grade and content version): it is never stored twice and never
guessed for sessions played before lessons existed. Rules: docs/LEARNING_GAMES.md#học-theo-bài.
"""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import lesson_catalog as lc
from .db import get_db
from .errors import APIError
from .learning import IdempotencyKey, OPEN, create_session, session_out
from .learning_history import fold
from .models import LearningLesson, LearningReviewItem, LearningSession, LearningSessionItem, User
from .security import current_user
from .study_profile import GRADE_LABELS, GradeId

router = APIRouter(prefix="/api/learning", tags=["learning"])

DEFAULT_COMPLETION = {"min_first_try": 0.8, "games": "all"}
LessonStatus = Literal["not_started", "in_progress", "completed"]
STATUS_LABEL = {"not_started": "Chưa học", "in_progress": "Đang luyện", "completed": "Đã hoàn thành"}


def grade_number(grade: str | None) -> int | None:
    return int(grade[5:]) if grade and grade.startswith("grade") else None


def viewed_grade(user: User, grade: str | None) -> int | None:
    """The grade on screen: the one asked for (review or learn ahead, the profile unchanged), else the confirmed one."""
    return grade_number(grade) or grade_number(user.school_grade)


def chosen_subjects(user: User) -> list[str]:
    try:
        value = json.loads(user.study_subjects or "[]")
    except ValueError:
        return []
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


# ---------------------------------------------------------------------------------------------------------------
# Progress, from the sessions (never from the app's numbers)
# ---------------------------------------------------------------------------------------------------------------

def _graded(item: LearningSessionItem) -> bool:
    """Self-assessment questions (tự đánh giá) are never right or wrong: they count for nothing here."""
    if item.kind != "choice_explain":
        return True
    try:
        return json.loads(item.answer_json or "{}").get("graded", True)
    except ValueError:
        return True


def game_progress(db: Session, user_id: int, keys: list[str]) -> dict[str, dict[str, dict]]:
    """lesson key → game → {stages, completed, best, last{…}, passed_at}. Only lesson stages count (not review ones)."""
    if not keys:
        return {}
    sessions = list(db.scalars(select(LearningSession).where(
        LearningSession.user_id == user_id, LearningSession.catalog_lesson.in_(keys)).order_by(LearningSession.id)))
    items: dict[int, list[LearningSessionItem]] = {}
    if sessions:
        for item in db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id.in_([s.id for s in sessions]))):
            items.setdefault(item.session_id, []).append(item)
    out: dict[str, dict[str, dict]] = {}
    for s in sessions:
        rules = json.loads(s.scoring_json or "{}").get("lesson") or {}
        game = rules.get("game") or s.game
        entry = lc.lesson(s.catalog_lesson)
        need = ((entry["lesson"].get("completion") if entry else None) or DEFAULT_COMPLETION).get("min_first_try", 0.8)
        row = out.setdefault(s.catalog_lesson, {}).setdefault(game, {
            "stages": 0, "completed": 0, "reviews": 0, "best": None, "last": None, "passed": False, "open_session": None})
        if s.status in OPEN:
            row["open_session"] = s.id
        if s.kind == "review":
            row["reviews"] += 1
            continue
        row["stages"] += 1
        own = [i for i in items.get(s.id, []) if i.practice_of_id is None and i.required]
        graded = [i for i in own if _graded(i)]
        first = sum(1 for i in graded if i.outcome == "first_try")
        share = first / len(graded) if graded else 1.0
        if s.status in ("completed", "failed", "abandoned"):
            row["last"] = {"session_id": s.id, "status": s.status, "first_try": first, "total": len(graded),
                           "attempts": sum(i.attempts for i in own), "hints": sum(i.hints_used for i in own),
                           "to_review": sum(1 for i in graded if i.outcome not in (None, "first_try")),
                           "content_version": s.content_version}
        if s.status == "completed":
            row["completed"] += 1
            row["best"] = max(row["best"] or 0, round(share * 100))
            row["passed"] = row["passed"] or share >= need
    return out


def lesson_state(entry: dict, progress: dict[str, dict]) -> dict:
    lesson = entry["lesson"]
    games = [g["game"] for g in lesson.get("games", [])] if lesson["status"] == "ready" else []
    rule = lesson.get("completion") or DEFAULT_COMPLETION
    passed = [g for g in games if progress.get(g, {}).get("passed")]
    done = bool(games) and (len(passed) == len(games) if rule.get("games", "all") == "all" else bool(passed))
    started = any(progress.get(g, {}).get("stages") for g in games)
    status: LessonStatus = "completed" if done else "in_progress" if started else "not_started"
    total = len(games) if rule.get("games", "all") == "all" else min(1, len(games))
    return {"status": status, "label": STATUS_LABEL[status], "games_passed": len(passed), "games_total": total,
            "percent": 100 if done else round(100 * min(len(passed), total) / total) if total else 0}


def locked(entry: dict, states: dict[str, dict]) -> bool:
    return any(states.get(req, {}).get("status") != "completed" for req in entry["lesson"].get("requires", []))


def _all_states(db: Session, user_id: int, keys: list[str]) -> dict[str, dict]:
    progress = game_progress(db, user_id, keys)
    return {k: lesson_state(lc.lesson(k), progress.get(k, {})) for k in keys}


# ---------------------------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------------------------

def _resume(db: Session, user: User) -> dict | None:
    """"Tiếp tục học": the lesson last practised (its game and grade), whatever grade is on screen."""
    s = db.scalar(select(LearningSession).where(LearningSession.user_id == user.id, LearningSession.catalog_lesson.is_not(None))
                  .order_by(LearningSession.id.desc()).limit(1))
    entry = lc.lesson(s.catalog_lesson) if s is not None else None
    if entry is None or entry["lesson"]["status"] != "ready":
        return None
    game = (json.loads(s.scoring_json or "{}").get("lesson") or {}).get("game") or s.game
    spec = lc.game_spec(entry, game)
    return {"lesson": entry["lesson"]["key"], "title": entry["lesson"]["title"], "grade": entry["grade"],
            "grade_id": f"grade{entry['grade']}", "subject": entry["subject"], "subject_name": lc.subject_name(entry["subject"], entry["grade"]),
            "game": game if spec else None, "game_title": spec["title"] if spec else None,
            "open_session": s.id if s.status in OPEN else None}


@router.get("/programme", summary="The subjects of a grade (every one of the curriculum), with their lessons and progress")
def programme(grade: GradeId | None = Query(default=None, description="Another grade to review or learn ahead; the "
                                                                      "confirmed grade by default (the profile is unchanged)."),
              user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    data = lc.programme()
    number = viewed_grade(user, grade)
    main = grade_number(user.school_grade)
    base = {"curriculum": data["name"], "legal_basis": data["legal_basis"], "notes": data["notes"], "types": data["types"],
            "main_grade": user.school_grade, "grades": [{"id": f"grade{g}", "label": f"Lớp {g}"} for g in lc.GRADES],
            "resume": _resume(db, user)}
    if number is None:  # not at school (or no grade yet): the app asks which grade's lessons to show
        return {**base, "grade": None, "number": None, "label": GRADE_LABELS.get(user.school_grade or "", "Chưa chọn lớp"),
                "is_main": False, "subjects": [], "selection": None,
                "note": "Chọn một lớp để xem các môn và bài học của lớp đó."}
    subjects = lc.subjects_for(number)
    keys = [lesson["key"] for s in subjects for c in lc.chapters(s["code"], number) for lesson in c["lessons"]]
    states = _all_states(db, user.id, keys)
    pick = lc.electives(number)
    chosen = [c for c in chosen_subjects(user) if c in pick]
    out = []
    for s in subjects:
        chaps = lc.chapters(s["code"], number)
        lessons = [lesson for c in chaps for lesson in c["lessons"]]
        ready = [lesson for lesson in lessons if lesson["status"] == "ready"]
        status = "unsupported" if s["unsupported"] else "ready" if ready and len(ready) == len(lessons) \
            else "partial" if ready else "planned" if lessons else "empty"
        out.append({**s, "chapters": len(chaps), "lessons": len(lessons), "ready": len(ready),
                    "completed": sum(1 for lesson in ready if states[lesson["key"]]["status"] == "completed"),
                    "in_progress": sum(1 for lesson in ready if states[lesson["key"]]["status"] == "in_progress"),
                    "status": status, "selected": s["code"] in chosen if s["type"] == "elective" else None})
    selection = None
    if pick:
        selection = {"available": pick, "chosen": chosen, "count": data["elective_pick"]["count"],
                     "note": data["elective_pick"]["note"]}
    return {**base, "grade": f"grade{number}", "number": number, "label": f"Lớp {number}", "is_main": number == main,
            "subjects": out, "selection": selection, "note": None}


class Selection(BaseModel):
    subjects: list[str] = Field(max_length=9, description="THPT: the elective subjects studied (at most 4).")


@router.put("/programme/selection", summary="THPT: the elective subjects the learner studies (shown first)")
def save_selection(data: Selection, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    pick = set(lc.electives(10))
    count = lc.programme()["elective_pick"]["count"]
    chosen = list(dict.fromkeys(data.subjects))
    if any(code not in pick for code in chosen):
        raise APIError(422, "not_an_elective", "Only elective subjects of upper secondary school can be chosen")
    if len(chosen) > count:
        raise APIError(422, "too_many_electives", f"Choose at most {count} elective subjects")
    user.study_subjects = json.dumps(chosen)
    db.commit()
    return {"chosen": chosen}


def _subject_or_404(code: str, number: int) -> dict:
    found = next((s for s in lc.subjects_for(number) if s["code"] == code), None)
    if found is None:
        raise APIError(404, "subject_not_in_grade", "This subject is not taught in this grade")
    return found


@router.get("/programme/subjects/{code}", summary="The chapters and lessons of a subject at a grade, with progress")
def subject_lessons(code: str, grade: GradeId | None = Query(default=None), q: str | None = Query(default=None, max_length=60),
                    user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    number = viewed_grade(user, grade)
    if number is None:
        raise APIError(409, "grade_required", "Choose a grade first")
    subject = _subject_or_404(code, number)
    chaps = lc.chapters(code, number)
    keys = [lesson["key"] for c in chaps for lesson in c["lessons"]]
    states = _all_states(db, user.id, keys)
    needle = fold(q) if q else ""
    data = lc.catalog()["subjects"].get(code) or {}
    out = []
    for c in chaps:
        lessons = []
        for lesson in sorted(c["lessons"], key=lambda x: (x.get("order", 0), x["key"])):
            if needle and needle not in fold(f"{lesson['title']} {lesson['description']}"):
                continue
            entry = lc.lesson(lesson["key"])
            lessons.append({"key": lesson["key"], "title": lesson["title"], "description": lesson["description"],
                            "status": lesson["status"], "progress": states[lesson["key"]] if lesson["status"] == "ready" else None,
                            "games": [{"game": g["game"], "title": g["title"]} for g in lesson.get("games", [])],
                            "locked": lesson["status"] == "ready" and locked(entry, states), "requires_note": lesson.get("requires_note")})
        if lessons or not needle:
            out.append({"key": c["key"], "title": c["title"], "lessons": lessons})
    return {"subject": subject, "grade": f"grade{number}", "number": number, "label": f"Lớp {number}",
            "organization": data.get("organization", "topic"), "source_note": data.get("source_note"),
            "textbook": data.get("textbook"), "chapters": out}


def _entry_or_404(key: str) -> dict:
    entry = lc.lesson(key)
    if entry is None:
        raise APIError(404, "lesson_not_found", "Lesson not found")
    return entry


@router.get("/lesson-catalog/{key}", summary="One lesson: what is learned, a summary, its games and their progress")
def lesson_detail(key: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    entry = _entry_or_404(key)
    lesson = entry["lesson"]
    progress = game_progress(db, user.id, [key]).get(key, {})
    required = lesson.get("requires", [])
    states = _all_states(db, user.id, required + [key])
    codes = {lc.lesson_code(key, g["game"]): g["game"] for g in lesson.get("games", [])}
    ids = dict(db.execute(select(LearningLesson.code, LearningLesson.id).where(LearningLesson.code.in_(codes),
                                                                              LearningLesson.status == "published")).all()) if codes else {}
    reviews = dict(db.execute(select(LearningReviewItem.lesson_id, func.count()).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.status == "open",
        LearningReviewItem.lesson_id.in_(list(ids.values()))).group_by(LearningReviewItem.lesson_id)).all()) if ids else {}
    games = []
    for spec in lesson.get("games", []) if lesson["status"] == "ready" else []:
        code = lc.lesson_code(key, spec["game"])
        row = progress.get(spec["game"], {})
        games.append({"game": spec["game"], "title": spec["title"], "gameplay": lc.GAMES[spec["game"]]["name"],
                      "style": spec.get("style"), "turns": lc.turns_of(spec), "short_stage": lc.short_stage(spec),
                      "playable": code in ids, "review_count": reviews.get(ids.get(code), 0),
                      "progress": {"stages": row.get("stages", 0), "completed": row.get("completed", 0), "best": row.get("best"),
                                   "passed": row.get("passed", False), "last": row.get("last"), "open_session": row.get("open_session")}})
    following = lc.lesson(entry["next"]) if entry.get("next") else None
    review = lesson.get("review") or {"status": "draft"}
    return {"key": key, "title": lesson["title"], "description": lesson["description"], "status": lesson["status"],
            "grade": entry["grade"], "grade_id": f"grade{entry['grade']}", "grade_label": f"Lớp {entry['grade']}",
            "subject": {"code": entry["subject"], "name": lc.subject_name(entry["subject"], entry["grade"])},
            "chapter": {"key": entry["chapter"]["key"], "title": entry["chapter"]["title"]},
            "objectives": lesson.get("objectives", []), "summary": lesson.get("summary", []), "examples": lesson.get("examples", []),
            "review": {"status": review["status"], "label": lc.REVIEW_LABEL[review["status"]]},
            "source_note": entry["file"].get("source_note"), "content_version": entry["version"],
            "completion": lesson.get("completion") or DEFAULT_COMPLETION, "progress": states[key] if lesson["status"] == "ready" else None,
            "locked": locked(entry, states), "requires": [{"key": r, "title": lc.lesson(r)["lesson"]["title"],
                                                           "done": states[r]["status"] == "completed"} for r in required],
            "requires_note": lesson.get("requires_note"), "practice_note": (lc.subject_meta(entry["subject"]) or {}).get("practice_note"),
            "games": games,
            "next": {"key": following["lesson"]["key"], "title": following["lesson"]["title"],
                     "ready": following["lesson"]["status"] == "ready"} if following else None}


class LessonPlay(BaseModel):
    game: str = Field(max_length=20, description="One of the games the lesson publishes.")
    timezone: str = Field(default="UTC", max_length=80)


@router.post("/lesson-catalog/{key}/play", status_code=201, summary="Start a game of a lesson (created paused: 3-2-1 resumes it)")
def play_lesson(key: str, data: LessonPlay, idempotency_key: IdempotencyKey = None,
                user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """The backend checks that the game belongs to this lesson, the lesson to its subject and grade, and that it is
    ready and unlocked; the stage then draws only this lesson's content."""
    entry = _entry_or_404(key)
    if lc.offer(entry["subject"], entry["grade"]) is None:  # never happens with a valid catalog
        raise APIError(409, "lesson_not_available", "This lesson's subject is not taught in its grade")
    if entry["lesson"]["status"] != "ready":
        raise APIError(409, "lesson_not_ready", "This lesson is still being written")
    if lc.game_spec(entry, data.game) is None:
        raise APIError(422, "game_not_in_lesson", "This lesson has no such game")
    required = entry["lesson"].get("requires", [])
    if required and locked(entry, _all_states(db, user.id, required)):
        raise APIError(409, "lesson_locked", entry["lesson"].get("requires_note") or "Finish the earlier lesson first")
    lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == lc.lesson_code(key, data.game)))
    if lesson is None or lesson.status != "published":
        raise APIError(409, "lesson_not_published", "This game of the lesson is not published yet")
    variant = data.game if data.game in lc.VOCAB_GAMES else None
    s = create_session(db, user, lesson=lesson, mode="practice", duration_minutes=25, variant=variant,
                       device_zone=data.timezone, kind="lesson", idempotency_key=idempotency_key, start_paused=True)
    return session_out(db, s)
