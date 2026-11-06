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
import random
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from . import education, game_registry as gr, learning_unlocks as unlocks, lesson_catalog as lc, vocab_lesson
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


def learner(db: Session, user: User, grade: str | None = None) -> tuple[int | None, int | None]:
    """(grade number, school year) the content is for: always the stored ones, brought to the current school year
    first. A grade sent by the app is only accepted when it is that grade (older apps send it); anything else is
    refused, so a request can never switch grades. Finished years are read from Kho lưu trữ (education.py)."""
    profile = education.sync(db, user)
    education.check_requested_grade(user, grade)
    year = profile.academic_year if profile is not None and profile.status != "outside_school" else None
    return grade_number(user.school_grade), year


def own_lesson_or_403(user: User, entry: dict) -> None:
    """A lesson of another grade is not opened or played here (a finished year's lessons are, from Kho lưu trữ)."""
    if entry["grade"] != grade_number(user.school_grade):
        raise APIError(403, "grade_locked", education.GRADE_LOCKED)


def chosen_subjects(user: User) -> list[str]:
    try:
        value = json.loads(user.study_subjects or "[]")
    except ValueError:
        return []
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


# ---------------------------------------------------------------------------------------------------------------
# Progress, from the sessions (never from the app's numbers)
# ---------------------------------------------------------------------------------------------------------------

def _graded(item) -> bool:
    """Self-assessment questions (tự đánh giá) are never right or wrong: they count for nothing here."""
    if item.kind != "choice_explain":
        return True
    try:
        return json.loads(item.answer_json or "{}").get("graded", True)
    except ValueError:
        return True


def game_progress(db: Session, user_id: int, keys: list[str], academic_year: int | None = None) -> dict[str, dict[str, dict]]:
    """lesson key → game → {stages, completed, best, last{…}, passed_at}. Only lesson stages count (not review ones).
    With a school year, only that year's sessions (each year's progress is its own); reviews of a finished year
    played from Kho lưu trữ never count."""
    if not keys:
        return {}
    query = select(LearningSession).where(LearningSession.user_id == user_id, LearningSession.catalog_lesson.in_(keys),
                                          LearningSession.archive_year.is_(None))
    if academic_year is not None:
        query = query.where(LearningSession.academic_year == academic_year)
    sessions = list(db.scalars(query.order_by(LearningSession.id)))
    items: dict[int, list[LearningSessionItem]] = {}
    if sessions:
        # Only the columns progress needs (not prompts or answers of every turn).
        for item in db.execute(select(
                LearningSessionItem.session_id, LearningSessionItem.kind, LearningSessionItem.outcome,
                # The answer only where it says whether the question is graded (self-assessment).
                case((LearningSessionItem.kind == "choice_explain", LearningSessionItem.answer_json), else_=None).label("answer_json"),
                LearningSessionItem.attempts, LearningSessionItem.hints_used, LearningSessionItem.practice_of_id,
                LearningSessionItem.required).where(LearningSessionItem.session_id.in_([s.id for s in sessions]))):
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
            if not rules.get("words_review"):
                continue
        else:
            row["stages"] += 1
        own = [i for i in items.get(s.id, []) if i.practice_of_id is None and i.required]
        graded = [i for i in own if _graded(i)]
        first = sum(1 for i in graded if i.outcome == "first_try")
        share = first / len(graded) if graded else 1.0
        if s.kind == "review":  # a review of the lesson's own words with no new word left: the same bar, nothing else
            row["passed"] = row["passed"] or (s.status == "completed" and share >= need)
            continue
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


def game_passed(spec: dict, progress: dict[str, dict]) -> bool:
    """A game is passed by its own stages, or by the game it replaced or was added to (`credit_from`): a lesson that
    gets a dedicated gameplay never takes a completion back from the learners who completed it before."""
    return bool(progress.get(spec["game"], {}).get("passed")
                or (spec.get("credit_from") and progress.get(spec["credit_from"], {}).get("passed")))


