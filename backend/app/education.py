"""School grade, school years and Kho lưu trữ học tập (docs/LEARNING_ARCHIVE.md).

The grade is confirmed once, at registration (or the first time an older account gives it), and is then locked: Học
tập has no grade picker, the content APIs use the grade and school year stored here and refuse another one, and only
the verified support workflow (admin endpoints below) can correct it. Each region's school years come from
academic_year_configs (seeded from data/academic_calendar.json, editable by an administrator): on a year's promotion
date the learner moves up one grade. The move is made by `sync`, which runs on login, on every Học tập read and from a
background sweep, so a learner who does not open the app on that day, or for years, is still brought to the right
grade the next time; the skipped years are closed with whatever was really learned in them (nothing is made up).

Closing a year freezes it (learning_year_archives + archived_learning_results + archived_learning_notes) before the
grade changes, in one transaction. The yearly history row is unique per user and school year and the profile update is
a compare-and-set on the year, so a retry, a second device or a second worker never promotes twice. Kho lưu trữ shows
the three most recent finished years; reviewing one plays the old lessons' games as kind "archive" sessions that never
change the frozen snapshot nor the current year's progress.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock, lesson_catalog as lc
from .config import settings
from .db import SessionLocal, get_db
from .errors import APIError
from .models import (AcademicCalendarChange, AcademicYearConfig, ArchivedLearningNote, ArchivedLearningResult, CurriculumVersion,
                     GradePromotion, LearningLesson, LearningLevel, LearningNote, LearningReviewItem, LearningSession, LearningSessionItem,
                     LearningSubject, LearningYearArchive, User, UserEducationProfile, as_utc)
from .security import admin_user, current_user
from .study_profile import GRADE_LABELS, GradeId

log = logging.getLogger("refmi.education")
router = APIRouter(prefix="/api/education", tags=["education"])
admin_router = APIRouter(prefix="/api/admin/education", tags=["education-admin"])

CALENDAR_FILE = Path(__file__).parent / "data" / "academic_calendar.json"
SNAPSHOT_VERSION = 1
# The grades a learner moves through at school, in order. Sinh viên / Người đi làm have no grade and never move.
SCHOOL_GRADES = ("preschool",) + tuple(f"grade{n}" for n in range(1, 13))
OUTSIDE_SCHOOL = ("university", "adult")
YEARLY_KINDS = ("promotion", "repeat", "completed")
CELEBRATED_KINDS = ("promotion", "completed")
NOTE_LIMIT = 500  # per kind and year: the most recent words / mistakes of a year are kept
STATUS_LABEL = {"studying": "Đang học", "completed": "Đã hoàn thành chương trình", "outside_school": "Học tự do"}
GRADE_LOCKED = ("The school grade is set at registration and only changes with a new school year. "
                "Finished years are in the learning archive.")


class _LostRace(Exception):
    """Another request closed the same school year first."""


# ---------------------------------------------------------------------------------------------------------------
# School years
# ---------------------------------------------------------------------------------------------------------------

@lru_cache(maxsize=1)
def calendar_file() -> dict:
    return json.loads(CALENDAR_FILE.read_text(encoding="utf-8"))


def regions() -> dict[str, dict]:
    return calendar_file()["regions"]


def year_label(year: int) -> str:
    return f"{year}–{year + 1}"


def grade_label(grade: str | None) -> str:
    return GRADE_LABELS.get(grade or "", "")


def grade_number(grade: str | None) -> int | None:
    return int(grade[5:]) if grade and grade.startswith("grade") else None


def region_zone(region: str) -> ZoneInfo:
    try:
        return ZoneInfo(regions().get(region, {}).get("timezone") or settings.login_streak_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo(settings.login_streak_timezone)


def local_today(region: str, now: datetime | None = None) -> date:
    return as_utc(now or clock.now()).astimezone(region_zone(region)).date()


def expected_start(db: Session | None, region: str, year: int) -> date:
    """When school year `year` is expected to start, to name the school year a day belongs to: the configured row
    (verified or not), else ACADEMIC_YEAR_EXPECTED_START. Never used to promote anyone (see verified_start)."""
    if db is not None:
        found = db.scalar(select(AcademicYearConfig.promotion_date).where(AcademicYearConfig.region == region,
                                                                           AcademicYearConfig.academic_year == year))
        if found is not None:
            return found
    month, day = (int(x) for x in settings.academic_year_expected_start.split("-"))
    return date(year, month, day)


def verified_start(db: Session, region: str, year: int) -> date | None:
    """The official promotion day of school year `year`, only once an administrator has verified it against the
    decision that sets it. None otherwise: nobody is promoted on a guessed date."""
    return db.scalar(select(AcademicYearConfig.promotion_date).where(
        AcademicYearConfig.region == region, AcademicYearConfig.academic_year == year, AcademicYearConfig.verified.is_(True)))


def school_year_of(db: Session | None, region: str, day: date) -> int:
    """The school year a day belongs to, as a label (registration, the header): from one start to the day before the
    next. Promotion uses verified dates only (target_year)."""
    return day.year if day >= expected_start(db, region, day.year) else day.year - 1


def year_config(db: Session, region: str, year: int) -> dict:
    row = db.scalar(select(AcademicYearConfig).where(AcademicYearConfig.region == region, AcademicYearConfig.academic_year == year))
    if row is not None:
        return {"region": region, "academic_year": year, "label": year_label(year), "configured": True,
                "school_start_date": row.school_start_date.isoformat(),
                "opening_date": row.opening_date.isoformat() if row.opening_date else None,
                "promotion_date": row.promotion_date.isoformat(), "end_date": row.end_date.isoformat() if row.end_date else None,
                "source": row.source, "decision_number": row.decision_number, "verified": row.verified,
                "verified_at": as_utc(row.verified_at).isoformat() if row.verified_at else None, "verified_by": row.verified_by,
                "updated_by": row.updated_by, "updated_at": as_utc(row.updated_at).isoformat() if row.updated_at else None}
    return {"region": region, "academic_year": year, "label": year_label(year), "configured": False, "school_start_date": None,
            "opening_date": None, "promotion_date": None, "end_date": None, "source": None, "decision_number": None,
            "verified": False, "verified_at": None, "verified_by": None, "updated_by": None, "updated_at": None,
            "expected_start": expected_start(None, region, year).isoformat()}


def seed_calendar(db: Session) -> None:
    """Adds the years listed in data/academic_calendar.json that are not in the table yet (none are bundled: real dates
    are entered and verified by an administrator). Existing rows are never overwritten."""
    for code, region in regions().items():
        have = set(db.scalars(select(AcademicYearConfig.academic_year).where(AcademicYearConfig.region == code)))
        for y in region.get("years", []):
            if y["academic_year"] in have:
                continue
            db.add(AcademicYearConfig(
                region=code, academic_year=y["academic_year"], timezone=region["timezone"],
                school_start_date=date.fromisoformat(y["school_start_date"]),
                opening_date=date.fromisoformat(y["opening_date"]) if y.get("opening_date") else None,
                promotion_date=date.fromisoformat(y["promotion_date"]),
                end_date=date.fromisoformat(y["end_date"]) if y.get("end_date") else None,
                source=y.get("source"), decision_number=y.get("decision_number"), verified=False))


# ---------------------------------------------------------------------------------------------------------------
# The profile
# ---------------------------------------------------------------------------------------------------------------

def next_grade(grade: str) -> str | None:
    """The grade after this one; None after the last grade of the programme (or outside school)."""
    if grade not in SCHOOL_GRADES:
        return None
    i = SCHOOL_GRADES.index(grade)
    return SCHOOL_GRADES[i + 1] if i + 1 < len(SCHOOL_GRADES) else None


def level_grade(code: str) -> int | None:
    """The school grade a lesson's level is made for (Math: grade3; catalog and curriculum games: g3), or None for a
    level that is not one grade's (vocabulary "auto", informatics "basic"...)."""
    found = re.fullmatch(r"g(?:rade)?(\d{1,2})", code)
    return int(found.group(1)) if found else None


def _status_for(grade: str) -> str:
    return "outside_school" if grade in OUTSIDE_SCHOOL else "studying"


def check_region(region: str | None) -> str:
    region = region or settings.education_default_region
    if region not in regions():
        raise APIError(422, "unknown_region", "This education region is not supported")
    return region


