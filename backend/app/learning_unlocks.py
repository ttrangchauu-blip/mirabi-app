"""Tự động mở khóa: a subject's chapters and lessons open on their own as the learner completes what is required.

The rules are the catalog's (lesson_catalog.unlock_path, checked for loops when the catalog loads):
- a grade's subject is a path of chapters (the map's areas), each a path of lessons (its points). The first chapter is
  open; the next one opens once every required lesson of the chapter before it is completed. In an open chapter the
  first lesson is open and each next one opens once the required lesson before it is completed (a `free` chapter
  opens all of its lessons with it). A lesson's `requires` adds prerequisites of its own (several branches);
- required: every ready lesson not marked `optional`, and in a lesson every game not marked `optional`. Optional
  content opens in its place but never holds anything back. A lesson still being written (`planned`) is never open and
  is skipped. A chapter with nothing required is never "completed", and never blocks the next one either;
- completed: lesson_api.lesson_state, read from the sessions: each required game passed by a completed stage with
  enough answers right at the first try (`completion.min_first_try`), checked by the backend on the stage's own items.
  Opening a game, leaving it or finishing its tutorial never counts.

What the rules open is stored (models.LearningUnlock) the first time, per school year, and never taken back: content
added later to a completed chapter does not close what was open. Storing is idempotent (a unique row per learner,
year and content), so a retried request or two devices never open anything twice. It happens in the transaction that
completes a stage (learning.complete_session), and again whenever the lessons are read, so a result lost on the way
(no network) is caught up on the next read. Each new unlock is celebrated once: it stays pending until the app says
it was shown (`POST /api/learning/unlocks/celebrated`).

Learners who studied before unlocks were stored keep what they studied open: on the first read of a subject in a
school year, every lesson up to the furthest one they had started stays open (`migration`, never celebrated).
Rules: docs/LEARNING_GAMES.md#tự-động-mở-khóa.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock, education, lesson_catalog as lc
from .db import get_db
from .errors import APIError
from .models import LearningUnlock, User, as_utc
from .security import current_user

router = APIRouter(prefix="/api/learning", tags=["learning"])

ContentStatus = Literal["LOCKED", "UNLOCKED", "IN_PROGRESS", "COMPLETED"]
STATUS_OF = {"not_started": "UNLOCKED", "in_progress": "IN_PROGRESS", "completed": "COMPLETED"}
COMING_SOON = "Bài học đang được biên soạn."
PENDING_LIMIT = 10


def _year_key(year: int | None) -> int:
    return year or 0


# ---------------------------------------------------------------------------------------------------------------
# The rules applied to a learner's progress (pure)
# ---------------------------------------------------------------------------------------------------------------

def evaluate(path: list[dict], states: dict[str, dict], stored: set[tuple[str, str]]) -> dict[str, dict]:
    """chapter or lesson key → its node: `open` (stored, or opened by the rules now), `rule` (the rules alone open
    it), `status` (LOCKED / UNLOCKED / IN_PROGRESS / COMPLETED) and `requirements` (each prerequisite, done or not)."""
    done = lambda key: states.get(key, {}).get("status") == "completed"
    titles = {x["key"]: x["title"] for c in path for x in c["lessons"]}
    out: dict[str, dict] = {}
    for c in path:
        gate = all(done(k) for k in c["needs"])
        chapter_open = ("chapter", c["key"]) in stored or gate
        required_done = sum(1 for k in c["required"] if done(k))
        complete = bool(c["required"]) and required_done == len(c["required"])
        started = any(states.get(x["key"], {}).get("status") in ("in_progress", "completed") for x in c["lessons"] if x["ready"])
        chapter_need = {"type": "chapter", "chapter_key": c["after"], "title": c["after_title"], "done": gate,
                        "remaining": sum(1 for k in c["needs"] if not done(k))} if c["after"] else None
        out[c["key"]] = {
            "type": "chapter", "key": c["key"], "title": c["title"], "open": chapter_open, "rule": gate,
            "status": "LOCKED" if not chapter_open else "COMPLETED" if complete else "IN_PROGRESS" if started else "UNLOCKED",
            "required_total": len(c["required"]), "required_completed": required_done,
            "requirements": [chapter_need] if chapter_need else [],
            "note": None if chapter_open else f"Hoàn thành chương “{c['after_title']}” để mở chương này."}
        for x in c["lessons"]:
            node = {"type": "lesson", "key": x["key"], "title": x["title"], "chapter_key": c["key"], "ready": x["ready"],
                    "required": x["required"]}
            if not x["ready"]:
                out[x["key"]] = {**node, "open": False, "rule": False, "status": "LOCKED",
                                 "requirements": [{"type": "content", "note": COMING_SOON}], "note": COMING_SOON}
                continue
            prior = list(dict.fromkeys(([x["after"]] if x["after"] else []) + x["requires"]))
            rule = chapter_open and all(done(k) for k in prior)
            is_open = ("lesson", x["key"]) in stored or rule
            requirements = ([chapter_need] if chapter_need and not chapter_open else []) + [
                {"type": "lesson", "lesson_id": k, "title": titles.get(k) or (lc.lesson(k) or {}).get("lesson", {}).get("title", k),
                 "done": done(k)} for k in prior]
            missing = [r for r in requirements if not r["done"]]
            note = None
            if not is_open:
                note = (out[c["key"]]["note"] if not chapter_open
                        else f"Hoàn thành {', '.join('“' + r['title'] + '”' for r in missing)} để mở bài này." if missing else None)
            out[x["key"]] = {**node, "open": is_open, "rule": rule, "requirements": requirements, "note": note,
                             "status": STATUS_OF[states.get(x["key"], {}).get("status", "not_started")] if is_open else "LOCKED"}
    return out


def _studied(path: list[dict], states: dict[str, dict]) -> set[tuple[str, str]]:
    """Before unlocks were stored every lesson was open: what a learner had started stays open, with every lesson
    before it (and their chapters), so nothing they could reach is closed."""
    ready = [(c["key"], x["key"]) for c in path for x in c["lessons"] if x["ready"]]
    started = [i for i, (_, key) in enumerate(ready) if states.get(key, {}).get("status", "not_started") != "not_started"]
    if not started:
        return set()
    out: set[tuple[str, str]] = set()
    for chapter, key in ready[:max(started) + 1]:
        out |= {("chapter", chapter), ("lesson", key)}
    return out


# ---------------------------------------------------------------------------------------------------------------
# Stored unlocks
# ---------------------------------------------------------------------------------------------------------------

def _stored(db: Session, user_id: int, subject: str, grade: int, year: int | None) -> list[LearningUnlock]:
    return list(db.scalars(select(LearningUnlock).where(
        LearningUnlock.user_id == user_id, LearningUnlock.academic_year == _year_key(year),
        LearningUnlock.subject == subject, LearningUnlock.grade == grade)))


def sync(db: Session, user_id: int, subject: str, grade: int, year: int | None, *, trigger: str | None = None,
         states: dict[str, dict] | None = None, now: datetime | None = None) -> dict[str, dict]:
    """Applies the rules to the learner's progress this school year and stores what they open (the caller commits).
    Returns every node of the subject (evaluate). Safe to run any number of times, concurrently too."""
    from .lesson_api import _all_states
    path = lc.unlock_path(subject, grade)
    if states is None:
        states = _all_states(db, user_id, [x["key"] for c in path for x in c["lessons"]], year)
    rows = _stored(db, user_id, subject, grade, year)
    stored = {(r.content_type, r.content_key) for r in rows}
    first = not rows  # the first read of this subject this year: what opens now is where the learner starts
    kept = _studied(path, states) if first else set()
    nodes = evaluate(path, states, stored | kept)
    now = now or clock.now()
    # An area with nothing to play yet opens quietly: there is nothing to celebrate or to go to.
    nothing_yet = {c["key"] for c in path if not any(x["ready"] for x in c["lessons"])}
    for node in nodes.values():
        if not node["open"] or (node["type"], node["key"]) in stored:
            continue
        if first:
            source = "start" if node["rule"] else "migration"
        else:
            source = "completed" if trigger else "progress"
        row = LearningUnlock(user_id=user_id, academic_year=_year_key(year), grade=grade, subject=subject,
                             content_type=node["type"], content_key=node["key"], source=source,
                             trigger_key=None if first else trigger, unlocked_at=now,
                             celebrated_at=now if first or node["key"] in nothing_yet else None)
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
        except IntegrityError:
            pass  # another request (a retry, another device) stored it first: it is open either way
    return nodes


def peek(db: Session, user_id: int, subject: str, grade: int, year: int | None, states: dict[str, dict]) -> dict[str, dict]:
    """The nodes as sync would see them, without storing anything (for reads that must not write)."""
    rows = _stored(db, user_id, subject, grade, year)
    path = lc.unlock_path(subject, grade)
    stored = {(r.content_type, r.content_key) for r in rows}
    return evaluate(path, states, stored | (_studied(path, states) if not rows else set()))


def is_open_stored(db: Session, user_id: int, year: int | None, lesson_key: str) -> bool:
    """Whether this lesson is open for the learner this school year and can be played now."""
    entry = lc.lesson(lesson_key)
    return entry is not None and entry["lesson"]["status"] == "ready" and db.scalar(select(LearningUnlock.id).where(
        LearningUnlock.user_id == user_id, LearningUnlock.academic_year == _year_key(year), LearningUnlock.content_type == "lesson",
        LearningUnlock.content_key == lesson_key)) is not None


def unlock_out(row: LearningUnlock) -> dict | None:
    """A stored unlock as the app shows it, with where "Khám phá ngay" leads (a chapter: its first open lesson)."""
    if row.content_type == "lesson":
        entry = lc.lesson(row.content_key)
        if entry is None or entry["lesson"]["status"] != "ready":  # withdrawn since: nothing to go to
            return None
        title, chapter, target = entry["lesson"]["title"], entry["chapter"], row.content_key
    else:
        chapter = next((c for c in lc.chapters(row.subject, row.grade) if c["key"] == row.content_key), None)
        if chapter is None:
            return None
        title = chapter["title"]
        target = next((x["key"] for x in sorted(chapter["lessons"], key=lc._order) if x["status"] == "ready"), None)
    return {"id": row.id, "type": row.content_type, "key": row.content_key, "title": title,
            "subject": row.subject, "subject_name": lc.subject_name(row.subject, row.grade), "grade": row.grade,
            "chapter_key": chapter["key"], "chapter_title": chapter["title"], "lesson": target,
            "source": row.source, "trigger": row.trigger_key, "unlocked_at": as_utc(row.unlocked_at).isoformat()}


def pending(db: Session, user_id: int, year: int | None, subject: str | None = None) -> list[dict]:
    """The unlocks not celebrated yet, newest first (chapters before their lessons)."""
    query = select(LearningUnlock).where(LearningUnlock.user_id == user_id, LearningUnlock.academic_year == _year_key(year),
                                         LearningUnlock.celebrated_at.is_(None))
    if subject is not None:
        query = query.where(LearningUnlock.subject == subject)
    rows = db.scalars(query.order_by(LearningUnlock.id.desc()).limit(PENDING_LIMIT))
    out = [found for r in rows if (found := unlock_out(r)) is not None]
    return sorted(out, key=lambda u: (u["type"] != "chapter", -u["id"]))


def after_stage(db: Session, user_id: int, lesson_key: str, year: int | None) -> None:
    """A stage of a lesson was completed (inside its transaction): store what that opened."""
    entry = lc.lesson(lesson_key)
    if entry is not None:
        sync(db, user_id, entry["subject"], entry["grade"], year, trigger=lesson_key)


# ---------------------------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------------------------

def _graded_learner(db: Session, user: User) -> tuple[int, int | None]:
    from .lesson_api import learner
    number, year = learner(db, user)
    if number is None:
        raise APIError(409, "grade_required", "This account has no school grade")
    return number, year


def map_of(db: Session, user: User, subject: str, number: int, year: int | None) -> dict:
    """A subject as a journey: its chapters (areas) and lessons (points) with their state, prerequisites, how far each
    one is, and its games (required or optional). Stores what the rules open first."""
    from .lesson_api import game_passed, game_progress, lesson_state
    path = lc.unlock_path(subject, number)
    keys = [x["key"] for c in path for x in c["lessons"]]
    progress = game_progress(db, user.id, keys, year)
    states = {k: lesson_state(lc.lesson(k), progress.get(k, {})) for k in keys}
    nodes = sync(db, user.id, subject, number, year, states=states)
    fresh = {(u["type"], u["key"]) for u in pending(db, user.id, year, subject)}
    chapters = []
    for c in path:
        lessons = []
        for x in c["lessons"]:
            node, entry = nodes[x["key"]], lc.lesson(x["key"])
            games = []
            for spec in entry["lesson"].get("games", []) if x["ready"] else []:
                row = progress.get(x["key"], {}).get(spec["game"], {})
                status = "LOCKED" if not node["open"] else "COMPLETED" if game_passed(spec, progress.get(x["key"], {})) \
                    else "IN_PROGRESS" if row.get("stages") or row.get("open_session") else "UNLOCKED"
                games.append({"game": spec["game"], "title": spec["title"], "required": not spec.get("optional", False),
                              "status": status})
            lessons.append({**{k: node[k] for k in ("key", "title", "status", "required", "ready", "requirements", "note")},
                            "percent": states[x["key"]]["percent"] if x["ready"] else 0,
                            "celebrate": ("lesson", x["key"]) in fresh, "games": games})
        node = nodes[c["key"]]
        chapters.append({**{k: node[k] for k in ("key", "title", "status", "required_total", "required_completed",
                                                 "requirements", "note")},
                         "progression": "free" if c["free"] else "sequential", "celebrate": ("chapter", c["key"]) in fresh,
                         "lessons": lessons})
    return {"chapters": chapters, "pending": pending(db, user.id, year, subject)}


@router.get("/unlock-map", responses=education.errors(*education.AUTH, (404, "subject_not_in_grade"), (409, "grade_required")),
            summary="A subject of the learner's grade as a journey map: chapters, lessons and games with their unlock state")
def unlock_map(subject: str = Query(max_length=30), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Every chapter and lesson of the subject this school year with `status` LOCKED / UNLOCKED / IN_PROGRESS /
    COMPLETED, what opens it (`requirements`), whether it is required, and `celebrate` while its unlock has not been
    celebrated yet. Nothing the app sends changes a state: they follow from the stages it completed."""
    from .lesson_api import _subject_or_404
    number, year = _graded_learner(db, user)
    found = _subject_or_404(subject, number)
    out = map_of(db, user, subject, number, year)
    db.commit()
    return {"subject": {"code": found["code"], "name": found["name"]}, "grade": f"grade{number}", "number": number,
            "academic_year": year, **out}