def lesson_state(entry: dict, progress: dict[str, dict]) -> dict:
    """Completed: every required game passed (`completion.games: any`: one of them). An optional game is played and
    passed like the others but never holds the lesson back; a lesson always has a required game (lesson_catalog)."""
    lesson = entry["lesson"]
    every = lesson.get("games", []) if lesson["status"] == "ready" else []
    specs = [g for g in every if not g.get("optional", False)]
    games = [g["game"] for g in specs]
    rule = lesson.get("completion") or DEFAULT_COMPLETION
    passed = [g["game"] for g in specs if game_passed(g, progress)]
    done = bool(games) and (len(passed) == len(games) if rule.get("games", "all") == "all" else bool(passed))
    # Stages of a game a newer one replaced (credit_from) are a start too: the lesson was studied.
    started = any(progress.get(g, {}).get("stages") for g in [g["game"] for g in every] + [g["credit_from"] for g in every if g.get("credit_from")])
    status: LessonStatus = "completed" if done else "in_progress" if started else "not_started"
    total = len(games) if rule.get("games", "all") == "all" else min(1, len(games))
    return {"status": status, "label": STATUS_LABEL[status], "games_passed": len(passed), "games_total": total,
            "percent": 100 if done else round(100 * min(len(passed), total) / total) if total else 0}


def _all_states(db: Session, user_id: int, keys: list[str], academic_year: int | None = None) -> dict[str, dict]:
    progress = game_progress(db, user_id, keys, academic_year)
    return {k: lesson_state(lc.lesson(k), progress.get(k, {})) for k in keys}


# ---------------------------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------------------------

def _resume(db: Session, user: User, number: int | None, year: int | None) -> dict | None:
    """"Tiếp tục học": the lesson of the current grade and school year last practised (its game)."""
    if number is None:
        return None
    query = select(LearningSession).where(LearningSession.user_id == user.id, LearningSession.catalog_lesson.is_not(None),
                                          LearningSession.archive_year.is_(None), LearningSession.catalog_grade == number)
    if year is not None:
        query = query.where(LearningSession.academic_year == year)
    s = db.scalar(query.order_by(LearningSession.id.desc()).limit(1))
    entry = lc.lesson(s.catalog_lesson) if s is not None else None
    if entry is None or entry["lesson"]["status"] != "ready":
        return None
    game = (json.loads(s.scoring_json or "{}").get("lesson") or {}).get("game") or s.game
    spec = lc.game_spec(entry, game)
    return {"lesson": entry["lesson"]["key"], "title": entry["lesson"]["title"], "grade": entry["grade"],
            "grade_id": f"grade{entry['grade']}", "subject": entry["subject"], "subject_name": lc.subject_name(entry["subject"], entry["grade"]),
            "game": game if spec else None, "game_title": spec["title"] if spec else None,
            "open_session": s.id if s.status in OPEN else None}