def enroll(db: Session, user: User, grade: str, region: str | None = None, *, kind: str = "enrollment",
           reason: str | None = None) -> UserEducationProfile:
    """Locks the confirmed grade at the current school year. The caller commits."""
    region = check_region(region)
    now = clock.now()
    today = local_today(region, now)
    year = school_year_of(db, region, today)
    profile = UserEducationProfile(user_id=user.id, initial_grade=grade, current_grade=grade, academic_year=year,
                                   enrollment_date=today, education_region=region, status=_status_for(grade), locked_at=now,
                                   created_at=now, updated_at=now)
    db.add(profile)
    user.school_grade = grade
    db.add(GradePromotion(user_id=user.id, kind=kind, academic_year=year, from_grade=None, to_grade=grade, reason=reason,
                          celebrated_at=now))
    # What was played before the grade was given belongs to this year.
    if profile.status != "outside_school":
        db.execute(update(LearningSession).where(LearningSession.user_id == user.id, LearningSession.academic_year.is_(None),
                                                 LearningSession.archive_year.is_(None)).values(academic_year=year))
    db.flush()
    return profile


def profile_of(db: Session, user: User) -> UserEducationProfile | None:
    """The learner's profile; an account with a grade but no profile yet (older data) gets one, locked, now."""
    profile = db.get(UserEducationProfile, user.id)
    if profile is None and user.school_grade:
        try:
            with db.begin_nested():
                profile = enroll(db, user, user.school_grade, kind="migration",
                                 reason="Grade given before grades were locked")
            db.commit()
        except IntegrityError:  # created by a concurrent request
            profile = db.get(UserEducationProfile, user.id)
    return profile


def learning_year(db: Session, user_id: int) -> int | None:
    """The school year new learning sessions belong to (None outside school)."""
    profile = db.get(UserEducationProfile, user_id)
    return profile.academic_year if profile is not None and profile.status != "outside_school" else None


def check_requested_grade(user: User, grade: str | None) -> None:
    """The content APIs never take a grade from the app: only the current one is accepted (older apps send it)."""
    if grade is not None and grade != user.school_grade:
        raise APIError(403, "grade_locked", GRADE_LOCKED)


# ---------------------------------------------------------------------------------------------------------------
# Promotion
# ---------------------------------------------------------------------------------------------------------------

def target_year(db: Session, profile: UserEducationProfile, now: datetime | None = None) -> int:
    """The school year the learner should be in: each next year counts only once its verified promotion day has come
    (Asia/Ho_Chi_Minh for VN). An unverified or missing year stops here: the grade stays and admins are told."""
    region = profile.education_region
    day = local_today(region, now)
    year = profile.academic_year
    while (start := verified_start(db, region, year + 1)) is not None and day >= start:
        year += 1
    return year


def awaiting_calendar(db: Session, profile: UserEducationProfile, now: datetime | None = None) -> int | None:
    """The school year that has (by its expected date) begun but cannot promote the learner because its dates are not
    verified yet; None when nothing waits."""
    if profile.status != "studying":
        return None
    region = profile.education_region
    reached = target_year(db, profile, now)
    labelled = school_year_of(db, region, local_today(region, now))
    return reached + 1 if labelled > reached else None


def game_in_progress(db: Session, profile: UserEducationProfile, now: datetime) -> LearningSession | None:
    """A stage of the closing year still being played: the promotion waits until it ends (or is abandoned as stale)."""
    stale = now - timedelta(hours=settings.learning_expire_hours)
    s = db.scalar(select(LearningSession).where(LearningSession.user_id == profile.user_id,
                                                LearningSession.status.in_(("active", "paused")),
                                                LearningSession.academic_year == profile.academic_year))
    return s if s is not None and as_utc(s.updated_at) > stale else None


def sync(db: Session, user: User, *, now: datetime | None = None) -> UserEducationProfile | None:
    """Brings the learner to the current school year, one closed year at a time. Idempotent and safe to call from any
    request; it commits when it changes something. Call it before the request's own changes."""
    profile = profile_of(db, user)
    if profile is None or profile.status != "studying":
        return profile
    now = now or clock.now()
    target = target_year(db, profile, now)
    while profile.academic_year < target:
        if game_in_progress(db, profile, now) is not None:
            break  # finish the stage first; the next request (or the sweep) promotes
        year = profile.academic_year
        try:
            _close_year(db, profile.user_id, year, now)
            db.commit()
        except (_LostRace, IntegrityError):
            db.rollback()
        db.refresh(profile)
        db.refresh(user)
        if profile.academic_year == year:  # nothing moved (should not happen): never loop
            log.error("School year %s of user %s could not be closed", year, user.id)
            break
        if profile.status != "studying":
            break
    return profile


def _close_year(db: Session, user_id: int, old_year: int, now: datetime, *, actor_id: int | None = None,
                reason: str | None = None) -> None:
    """Freezes school year `old_year`, then moves the learner into the next one. Raises _LostRace or IntegrityError
    when another request closed it first (the caller rolls back). The profile row is locked (PostgreSQL) and re-read,
    so only the year the caller saw is ever closed."""
    fresh = db.scalar(select(UserEducationProfile).where(UserEducationProfile.user_id == user_id)
                      .with_for_update().execution_options(populate_existing=True))
    if fresh is None or fresh.academic_year != old_year or fresh.status != "studying":
        raise _LostRace()
    old_grade = fresh.current_grade
    archive = snapshot_year(db, fresh.user_id, old_year, old_grade, fresh.education_region, now)
    after = next_grade(old_grade)
    if fresh.hold_next_promotion:
        new_grade, kind, status, reason = old_grade, "repeat", "studying", "Học lại lớp theo yêu cầu đã xác minh"
    elif after is None:
        new_grade, kind, status, reason = old_grade, "completed", "completed", "Hoàn thành chương trình"
    else:
        new_grade, kind, status, reason = after, "promotion", "studying", reason
    db.add(GradePromotion(user_id=fresh.user_id, kind=kind, academic_year=old_year + 1, from_grade=old_grade, to_grade=new_grade,
                          skipped=not archive.had_activity, archive_id=archive.id, reason=reason, actor_id=actor_id, created_at=now,
                          celebrated_at=None if kind in CELEBRATED_KINDS else now))
    db.flush()  # the unique (user, year) index refuses a second promotion here
    moved = db.execute(update(UserEducationProfile).where(UserEducationProfile.user_id == fresh.user_id,
                                                          UserEducationProfile.academic_year == old_year)
                       .values(academic_year=old_year + 1, current_grade=new_grade, status=status, hold_next_promotion=False,
                               version=UserEducationProfile.version + 1, updated_at=now))
    if moved.rowcount != 1:
        raise _LostRace()
    db.execute(update(User).where(User.id == fresh.user_id).values(school_grade=new_grade))
    if new_grade != old_grade:
        _archive_old_grade_reviews(db, fresh.user_id, grade_number(new_grade))
    log.info("User %s: %s %s -> %s %s (%s)", fresh.user_id, old_grade, year_label(old_year), new_grade, year_label(old_year + 1), kind)


def _archive_old_grade_reviews(db: Session, user_id: int, new_grade: int | None) -> None:
    """"Cần ôn" holds what can still be practised at the learner's grade: the questions of lessons made for another
    grade leave it (they stay in the frozen year's `mistakes`). The word bank's belong to no grade, and stay."""
    rows = db.execute(select(LearningReviewItem, LearningLevel.code).join(LearningLesson, LearningLesson.id == LearningReviewItem.lesson_id)
                      .join(LearningLevel, LearningLevel.id == LearningLesson.level_id)
                      .where(LearningReviewItem.user_id == user_id, LearningReviewItem.status == "open")).all()
    for row, level in rows:
        needed = level_grade(level)
        if needed is not None and needed != new_grade:
            row.status = "archived"


