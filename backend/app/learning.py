"""English and Math learning games: catalog, sessions (stages), answers, progress, review list and stage rewards.

The backend is the source of truth for answers, score, combo, hearts, the end of a stage, progress, completion and
EXP. The app animates, reports what the user did (answer, hint, reveal, a target that reached the ground/base) with a
client event id, and shows what the backend returns. Rules: docs/LEARNING_GAMES.md.
"""
import json
import random
import secrets
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from . import clock
from .companion import day_start as quest_day_start, maybe_start_walk
from .config import settings
from .db import get_db
from .errors import APIError
from . import learning_grammar_bank as grammar_bank
from .learning_grammar import generate_grammar_items
from .learning_vocab import POS_VI, bank_items, travel_for
from .learning_engine import (DEFAULT_SCORING, answer_key, HEART_ON_WRONG, MASTERED_AT, MOVING_KINDS, TYPED_TARGET_KINDS, VOCAB_KINDS,
                              WRONG_POLICY, InvalidAnswer, check_bridge, check_choice, check_number, check_text,
                              compare_error_type, correct_outcome, default_variant, fmt, game_of, generate_math_items,
                              hearts_for, mastery_after, math_error_type, parse_number, score_for)
from .models import (Activity, LearningEvent, LearningLesson, LearningLessonVersion, LearningLevel, LearningQuestion,
                     LearningReviewItem, LearningReward, LearningSession, LearningSessionItem, LearningSkillProgress,
                     LearningSubject, LearningTopic, LearningTutorialView, LearningVocabEntry, LearningVocabItem,
                     PomodoroSettings, User, as_utc)
from .profile import DAILY_TASK_BY_ID
from .progression import award_exp, pool_exp_between
from .security import current_user

router = APIRouter(prefix="/api/learning", tags=["learning"])

OPEN = ("active", "paused")
TERMINAL = ("completed", "failed", "abandoned")
TRANSITIONS = {
    "active": {"paused", "completed", "failed", "abandoned"},
    "paused": {"active", "completed", "abandoned"},
    "completed": set(), "failed": set(), "abandoned": set(),
}
CORRECT = ("first_try", "hinted", "corrected")
REVIEW_REASONS = ("hinted", "corrected", "wrong", "revealed", "missed")
REVIEW_WEIGHT = {"revealed": 5, "missed": 4, "wrong": 4, "corrected": 2, "hinted": 1}
MIN_REWARD_TURNS = 10  # a "chặng hợp lệ": a full lesson stage of 10-15 turns
DAILY_LEARNING_TASK = "learning"

Mode = Literal["practice", "challenge"]
Variant = Literal["mixed", "gate", "bridge", "meteor", "word_shooter"]
EventId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{8,64}$", description="Idempotency key chosen by the app per action; "
                                                                             "a retry with the same id changes nothing.")]
TurnId = Annotated[str, Field(min_length=8, max_length=32)]


# ---------------------------------------------------------------------------------------------------------------
# Request and response schemas
# ---------------------------------------------------------------------------------------------------------------

class SessionCreate(BaseModel):
    lesson_id: int
    mode: Mode = "practice"
    duration_minutes: int = Field(default=25, ge=5, le=60)
    variant: Variant | None = Field(default=None, description="Grammar: mixed (default), gate or bridge. Vocabulary: meteor "
                                                              "(Việt → Anh, default) or word_shooter (Anh → Việt).")
    timezone: str = Field(default="UTC", max_length=80, description="Device timezone; becomes the account timezone if none is set.")
    start_paused: bool = Field(default=False, description="Create it paused (the app shows the session's lesson first; "
                                                          "the clock starts with /resume).")


class QuickStart(BaseModel):
    game: Literal["word_shooter", "meteor", "gate", "bridge"] = Field(
        description="word_shooter: Bắn từ tiếng Anh; meteor: Bắn thiên thạch Việt → Anh; gate: Chọn đáp án ngữ pháp; "
                    "bridge: Sắp xếp câu. The content is picked by the backend from the user's progress.")
    mode: Mode = "practice"
    duration_minutes: int = Field(default=25, ge=5, le=60)
    timezone: str = Field(default="UTC", max_length=80)


class ReviewSessionCreate(BaseModel):
    topic_id: int
    mode: Mode = "practice"
    duration_minutes: int = Field(default=15, ge=5, le=60)
    timezone: str = Field(default="UTC", max_length=80)
    start_paused: bool = Field(default=False, description="Create it paused (the app counts down 3-2-1, then /resume).")


class NextInput(BaseModel):
    count: int = Field(default=1, ge=1, le=3)


class TurnEvent(BaseModel):
    turn_id: TurnId
    client_event_id: EventId


class AnswerInput(TurnEvent):
    answer: str | list[str] = Field(description="Typed text or number, an option id, or the ordered token ids of a bridge.")

    @field_validator("answer")
    @classmethod
    def bounded(cls, value):
        if isinstance(value, str):
            if len(value) > 120:
                raise ValueError("Answer is too long")
        elif len(value) > 20 or any(not isinstance(v, str) or len(v) > 8 for v in value):
            raise ValueError("Too many tokens")
        return value


class ControlInput(BaseModel):
    client_event_id: EventId | None = None


class ExtendInput(BaseModel):
    minutes: int = Field(ge=1, le=30)
    client_event_id: EventId


class AbandonInput(BaseModel):
    reason: Literal["user_ended", "time_up"] = "user_ended"
    client_event_id: EventId | None = None


class Ref(BaseModel):
    id: int
    code: str
    name: str


class TurnOut(BaseModel):
    turn_id: str
    position: int
    kind: str
    skill_label: str
    prompt: dict[str, Any]
    hints_shown: list[str]
    hints_total: int
    attempts: int
    wrong_attempts: int
    practice: bool = Field(description="A re-practice turn after a revealed answer or a mistake in Học tập.")
    travel_seconds: int = Field(description="Challenge only: time for the target to reach the ground/base. 0 = waits.")
    on_screen_ms: int = Field(description="Play time since the turn was issued, so a reopened game puts each target back "
                                          "where it was instead of at the top.")


class RewardOut(BaseModel):
    status: str = Field(description="granted | capped | daily_cap_reached | daily_task | already_claimed | not_eligible | none")
    exp: int


class SessionOut(BaseModel):
    id: int
    status: Literal["active", "paused", "completed", "failed", "abandoned"]
    kind: Literal["lesson", "review"]
    mode: Mode
    game_type: str
    variant: str | None
    game: str
    subject: Ref
    topic: Ref
    level: Ref
    lesson: Ref
    duration_seconds: int
    active_ms: int
    remaining_ms: int
    time_up: bool
    hearts: int
    hearts_max: int
    score: int
    combo: int
    max_combo: int
    required_count: int
    resolved_count: int
    pending_practice: int
    open_turns: list[TurnOut]
    can_complete: bool
    end_reason: str | None
    reward: RewardOut | None
    version: int
    server_time: str


class WordOut(BaseModel):
    en: str
    vi: str
    phonetic: str | None = None


class TurnResultOut(BaseModel):
    turn_id: str = Field(description="The turn this event resolved. A typed shot can hit another falling word than the "
                                     "one aimed at (the one closest to the ground whose answer matches).")
    event: str
    correct: bool | None = None
    outcome: str | None = None
    resolved: bool = False
    retry_allowed: bool = False
    error_type: str | None = None
    score_delta: int = 0
    hearts_delta: int = 0
    combo: int = 0
    hint: str | None = None
    correct_answer: str | None = Field(default=None, description="Only once the turn is resolved or revealed.")
    explanation: str | None = None
    practice_added: bool = False
    word: WordOut | None = Field(default=None, description="Vocabulary: the English word and its Vietnamese meaning, "
                                                           "once the turn is resolved or revealed.")


class EventOut(BaseModel):
    result: TurnResultOut | None
    session: SessionOut
    replayed: bool = False


class ItemResultOut(BaseModel):
    turn_id: str
    position: int
    kind: str
    skill_label: str
    prompt: dict[str, Any]
    outcome: str | None
    practice: bool
    attempts: int
    hints_used: int
    error_type: str | None
    correct_answer: str
    explanation: str | None
    word: WordOut | None = None


class ResultOut(BaseModel):
    session: SessionOut
    counts: dict[str, int]
    items: list[ItemResultOut]
    open_review_count: int


# ---------------------------------------------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------------------------------------------

def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise APIError(422, "invalid_timezone", "Unknown timezone")