@router.get("/programme", responses=education.errors(*education.AUTH, (403, "grade_locked")), summary="The subjects of the learner's current grade, with their lessons and progress this school year")
def programme(grade: GradeId | None = Query(default=None, description="Deprecated: only the current grade is accepted "
                                                                      "(403 grade_locked otherwise)."),
              user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    data = lc.programme()
    number, year = learner(db, user, grade)
    base = {"curriculum": data["name"], "legal_basis": data["legal_basis"], "notes": data["notes"], "types": data["types"],
            "main_grade": user.school_grade, "academic_year": year,
            "academic_year_label": education.year_label(year) if year is not None else None,
            "resume": _resume(db, user, number, year)}
    if number is None:  # no school grade (Sinh viên, Người đi làm, or not given yet): practice by level instead
        note = ("Học tập theo bài dành cho học sinh lớp 1–12. Bạn luyện tập bằng các trò chơi theo trình độ bên dưới."
                if user.school_grade else "Cho Mirabi biết lớp học của bạn để xem các môn và bài học của lớp.")
        return {**base, "grade": None, "number": None, "label": GRADE_LABELS.get(user.school_grade or "", "Chưa chọn lớp"),
                "is_main": False, "subjects": [], "selection": None, "note": note}
    subjects = lc.subjects_for(number)
    keys = [lesson["key"] for s in subjects for c in lc.chapters(s["code"], number) for lesson in c["lessons"]]
    states = _all_states(db, user.id, keys, year)
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
    return {**base, "grade": f"grade{number}", "number": number, "label": f"Lớp {number}", "is_main": True,
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


#: The order of a subject's lesson list: what is being studied, then what can be started, then what is done (still
#: open for review), then what cannot be opened yet. Within a group, the curriculum's chapter then lesson order.
LESSON_GROUPS = ("in_progress", "unlocked", "completed", "locked")
COMING_SOON = "Bài học đang được biên soạn."


def lock_note(lesson: dict, node: dict) -> str | None:
    """Why a lesson is locked: its own explanation of its prerequisite while that is what is missing, else the rule's."""
    if node["open"]:
        return None
    own = any(r["type"] == "lesson" and not r["done"] and r["lesson_id"] in lesson.get("requires", []) for r in node["requirements"])
    return (lesson.get("requires_note") if own else None) or node["note"]


def lesson_card(entry: dict, states: dict[str, dict], node: dict, *, subject: str, number: int, year: int | None,
                chapter_order: int, lesson_order: int, celebrate: bool = False) -> dict:
    """One lesson of a subject's list, as the backend decides it for this learner and school year. Being open
    (`unlock_status`, learning_unlocks.py) and being done (`progress_status`) are separate: a lesson is locked while it
    is still being written or until what opens it is completed this school year; the app never sends either."""
    lesson = entry["lesson"]
    ready = lesson["status"] == "ready"
    state = states[lesson["key"]] if ready else None
    is_locked = not node["open"]
    progress_status = state["status"] if state else "not_started"
    group = "locked" if is_locked else {"not_started": "unlocked"}.get(progress_status, progress_status)
    return {
        "lesson_id": lesson["key"], "subject_id": subject, "grade_id": f"grade{number}", "academic_year": year,
        "chapter_key": entry["chapter"]["key"], "chapter_title": entry["chapter"]["title"],
        "chapter_order": chapter_order, "lesson_order": lesson_order,
        "unlock_status": "locked" if is_locked else "unlocked", "progress_status": progress_status,
        "content_status": node["status"], "required": node["required"], "celebrate": celebrate,
        "progress_percent": state["percent"] if state else 0, "unlock_requirements": node["requirements"],
        "unlock_note": lock_note(lesson, node), "group": group,
        # The fields of before, kept for older apps.
        "key": lesson["key"], "title": lesson["title"], "description": lesson["description"], "status": lesson["status"],
        "progress": state, "games": [{"game": g["game"], "title": g["title"]} for g in lesson.get("games", [])],
        "locked": ready and is_locked, "requires_note": lesson.get("requires_note"),
    }


def sort_lessons(cards: list[dict]) -> list[dict]:
    """Đang học → Đã mở → Đã hoàn thành → Chưa mở; within each, chapter then lesson order (never ids or dates)."""
    return sorted(cards, key=lambda c: (LESSON_GROUPS.index(c["group"]), c["chapter_order"], c["lesson_order"]))


@router.get("/programme/subjects/{code}", responses=education.errors(*education.AUTH, (403, "grade_locked"), (404, "subject_not_in_grade"), (409, "grade_required")), summary="The chapters and lessons of a subject at a grade, with progress")
def subject_lessons(code: str, grade: GradeId | None = Query(default=None, description="Deprecated: only the current grade."),
                    q: str | None = Query(default=None, max_length=60),
                    user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """The lessons of a subject at the learner's grade, this school year: by chapter (`chapters`) and as one list sorted
    by the learner's state (`lessons`, see sort_lessons), with the subject's progress (lessons completed / ready)."""
    number, year = learner(db, user, grade)
    if number is None:
        raise APIError(409, "grade_required", "This account has no school grade")
    subject = _subject_or_404(code, number)
    chaps = lc.chapters(code, number)
    keys = [lesson["key"] for c in chaps for lesson in c["lessons"]]
    states = _all_states(db, user.id, keys, year)
    nodes = unlocks.sync(db, user.id, code, number, year, states=states)  # what the rules open now is stored first
    db.commit()
    fresh = unlocks.pending(db, user.id, year, code)
    celebrate = {(u["type"], u["key"]) for u in fresh}
    needle = fold(q) if q else ""
    data = lc.catalog()["subjects"].get(code) or {}
    out = []
    cards: list[dict] = []
    for ci, c in enumerate(chaps, start=1):
        lessons = []
        for li, lesson in enumerate(sorted(c["lessons"], key=lambda x: (x.get("order", 0), x["key"])), start=1):
            if needle and needle not in fold(f"{lesson['title']} {lesson['description']}"):
                continue
            card = lesson_card(lc.lesson(lesson["key"]), states, nodes[lesson["key"]], subject=code, number=number, year=year,
                               chapter_order=ci, lesson_order=li, celebrate=("lesson", lesson["key"]) in celebrate)
            lessons.append(card)
            cards.append(card)
        if lessons or not needle:
            node = nodes[c["key"]]
            out.append({"key": c["key"], "title": c["title"], "order": ci, "lessons": lessons,
                        "unlock_status": "unlocked" if node["open"] else "locked", "content_status": node["status"],
                        "required_total": node["required_total"], "required_completed": node["required_completed"],
                        "unlock_requirements": node["requirements"], "unlock_note": node["note"],
                        "celebrate": ("chapter", c["key"]) in celebrate})
    ready = [k for k in keys if lc.lesson(k)["lesson"]["status"] == "ready"]
    completed = sum(1 for k in ready if states[k]["status"] == "completed")
    return {"subject": subject, "grade": f"grade{number}", "number": number, "label": f"Lớp {number}", "unlocked": fresh,
            "academic_year": year, "academic_year_label": education.year_label(year) if year is not None else None,
            "organization": data.get("organization", "topic"), "source_note": data.get("source_note"),
            "textbook": data.get("textbook"), "chapters": out, "lessons": sort_lessons(cards),
            "progress": {"completed": completed, "ready": len(ready), "total": len(keys),
                         "percent": round(100 * completed / len(ready)) if ready else 0}}


def _entry_or_404(key: str) -> dict:
    entry = lc.lesson(key)
    if entry is None:
        raise APIError(404, "lesson_not_found", "Lesson not found")
    return entry


def _unlock_node(db: Session, user: User, entry: dict, year: int | None) -> dict:
    """Whether a lesson is open for this learner this school year (learning_unlocks), its subject's unlocks stored first."""
    nodes = unlocks.sync(db, user.id, entry["subject"], entry["grade"], year)
    db.commit()
    return nodes[entry["lesson"]["key"]]


@router.get("/gameplays", responses=education.errors(*education.AUTH), summary="The game definitions: every gameplay, what the learner does in it, and whether it is built")
def gameplays(user: User = Depends(current_user)) -> dict:
    """The game definition table (game_registry.py): each gameplay's family (two of one family play the same way), its
    interaction, grades, world, turn kind, status (ready / planned) and the learning activities it is made for. The
    lessons that use each one: docs/GAME_AUDIT.md."""
    return {"gameplays": gr.definitions(),
            "activities": [{"code": code, "label": a["label"], "best": list(a["best"]), "fits": list(a["fits"])}
                           for code, a in gr.ACTIVITIES.items()]}


@router.get("/lesson-catalog/{key}", responses=education.errors(*education.AUTH, (403, "grade_locked"), (404, "lesson_not_found")), summary="One lesson: what is learned, a summary, its games and their progress")
def lesson_detail(key: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    entry = _entry_or_404(key)
    _, year = learner(db, user)
    own_lesson_or_403(user, entry)
    lesson = entry["lesson"]
    progress = game_progress(db, user.id, [key], year).get(key, {})
    required = lesson.get("requires", [])
    node = _unlock_node(db, user, entry, year)
    states = _all_states(db, user.id, required + [key], year)
    codes = {lc.lesson_code(key, g["game"]): g["game"] for g in lesson.get("games", [])}
    ids = dict(db.execute(select(LearningLesson.code, LearningLesson.id).where(LearningLesson.code.in_(codes),
                                                                              LearningLesson.status == "published")).all()) if codes else {}
    reviews = dict(db.execute(select(LearningReviewItem.lesson_id, func.count()).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.status == "open",
        LearningReviewItem.lesson_id.in_(list(ids.values()))).group_by(LearningReviewItem.lesson_id)).all()) if ids else {}
    games = []
    # Khám phá từ mới (vocab_lesson.py): the lesson's own words, then new words beyond them, per game.
    vocab_specs = [g for g in lesson.get("games", []) if g["game"] in lc.VOCAB_GAMES] if lesson["status"] == "ready" else []
    explore = vocab_lesson.status(db, user, key, list(dict.fromkeys(w for g in vocab_specs for w in g["words"]))) \
        if vocab_specs else {}
    for spec in lesson.get("games", []) if lesson["status"] == "ready" else []:
        code = lc.lesson_code(key, spec["game"])
        row = progress.get(spec["game"], {})
        found = explore.get(spec["game"])
        turns = found["next_stage_words"] if found else lc.turns_of(spec)
        gameplay = gr.GAMEPLAYS[spec["game"]]
        passed = game_passed(spec, progress)
        games.append({"game": spec["game"], "title": spec["title"], "gameplay": lc.GAMES[spec["game"]]["name"],
                      "required": not spec.get("optional", False),
                      "status": "LOCKED" if not node["open"] else "COMPLETED" if passed
                      else "IN_PROGRESS" if row.get("stages") or row.get("open_session") else "UNLOCKED",
                      "family": gameplay["family"], "interaction": gameplay["interaction"],
                      "style": spec.get("style"), "turns": turns,
                      "short_stage": 0 < turns < lc.VOCAB_FULL_STAGE if found else lc.short_stage(spec), "explore": found,
                      "playable": code in ids, "review_count": reviews.get(ids.get(code), 0),
                      "progress": {"stages": row.get("stages", 0), "completed": row.get("completed", 0), "best": row.get("best"),
                                   "passed": passed, "last": row.get("last"), "open_session": row.get("open_session")}})
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
            # Open or not is learning_unlocks' (the lesson before it, its chapter, its own prerequisites).
            "locked": lesson["status"] == "ready" and not node["open"], "content_status": node["status"],
            "required": node["required"], "unlock_requirements": node["requirements"], "unlock_note": node["note"],
            "requires": [{"key": r["lesson_id"], "title": r["title"], "done": r["done"]}
                         for r in node["requirements"] if r["type"] == "lesson"],
            "requires_note": lock_note(lesson, node) or lesson.get("requires_note"),
            "practice_note": (lc.subject_meta(entry["subject"]) or {}).get("practice_note"),
            "games": games,
            "next": {"key": following["lesson"]["key"], "title": following["lesson"]["title"],
                     "ready": following["lesson"]["status"] == "ready"} if following else None}


class LessonPlay(BaseModel):
    game: str = Field(max_length=20, description="One of the games the lesson publishes.")
    timezone: str = Field(default="UTC", max_length=80)


@router.post("/lesson-catalog/{key}/play", status_code=201, responses=education.errors(*education.AUTH, (403, "grade_locked"), (404, "lesson_not_found"), (409, "lesson_locked"), (409, "lesson_not_ready"), (409, "lesson_not_published"), (409, "open_session_exists"), (409, "vocabulary_exhausted"), (422, "game_not_in_lesson")), summary="Start a game of a lesson (created paused: 3-2-1 resumes it)")
def play_lesson(key: str, data: LessonPlay, idempotency_key: IdempotencyKey = None,
                user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """The backend checks that the game belongs to this lesson, the lesson to its subject and grade, and that it is
    ready and unlocked; the stage then draws only this lesson's content. A vocabulary game draws the lesson's own words
    first, then new words beyond them (vocab_lesson.py). With no new word left: once the game is passed it does not
    start (409 vocabulary_exhausted: the app offers Ôn tập); before that, it is a review of the lesson's own words
    (`catalog.words_review`), which can pass the game, as nothing else could any more."""
    entry = _entry_or_404(key)
    _, year = learner(db, user)
    own_lesson_or_403(user, entry)
    if lc.offer(entry["subject"], entry["grade"]) is None:  # never happens with a valid catalog
        raise APIError(409, "lesson_not_available", "This lesson's subject is not taught in its grade")
    if entry["lesson"]["status"] != "ready":
        raise APIError(409, "lesson_not_ready", "This lesson is still being written")
    if lc.game_spec(entry, data.game) is None:
        raise APIError(422, "game_not_in_lesson", "This lesson has no such game")
    node = _unlock_node(db, user, entry, year)
    if not node["open"]:
        raise APIError(409, "lesson_locked", lock_note(entry["lesson"], node) or "Finish the earlier lesson first")
    lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == lc.lesson_code(key, data.game)))
    if lesson is None or lesson.status != "published":
        raise APIError(409, "lesson_not_published", "This game of the lesson is not published yet")
    variant = data.game if data.game in lc.VOCAB_GAMES else None
    start = lambda **more: create_session(db, user, lesson=lesson, mode="practice", duration_minutes=25, variant=variant,
                                          device_zone=data.timezone, idempotency_key=idempotency_key, start_paused=True, **more)
    try:
        s = start(kind="lesson")
    except APIError as e:
        spec = lc.game_spec(entry, data.game)
        if e.code != "vocabulary_exhausted" or game_passed(spec, game_progress(db, user.id, [key], year).get(key, {})):
            raise
        words = random.sample(spec["words"], len(spec["words"]))  # a review stage holds at most 12 of them
        prefix = f"{lesson.code}.{'spell.' if data.game == 'word_shooter' else ''}"
        s = start(kind="review", review_keys=[prefix + word for word in words], words_review=True)
    return session_out(db, s)