def sweep(now: datetime | None = None) -> int:
    """Background job: brings every learner whose school year has ended to the new one, then applies the retention
    policy. Safe with several workers (every promotion is idempotent). Returns how many learners moved."""
    moved = 0
    with SessionLocal() as db:
        due: list[int] = []
        for region in {r for (r,) in db.execute(select(UserEducationProfile.education_region).distinct())}:
            day = local_today(region, now)
            due += list(db.scalars(select(UserEducationProfile.user_id).where(
                UserEducationProfile.education_region == region, UserEducationProfile.status == "studying",
                UserEducationProfile.academic_year < school_year_of(db, region, day))))
    for user_id in due:
        with SessionLocal() as db:
            user = db.get(User, user_id)
            if user is None:
                continue
            before = db.get(UserEducationProfile, user_id).academic_year
            try:
                profile = sync(db, user, now=now)
            except Exception:
                log.exception("Promotion of user %s failed", user_id)
                continue
            moved += int(profile is not None and profile.academic_year != before)
    with SessionLocal() as db:
        for alert in calendar_alerts(db, now):
            log.warning("School calendar %s %s is not verified: %s learners wait (%s)", alert["region"],
                        alert["label"], alert["waiting"], alert["level"])
        purge_expired_archives(db, now)
        db.commit()
    return moved


ALERT_AHEAD_DAYS = 45


def calendar_alerts(db: Session, now: datetime | None = None) -> list[dict]:
    """What the administrators must do: a school year whose dates are not verified while it has begun (`overdue`:
    learners keep their grade until it is verified) or begins within ALERT_AHEAD_DAYS (`upcoming`)."""
    alerts = []
    used = {r for (r,) in db.execute(select(UserEducationProfile.education_region).distinct())} | set(regions())
    for region in sorted(used):
        day = local_today(region, now)
        labelled = school_year_of(db, region, day)
        for year in (labelled, labelled + 1):
            if verified_start(db, region, year) is not None:
                continue
            start = expected_start(db, region, year)
            if year == labelled + 1 and (start - day).days > ALERT_AHEAD_DAYS:
                continue
            waiting = db.scalar(select(func.count()).select_from(UserEducationProfile).where(
                UserEducationProfile.education_region == region, UserEducationProfile.status == "studying",
                UserEducationProfile.academic_year < year)) or 0
            config = year_config(db, region, year)
            alerts.append({"region": region, "academic_year": year, "label": year_label(year),
                           "level": "overdue" if day >= start else "upcoming", "expected_start": start.isoformat(),
                           "configured": config["configured"], "waiting": waiting})
    return alerts


# ---------------------------------------------------------------------------------------------------------------
# Freezing a year
# ---------------------------------------------------------------------------------------------------------------

def curriculum_version(db: Session) -> CurriculumVersion | None:
    try:
        lessons = lc.catalog()["lessons"]
    except lc.ContentError:
        return None
    digest = hashlib.sha256(json.dumps(sorted((k, e["version"]) for k, e in lessons.items())).encode()).hexdigest()[:16]
    found = db.scalar(select(CurriculumVersion).where(CurriculumVersion.curriculum == "GDPT2018", CurriculumVersion.version_hash == digest))
    if found is None:
        try:
            with db.begin_nested():
                found = CurriculumVersion(curriculum="GDPT2018", version_hash=digest, lessons=len(lessons))
                db.add(found)
        except IntegrityError:
            found = db.scalar(select(CurriculumVersion).where(CurriculumVersion.curriculum == "GDPT2018",
                                                              CurriculumVersion.version_hash == digest))
    return found


def _knowledge(entry: dict) -> dict:
    lesson = entry["lesson"]
    return {"key": lesson["key"], "title": lesson["title"], "description": lesson.get("description"), "grade": entry["grade"],
            "subject": entry["subject"], "subject_name": lc.subject_name(entry["subject"], entry["grade"]),
            "chapter": entry["chapter"]["title"], "objectives": lesson.get("objectives", []), "summary": lesson.get("summary", []),
            "examples": lesson.get("examples", []), "content_version": entry["version"]}


def grade_lessons(number: int | None) -> list[tuple[dict, dict, dict]]:
    """(subject, chapter, lesson) of every lesson of a grade, in the programme's order."""
    if number is None:
        return []
    try:
        return [(s, c, lesson) for s in lc.subjects_for(number) for c in lc.chapters(s["code"], number) for lesson in c["lessons"]]
    except lc.ContentError:
        return []


def snapshot_year(db: Session, user_id: int, year: int, grade: str, region: str, now: datetime) -> LearningYearArchive:
    """learning_year_archives + results + notes for one school year, from what was really played in it."""
    from .learning import REVIEW_REASONS, correct_answer_text
    from .lesson_api import game_progress, lesson_state
    number = grade_number(grade)
    sessions = list(db.scalars(select(LearningSession).where(LearningSession.user_id == user_id, LearningSession.academic_year == year,
                                                             LearningSession.archive_year.is_(None)).order_by(LearningSession.id)))
    rows = grade_lessons(number)
    keys = [lesson["key"] for _, _, lesson in rows]
    progress = game_progress(db, user_id, keys, academic_year=year) if keys else {}
    subjects: dict[str, dict] = {}
    ready = completed = 0
    for subject, chapter, lesson in rows:
        entry = lc.lesson(lesson["key"])
        state = lesson_state(entry, progress.get(lesson["key"], {})) if lesson["status"] == "ready" else None
        s = subjects.setdefault(subject["code"], {"code": subject["code"], "name": subject["name"], "type": subject["type"],
                                                  "icon": subject["icon"], "bg": subject["bg"], "color": subject["color"],
                                                  "chapters": [], "lessons": 0, "ready": 0, "completed": 0, "started": 0})
        if not s["chapters"] or s["chapters"][-1]["key"] != chapter["key"]:
            s["chapters"].append({"key": chapter["key"], "title": chapter["title"], "lessons": []})
        s["chapters"][-1]["lessons"].append({"key": lesson["key"], "title": lesson["title"], "status": lesson["status"],
                                             "content_version": entry["version"] if entry else None,
                                             "progress": state})
        s["lessons"] += 1
        if lesson["status"] == "ready":
            s["ready"] += 1
            ready += 1
        if state and state["status"] == "completed":
            s["completed"] += 1
            completed += 1
        if state and state["status"] != "not_started":
            s["started"] += 1
    codes = dict(db.execute(select(LearningSubject.id, LearningSubject.code)).all())
    items = list(db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id.in_([s.id for s in sessions]))
                            .order_by(LearningSessionItem.id))) if sessions else []
    by_session = {s.id: s for s in sessions}
    graded = [i for i in items if i.practice_of_id is None and i.required and i.outcome is not None]
    zone = region_zone(region)
    stats = {"sessions": len(sessions), "stages_completed": sum(1 for s in sessions if s.status == "completed" and s.kind == "lesson"),
             "active_minutes": round(sum(s.active_ms or 0 for s in sessions) / 60000), "score": sum(s.score or 0 for s in sessions),
             "exp": sum(s.reward_exp or 0 for s in sessions),
             "days_active": len({as_utc(s.started_at).astimezone(zone).date() for s in sessions}),
             "answers": len(graded), "first_try": sum(1 for i in graded if i.outcome == "first_try"),
             "lessons_total": len(rows), "lessons_ready": ready, "lessons_completed": completed,
             "percent": round(100 * completed / ready) if ready else 0}
    stats["accuracy"] = round(100 * stats["first_try"] / stats["answers"]) if stats["answers"] else None
    version = curriculum_version(db)
    archive = LearningYearArchive(user_id=user_id, academic_year=year, grade=grade, region=region,
                                  curriculum_version_id=version.id if version else None, snapshot_version=SNAPSHOT_VERSION,
                                  had_activity=bool(sessions), summary_json=json.dumps(list(subjects.values()), ensure_ascii=False),
                                  stats_json=json.dumps(stats), created_at=now)
    db.add(archive)
    db.flush()  # the unique (user, year) refuses a second snapshot of the same year
    for key, games in progress.items():
        entry = lc.lesson(key)
        for game, row in games.items():
            db.add(ArchivedLearningResult(archive_id=archive.id, subject=entry["subject"] if entry else "", lesson_key=key, game=game,
                                          content_version=(row.get("last") or {}).get("content_version") or (entry or {}).get("version"),
                                          stages=row["stages"], completed=row["completed"], best=row["best"], passed=row["passed"],
                                          detail_json=json.dumps({"last": row.get("last"), "reviews": row.get("reviews", 0)})))
    free: dict[str, dict] = {}
    for s in sessions:
        if s.catalog_lesson or s.kind != "lesson":
            continue
        row = free.setdefault(s.game or s.game_type, {"subject": codes.get(s.subject_id, ""), "stages": 0, "completed": 0, "best": 0})
        row["stages"] += 1
        row["completed"] += int(s.status == "completed")
        row["best"] = max(row["best"], s.score or 0)
    for game, row in free.items():
        db.add(ArchivedLearningResult(archive_id=archive.id, subject=row["subject"], lesson_key="", game=game, stages=row["stages"],
                                      completed=row["completed"], best_score=row["best"]))
    for key, games in progress.items():  # the lessons studied that year, as they read then
        entry = lc.lesson(key)
        if entry is not None and any(g["stages"] or g["reviews"] for g in games.values()):
            db.add(ArchivedLearningNote(archive_id=archive.id, kind="knowledge", note_key=key[:120], subject=entry["subject"],
                                        payload_json=json.dumps(_knowledge(entry), ensure_ascii=False)))
    words: dict[str, dict] = {}
    mistakes: dict[str, dict] = {}
    for item in reversed(graded):  # most recent first
        session = by_session[item.session_id]
        answer = json.loads(item.answer_json or "{}")
        if answer.get("entry_key") and answer["entry_key"] not in words and len(words) < NOTE_LIMIT:
            words[answer["entry_key"]] = {"word": answer.get("display"), "meaning_vi": answer.get("meaning_vi"),
                                          "phonetic": answer.get("phonetic"), "part_of_speech": answer.get("part_of_speech"),
                                          "example_en": answer.get("example_en"), "example_vi": answer.get("example_vi"),
                                          "outcome": item.outcome}
        if item.outcome in REVIEW_REASONS and item.question_key not in mistakes and len(mistakes) < NOTE_LIMIT:
            try:
                right = correct_answer_text(item)
            except (KeyError, TypeError, ValueError):
                right = None
            mistakes[item.question_key] = {"label": item.skill_label, "answer": right, "reason": item.outcome,
                                           "subject": codes.get(session.subject_id), "lesson": session.catalog_lesson}
    for key, payload in words.items():
        db.add(ArchivedLearningNote(archive_id=archive.id, kind="vocab", note_key=key[:120], subject="english",
                                    payload_json=json.dumps(payload, ensure_ascii=False)))
    for key, payload in mistakes.items():
        db.add(ArchivedLearningNote(archive_id=archive.id, kind="mistake", note_key=key[:120], subject=payload["subject"],
                                    payload_json=json.dumps(payload, ensure_ascii=False)))
    db.flush()
    return archive