def account_timezone(db: Session, user: User, device_zone: str | None = None) -> str:
    """The account's IANA timezone (pomodoro_settings.timezone, which the app keeps in sync with the device)."""
    row = db.get(PomodoroSettings, user.id)
    if row is None:
        zone = device_zone if device_zone else "UTC"
        _tz(zone)
        try:
            with db.begin_nested():
                db.add(PomodoroSettings(user_id=user.id, timezone=zone, daily_goal_minutes=120, focus_minutes=25,
                                        short_break_minutes=5, long_break_minutes=15, long_break_every=4))
        except IntegrityError:
            pass
        row = db.get(PomodoroSettings, user.id)
    return row.timezone if row else "UTC"


def local_day_bounds(now: datetime, zone: str) -> tuple:
    """(local date, UTC start, UTC end) of the account's calendar day containing `now`."""
    tz = _tz(zone)
    local = now.astimezone(tz)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return local.date(), start.astimezone(dt_timezone.utc), end.astimezone(dt_timezone.utc)


def _loads(text: str | None, default=None):
    return json.loads(text) if text else default


def _rules(s: LearningSession) -> dict:
    return json.loads(s.scoring_json)


def _items(db: Session, s: LearningSession) -> list[LearningSessionItem]:
    return list(db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == s.id)
                           .order_by(LearningSessionItem.position)))


def owned_session(db: Session, user: User, session_id: int) -> LearningSession:
    """Sessions belong to one user. Anyone else gets the same 404 as for a missing session."""
    s = db.scalar(select(LearningSession).where(LearningSession.id == session_id, LearningSession.user_id == user.id))
    if s is None:
        raise APIError(404, "session_not_found", "Learning session not found")
    return s


def transition(s: LearningSession, target: str) -> None:
    if target not in TRANSITIONS[s.status]:
        raise APIError(409, "invalid_transition", f"Cannot go from {s.status} to {target}")
    s.status = target


def require_active(s: LearningSession) -> None:
    if s.status == "paused":
        raise APIError(409, "session_paused", "Resume the session first")
    if s.status in TERMINAL:
        raise APIError(409, "session_ended", "This session has already ended")


def tick(s: LearningSession, now: datetime) -> None:
    """Accrue play time since the last request, at most the idle cap (a closed app doesn't burn the session's time)."""
    if s.status == "active" and s.last_tick_at is not None:
        gap_ms = (now - as_utc(s.last_tick_at)).total_seconds() * 1000
        s.active_ms += int(max(0, min(gap_ms, settings.learning_idle_cap_seconds * 1000)))
        s.last_tick_at = now


def projected_active_ms(s: LearningSession, now: datetime) -> int:
    if s.status == "active" and s.last_tick_at is not None:
        gap_ms = (now - as_utc(s.last_tick_at)).total_seconds() * 1000
        return s.active_ms + int(max(0, min(gap_ms, settings.learning_idle_cap_seconds * 1000)))
    return s.active_ms


def correct_answer_text(item: LearningSessionItem) -> str:
    answer = _loads(item.answer_json, {})
    if item.kind in ("math_input", "missing_number"):
        return fmt(int(answer["value"])) if answer["value"].lstrip("-").isdigit() else answer["value"]
    if item.kind == "compare":
        prompt = _loads(item.prompt_json, {})
        return f"{prompt['left']} {answer['value']} {prompt['right']}"
    return answer.get("display", "")


def word_pair(item: LearningSessionItem) -> dict | None:
    """The English word and its meaning, shown once a vocabulary turn is resolved (hit, missed or revealed)."""
    if item.kind not in VOCAB_KINDS:
        return None
    answer, prompt = _loads(item.answer_json, {}), _loads(item.prompt_json, {})
    return {"en": answer.get("display", ""), "vi": answer.get("meaning_vi") or prompt.get("meaning_vi", ""),
            "phonetic": answer.get("phonetic")}


OPEN_LABEL = {"vocab_typing": "Từ vựng", "word_spelling": "Gõ từ"}


def item_travel(item: LearningSessionItem, rules: dict) -> int:
    """Seconds for a falling target to reach the ground: longer words and phrases fall slower."""
    base = int(rules.get("travel_seconds", 0))
    if item.kind in VOCAB_KINDS:
        return travel_for(_loads(item.answer_json, {}).get("display", ""), base)
    return base


PRACTICE_APPROACH_MS = 30000  # Học tập: targets drift in over this time and stop at 80% of the way (as in the app)


def fall_progress(item: LearningSessionItem, rules: dict, mode: str, active_ms: int) -> float:
    """How far a falling target is (0 = top, 1 = ground). Longer words fall slower, so the one issued first is not
    always the one closest to the ground."""
    elapsed = max(0, active_ms - (item.issued_active_ms or 0))
    travel = item_travel(item, rules) if mode == "challenge" else 0
    return elapsed / (travel * 1000) if travel else min(0.8, 0.8 * elapsed / PRACTICE_APPROACH_MS)


def _turn_out(item: LearningSessionItem, rules: dict, mode: str, active_ms: int) -> dict:
    hints = _loads(item.hints_json, [])
    moving = mode == "challenge" and item.kind in MOVING_KINDS
    # A word's label holds the answer or the meaning ("cat – con mèo"): open turns only say what kind of question it is.
    label = OPEN_LABEL[item.kind] if item.kind in OPEN_LABEL and item.state != "resolved" else item.skill_label
    prompt = _loads(item.prompt_json, {})
    if item.kind in TYPED_TARGET_KINDS and item.state != "resolved":
        # Falling words shoot as soon as the typed text is right: the app gets keys of the accepted answers, not them.
        prompt["answer_keys"] = [answer_key(item.turn_id, a) for a in _loads(item.answer_json, {}).get("accepted", [])]
    return {"turn_id": item.turn_id, "position": item.position, "kind": item.kind, "skill_label": label,
            "prompt": prompt, "hints_shown": hints[:item.hints_used], "hints_total": len(hints),
            "attempts": item.attempts, "wrong_attempts": item.wrong_attempts, "practice": item.practice_of_id is not None,
            "travel_seconds": item_travel(item, rules) if moving else 0,
            "on_screen_ms": max(0, active_ms - (item.issued_active_ms if item.issued_active_ms is not None else active_ms))}


def completion_state(items: list[LearningSessionItem]) -> tuple[bool, int]:
    """(can complete, pending practice turns). Every turn must be resolved, and every revealed answer needs a
    correctly answered re-practice turn. Re-practice never rewrites the original result."""
    if any(i.state != "resolved" for i in items):
        pending = sum(1 for i in items if i.state != "resolved" and i.practice_of_id is not None)
        return False, pending
    practiced = {i.practice_of_id for i in items if i.practice_of_id is not None and i.outcome in CORRECT}
    unpracticed = [i for i in items if i.outcome == "revealed" and i.practice_of_id is None and i.id not in practiced]
    return not unpracticed, 0


def session_out(db: Session, s: LearningSession, now: datetime | None = None, items=None) -> dict:
    now = now or clock.now()
    items = items if items is not None else _items(db, s)
    rules = _rules(s)
    active = projected_active_ms(s, now)
    can_complete, pending = completion_state(items)
    subject, topic = db.get(LearningSubject, s.subject_id), db.get(LearningTopic, s.topic_id)
    level, lesson = db.get(LearningLevel, s.level_id), db.get(LearningLesson, s.lesson_id)
    return {
        "id": s.id, "status": s.status, "kind": s.kind, "mode": s.mode, "game_type": s.game_type,
        "variant": rules.get("variant"), "game": s.game or game_of(s.game_type, rules.get("variant")),
        "subject": {"id": subject.id, "code": subject.code, "name": subject.name},
        "topic": {"id": topic.id, "code": topic.code, "name": topic.name},
        "level": {"id": level.id, "code": level.code, "name": level.name},
        "lesson": {"id": lesson.id, "code": lesson.code, "name": lesson.title},
        "duration_seconds": s.duration_seconds, "active_ms": active,
        "remaining_ms": max(0, s.duration_seconds * 1000 - active),
        "time_up": active >= s.duration_seconds * 1000,
        "hearts": s.hearts, "hearts_max": s.hearts_max, "score": s.score, "combo": s.combo, "max_combo": s.max_combo,
        "required_count": s.required_count,
        "resolved_count": sum(1 for i in items if i.required and i.state == "resolved"),
        "pending_practice": pending,
        "open_turns": [_turn_out(i, rules, s.mode, active) for i in items if i.state == "issued"],
        "can_complete": s.status in OPEN and can_complete,
        "end_reason": s.end_reason,
        "reward": {"status": s.reward_status, "exp": s.reward_exp} if s.status in TERMINAL else None,
        "version": s.version, "server_time": now.isoformat(),
    }