@router.post("/progress/sync", responses=education.errors(*education.AUTH, (409, "grade_required")),
             summary="Catch up the unlocks of the learner's grade (after a lost result) and list those not celebrated yet")
def sync_progress(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """The app calls this when it comes back online or after a result: the backend applies the rules again to the
    stages it has recorded (a body, if any, is ignored: the app never says what is completed or open) and returns the
    unlocks still to celebrate. Idempotent."""
    from .lesson_api import _all_states
    number, year = _graded_learner(db, user)
    subjects = [s["code"] for s in lc.subjects_for(number) if lc.chapters(s["code"], number)]
    paths = {code: lc.unlock_path(code, number) for code in subjects}
    states = _all_states(db, user.id, [x["key"] for p in paths.values() for c in p for x in c["lessons"]], year)
    for code in subjects:
        sync(db, user.id, code, number, year, states=states)
    db.commit()
    return {"academic_year": year, "unlocked": pending(db, user.id, year)}


class Celebrated(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=50, description="The unlocks whose animation was shown.")


@router.post("/unlocks/celebrated", summary="The unlock animation was shown: it does not come back (idempotent)")
def unlocks_celebrated(data: Celebrated, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    now = clock.now()
    db.execute(update(LearningUnlock).where(LearningUnlock.user_id == user.id, LearningUnlock.id.in_(data.ids),
                                            LearningUnlock.celebrated_at.is_(None)).values(celebrated_at=now))
    db.commit()
    return {"celebrated": sorted(set(data.ids))}