def visible_archives(db: Session, user_id: int, current_year: int) -> list[LearningYearArchive]:
    """Kho lưu trữ: the most recent finished years (never the current one), at most learning_archive_visible_years."""
    return list(db.scalars(select(LearningYearArchive).where(LearningYearArchive.user_id == user_id,
                                                             LearningYearArchive.academic_year < current_year)
                           .order_by(LearningYearArchive.academic_year.desc()).limit(settings.learning_archive_visible_years)))


def purge_expired_archives(db: Session, now: datetime | None = None) -> int:
    """Deletes archives older than the configured retention (0 keeps them). Only the archive tables are touched:
    accounts, pets, EXP, achievements and the learning sessions other features read are never deleted here."""
    years = settings.learning_archive_retention_years
    if years <= 0:
        return 0
    region = settings.education_default_region
    cutoff = school_year_of(db, region, local_today(region, now)) - years
    ids = list(db.scalars(select(LearningYearArchive.id).where(LearningYearArchive.academic_year < cutoff)))
    if not ids:
        return 0
    db.execute(delete(ArchivedLearningResult).where(ArchivedLearningResult.archive_id.in_(ids)))
    db.execute(delete(ArchivedLearningNote).where(ArchivedLearningNote.archive_id.in_(ids)))
    db.execute(update(GradePromotion).where(GradePromotion.archive_id.in_(ids)).values(archive_id=None))
    db.execute(delete(LearningYearArchive).where(LearningYearArchive.id.in_(ids)))
    log.info("Deleted %d learning archives older than %s", len(ids), year_label(cutoff))
    return len(ids)


# ---------------------------------------------------------------------------------------------------------------
# What the app shows
# ---------------------------------------------------------------------------------------------------------------

def year_progress(db: Session, user_id: int, grade: str, year: int) -> dict:
    from .lesson_api import _all_states
    keys = [lesson["key"] for _, _, lesson in grade_lessons(grade_number(grade)) if lesson["status"] == "ready"]
    states = _all_states(db, user_id, keys, academic_year=year) if keys else {}
    done = sum(1 for s in states.values() if s["status"] == "completed")
    started = sum(1 for s in states.values() if s["status"] == "in_progress")
    return {"lessons_ready": len(keys), "lessons_completed": done, "lessons_in_progress": started,
            "percent": round(100 * done / len(keys)) if keys else 0}


def _celebration(row: GradePromotion | None) -> dict | None:
    if row is None:
        return None
    label = grade_label(row.to_grade)
    message = (f"Chúc mừng! Bạn đã hoàn thành chương trình {label}!" if row.kind == "completed"
               else f"Chúc mừng! Bạn đã lên {label.lower() if label.startswith('Lớp') else label}!")
    return {"id": row.id, "kind": row.kind, "grade": row.to_grade, "grade_label": label, "from_grade": row.from_grade,
            "academic_year": row.academic_year, "academic_year_label": year_label(row.academic_year), "message": message}


def state(db: Session, user: User) -> dict:
    profile = sync(db, user)
    if profile is None:
        return {"enrolled": False, "locked": False, "grade": user.school_grade, "grade_label": grade_label(user.school_grade),
                "academic_year": None, "academic_year_label": None, "status": None, "celebration": None, "archives": 0,
                "progress": None, "next_promotion": None, "promotion_pending": False, "awaiting_calendar": False}
    now = clock.now()
    region = profile.education_region
    current = profile.academic_year
    pending = None
    if profile.status == "studying":
        pending = db.scalar(select(GradePromotion).where(GradePromotion.user_id == user.id, GradePromotion.kind.in_(CELEBRATED_KINDS),
                                                         GradePromotion.celebrated_at.is_(None)).order_by(GradePromotion.id.desc()).limit(1))
    elif profile.status == "completed":
        pending = db.scalar(select(GradePromotion).where(GradePromotion.user_id == user.id, GradePromotion.kind == "completed",
                                                         GradePromotion.celebrated_at.is_(None)).limit(1))
    following = next_grade(profile.current_grade)
    next_promotion = None
    if profile.status == "studying":
        confirmed = verified_start(db, region, current + 1)
        next_promotion = {"academic_year": current + 1, "academic_year_label": year_label(current + 1),
                          # Only a verified day is announced: before that the date is not known for sure.
                          "date": confirmed.isoformat() if confirmed else None, "confirmed": confirmed is not None,
                          "to_grade": profile.current_grade if profile.hold_next_promotion else following,
                          "to_grade_label": grade_label(profile.current_grade if profile.hold_next_promotion else following) or None,
                          "completes": following is None and not profile.hold_next_promotion}
    return {"enrolled": True, "locked": True, "grade": profile.current_grade, "grade_label": grade_label(profile.current_grade),
            "initial_grade": profile.initial_grade, "academic_year": current, "academic_year_label": year_label(current),
            "region": region, "region_name": regions().get(region, {}).get("name", region), "status": profile.status,
            "status_label": STATUS_LABEL[profile.status], "enrollment_date": profile.enrollment_date.isoformat(),
            "calendar": year_config(db, region, current),
            "progress": year_progress(db, user.id, profile.current_grade, current) if profile.status != "outside_school" else None,
            "promotion_pending": profile.status == "studying" and target_year(db, profile, now) > current,
            # A new school year has begun but its calendar is not verified yet: the grade stays until it is.
            "awaiting_calendar": awaiting_calendar(db, profile, now) is not None,
            "next_promotion": next_promotion, "celebration": _celebration(pending),
            "archives": len(visible_archives(db, user.id, current)),
            "support_note": "Lớp học được xác định khi đăng ký và tự lên lớp vào ngày bắt đầu năm học mới. "
                            "Nếu lớp chưa đúng, hãy liên hệ hỗ trợ để được xác minh và điều chỉnh."}