def issue_turns(s: LearningSession, items: list[LearningSessionItem], now: datetime, *, want: int) -> None:
    """Hand out queued turns until `want` are open (bounded by the game's target count). Nothing new after time is up:
    the user finishes the open turns, then chooses to end or to study longer."""
    rules = _rules(s)
    if s.status != "active" or s.active_ms >= s.duration_seconds * 1000:
        return
    target = min(want, int(rules.get("max_targets", 1)))
    open_count = sum(1 for i in items if i.state == "issued")
    for item in items:
        if open_count >= target:
            break
        if item.state == "queued":
            item.state, item.issued_at, item.issued_active_ms = "issued", now, s.active_ms
            open_count += 1


# ---------------------------------------------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------------------------------------------

def _lesson_brief(lesson: LearningLesson, version: LearningLessonVersion) -> dict:
    game = _loads(version.game_config_json, {})
    return {"id": lesson.id, "code": lesson.code, "title": lesson.title, "topic_id": lesson.topic_id,
            "level_id": lesson.level_id, "game_type": game["game_type"], "turns": game["turns"],
            "variants": game.get("variants", []), "version": version.version}


def current_version(db: Session, lesson: LearningLesson) -> LearningLessonVersion:
    return db.scalar(select(LearningLessonVersion).where(LearningLessonVersion.lesson_id == lesson.id,
                                                         LearningLessonVersion.version == lesson.current_version))


# "Cách chơi": each game's first-time guide. It is finished with "Bắt đầu" (closing it early does not count), once per
# account and game, so it is skipped on every device afterwards.
GameId = Literal["word_shooter", "meteor", "gate", "bridge", "grammar", "defense", "math_bridge"]


def _tutorials_seen(db: Session, user: User) -> dict:
    games = db.scalars(select(LearningTutorialView.game).where(LearningTutorialView.user_id == user.id)
                       .order_by(LearningTutorialView.id))
    return {"seen": list(games)}


@router.get("/tutorials", summary="The games whose first-time guide this account has finished")
def tutorials(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return _tutorials_seen(db, user)


@router.post("/tutorials/{game}", summary="Mark a game's guide as finished (idempotent)")
def finish_tutorial(game: GameId, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(LearningTutorialView.id).where(LearningTutorialView.user_id == user.id,
                                                        LearningTutorialView.game == game)) is None:
        db.add(LearningTutorialView(user_id=user.id, game=game))
        try:
            db.commit()
        except IntegrityError:  # the same game finished at the same moment on another device
            db.rollback()
    return _tutorials_seen(db, user)


@router.get("/catalog", summary="Subjects with their levels, topics and lessons (no answers)")
def catalog(user: User = Depends(current_user), db: Session = Depends(get_db)):
    review_counts = dict(db.execute(select(LearningReviewItem.topic_id, func.count()).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.status == "open").group_by(LearningReviewItem.topic_id)).all())
    subjects = []
    for subject in db.scalars(select(LearningSubject).order_by(LearningSubject.sort_order)):
        levels = db.scalars(select(LearningLevel).where(LearningLevel.subject_id == subject.id).order_by(LearningLevel.sort_order)).all()
        topics = db.scalars(select(LearningTopic).where(LearningTopic.subject_id == subject.id).order_by(LearningTopic.sort_order)).all()
        lessons = []
        for lesson in db.scalars(select(LearningLesson).join(LearningTopic).where(
                LearningTopic.subject_id == subject.id, LearningLesson.status == "published").order_by(LearningLesson.sort_order)):
            version = current_version(db, lesson)
            if version is not None:
                lessons.append(_lesson_brief(lesson, version))
        subjects.append({
            "id": subject.id, "code": subject.code, "name": subject.name,
            "levels": [{"id": lv.id, "code": lv.code, "name": lv.name, "description": lv.description} for lv in levels],
            "topics": [{"id": t.id, "code": t.code, "name": t.name, "skill_type": t.skill_type, "description": t.description,
                        "review_count": review_counts.get(t.id, 0)} for t in topics],
            "lessons": lessons,
        })
    return {"subjects": subjects, "default_duration_minutes": 25}


def vocab_key(skill_key: str) -> str:
    """The word a skill is about: en.spell.cat (Anh → Việt) and en.word.cat (Việt → Anh) are both the word en.word.cat."""
    return "en.word." + skill_key.removeprefix("en.spell.") if skill_key.startswith("en.spell.") else skill_key


PICK_LABEL = {"new": "Từ mới", "review": "Cần ôn", "learned": "Ôn lại"}


def bank_intro_words(db: Session, game: dict, session: LearningSession | None) -> list[dict]:
    """A session teaches exactly the words drawn for it (from its frozen turns); without one, a preview of the topic."""
    def word(a: dict) -> dict:
        return {"word": a["display"], "meaning_vi": a["meaning_vi"], "context_vi": a.get("context_vi"),
                "part_of_speech": POS_VI.get(a.get("part_of_speech"), a.get("part_of_speech")), "phonetic": a.get("phonetic"),
                "example_en": a.get("example_en"), "example_vi": a.get("example_vi"), "level": a.get("level"),
                "pick": PICK_LABEL.get(a.get("pick"))}
    if session is not None:
        # Only the words already met in this stage: a word still to come is an answer (Việt → Anh) or a meaning to
        # discover after the shot (Anh → Việt).
        words, seen = [], set()
        for item in db.scalars(select(LearningSessionItem).where(LearningSessionItem.session_id == session.id,
                                                                  LearningSessionItem.practice_of_id.is_(None),
                                                                  LearningSessionItem.state == "resolved")
                               .order_by(LearningSessionItem.position)):
            answer = _loads(item.answer_json, {})
            if answer.get("entry_key") and answer["entry_key"] not in seen:
                seen.add(answer["entry_key"])
                words.append(word(answer))
        return words
    topic = game["generator"]["vocab_bank"].get("topic")
    query = select(LearningVocabEntry).where(LearningVocabEntry.status == "active")
    if topic:
        query = query.where(LearningVocabEntry.topic == topic)
    entries = sorted(db.scalars(query), key=lambda e: (e.level, e.word))[:40]
    return [word({"display": e.word, "meaning_vi": e.meaning_vi, "context_vi": e.context_vi, "part_of_speech": e.part_of_speech,
                  "phonetic": e.phonetic, "example_en": e.example_en, "example_vi": e.example_vi, "level": e.level})
            for e in entries]


def lesson_intro(db: Session, version: LearningLessonVersion, session: LearningSession | None = None) -> dict:
    """A session's intro teaches exactly the words drawn for it; without a session, the topic's whole word bank."""
    intro = _loads(version.intro_json, {})
    game = _loads(version.game_config_json, {})
    if (game.get("generator") or {}).get("grammar_bank") is not None:
        # The rules of the points this stage practises (never its sentences or answers); without a session, the
        # points a beginner starts with.
        if session is None:
            return {**intro, "rules": [{"form": p["name"], "example": p["rule"]} for p in grammar_bank.POINT.values()
                                       if p["difficulty"] == 1]}
        answers = [_loads(a, {}) for a in db.scalars(select(LearningSessionItem.answer_json).where(
            LearningSessionItem.session_id == session.id).order_by(LearningSessionItem.position))]
        return {**intro, **grammar_bank.lesson_intro(answers), "title": intro.get("title", "")}
    if intro.get("kind") == "vocabulary" and (game.get("generator") or {}).get("vocab_bank") is not None:
        intro["words"] = bank_intro_words(db, game, session)
        return intro
    if intro.get("kind") == "vocabulary":
        query = select(LearningVocabItem).where(LearningVocabItem.lesson_version_id == version.id)
        if session is not None:
            keys = {vocab_key(k) for k in db.scalars(select(LearningSessionItem.skill_key)
                                                     .where(LearningSessionItem.session_id == session.id))}
            query = query.where(LearningVocabItem.item_key.in_(keys))
        intro["words"] = [{"word": w.word, "meaning_vi": w.meaning_vi, "context_vi": w.context_vi,
                           "part_of_speech": w.part_of_speech, "phonetic": w.phonetic,
                           "example_en": w.example_en, "example_vi": w.example_vi}
                          for w in db.scalars(query.order_by(LearningVocabItem.sort_order))]
    return intro


@router.get("/lessons/{lesson_id}", summary="A lesson and its introduction (shown before playing)")
def get_lesson(lesson_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lesson = db.get(LearningLesson, lesson_id)
    if lesson is None or lesson.status != "published":
        raise APIError(404, "lesson_not_found", "Lesson not found")
    version = current_version(db, lesson)
    return {**_lesson_brief(lesson, version), "intro": lesson_intro(db, version)}


# ---------------------------------------------------------------------------------------------------------------
# Building a session: pick and freeze its turns
# ---------------------------------------------------------------------------------------------------------------

def _mastery(db: Session, user_id: int) -> dict[str, int]:
    return dict(db.execute(select(LearningSkillProgress.skill_key, LearningSkillProgress.mastery)
                           .where(LearningSkillProgress.user_id == user_id)).all())


def _open_review_keys(db: Session, user_id: int, lesson_id: int) -> list[str]:
    rows = db.scalars(select(LearningReviewItem).where(LearningReviewItem.user_id == user_id, LearningReviewItem.lesson_id == lesson_id,
                                                       LearningReviewItem.status == "open")).all()
    rows.sort(key=lambda r: (-REVIEW_WEIGHT.get(r.reason, 1), -r.times_flagged, r.updated_at or r.created_at))
    return [r.question_key for r in rows]


def weakness(mastery: int | None, flagged: bool) -> float:
    """Weaker content is drawn more often: unseen 2.0, mastered 1.0, weakest 3.0, +1 if on the review list."""
    base = 2.0 if mastery is None else 1.0 + (100 - mastery) / 50
    return base + (1.0 if flagged else 0.0)


def _spread(sequence: list, key) -> list:
    """Avoid the same question twice in a row where possible."""
    out = list(sequence)
    for i in range(1, len(out)):
        if key(out[i]) == key(out[i - 1]):
            for j in range(i + 1, len(out)):
                if key(out[j]) != key(out[i - 1]):
                    out[i], out[j] = out[j], out[i]
                    break
    return out


def _snapshot(q: LearningQuestion, rng: random.Random) -> dict:
    prompt, answer = _loads(q.prompt_json, {}), _loads(q.answer_json, {})
    if q.kind == "gate_choice":
        options = list(prompt["options"])
        rng.shuffle(options)
        prompt["options"] = options
    elif q.kind == "bridge_order":
        words = list(prompt["tokens"])
        rng.shuffle(words)
        # Ids follow the shuffled order, so they say nothing about the right order.
        prompt["tokens"] = [{"id": f"w{i + 1}", "text": text} for i, text in enumerate(words)]
    return {"kind": q.kind, "question_id": q.id, "question_key": q.question_key, "skill_key": q.skill_key,
            "skill_label": q.skill_label, "prompt": prompt, "answer": answer, "hints": _loads(q.hints_json, []),
            "explanation": q.explanation}


def english_items(db: Session, user: User, lesson: LearningLesson, version: LearningLessonVersion, game: dict,
                  variant: str | None, seed: int, review_keys: list[str] | None) -> list[dict]:
    """Random every session, like Math. Vocabulary: a random handful of the topic's words (weaker ones more likely),
    each asked at least once. Grammar: sentences generated from word pools by learning_grammar."""
    rng = random.Random(seed)
    if (game.get("generator") or {}).get("grammar_bank") is not None:
        # The grammar bank: questions picked for this user (level, history, review list, recent stages).
        if review_keys is not None:
            return grammar_bank.stage_items(db, user.id, lesson.code, "choice", seed, review_keys=review_keys)
        if variant in ("gate", "bridge"):
            return grammar_bank.stage_items(db, user.id, lesson.code, "choice" if variant == "gate" else "order", seed)
        half = game["turns"] // 2
        return (grammar_bank.stage_items(db, user.id, lesson.code, "choice", seed, half)
                + grammar_bank.stage_items(db, user.id, lesson.code, "order", seed + 1, game["turns"] - half))
    mastery = _mastery(db, user.id)
    flagged = set(_open_review_keys(db, user.id, lesson.id))
    if game["game_type"] == "grammar":
        point = game["generator"]["grammar"]
        if review_keys is not None:
            items = []
            for i, key in enumerate(review_keys[:6]):
                items += generate_grammar_items(seed + i, point, "mixed", 2, only_key=key)
            return items[:12]
        weights = {key: 3.0 for key in flagged}
        turns = game["turns"] if (variant or "mixed") == "mixed" else 10
        return generate_grammar_items(seed, point, variant or "mixed", turns, weights)

    if (game.get("generator") or {}).get("vocab_bank") is not None:
        return bank_items(db, user, lesson, game, variant, seed, review_keys)
    # Lessons published before the vocabulary bank: their own fixed word list (kept for old sessions and reviews).
    questions = list(db.scalars(select(LearningQuestion).where(LearningQuestion.lesson_version_id == version.id)
                                .order_by(LearningQuestion.sort_order)))
    if review_keys is not None:
        by_key = {q.question_key: q for q in questions}
        chosen = [by_key[k] for k in review_keys if k in by_key][:12]
        rng.shuffle(chosen)
        return [_snapshot(q, rng) for q in chosen]
    # The same word bank, asked the way the chosen game asks it.
    kind = "word_spelling" if variant == "word_shooter" else "vocab_typing"
    questions = [q for q in questions if q.kind == kind]
    weight = lambda q: weakness(mastery.get(q.skill_key), q.question_key in flagged)
    # Draw the session's words without replacement, weaker words more likely (weighted random order).
    order = sorted(questions, key=lambda q: rng.random() ** (1 / weight(q)), reverse=True)
    words = order[:min(len(order), game.get("words_per_session", 7))]
    chosen = list(words)
    while len(chosen) < game["turns"]:
        chosen.append(rng.choices(words, weights=[weight(q) for q in words])[0])
    rng.shuffle(chosen)
    return [_snapshot(q, rng) for q in _spread(chosen, lambda q: q.question_key)]


def math_items(db: Session, user: User, topic: LearningTopic, game: dict, seed: int, review_keys: list[str] | None) -> list[dict]:
    generator = game["generator"]
    if review_keys is not None:
        per_key = max(2, 6 // max(1, len(review_keys)))
        items = []
        for i, key in enumerate(review_keys[:6]):
            items += generate_math_items(seed + i, topic.skill_type, generator, per_key, only_key=key)
        return items[:12]
    mastery = _mastery(db, user.id)
    weights = {key: weakness(value, False) for key, value in mastery.items() if key.startswith("math.")}
    for op in generator.get("ops", []):
        for prefix in ("math.arith.", "math.missing."):
            weights.setdefault(prefix + op, weakness(None, False))
    return generate_math_items(seed, topic.skill_type, generator, game["turns"], weights)


def create_session(db: Session, user: User, *, lesson: LearningLesson, mode: str, duration_minutes: int,
                   variant: str | None, device_zone: str, kind: str, idempotency_key: str | None,
                   review_keys: list[str] | None = None, start_paused: bool = False) -> LearningSession:
    _tz(device_zone)
    if idempotency_key and (existing := db.scalar(select(LearningSession).where(
            LearningSession.user_id == user.id, LearningSession.client_request_id == idempotency_key))):
        return existing
    if (open_session := db.scalar(select(LearningSession).where(LearningSession.user_id == user.id,
                                                                LearningSession.status.in_(OPEN)))) is not None:
        raise APIError(409, "open_session_exists", f"Finish or end session {open_session.id} first")
    version = current_version(db, lesson)
    topic, game = db.get(LearningTopic, lesson.topic_id), _loads(version.game_config_json, {})
    if variant and variant not in game.get("variants", []):
        raise APIError(422, "variant_not_supported", "This lesson has no such game")
    zone = account_timezone(db, user, device_zone)
    seed = secrets.randbelow(2**31 - 1)
    subject = db.get(LearningSubject, topic.subject_id)
    if subject.code == "math":
        snapshots = math_items(db, user, topic, game, seed, review_keys)
    else:
        snapshots = english_items(db, user, lesson, version, game, variant, seed, review_keys)
    if not snapshots:
        raise APIError(409, "nothing_to_review", "There is nothing to review in this topic")
    if game["game_type"] == "meteor" and all(snap["kind"] == "word_spelling" for snap in snapshots):
        variant = "word_shooter"  # a review of Anh → Việt words only is played as that game
    rules = {**DEFAULT_SCORING, "hearts": hearts_for(game["game_type"], mode), "travel_seconds": game.get("travel_seconds", 0),
             "max_targets": game.get("max_targets", {}).get(mode, 1),
             "variant": default_variant(game["game_type"], variant),
             "generator": game.get("generator")}
    if subject.code == "english":  # the published state of the banks this stage was drawn from
        rules["content_release"] = {bank: grammar_bank.current_release(db, bank) for bank in ("vocabulary", "grammar")}
    now = clock.now()
    s = LearningSession(user_id=user.id, subject_id=subject.id, topic_id=topic.id, level_id=lesson.level_id,
                        lesson_id=lesson.id, lesson_version_id=version.id, kind=kind, mode=mode,
                        game_type=game["game_type"], game=game_of(game["game_type"], rules["variant"]), status="paused" if start_paused else "active", seed=seed,
                        scoring_json=json.dumps(rules, ensure_ascii=False), timezone=zone,
                        duration_seconds=duration_minutes * 60, required_count=len(snapshots),
                        hearts_max=rules["hearts"], hearts=rules["hearts"],
                        next_position=len(snapshots), client_request_id=idempotency_key,
                        started_at=now, last_tick_at=None if start_paused else now,
                        paused_at=now if start_paused else None, updated_at=now)
    db.add(s)
    try:
        db.flush()
        items = [_new_item(s, i, snap) for i, snap in enumerate(snapshots)]
        db.add_all(items)
        db.flush()
        issue_turns(s, items, now, want=1)
        db.commit()
    except IntegrityError:
        # Same Idempotency-Key from a concurrent retry, or another open session created at the same moment.
        db.rollback()
        if idempotency_key and (existing := db.scalar(select(LearningSession).where(
                LearningSession.user_id == user.id, LearningSession.client_request_id == idempotency_key))):
            return existing
        raise APIError(409, "open_session_exists", "Finish or end the open session first")
    return s


def _new_item(s: LearningSession, position: int, snap: dict, *, practice_of: LearningSessionItem | None = None) -> LearningSessionItem:
    return LearningSessionItem(
        session_id=s.id, position=position, turn_id=secrets.token_urlsafe(12), question_id=snap.get("question_id"),
        question_key=snap["question_key"], skill_key=snap["skill_key"], skill_label=snap["skill_label"], kind=snap["kind"],
        prompt_json=json.dumps(snap["prompt"], ensure_ascii=False), answer_json=json.dumps(snap["answer"], ensure_ascii=False),
        hints_json=json.dumps(snap["hints"], ensure_ascii=False), explanation=snap.get("explanation"),
        required=practice_of is None, practice_of_id=practice_of.id if practice_of else None, state="queued")


def add_practice_turn(db: Session, s: LearningSession, items: list[LearningSessionItem], source: LearningSessionItem) -> bool:
    """Queue the same question again at the end of the stage (bounded per session)."""
    rules = _rules(s)
    if sum(1 for i in items if i.practice_of_id is not None) >= rules["max_practice_turns"]:
        return False
    root = db.get(LearningSessionItem, source.practice_of_id) if source.practice_of_id else source
    snap = {"question_id": root.question_id, "question_key": root.question_key, "skill_key": root.skill_key,
            "skill_label": root.skill_label, "kind": root.kind, "prompt": _loads(root.prompt_json),
            "answer": _loads(root.answer_json), "hints": _loads(root.hints_json, []), "explanation": root.explanation}
    item = _new_item(s, s.next_position, snap, practice_of=root)
    s.next_position += 1
    db.add(item)
    db.flush()
    items.append(item)
    return True


# ---------------------------------------------------------------------------------------------------------------
# Progress and review list (written in the same transaction as the confirmed answer)
# ---------------------------------------------------------------------------------------------------------------

def _skill_type(skill_key: str) -> str:
    if skill_key.startswith("en.word."):
        return "word"  # Việt → Anh: recalling the word from its meaning (vocabulary mastery)
    if skill_key.startswith("en.spell."):
        return "spelling"  # Anh → Việt: typing the word shown; never counts as knowing the word
    return "grammar_point" if skill_key.startswith("en.grammar.") else "math_type"


def record_progress(db: Session, s: LearningSession, item: LearningSessionItem, now: datetime) -> None:
    practice = item.practice_of_id is not None
    row = db.scalar(select(LearningSkillProgress).where(LearningSkillProgress.user_id == s.user_id,
                                                        LearningSkillProgress.skill_key == item.skill_key))
    if row is None:
        row = LearningSkillProgress(user_id=s.user_id, subject_id=s.subject_id, skill_key=item.skill_key,
                                    skill_type=_skill_type(item.skill_key), label=item.skill_label, attempts=0, first_try=0,
                                    corrected=0, hinted=0, revealed=0, missed=0, wrong=0, mastery=0, error_counts_json="{}")
        db.add(row)
    outcome = item.outcome
    row.attempts += 1
    if practice and outcome in CORRECT:
        row.corrected += 1  # right only after seeing the answer: never a first-try success
    elif outcome in ("first_try", "hinted", "corrected", "wrong", "revealed", "missed"):
        setattr(row, outcome, getattr(row, outcome) + 1)
    if item.error_type:
        errors = _loads(row.error_counts_json, {})
        errors[item.error_type] = errors.get(item.error_type, 0) + 1
        row.error_counts_json = json.dumps(errors)
    row.mastery = mastery_after(row.mastery, outcome, practice_turn=practice)
    row.last_seen_at = now


def record_review(db: Session, s: LearningSession, item: LearningSessionItem) -> None:
    root_key = item.question_key
    row = db.scalar(select(LearningReviewItem).where(LearningReviewItem.user_id == s.user_id,
                                                     LearningReviewItem.lesson_id == s.lesson_id,
                                                     LearningReviewItem.question_key == root_key))
    flagged = item.outcome in REVIEW_REASONS and not (item.practice_of_id is not None and item.outcome in CORRECT)
    label = item.skill_label if item.kind in ("math_input", "missing_number", "compare", "word_spelling") else \
        f"{item.skill_label}: {correct_answer_text(item)}"
    if flagged:
        if row is None:
            db.add(LearningReviewItem(user_id=s.user_id, subject_id=s.subject_id, topic_id=s.topic_id, lesson_id=s.lesson_id,
                                      question_key=root_key, skill_key=item.skill_key, label=label[:160], reason=item.outcome,
                                      status="open", times_flagged=1, times_practiced=0, last_session_id=s.id))
        else:
            row.status, row.reason, row.label, row.last_session_id = "open", item.outcome, label[:160], s.id
            row.times_flagged += 1
    elif row is not None:
        row.times_practiced += 1
        # Cleared by a first-try answer in a later session (not right after the mistake, not after a reveal).
        if item.outcome == "first_try" and item.practice_of_id is None and row.last_session_id != s.id:
            row.status = "cleared"


def resolve(db: Session, s: LearningSession, item: LearningSessionItem, outcome: str, now: datetime) -> None:
    item.state, item.outcome, item.resolved_at = "resolved", outcome, now
    record_progress(db, s, item, now)
    record_review(db, s, item)
    if item.kind in ("gate_choice", "bridge_order"):
        answer = _loads(item.answer_json, {})
        if answer.get("item_key") and answer.get("game") in grammar_bank.GAMES:
            grammar_bank.record_history(db, s.user_id, s.id, answer, outcome, item.practice_of_id is not None, now)


def finalize_open_turns(db: Session, s: LearningSession, items: list[LearningSessionItem], now: datetime) -> None:
    """When a stage ends, confirmed mistakes on turns left open still count (progress and review list).
    Turns with no attempt stay unanswered and count for nothing."""
    for item in items:
        if item.state == "issued" and item.wrong_attempts:
            resolve(db, s, item, "wrong", now)


def lose_heart(s: LearningSession, now: datetime) -> int:
    if not s.hearts_max:  # Học tập stages started before practice had hearts
        return 0
    s.hearts = max(0, s.hearts - 1)
    s.combo = 0
    if s.hearts == 0:
        transition(s, "failed")
        s.ended_at, s.end_reason, s.last_tick_at, s.reward_status = now, "out_of_hearts", None, "not_eligible"
    return -1


# ---------------------------------------------------------------------------------------------------------------
# Events: one transaction each, idempotent by client_event_id, safe under concurrency (optimistic version check)
# ---------------------------------------------------------------------------------------------------------------

def _replay(db: Session, s: LearningSession, event_type: str, client_event_id: str | None) -> dict | None:
    if not client_event_id:
        return None
    prior = db.scalar(select(LearningEvent).where(LearningEvent.session_id == s.id, LearningEvent.client_event_id == client_event_id))
    if prior is None:
        return None
    if prior.event_type != event_type:
        raise APIError(409, "idempotency_conflict", "This event id was already used for another action")
    return {"result": _loads(prior.response_json), "session": session_out(db, s), "replayed": True}


def run_event(db: Session, user: User, session_id: int, event_type: str, client_event_id: str | None, apply) -> dict:
    for _ in range(5):
        s = owned_session(db, user, session_id)
        if (replayed := _replay(db, s, event_type, client_event_id)) is not None:
            return replayed
        now = clock.now()
        try:
            items = _items(db, s)
            result, event = apply(s, items, now)
            event.session_id, event.user_id, event.client_event_id = s.id, user.id, client_event_id
            event.event_type, event.created_at = event_type, now
            event.response_json = json.dumps(result, ensure_ascii=False) if result is not None else None
            s.updated_at = now  # always bump the session version, even when only items changed
            db.add(event)
            db.commit()
        except (StaleDataError, IntegrityError):
            db.rollback()  # another request changed the session first: re-read and try again (or replay)
            continue
        except APIError:
            db.rollback()
            # The same event may have been committed by a concurrent duplicate since we looked: replay it.
            s = owned_session(db, user, session_id)
            if (replayed := _replay(db, s, event_type, client_event_id)) is not None:
                return replayed
            raise
        except Exception:
            db.rollback()
            raise
        return {"result": result, "session": session_out(db, s, now), "replayed": False}
    raise APIError(409, "concurrent_update", "The session changed at the same time; please retry")


def _find_open_turn(items: list[LearningSessionItem], turn_id: str) -> LearningSessionItem:
    item = next((i for i in items if i.turn_id == turn_id), None)
    if item is None:
        raise APIError(404, "turn_not_found", "Turn not found in this session")
    if item.state != "issued":
        raise APIError(409, "turn_not_open", "This turn is not open")
    return item


def check_answer(item: LearningSessionItem, answer) -> tuple[bool, str | None, str]:
    """(correct, error type, normalized answer text). Raises InvalidAnswer for empty or malformed input."""
    prompt, expected = _loads(item.prompt_json, {}), _loads(item.answer_json, {})
    if item.kind == "bridge_order":
        if not isinstance(answer, list):
            raise InvalidAnswer("expected token ids")
        return check_bridge(answer, prompt["tokens"], expected["accepted"]), None, " ".join(answer)
    if not isinstance(answer, str):
        raise InvalidAnswer("expected text")
    if item.kind in VOCAB_KINDS:
        return check_text(answer, expected["accepted"]), None, answer.strip()
    if item.kind == "gate_choice":
        return check_choice(answer, prompt["options"], expected["option"]), None, answer
    if item.kind == "compare":
        ok = check_choice(answer, prompt["options"], expected["value"])
        return ok, None if ok else compare_error_type({"answer": expected}, answer), answer
    value = parse_number(answer)
    ok = check_number(answer, expected["value"], expected.get("tolerance"))
    return ok, None if ok else math_error_type({"kind": item.kind, "answer": expected}, value), str(value)


def answer_event(db: Session, user: User, session_id: int, data: AnswerInput) -> dict:
    def apply(s: LearningSession, items, now):
        require_active(s)
        tick(s, now)
        item = _find_open_turn(items, data.turn_id)
        rules = _rules(s)
        if item.attempts >= rules["max_attempts"]:
            raise APIError(409, "too_many_attempts", "Too many attempts on this turn")
        try:
            correct, error_type, given = check_answer(item, data.answer)
            if item.kind in TYPED_TARGET_KINDS:
                # Typing at falling words: the shot hits whichever open word it matches, the one closest to the ground
                # (issued first) when several do, and destroys only that one. A miss counts against the aimed word.
                hits = [i for i in items if i.state == "issued" and i.kind in TYPED_TARGET_KINDS and check_answer(i, data.answer)[0]]
                if hits:
                    item = max(hits, key=lambda i: (fall_progress(i, rules, s.mode, s.active_ms), -i.position))
                    correct, error_type = True, None
        except InvalidAnswer:
            raise APIError(422, "invalid_answer_format", "Empty or malformed answer; it was not counted")
        item.attempts += 1
        practice = item.practice_of_id is not None
        result = {"turn_id": item.turn_id, "event": "answer", "correct": correct, "outcome": None, "resolved": False,
                  "retry_allowed": False, "error_type": error_type, "score_delta": 0, "hearts_delta": 0, "combo": s.combo,
                  "hint": None, "correct_answer": None, "explanation": None, "practice_added": False, "word": None}
        if correct:
            outcome = correct_outcome(item.wrong_attempts, item.hints_used)
            resolve(db, s, item, outcome, now)
            if s.mode == "challenge":
                points, s.combo = score_for(outcome, s.combo, rules, practice_turn=practice)
                s.score += points
                s.max_combo = max(s.max_combo, s.combo)
                result["score_delta"] = points
            result.update(outcome=outcome, resolved=True, correct_answer=correct_answer_text(item),
                          explanation=item.explanation, combo=s.combo, word=word_pair(item))
        else:
            item.wrong_attempts += 1
            item.error_type = error_type or item.error_type
            if s.mode == "challenge":
                s.combo = 0
            if WRONG_POLICY[item.kind] == "reveal":
                resolve(db, s, item, "wrong", now)
                result.update(outcome="wrong", resolved=True, correct_answer=correct_answer_text(item),
                              explanation=item.explanation, word=word_pair(item))
                # Học tập: try the question again later in the stage ("thử lại"). A wrong re-practice is retried too.
                if s.mode == "practice" or practice:
                    result["practice_added"] = add_practice_turn(db, s, items, item)
            else:
                result["retry_allowed"] = True
            if s.mode == "practice" or item.kind in HEART_ON_WRONG:
                result["hearts_delta"] = lose_heart(s, now)
            result["combo"] = s.combo
        if s.status == "active":
            issue_turns(s, items, now, want=1)
        else:
            finalize_open_turns(db, s, items, now)
        event = LearningEvent(item_id=item.id, answer_text=given[:300], is_correct=correct, error_type=error_type,
                              score_delta=result["score_delta"], hearts_delta=result["hearts_delta"])
        return result, event
    return run_event(db, user, session_id, "answer", data.client_event_id, apply)


def hint_event(db: Session, user: User, session_id: int, data: TurnEvent) -> dict:
    def apply(s, items, now):
        require_active(s)
        tick(s, now)
        item = _find_open_turn(items, data.turn_id)
        hints = _loads(item.hints_json, [])
        if item.hints_used >= len(hints):
            raise APIError(409, "no_more_hints", "No more hints for this turn")
        item.hints_used += 1
        result = {"turn_id": item.turn_id, "event": "hint", "hint": hints[item.hints_used - 1], "combo": s.combo}
        return result, LearningEvent(item_id=item.id)
    return run_event(db, user, session_id, "hint", data.client_event_id, apply)


def reveal_event(db: Session, user: User, session_id: int, data: TurnEvent) -> dict:
    def apply(s, items, now):
        require_active(s)
        tick(s, now)
        item = _find_open_turn(items, data.turn_id)
        item.revealed = True
        if s.mode == "challenge":
            s.combo = 0
        resolve(db, s, item, "revealed", now)
        added = add_practice_turn(db, s, items, item)
        issue_turns(s, items, now, want=1)
        result = {"turn_id": item.turn_id, "event": "reveal", "outcome": "revealed", "resolved": True, "combo": s.combo,
                  "correct_answer": correct_answer_text(item), "explanation": item.explanation, "practice_added": added,
                  "word": word_pair(item)}
        return result, LearningEvent(item_id=item.id)
    return run_event(db, user, session_id, "reveal", data.client_event_id, apply)


def miss_event(db: Session, user: User, session_id: int, data: TurnEvent) -> dict:
    def apply(s, items, now):
        require_active(s)
        tick(s, now)
        item = _find_open_turn(items, data.turn_id)
        if s.mode != "challenge" or item.kind not in MOVING_KINDS:
            raise APIError(409, "miss_not_allowed", "Targets only move in Challenge mode")
        rules = _rules(s)
        # Plausibility, not anti-cheat: the target must have been on screen for a reasonable share of its travel time.
        on_screen_ms = s.active_ms - (item.issued_active_ms or 0)
        if on_screen_ms < item_travel(item, rules) * 1000 * rules["miss_min_share"]:
            raise APIError(409, "miss_too_early", "The target cannot have arrived yet")
        resolve(db, s, item, "missed", now)
        hearts_delta = lose_heart(s, now)
        s.combo = 0
        if item.practice_of_id is not None:  # a revealed answer still needs a correct re-practice
            add_practice_turn(db, s, items, item)
        if s.status == "active":
            issue_turns(s, items, now, want=1)
        else:
            finalize_open_turns(db, s, items, now)
        # A missed word shows its English–Vietnamese pair, to review it.
        result = {"turn_id": item.turn_id, "event": "miss", "outcome": "missed", "resolved": True, "hearts_delta": hearts_delta,
                  "combo": 0, "correct_answer": correct_answer_text(item), "explanation": item.explanation, "word": word_pair(item)}
        return result, LearningEvent(item_id=item.id, hearts_delta=hearts_delta)
    return run_event(db, user, session_id, "miss", data.client_event_id, apply)


# ---------------------------------------------------------------------------------------------------------------
# Rewards
# ---------------------------------------------------------------------------------------------------------------

def daily_learning_task_open(db: Session, user: User) -> bool:
    selected = json.loads(user.daily_task_ids or "[]") if user.daily_tasks_selected else []
    if DAILY_LEARNING_TASK not in selected:
        return False
    return db.scalar(select(Activity.id).where(Activity.user_id == user.id, Activity.kind == f"quest_{DAILY_LEARNING_TASK}",
                                               Activity.created_at >= quest_day_start()).limit(1)) is None


def grant_stage_reward(db: Session, user: User, s: LearningSession, now: datetime) -> None:
    """Runs inside the completion transaction. The (user, subject, local day) claim is a unique row, so a second
    session, device or concurrent request can't claim it again; the EXP goes through the shared ExpEvent ledger."""
    db.add(Activity(user_id=user.id, kind="lesson", ref=f"learning:{s.id}"))  # counts for the legacy "lesson" quest
    if s.kind != "lesson" or s.required_count < MIN_REWARD_TURNS:
        s.reward_status, s.reward_exp = "not_eligible", 0
        return
    local_date, day_start, day_end = local_day_bounds(now, s.timezone)
    use_task = daily_learning_task_open(db, user)
    claim = LearningReward(user_id=user.id, subject_id=s.subject_id, session_id=s.id, local_date=local_date,
                           kind="daily_task" if use_task else "stage", exp_amount=0)
    try:
        with db.begin_nested():
            db.add(claim)
            db.flush()
    except IntegrityError:
        s.reward_status, s.reward_exp = "already_claimed", 0
        return
    db.scalar(select(User.id).where(User.id == user.id).with_for_update())  # serialize cap checks on PostgreSQL
    if use_task:
        # The stage completed the daily "learning" task: its task reward is given instead of (not on top of) the stage reward.
        db.add(Activity(user_id=user.id, kind=f"quest_{DAILY_LEARNING_TASK}"))
        granted = award_exp(user, db, source="task", reference_id=f"quest:{DAILY_LEARNING_TASK}:{quest_day_start().date().isoformat()}",
                            requested=DAILY_TASK_BY_ID[DAILY_LEARNING_TASK]["exp"], daily_cap=settings.task_daily_exp_cap)
        status = "daily_task"
    else:
        earned = pool_exp_between(user, db, "learning", day_start, day_end)
        granted = award_exp(user, db, source="learning", reference_id=f"learning:{s.subject_id}:{local_date.isoformat()}",
                            requested=settings.learning_stage_exp, daily_cap=settings.task_daily_exp_cap, already_earned=earned)
        status = "granted" if granted == settings.learning_stage_exp else "capped" if granted else "daily_cap_reached"
    claim.exp_amount = granted
    s.reward_status, s.reward_exp = status, granted


# ---------------------------------------------------------------------------------------------------------------
# Housekeeping on read: pause sessions left running by a closed app, expire forgotten ones
# ---------------------------------------------------------------------------------------------------------------

def settle_on_read(db: Session, s: LearningSession) -> None:
    if s.status not in OPEN:
        return
    now = clock.now()
    try:
        if now - as_utc(s.updated_at) > timedelta(hours=settings.learning_expire_hours):
            tick(s, now)
            transition(s, "abandoned")
            s.ended_at, s.end_reason, s.last_tick_at, s.reward_status = now, "expired", None, "not_eligible"
            finalize_open_turns(db, s, _items(db, s), now)
        elif s.status == "active" and s.last_tick_at is not None and \
                now - as_utc(s.last_tick_at) > timedelta(seconds=settings.learning_auto_pause_seconds):
            tick(s, now)
            transition(s, "paused")
            s.last_tick_at, s.paused_at = None, now
        else:
            return
        s.updated_at = now
        db.commit()
    except StaleDataError:
        db.rollback()
        db.refresh(s)


# ---------------------------------------------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------------------------------------------

IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", pattern=r"^[A-Za-z0-9_-]{8,64}$")]


@router.post("/sessions", status_code=201, response_model=SessionOut, summary="Start a stage of a lesson")
def start_session(data: SessionCreate, idempotency_key: IdempotencyKey = None,
                  user: User = Depends(current_user), db: Session = Depends(get_db)):
    lesson = db.get(LearningLesson, data.lesson_id)
    if lesson is None or lesson.status != "published":
        raise APIError(404, "lesson_not_found", "Lesson not found")
    s = create_session(db, user, lesson=lesson, mode=data.mode, duration_minutes=data.duration_minutes,
                       variant=data.variant, device_zone=data.timezone, kind="lesson", idempotency_key=idempotency_key,
                       start_paused=data.start_paused)
    return session_out(db, s)


# "Học tập → Tiếng Anh → Chọn trò → Chơi ngay": each game plays one lesson whose content the backend picks per stage.
QUICK_GAMES = {"word_shooter": ("en.vocab.mix", "word_shooter"), "meteor": ("en.vocab.mix", "meteor"),
               "gate": ("en.grammar.bank", "gate"), "bridge": ("en.grammar.bank", "bridge")}


@router.post("/play", status_code=201, response_model=SessionOut, summary="Start an English game right away (no setup)")
def quick_start(data: QuickStart, idempotency_key: IdempotencyKey = None,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Creates a paused stage of the game's lesson (the app shows a 3-2-1 countdown, then resumes it). The words or
    questions are chosen from the user's level, history and review list: there is nothing to configure."""
    code, variant = QUICK_GAMES[data.game]
    lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == code))
    if lesson is None or lesson.status != "published":
        raise APIError(404, "lesson_not_found", "Lesson not found")
    s = create_session(db, user, lesson=lesson, mode=data.mode, duration_minutes=data.duration_minutes, variant=variant,
                       device_zone=data.timezone, kind="lesson", idempotency_key=idempotency_key, start_paused=True)
    return session_out(db, s)


@router.post("/review/sessions", status_code=201, response_model=SessionOut, summary="Practise the open review items of a topic")
def start_review_session(data: ReviewSessionCreate, idempotency_key: IdempotencyKey = None,
                         user: User = Depends(current_user), db: Session = Depends(get_db)):
    topic = db.get(LearningTopic, data.topic_id)
    if topic is None:
        raise APIError(404, "topic_not_found", "Topic not found")
    rows = db.execute(select(LearningReviewItem.lesson_id, func.count()).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.topic_id == topic.id, LearningReviewItem.status == "open")
        .group_by(LearningReviewItem.lesson_id).order_by(func.count().desc())).all()
    if not rows:
        raise APIError(409, "nothing_to_review", "There is nothing to review in this topic")
    lesson = db.get(LearningLesson, rows[0][0])
    s = create_session(db, user, lesson=lesson, mode=data.mode, duration_minutes=data.duration_minutes, variant=None,
                       device_zone=data.timezone, kind="review", idempotency_key=idempotency_key,
                       review_keys=_open_review_keys(db, user.id, lesson.id), start_paused=data.start_paused)
    return session_out(db, s)