def archive_card(a: LearningYearArchive) -> dict:
    stats = json.loads(a.stats_json)
    subjects = json.loads(a.summary_json)
    return {"academic_year": a.academic_year, "academic_year_label": year_label(a.academic_year), "grade": a.grade,
            "grade_label": grade_label(a.grade), "subjects": len(subjects), "lessons_completed": stats.get("lessons_completed", 0),
            "lessons_ready": stats.get("lessons_ready", 0), "percent": stats.get("percent", 0), "had_activity": a.had_activity,
            "archived_at": as_utc(a.created_at).isoformat()}


def _owned_archive(db: Session, user: User, year: int) -> LearningYearArchive:
    """Only the owner's archives, and only those Kho lưu trữ shows (older ones are kept but not offered)."""
    profile = profile_of(db, user)
    if profile is None:
        raise APIError(404, "archive_not_found", "No such archived school year")
    found = next((a for a in visible_archives(db, user.id, profile.academic_year) if a.academic_year == year), None)
    if found is None:
        raise APIError(404, "archive_not_found", "No such archived school year")
    return found


def _notes(db: Session, archive_id: int, kind: str) -> list[dict]:
    return [{"key": n.note_key, "subject": n.subject, **json.loads(n.payload_json)} for n in db.scalars(
        select(ArchivedLearningNote).where(ArchivedLearningNote.archive_id == archive_id, ArchivedLearningNote.kind == kind)
        .order_by(ArchivedLearningNote.id))]


def _reviews(db: Session, user_id: int, year: int, lesson_key: str | None = None, game: str | None = None) -> dict:
    """The reviews of a finished year played from Kho lưu trữ: stored apart from the frozen results. With a lesson, its
    own; with a game too, that game's."""
    query = select(LearningSession).where(LearningSession.user_id == user_id, LearningSession.archive_year == year)
    if lesson_key:
        query = query.where(LearningSession.catalog_lesson == lesson_key)
    rows = list(db.scalars(query.order_by(LearningSession.id.desc())))
    if game:
        rows = [s for s in rows if (json.loads(s.scoring_json or "{}").get("lesson") or {}).get("game", s.game) == game]
    done = [s for s in rows if s.status == "completed"]
    last = rows[0] if rows else None
    return {"stages": len(rows), "completed": len(done), "best_score": max((s.score for s in done), default=None),
            "last": {"session_id": last.id, "status": last.status, "game": last.game, "score": last.score,
                     "at": as_utc(last.started_at).isoformat()} if last else None,
            "open_session": next((s.id for s in rows if s.status in ("active", "paused")), None)}


# ---------------------------------------------------------------------------------------------------------------
# Response schemas and documented errors (docs/learning-openapi.json)
# ---------------------------------------------------------------------------------------------------------------

class ErrorOut(BaseModel):
    detail: str
    code: str


def errors(*codes: tuple[int, str]) -> dict:
    """OpenAPI `responses` listing the error codes an endpoint can answer (body: {detail, code})."""
    by_status: dict[int, list[str]] = {}
    for status, code in codes:
        by_status.setdefault(status, []).append(code)
    return {status: {"model": ErrorOut, "description": "code: " + " | ".join(found)} for status, found in by_status.items()}


AUTH = ((401, "not_authenticated"), (401, "invalid_token"), (401, "token_expired"))
ADMIN = AUTH + ((403, "admin_required"),)


class CelebrationOut(BaseModel):
    id: int
    kind: Literal["promotion", "completed"]
    grade: str
    grade_label: str
    from_grade: str | None
    academic_year: int
    academic_year_label: str
    message: str


class NextPromotionOut(BaseModel):
    academic_year: int
    academic_year_label: str
    date: str | None = Field(description="The verified promotion day; null until the school year's calendar is verified.")
    confirmed: bool
    to_grade: str | None
    to_grade_label: str | None
    completes: bool


class YearProgressOut(BaseModel):
    lessons_ready: int
    lessons_completed: int
    lessons_in_progress: int
    percent: int


class EducationStateOut(BaseModel):
    enrolled: bool
    locked: bool
    grade: str | None
    grade_label: str
    initial_grade: str | None = None
    academic_year: int | None
    academic_year_label: str | None
    region: str | None = None
    region_name: str | None = None
    status: Literal["studying", "completed", "outside_school"] | None
    status_label: str | None = None
    enrollment_date: str | None = None
    progress: YearProgressOut | None
    promotion_pending: bool = Field(description="A verified new school year has begun; a stage being played finishes first.")
    awaiting_calendar: bool = Field(description="A new school year has begun but its calendar is not verified: the grade stays.")
    next_promotion: NextPromotionOut | None
    celebration: CelebrationOut | None
    archives: int
    support_note: str | None = None


class ArchiveCardOut(BaseModel):
    academic_year: int
    academic_year_label: str
    grade: str
    grade_label: str
    subjects: int
    lessons_completed: int
    lessons_ready: int
    percent: int
    had_activity: bool
    archived_at: str


class ArchivesOut(BaseModel):
    visible_years: int
    items: list[ArchiveCardOut]


class CurrentCalendarOut(BaseModel):
    region: str
    region_name: str
    today: str
    academic_year: int
    academic_year_label: str
    verified: bool = Field(description="The current school year's dates are verified.")


# ---------------------------------------------------------------------------------------------------------------
# Routes: the learner
# ---------------------------------------------------------------------------------------------------------------

@router.get("", response_model=EducationStateOut, responses=errors(*AUTH),
            summary="The learner's grade, school year, progress and a pending 'lên lớp' celebration")
def get_state(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Runs the promotion check first, so an app that was offline (or closed for years) gets the right grade."""
    return state(db, user)


@router.post("/celebrations/{promotion_id}/seen", responses=errors(*AUTH, (404, "celebration_not_found")),
             summary="The celebration was shown (once per promotion, every device)")
def celebration_seen(promotion_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    row = db.get(GradePromotion, promotion_id)
    if row is None or row.user_id != user.id:
        raise APIError(404, "celebration_not_found", "No such promotion")
    db.execute(update(GradePromotion).where(GradePromotion.user_id == user.id, GradePromotion.id <= promotion_id,
                                            GradePromotion.celebrated_at.is_(None)).values(celebrated_at=clock.now()))
    db.commit()
    return {"seen": True}


@router.get("/calendar/current", response_model=CurrentCalendarOut, responses=errors((422, "unknown_region")),
            summary="Public: the school year now (registration says which year's grade to give)")
def current_calendar(region: str | None = Query(default=None, max_length=8), db: Session = Depends(get_db)) -> dict:
    region = check_region(region)
    today = local_today(region)
    year = school_year_of(db, region, today)
    return {"region": region, "region_name": regions()[region]["name"], "today": today.isoformat(), "academic_year": year,
            "academic_year_label": year_label(year), "verified": verified_start(db, region, year) is not None}


@router.get("/archives", response_model=ArchivesOut, responses=errors(*AUTH),
            summary="Kho lưu trữ học tập: the finished school years (the three most recent)")
def list_archives(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = sync(db, user)
    items = [archive_card(a) for a in visible_archives(db, user.id, profile.academic_year)] if profile else []
    return {"visible_years": settings.learning_archive_visible_years, "items": items}


@router.get("/archives/{year}", responses=errors(*AUTH, (404, "archive_not_found")),
            summary="One finished school year: its subjects, results, words, mistakes, knowledge and notes (owner only)")
def archive_detail(year: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    sync(db, user)
    a = _owned_archive(db, user, year)
    results = list(db.scalars(select(ArchivedLearningResult).where(ArchivedLearningResult.archive_id == a.id)
                              .order_by(ArchivedLearningResult.id)))
    knowledge = _notes(db, a.id, "knowledge")
    return {**archive_card(a), "snapshot_version": a.snapshot_version, "stats": json.loads(a.stats_json),
            "subjects": json.loads(a.summary_json),
            "free_practice": [{"game": r.game, "subject": r.subject, "stages": r.stages, "completed": r.completed,
                               "best_score": r.best_score} for r in results if not r.lesson_key],
            "lesson_results": [{"lesson": r.lesson_key, "game": r.game, "subject": r.subject, "stages": r.stages, "completed": r.completed,
                                "best": r.best, "passed": r.passed, "content_version": r.content_version} for r in results if r.lesson_key],
            "knowledge": [{"key": k["key"], "title": k["title"], "subject": k["subject"], "subject_name": k.get("subject_name"),
                           "chapter": k.get("chapter")} for k in knowledge],
            "vocabulary": _notes(db, a.id, "vocab"), "mistakes": _notes(db, a.id, "mistake"),
            "notes": [note_out(n) for n in _user_notes(db, user.id, year)],
            "reviews": _reviews(db, user.id, year), "read_only": True}


@router.get("/archives/{year}/lessons/{key}", responses=errors(*AUTH, (404, "archive_not_found"), (404, "lesson_not_found")),
            summary="Read a lesson of a finished year again (as it was studied)")
def archive_lesson(year: int, key: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    from .lesson_api import DEFAULT_COMPLETION
    from .models import LearningLesson
    a = _owned_archive(db, user, year)
    frozen = next((n for n in _notes(db, a.id, "knowledge") if n["key"] == key), None)
    entry = lc.lesson(key)
    if frozen is None and (entry is None or entry["grade"] != grade_number(a.grade)):
        raise APIError(404, "lesson_not_found", "This lesson is not part of that school year")
    content = frozen or _knowledge(entry)
    results = [{"game": r.game, "stages": r.stages, "completed": r.completed, "best": r.best, "passed": r.passed}
               for r in db.scalars(select(ArchivedLearningResult).where(ArchivedLearningResult.archive_id == a.id,
                                                                       ArchivedLearningResult.lesson_key == key))]
    games = []
    if entry is not None and entry["lesson"]["status"] == "ready" and entry["grade"] == grade_number(a.grade):
        codes = {lc.lesson_code(key, g["game"]): g for g in entry["lesson"].get("games", [])}
        published = set(db.scalars(select(LearningLesson.code).where(LearningLesson.code.in_(codes), LearningLesson.status == "published")))
        games = [{"game": g["game"], "title": g["title"], "gameplay": lc.GAMES[g["game"]]["name"], "playable": code in published,
                  "review": _reviews(db, user.id, year, key, g["game"])} for code, g in codes.items()]
    return {**content, "academic_year": year, "academic_year_label": year_label(year), "grade_label": grade_label(a.grade),
            "frozen": frozen is not None, "current_content_version": entry["version"] if entry else None,
            "results": results, "games": games, "completion": (entry["lesson"].get("completion") if entry else None) or DEFAULT_COMPLETION,
            "read_only": True}


class ArchivePlay(BaseModel):
    game: str = Field(max_length=20)
    timezone: str = Field(default="UTC", max_length=80)


@router.post("/archives/{year}/lessons/{key}/play", status_code=201,
             responses=errors(*AUTH, (404, "archive_not_found"), (404, "lesson_not_found"), (409, "lesson_not_published"),
                              (409, "open_session_exists"), (422, "game_not_in_lesson")),
             summary="Review a finished year's lesson with its game (kept apart: the year's results never change)")
def archive_play(year: int, key: str, data: ArchivePlay,
                 idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9_-]{8,64}$")] = None,
                 user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    from .learning import create_session, session_out
    from .models import LearningLesson
    a = _owned_archive(db, user, year)
    entry = lc.lesson(key)
    if entry is None or entry["grade"] != grade_number(a.grade):
        raise APIError(404, "lesson_not_found", "This lesson is not part of that school year")
    if entry["lesson"]["status"] != "ready" or lc.game_spec(entry, data.game) is None:
        raise APIError(422, "game_not_in_lesson", "This lesson has no such game")
    lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == lc.lesson_code(key, data.game)))
    if lesson is None or lesson.status != "published":
        raise APIError(409, "lesson_not_published", "This game of the lesson is not published yet")
    variant = data.game if data.game in lc.VOCAB_GAMES else None
    s = create_session(db, user, lesson=lesson, mode="practice", duration_minutes=25, variant=variant, device_zone=data.timezone,
                       kind="archive", idempotency_key=idempotency_key, start_paused=True, archive_year=year)
    return session_out(db, s)


@router.get("/notebook", responses=errors(*AUTH), summary="Sổ tay kiến thức, tóm tắt tự động: the lessons studied this school year")
def notebook(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = sync(db, user)
    if profile is None or profile.status == "outside_school":
        return {"academic_year": None, "academic_year_label": None, "grade_label": grade_label(user.school_grade), "entries": []}
    keys = list(dict.fromkeys(db.scalars(select(LearningSession.catalog_lesson).where(
        LearningSession.user_id == user.id, LearningSession.academic_year == profile.academic_year,
        LearningSession.archive_year.is_(None), LearningSession.catalog_lesson.is_not(None)).order_by(LearningSession.id.desc()))))
    entries = [_knowledge(e) for e in (lc.lesson(k) for k in keys) if e is not None and e["grade"] == grade_number(profile.current_grade)]
    return {"academic_year": profile.academic_year, "academic_year_label": year_label(profile.academic_year),
            "grade_label": grade_label(profile.current_grade), "entries": entries}


# ---------------------------------------------------------------------------------------------------------------
# Routes: Sổ tay kiến thức, ghi chú cá nhân
# ---------------------------------------------------------------------------------------------------------------

class NoteInput(BaseModel):
    title: str = Field(default="", max_length=120)
    body: str = Field(min_length=1, max_length=5000)
    subject: str = Field(min_length=1, max_length=30, description="A subject of the note's grade (lesson catalog code).")
    lesson_key: str | None = Field(default=None, max_length=60, description="Optional: a lesson of that subject and grade.")


class NoteOut(BaseModel):
    id: int
    academic_year: int | None
    academic_year_label: str | None
    grade: str | None
    grade_label: str
    subject: str
    subject_name: str
    lesson_key: str | None
    lesson_title: str | None
    title: str
    body: str
    created_at: str
    updated_at: str


class NotesOut(BaseModel):
    items: list[NoteOut]
    total: int


def note_out(n: LearningNote) -> dict:
    number = grade_number(n.grade)
    entry = lc.lesson(n.lesson_key) if n.lesson_key else None
    return {"id": n.id, "academic_year": n.academic_year, "academic_year_label": year_label(n.academic_year) if n.academic_year else None,
            "grade": n.grade, "grade_label": grade_label(n.grade), "subject": n.subject,
            "subject_name": lc.subject_name(n.subject, number) if lc.subject_meta(n.subject) else n.subject,
            "lesson_key": n.lesson_key, "lesson_title": entry["lesson"]["title"] if entry else None,
            "title": n.title, "body": n.body, "created_at": as_utc(n.created_at).isoformat(), "updated_at": as_utc(n.updated_at).isoformat()}


def _user_notes(db: Session, user_id: int, year: int | None = None) -> list[LearningNote]:
    query = select(LearningNote).where(LearningNote.user_id == user_id)
    if year is not None:
        query = query.where(LearningNote.academic_year == year)
    return list(db.scalars(query.order_by(LearningNote.updated_at.desc(), LearningNote.id.desc())))


def _check_note_link(grade: str | None, subject: str, lesson_key: str | None) -> None:
    number = grade_number(grade)
    try:
        known = any(s["code"] == subject for s in lc.subjects_for(number)) if number else lc.subject_meta(subject) is not None
    except lc.ContentError:
        known = False
    if not known:
        raise APIError(422, "note_subject_invalid", "This subject is not taught in the note's grade")
    if lesson_key:
        entry = lc.lesson(lesson_key)
        if entry is None or entry["subject"] != subject or entry["grade"] != number:
            raise APIError(422, "note_lesson_invalid", "This lesson is not a lesson of that subject and grade")


def _own_note(db: Session, user: User, note_id: int) -> LearningNote:
    note = db.get(LearningNote, note_id)
    if note is None or note.user_id != user.id:
        raise APIError(404, "note_not_found", "No such note")
    return note


def _clean(data: NoteInput) -> tuple[str, str]:
    title, body = data.title.strip(), data.body.strip()
    if not body:
        raise APIError(422, "note_empty", "A note needs some text")
    return title, body


@router.get("/notes", response_model=NotesOut, responses=errors(*AUTH),
            summary="Ghi chú cá nhân: the learner's notes, newest first, with search (accents and case ignored)")
def list_notes(q: str | None = Query(default=None, max_length=80), academic_year: int | None = Query(default=None),
               subject: str | None = Query(default=None, max_length=30), lesson_key: str | None = Query(default=None, max_length=60),
               user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    from .learning_history import fold
    needle = fold(q) if q else ""
    items = [n for n in _user_notes(db, user.id, academic_year)
             if (subject is None or n.subject == subject) and (lesson_key is None or n.lesson_key == lesson_key)
             and (not needle or needle in fold(f"{n.title} {n.body}"))]
    return {"items": [note_out(n) for n in items], "total": len(items)}


@router.post("/notes", status_code=201, response_model=NoteOut,
             responses=errors(*AUTH, (422, "note_subject_invalid"), (422, "note_lesson_invalid"), (422, "note_empty")),
             summary="Write a note for the current school year (its grade), on a subject and optionally a lesson")
def create_note(data: NoteInput, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    profile = sync(db, user)
    at_school = profile is not None and profile.status != "outside_school"
    grade = profile.current_grade if at_school else None
    _check_note_link(grade, data.subject, data.lesson_key)
    title, body = _clean(data)
    now = clock.now()
    note = LearningNote(user_id=user.id, academic_year=profile.academic_year if at_school else None, grade=grade,
                        subject=data.subject, lesson_key=data.lesson_key, title=title, body=body, created_at=now, updated_at=now)
    db.add(note)
    db.commit()
    return note_out(note)


@router.put("/notes/{note_id}", response_model=NoteOut,
            responses=errors(*AUTH, (404, "note_not_found"), (422, "note_subject_invalid"), (422, "note_lesson_invalid"),
                             (422, "note_empty")),
            summary="Edit a note (it stays in its own school year and grade)")
def update_note(note_id: int, data: NoteInput, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    note = _own_note(db, user, note_id)
    _check_note_link(note.grade, data.subject, data.lesson_key)
    note.title, note.body = _clean(data)
    note.subject, note.lesson_key, note.updated_at = data.subject, data.lesson_key, clock.now()
    db.commit()
    return note_out(note)


@router.delete("/notes/{note_id}", status_code=204, responses=errors(*AUTH, (404, "note_not_found")), summary="Delete a note")
def delete_note(note_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    db.delete(_own_note(db, user, note_id))
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------------------------------------------
# Routes: support workflow (administrators, after verifying the request). Every change records who, when and why.
# ---------------------------------------------------------------------------------------------------------------

class CalendarInput(BaseModel):
    region: str = Field(max_length=8)
    academic_year: int = Field(ge=2000, le=2100)
    school_start_date: date = Field(description="Tựu trường.")
    opening_date: date | None = Field(default=None, description="Khai giảng.")
    promotion_date: date | None = Field(default=None, description="The day grades change; tựu trường by default.")
    end_date: date | None = None
    source: str | None = Field(default=None, max_length=200, description="The decision that sets the dates (its title / issuer).")
    decision_number: str | None = Field(default=None, max_length=80, description="Số văn bản, e.g. 2368/QĐ-BGDĐT.")
    verified: bool = Field(default=False, description="Checked against the decision: grades move up on this date only then.")
    reason: str = Field(min_length=5, max_length=300, description="Why this change is made (kept in the audit).")


class CalendarYearOut(BaseModel):
    region: str
    academic_year: int
    label: str
    configured: bool
    school_start_date: str | None
    opening_date: str | None
    promotion_date: str | None
    end_date: str | None
    source: str | None
    decision_number: str | None
    verified: bool
    verified_at: str | None
    verified_by: int | None
    updated_by: int | None
    updated_at: str | None
    expected_start: str | None = None


class AlertOut(BaseModel):
    region: str
    academic_year: int
    label: str
    level: Literal["overdue", "upcoming"]
    expected_start: str
    configured: bool
    waiting: int


class CalendarOut(BaseModel):
    region: str
    years: list[CalendarYearOut]
    changes: list[dict]
    alerts: list[AlertOut]


class SupportInput(BaseModel):
    reason: str = Field(min_length=5, max_length=300)
    verification: str = Field(min_length=3, max_length=120, description="The support ticket or check that verified the request.")


class GradeCorrection(SupportInput):
    grade: GradeId


class RegionChange(SupportInput):
    region: str = Field(max_length=8)


def _snapshot(row: AcademicYearConfig | None) -> dict | None:
    if row is None:
        return None
    return {k: (v.isoformat() if isinstance(v, (date, datetime)) else v) for k, v in (
        ("school_start_date", row.school_start_date), ("opening_date", row.opening_date), ("promotion_date", row.promotion_date),
        ("end_date", row.end_date), ("source", row.source), ("decision_number", row.decision_number), ("verified", row.verified))}


def _actor_names(db: Session, ids: set[int | None]) -> dict[int, str]:
    ids = {i for i in ids if i}
    return dict(db.execute(select(User.id, User.email).where(User.id.in_(ids))).all()) if ids else {}


@admin_router.get("/regions", responses=errors(*ADMIN), summary="The education regions whose calendars can be managed")
def admin_regions(_: User = Depends(admin_user)) -> dict:
    return {"items": [{"code": code, "name": r["name"], "timezone": r["timezone"]} for code, r in regions().items()]}


@admin_router.get("/alerts", response_model=list[AlertOut], responses=errors(*ADMIN),
                  summary="School years whose calendar is not verified while learners wait (or soon will)")
def admin_alerts(_: User = Depends(admin_user), db: Session = Depends(get_db)) -> list[dict]:
    return calendar_alerts(db)


@admin_router.get("/calendar", response_model=CalendarOut, responses=errors(*ADMIN, (422, "unknown_region")),
                  summary="The configured school years of a region, their recent changes and the alerts")
def admin_calendar(region: str = Query(default="VN", max_length=8), _: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    region = check_region(region)
    rows = db.scalars(select(AcademicYearConfig.academic_year).where(AcademicYearConfig.region == region).order_by(AcademicYearConfig.academic_year))
    changes = list(db.scalars(select(AcademicCalendarChange).where(AcademicCalendarChange.region == region)
                              .order_by(AcademicCalendarChange.id.desc()).limit(30)))
    names = _actor_names(db, {c.actor_id for c in changes})
    return {"region": region, "years": [year_config(db, region, y) for y in rows],
            "changes": [{"academic_year": c.academic_year, "actor": names.get(c.actor_id), "reason": c.reason,
                         "at": as_utc(c.created_at).isoformat(), "before": json.loads(c.before_json) if c.before_json else None,
                         "after": json.loads(c.after_json)} for c in changes],
            "alerts": [a for a in calendar_alerts(db) if a["region"] == region]}


@admin_router.put("/calendar", response_model=CalendarYearOut,
                  responses=errors(*ADMIN, (422, "unknown_region"), (422, "invalid_calendar"), (422, "verification_incomplete")),
                  summary="Set (and verify) a school year's dates. Never re-promotes anyone: promotions are once per year")
def admin_set_calendar(data: CalendarInput, admin: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    region = check_region(data.region)
    promo = data.promotion_date or data.school_start_date
    window = (date(data.academic_year, 6, 1), date(data.academic_year, 12, 31))
    if not window[0] <= promo <= window[1] or not window[0] <= data.school_start_date <= window[1]:
        raise APIError(422, "invalid_calendar", "The school year must start in its first calendar year (June to December)")
    if data.opening_date and data.opening_date < data.school_start_date:
        raise APIError(422, "invalid_calendar", "Khai giảng cannot come before tựu trường")
    if data.end_date and data.end_date <= promo:
        raise APIError(422, "invalid_calendar", "The school year must end after it starts")
    source, number = (data.source or "").strip() or None, (data.decision_number or "").strip() or None
    if data.verified and not (source and number):
        raise APIError(422, "verification_incomplete", "A verified school year needs its source and decision number")
    row = db.scalar(select(AcademicYearConfig).where(AcademicYearConfig.region == region, AcademicYearConfig.academic_year == data.academic_year))
    before = _snapshot(row)
    if row is None:
        row = AcademicYearConfig(region=region, academic_year=data.academic_year, timezone=regions()[region]["timezone"])
        db.add(row)
    dates_changed = before is None or (before["school_start_date"], before["promotion_date"]) != (
        data.school_start_date.isoformat(), promo.isoformat())
    row.school_start_date, row.opening_date, row.promotion_date, row.end_date = data.school_start_date, data.opening_date, promo, data.end_date
    row.source, row.decision_number, row.updated_by = source, number, admin.id
    now = clock.now()
    if data.verified and (not row.verified or dates_changed):
        row.verified_at, row.verified_by = now, admin.id
    elif not data.verified:
        row.verified_at = row.verified_by = None
    row.verified = data.verified
    row.updated_at = now
    db.flush()
    db.add(AcademicCalendarChange(region=region, academic_year=data.academic_year, actor_id=admin.id, reason=data.reason.strip(),
                                  before_json=json.dumps(before, ensure_ascii=False) if before else None,
                                  after_json=json.dumps(_snapshot(row), ensure_ascii=False), created_at=now))
    db.commit()
    return year_config(db, region, data.academic_year)


def _support_target(db: Session, user_id: int) -> tuple[User, UserEducationProfile]:
    user = db.get(User, user_id)
    if user is None:
        raise APIError(404, "user_not_found", "User not found")
    profile = sync(db, user)
    if profile is None:
        raise APIError(409, "not_enrolled", "This account has no school grade yet")
    return user, profile


def _learner_row(user: User, profile: UserEducationProfile | None) -> dict:
    return {"id": user.id, "email": user.email, "display_name": user.display_name,
            "grade": profile.current_grade if profile else user.school_grade, "grade_label": grade_label(profile.current_grade if profile else user.school_grade),
            "academic_year": profile.academic_year if profile else None,
            "academic_year_label": year_label(profile.academic_year) if profile else None,
            "region": profile.education_region if profile else None, "status": profile.status if profile else None,
            "hold_next_promotion": bool(profile and profile.hold_next_promotion)}


def _history(db: Session, user_id: int) -> list[dict]:
    rows = list(db.scalars(select(GradePromotion).where(GradePromotion.user_id == user_id).order_by(GradePromotion.id)))
    names = _actor_names(db, {r.actor_id for r in rows})
    return [{"id": r.id, "kind": r.kind, "academic_year": r.academic_year, "academic_year_label": year_label(r.academic_year),
             "from_grade": r.from_grade, "to_grade": r.to_grade, "skipped": r.skipped, "archive_id": r.archive_id, "reason": r.reason,
             "actor_id": r.actor_id, "actor": names.get(r.actor_id), "at": as_utc(r.created_at).isoformat()} for r in rows]


@admin_router.get("/users", responses=errors(*ADMIN), summary="Find learners by email or name")
def admin_find_users(q: str = Query(min_length=2, max_length=80), _: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    needle = f"%{q.strip().lower()}%"
    users = list(db.scalars(select(User).where((func.lower(User.email).like(needle)) | (func.lower(User.display_name).like(needle)))
                            .order_by(User.id).limit(20)))
    profiles = {p.user_id: p for p in db.scalars(select(UserEducationProfile).where(
        UserEducationProfile.user_id.in_([u.id for u in users])))} if users else {}
    return {"items": [_learner_row(u, profiles.get(u.id)) for u in users]}


@admin_router.get("/users/{user_id}", responses=errors(*ADMIN, (404, "user_not_found")),
                  summary="A learner's grade, school year, region and every change with who made it")
def admin_user_detail(user_id: int, _: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise APIError(404, "user_not_found", "User not found")
    profile = sync(db, user)
    waiting = awaiting_calendar(db, profile) if profile else None
    return {**_learner_row(user, profile), "initial_grade": profile.initial_grade if profile else None,
            "enrollment_date": profile.enrollment_date.isoformat() if profile else None,
            "awaiting_calendar": year_label(waiting) if waiting else None,
            "can_promote": bool(profile and profile.status == "studying"
                                and school_year_of(db, profile.education_region, local_today(profile.education_region)) > profile.academic_year),
            "history": _history(db, user.id)}


@admin_router.get("/users/{user_id}/history", responses=errors(*ADMIN), summary="Every grade / school year change of a learner")
def admin_history(user_id: int, _: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    return {"items": _history(db, user_id)}


@admin_router.post("/users/{user_id}/grade", responses=errors(*ADMIN, (404, "user_not_found"), (409, "not_enrolled")),
                   summary="Correct a grade registered by mistake (verified support request)")
def admin_correct_grade(user_id: int, data: GradeCorrection, admin: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    user, profile = _support_target(db, user_id)
    before = profile.current_grade
    if before == data.grade:
        return state(db, user)
    profile.current_grade, profile.status, profile.updated_at = data.grade, _status_for(data.grade), clock.now()
    profile.version += 1
    if not db.scalar(select(func.count()).select_from(LearningYearArchive).where(LearningYearArchive.user_id == user.id)):
        profile.initial_grade = data.grade  # no year closed yet: still the year of registration, it was registered wrong
    user.school_grade = data.grade
    _archive_old_grade_reviews(db, user.id, grade_number(data.grade))
    db.add(GradePromotion(user_id=user.id, kind="correction", academic_year=profile.academic_year, from_grade=before, to_grade=data.grade,
                          reason=f"{data.reason} [{data.verification}]"[:300], actor_id=admin.id, celebrated_at=clock.now()))
    db.commit()
    return state(db, user)


@admin_router.post("/users/{user_id}/repeat", responses=errors(*ADMIN, (404, "user_not_found"), (409, "not_enrolled"), (409, "not_studying")),
                   summary="Học lại: the next school year keeps the current grade")
def admin_repeat(user_id: int, data: SupportInput, admin: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    user, profile = _support_target(db, user_id)
    if profile.status != "studying":
        raise APIError(409, "not_studying", "Only a learner at school can repeat a grade")
    profile.hold_next_promotion = True
    profile.version += 1
    db.add(GradePromotion(user_id=user.id, kind="repeat_request", academic_year=profile.academic_year, from_grade=profile.current_grade,
                          to_grade=profile.current_grade, reason=f"{data.reason} [{data.verification}]"[:300], actor_id=admin.id,
                          celebrated_at=clock.now()))
    db.commit()
    return state(db, user)


@admin_router.post("/users/{user_id}/promote",
                   responses=errors(*ADMIN, (404, "user_not_found"), (409, "not_enrolled"), (409, "not_studying"),
                                    (409, "school_year_not_started"), (409, "game_in_progress")),
                   summary="Lên lớp now, confirmed by an administrator (e.g. while the calendar awaits verification)")
def admin_promote(user_id: int, data: SupportInput, admin: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    """Closes the learner's school year exactly like the automatic promotion (archive, history, once per year), only
    once the next school year has begun by its expected date; a "học lại" hold keeps the grade as it would."""
    user, profile = _support_target(db, user_id)
    if profile.status != "studying":
        raise APIError(409, "not_studying", "Only a learner at school can move up")
    now = clock.now()
    if school_year_of(db, profile.education_region, local_today(profile.education_region, now)) <= profile.academic_year:
        raise APIError(409, "school_year_not_started", "The next school year has not begun yet")
    if game_in_progress(db, profile, now) is not None:
        raise APIError(409, "game_in_progress", "The learner is playing a stage of this school year; try again when it ends")
    try:
        _close_year(db, user.id, profile.academic_year, now, actor_id=admin.id, reason=f"{data.reason} [{data.verification}]"[:300])
        db.commit()
    except (_LostRace, IntegrityError):
        db.rollback()  # promoted meanwhile: nothing more to do
    db.refresh(user)
    return state(db, user)


@admin_router.post("/users/{user_id}/region", responses=errors(*ADMIN, (404, "user_not_found"), (409, "not_enrolled"), (422, "unknown_region")),
                   summary="Move a learner to another region's school calendar")
def admin_change_region(user_id: int, data: RegionChange, admin: User = Depends(admin_user), db: Session = Depends(get_db)) -> dict:
    """The school year already reached is kept: a region whose year starts later never moves the learner back, and one
    whose year has already started promotes once, through the same per-year unique key as always."""
    region = check_region(data.region)
    user, profile = _support_target(db, user_id)
    if profile.education_region == region:
        return state(db, user)
    before = profile.education_region
    profile.education_region = region
    profile.version += 1
    db.add(GradePromotion(user_id=user.id, kind="region_change", academic_year=profile.academic_year, from_grade=profile.current_grade,
                          to_grade=profile.current_grade, reason=f"{before} → {region}: {data.reason} [{data.verification}]"[:300],
                          actor_id=admin.id, celebrated_at=clock.now()))
    db.commit()
    return state(db, user)