@router.get("/sessions/current", summary="The open (active or paused) session to resume, if any")
def current_session(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    s = db.scalar(select(LearningSession).where(LearningSession.user_id == user.id, LearningSession.status.in_(OPEN)))
    if s is not None:
        settle_on_read(db, s)
    return {"session": session_out(db, s) if s is not None and s.status in OPEN else None}


@router.get("/sessions", summary="Recent sessions")
def list_sessions(limit: int = Query(default=20, ge=1, le=50), user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(LearningSession).where(LearningSession.user_id == user.id)
                      .order_by(LearningSession.id.desc()).limit(limit))
    return {"items": [{"id": s.id, "status": s.status, "kind": s.kind, "mode": s.mode, "game_type": s.game_type,
                       "lesson_id": s.lesson_id, "score": s.score, "reward_exp": s.reward_exp,
                       "started_at": as_utc(s.started_at).isoformat(),
                       "ended_at": as_utc(s.ended_at).isoformat() if s.ended_at else None} for s in rows]}


@router.get("/sessions/{session_id}", response_model=SessionOut, summary="Session state (to restore after reopening the app)")
def get_session(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = owned_session(db, user, session_id)
    settle_on_read(db, s)
    return session_out(db, s)


@router.get("/sessions/{session_id}/intro", summary="The introduction of the lesson version this session uses")
def get_session_intro(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = owned_session(db, user, session_id)
    return {"intro": lesson_intro(db, db.get(LearningLessonVersion, s.lesson_version_id), session=s)}


@router.post("/sessions/{session_id}/next", response_model=EventOut, summary="Open more turns (up to the game's target count)")
def next_turns(session_id: int, data: NextInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    def apply(s, items, now):
        require_active(s)
        tick(s, now)
        open_now = sum(1 for i in items if i.state == "issued")
        issue_turns(s, items, now, want=open_now + data.count)
        return None, LearningEvent()
    return run_event(db, user, session_id, "next", None, apply)


@router.post("/sessions/{session_id}/answer", response_model=EventOut, summary="Answer an open turn")
def post_answer(session_id: int, data: AnswerInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return answer_event(db, user, session_id, data)


@router.post("/sessions/{session_id}/hint", response_model=EventOut, summary="Show the next hint of an open turn")
def post_hint(session_id: int, data: TurnEvent, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return hint_event(db, user, session_id, data)


@router.post("/sessions/{session_id}/reveal", response_model=EventOut, summary="Show the answer (adds a re-practice turn)")
def post_reveal(session_id: int, data: TurnEvent, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return reveal_event(db, user, session_id, data)


@router.post("/sessions/{session_id}/miss", response_model=EventOut, summary="A moving target reached the ground/base (Challenge)")
def post_miss(session_id: int, data: TurnEvent, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return miss_event(db, user, session_id, data)


@router.post("/sessions/{session_id}/pause", response_model=EventOut, summary="Pause: stops the clock and every target")
def pause_session(session_id: int, data: ControlInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    def apply(s, items, now):
        if s.status == "paused":
            return None, LearningEvent()  # already paused (other device, retry): nothing changes
        require_active(s)
        tick(s, now)
        transition(s, "paused")
        s.last_tick_at, s.paused_at = None, now
        return None, LearningEvent()
    return run_event(db, user, session_id, "pause", data.client_event_id, apply)


@router.post("/sessions/{session_id}/resume", response_model=EventOut, summary="Resume a paused session")
def resume_session(session_id: int, data: ControlInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    def apply(s, items, now):
        if s.status == "active":
            return None, LearningEvent()
        if s.status in TERMINAL:
            raise APIError(409, "session_ended", "This session has already ended")
        transition(s, "active")
        s.last_tick_at, s.paused_at = now, None
        issue_turns(s, items, now, want=1)
        return None, LearningEvent()
    return run_event(db, user, session_id, "resume", data.client_event_id, apply)


@router.post("/sessions/{session_id}/extend", response_model=EventOut, summary="Study longer after the time is up (Học thêm)")
def extend_session(session_id: int, data: ExtendInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    def apply(s, items, now):
        if s.status in TERMINAL:
            raise APIError(409, "session_ended", "This session has already ended")
        tick(s, now)
        if s.duration_seconds + data.minutes * 60 > settings.learning_max_duration_minutes * 60:
            raise APIError(409, "duration_limit", "The session cannot be extended further")
        s.duration_seconds += data.minutes * 60
        issue_turns(s, items, now, want=1)
        return None, LearningEvent()
    return run_event(db, user, session_id, "extend", data.client_event_id, apply)


@router.post("/sessions/{session_id}/complete", response_model=EventOut, summary="Finish the stage and claim its reward once")
def complete_session(session_id: int, data: ControlInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = owned_session(db, user, session_id)
    if s.status == "completed":  # finishing again (retry, other device) never adds EXP again
        return {"result": None, "session": session_out(db, s), "replayed": True}

    def apply(s, items, now):
        if s.status == "completed":
            return None, LearningEvent()
        if s.status in TERMINAL:
            raise APIError(409, "session_ended", "This session has already ended")
        can_complete, _ = completion_state(items)
        if not can_complete:
            raise APIError(409, "session_incomplete", "Answer every turn (and re-practise revealed answers) first")
        tick(s, now)
        transition(s, "completed")
        s.ended_at, s.end_reason, s.last_tick_at, s.paused_at = now, "completed", None, None
        grant_stage_reward(db, user, s, now)
        from .memories import record_event
        record_event(db, user, "first_learning_session", "first:learning", at=now,
                     result="Hoàn thành phiên học đầu tiên")
        return None, LearningEvent()
    out = run_event(db, user, session_id, "complete", data.client_event_id, apply)
    maybe_start_walk(user, db)  # the daily learning task may have completed today's quests
    return out


@router.post("/sessions/{session_id}/abandon", response_model=EventOut, summary="End the session early (no completion reward)")
def abandon_session(session_id: int, data: AbandonInput, user: User = Depends(current_user), db: Session = Depends(get_db)):
    def apply(s, items, now):
        if s.status == "abandoned":
            return None, LearningEvent()
        if s.status in TERMINAL:
            raise APIError(409, "session_ended", "This session has already ended")
        tick(s, now)
        transition(s, "abandoned")
        s.ended_at, s.end_reason, s.last_tick_at, s.reward_status = now, data.reason, None, "not_eligible"
        finalize_open_turns(db, s, items, now)
        return None, LearningEvent()
    return run_event(db, user, session_id, "abandon", data.client_event_id, apply)


@router.get("/sessions/{session_id}/result", response_model=ResultOut, summary="Result of a finished session, with every answer")
def session_result(session_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = owned_session(db, user, session_id)
    settle_on_read(db, s)
    if s.status not in TERMINAL:
        raise APIError(409, "session_not_finished", "The session is still running")
    items = _items(db, s)
    counts = {k: 0 for k in ("first_try", "hinted", "corrected", "wrong", "revealed", "missed", "unanswered")}
    for item in items:
        if item.practice_of_id is None:
            counts[item.outcome or "unanswered"] += 1
    shown = [i for i in items if i.state != "queued"]  # never reveal answers of turns the user didn't see
    open_reviews = db.scalar(select(func.count()).select_from(LearningReviewItem).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.topic_id == s.topic_id, LearningReviewItem.status == "open")) or 0
    return {"session": session_out(db, s, items=items), "counts": counts, "open_review_count": open_reviews,
            "items": [{"turn_id": i.turn_id, "position": i.position, "kind": i.kind, "skill_label": i.skill_label,
                       "prompt": _loads(i.prompt_json, {}), "outcome": i.outcome, "practice": i.practice_of_id is not None,
                       "attempts": i.attempts, "hints_used": i.hints_used, "error_type": i.error_type,
                       "correct_answer": correct_answer_text(i), "explanation": i.explanation, "word": word_pair(i)}
                      for i in shown]}


@router.get("/review", summary="The user's “cần ôn” list, weakest first, grouped by topic")
def review_list(subject: Literal["english", "math"] | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = select(LearningReviewItem, LearningTopic, LearningSubject).join(
        LearningTopic, LearningTopic.id == LearningReviewItem.topic_id).join(
        LearningSubject, LearningSubject.id == LearningReviewItem.subject_id).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.status == "open")
    if subject:
        query = query.where(LearningSubject.code == subject)
    groups: dict[int, dict] = {}
    for row, topic, subj in db.execute(query).all():
        group = groups.setdefault(topic.id, {"topic": {"id": topic.id, "code": topic.code, "name": topic.name},
                                             "subject": {"id": subj.id, "code": subj.code, "name": subj.name}, "items": []})
        group["items"].append({"id": row.id, "label": row.label, "reason": row.reason, "skill_key": row.skill_key,
                               "times_flagged": row.times_flagged, "updated_at": as_utc(row.updated_at).isoformat()})
    out = list(groups.values())
    for group in out:
        group["items"].sort(key=lambda r: (-REVIEW_WEIGHT.get(r["reason"], 1), -r["times_flagged"]))
    out.sort(key=lambda g: -sum(REVIEW_WEIGHT.get(r["reason"], 1) for r in g["items"]))
    return {"groups": out, "total": sum(len(g["items"]) for g in out)}


@router.get("/progress", summary="Progress per word, grammar point and math problem type")
def progress(subject: Literal["english", "math"] | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    query = select(LearningSkillProgress, LearningSubject).join(LearningSubject).where(LearningSkillProgress.user_id == user.id)
    if subject:
        query = query.where(LearningSubject.code == subject)
    points = grammar_bank.point_progress(db, user.id)

    def mastered(p: LearningSkillProgress) -> bool:
        # A grammar point of the bank needs several different questions right at the first try, not one sentence.
        return p.mastery >= MASTERED_AT and points.get(p.skill_key, {}).get("mastered", True)
    skills = [{"skill_key": p.skill_key, "skill_type": p.skill_type, "label": p.label, "subject": subj.code,
               "attempts": p.attempts, "first_try": p.first_try, "corrected": p.corrected, "hinted": p.hinted,
               "revealed": p.revealed, "missed": p.missed, "wrong": p.wrong, "mastery": p.mastery,
               "mastered": mastered(p), "errors": _loads(p.error_counts_json, {}),
               **({"questions": points[p.skill_key]["questions"], "first_try_questions": points[p.skill_key]["first_try_questions"]}
                  if p.skill_key in points else {})}
              for p, subj in db.execute(query.order_by(LearningSkillProgress.mastery)).all()]
    return {"skills": skills}
