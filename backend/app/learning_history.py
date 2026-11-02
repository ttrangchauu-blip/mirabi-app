"""“Từ đã học”: the history of the English words a user met in the two vocabulary games, and practising them again.

Nothing new is stored. Every turn a game served is already kept in `learning_session_items` with a frozen copy of its
word, meaning and answer, its state (issued / resolved) and outcome, and answers are idempotent per client event id.
The history is a read of those rows, one entry per sense (`entry_key`: "bank.money" and "bank.river" are two
entries), so a retried or re-synced answer can never count twice, and sessions played before this screen existed are
part of it with their real results. Practising again starts an ordinary review stage of the existing games, which
records progress and history like any other stage and earns no completion reward. Rules: docs/LEARNING_GAMES.md.
"""
import unicodedata
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import clock, education, vocab_discovery
from .db import get_db
from .errors import APIError
from .learning import IdempotencyKey, QUICK_GAMES, _loads, create_session, session_out
from .learning_engine import MASTERED_AT
from .learning_vocab import POS_VI, TOPICS
from .models import (LearningLesson, LearningSession, LearningSessionItem, LearningSkillProgress, LearningVocabEntry, User,
                     VocabLevelProgress, as_utc)
from .security import current_user

router = APIRouter(prefix="/api/learning/vocabulary", tags=["learning"])

# The two vocabulary games, by the kind of turn they serve.
DIRECTION = {"word_spelling": "en_vi", "vocab_typing": "vi_en"}  # Anh → Việt (Bắn từ vựng), Việt → Anh (Bắn thiên thạch)
GAME_OF = {"en_vi": "word_shooter", "vi_en": "meteor"}
# A turn answered without seeing the answer: right at once, or right after a letter hint. Fixing a wrong answer,
# a wrong answer, "Xem đáp án" and a word that reached the ground are all wrong.
CORRECT = {"first_try", "hinted"}
PRACTICE_LIMIT = 12  # the most words a review stage holds (learning_vocab.bank_items)
PAGE_SIZE = 15  # words per page of the history


def fold(text: str | None) -> str:
    """Case- and accent-insensitive, so "ban" finds "bàn" and "dao" finds "đào"."""
    text = unicodedata.normalize("NFD", text or "").replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in text if unicodedata.category(c) != "Mn").lower().strip()


def entry_key_of(item: LearningSessionItem, answer: dict) -> str:
    # The progress key carries the sense for every vocabulary turn: en.word.<key> (Việt → Anh), en.spell.<key> (Anh → Việt).
    return answer.get("entry_key") or item.skill_key.removeprefix("en.spell.").removeprefix("en.word.")


def result_of(item: LearningSessionItem) -> str:
    if item.state != "resolved" or item.outcome is None:
        return "unanswered"
    return "correct" if item.outcome in CORRECT else "wrong"


def _iso(value: datetime | None) -> str | None:
    return as_utc(value).isoformat() if value else None


def collect(db: Session, user: User, entry_key: str | None = None, year: int | None = None) -> dict[str, dict]:
    """Every vocabulary turn this user was shown (in school year `year`, if given), grouped by sense, newest answer first."""
    rows = db.execute(
        select(LearningSessionItem, LearningSession.status, LearningSession.academic_year)
        .join(LearningSession, LearningSession.id == LearningSessionItem.session_id)
        .where(LearningSession.user_id == user.id, LearningSessionItem.kind.in_(DIRECTION),
               LearningSessionItem.state.in_(("issued", "resolved")))  # queued turns were never on screen
    ).all()
    entries: dict[str, dict] = {}
    for item, session_status, session_year in rows:
        if year is not None and session_year != year:
            continue
        answer, prompt = _loads(item.answer_json, {}), _loads(item.prompt_json, {})
        key = entry_key_of(item, answer)
        if entry_key is not None and key != entry_key:
            continue
        at = item.resolved_at or item.issued_at
        e = entries.setdefault(key, {"entry_key": key, "attempts": [], "frozen": None, "frozen_at": None})
        if e["frozen_at"] is None or (at and at > e["frozen_at"]):
            e["frozen"], e["frozen_at"] = {**prompt, **answer}, at  # the most recent copy of the word, as it was played
        e["attempts"].append({
            "turn_id": item.turn_id, "session_id": item.session_id, "at": _iso(at),
            "direction": DIRECTION[item.kind], "result": result_of(item), "outcome": item.outcome,
            # A re-practice turn comes right after "Xem đáp án": it is shown, but never counted as knowing the word.
            "practice": item.practice_of_id is not None, "session_open": session_status in ("active", "paused"),
        })
    for e in entries.values():
        e["attempts"].sort(key=lambda a: a["at"] or "", reverse=True)  # ISO times in UTC sort as text
    return entries


def directions(attempts: list[dict]) -> dict[str, dict]:
    """Counts per game and the latest result that decides "Cần ôn" (re-practice turns excluded)."""
    out = {}
    for d in ("en_vi", "vi_en"):
        mine = [a for a in attempts if a["direction"] == d and not a["practice"]]
        if not mine:
            continue
        out[d] = {"correct": sum(a["result"] == "correct" for a in mine), "wrong": sum(a["result"] == "wrong" for a in mine),
                  "unanswered": sum(a["result"] == "unanswered" for a in mine), "last_result": mine[0]["result"],
                  "last_at": mine[0]["at"]}
    return out


def needs_review(per_direction: dict[str, dict]) -> bool:
    # Wrong or unanswered the last time in either game played; one right answer is not "remembered" in the other.
    return any(d["last_result"] != "correct" for d in per_direction.values())


def word_info(db: Session, entries: dict[str, dict]) -> dict[str, dict]:
    """Word, meaning and details from the vocabulary bank, or the copy frozen in the turn for words no longer there.
    Only what the data has: a missing phonetic or example stays missing."""
    bank = {e.entry_key: e for e in db.scalars(select(LearningVocabEntry).where(LearningVocabEntry.entry_key.in_(entries)))}
    out = {}
    for key, e in entries.items():
        b, f = bank.get(key), e["frozen"] or {}
        pos = b.part_of_speech if b else f.get("part_of_speech")
        out[key] = {
            "word": b.word if b else (f.get("display") or f.get("word") or ""),
            "meaning_vi": b.meaning_vi if b else (f.get("meaning_vi") or ""),
            "context_vi": b.context_vi if b else f.get("context_vi"),
            "part_of_speech": POS_VI.get(pos, pos) if pos else None,
            "phonetic": (b.phonetic if b else f.get("phonetic")) or None,
            "example_en": (b.example_en if b else f.get("example_en")) or None,
            "example_vi": (b.example_vi if b else f.get("example_vi")) or None,
            "topic": (b.topic if b else f.get("topic")) or None,
            "level": vocab_discovery.level_of(b.difficulty if b else f.get("difficulty")),
            "in_bank": b is not None,
        }
    return out


def summary(key: str, e: dict, info: dict, mastery: int = 0) -> dict:
    """`memory`: review (chưa nhớ: wrong or unanswered the last time in a game), mastered (thành thạo: mastery ≥
    MASTERED_AT) or learned (đã học). `status` (older apps): review, or correct for learned and mastered."""
    per_direction = directions(e["attempts"])
    counted = [a for a in e["attempts"] if not a["practice"]]
    times = [a["at"] for a in e["attempts"] if a["at"]]
    weak = needs_review(per_direction)
    return {"entry_key": key, **{k: info[k] for k in ("word", "meaning_vi", "context_vi", "part_of_speech", "topic", "level")},
            "first_seen_at": min(times) if times else None, "last_seen_at": max(times) if times else None,
            "status": "review" if weak else "correct",
            "memory": "review" if weak else "mastered" if mastery >= MASTERED_AT else "learned", "mastery": mastery,
            "correct": sum(a["result"] == "correct" for a in counted), "wrong": sum(a["result"] == "wrong" for a in counted),
            "unanswered": sum(a["result"] == "unanswered" for a in counted), "directions": per_direction}


def masteries(db: Session, user: User) -> dict[str, int]:
    """The best mastery of each sense over the two games."""
    out: dict[str, int] = {}
    for skill_key, mastery in db.execute(select(LearningSkillProgress.skill_key, LearningSkillProgress.mastery).where(
            LearningSkillProgress.user_id == user.id, LearningSkillProgress.skill_key.startswith("en."))):
        key = skill_key.removeprefix("en.spell.").removeprefix("en.word.")
        if key != skill_key:
            out[key] = max(out.get(key, 0), mastery)
    return out


def summaries(db: Session, user: User, year: int | None = None) -> list[dict]:
    entries = collect(db, user, year=year)
    info = word_info(db, entries)
    mastery = masteries(db, user)
    out = [summary(k, e, info[k], mastery.get(k, 0)) for k, e in entries.items()]
    out.sort(key=lambda s: s["last_seen_at"] or "", reverse=True)  # most recently studied first
    return out


@router.get("/history", summary="Sổ tay từ vựng: words met in the vocabulary games, most recent first, a page at a time")
def history(q: str | None = Query(default=None, max_length=60, description="English word or Vietnamese meaning"),
            filter: Literal["all", "correct", "review", "learned", "mastered"] = "all",
            topic: str | None = Query(default=None, max_length=40, description="A topic code of the bank"),
            level: int | None = Query(default=None, ge=1, le=5, description="Vocabulary level 1..5"),
            year: int | None = Query(default=None, ge=2000, le=2100, description="Only what was played in this school year"),
            limit: int = Query(default=PAGE_SIZE, ge=1, le=100), offset: int = Query(default=0, ge=0),
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    """`counts` are for the whole history (the filter tabs); `total` is the number of words matching the filters and
    search, of which `items` is the page from `offset`. filter: review (chưa nhớ, answered wrong), learned (đã học),
    mastered (thành thạo), correct (learned or mastered). `topics` are the topics of the history, for the topic filter."""
    items = summaries(db, user, year)
    counts = {"all": len(items), "correct": sum(s["status"] == "correct" for s in items),
              "review": sum(s["status"] == "review" for s in items),
              "learned": sum(s["memory"] == "learned" for s in items), "mastered": sum(s["memory"] == "mastered" for s in items)}
    # "Cần ôn" words whose last answer in each game was not right: which game "Luyện lại" is most useful in.
    due = {d: sum(d in s["directions"] and s["directions"][d]["last_result"] != "correct" for s in items) for d in ("en_vi", "vi_en")}
    names = {code: name for code, name, _ in TOPICS}
    per_topic: dict[str, int] = {}
    for s in items:
        if s["topic"]:
            per_topic[s["topic"]] = per_topic.get(s["topic"], 0) + 1
    topics = [{"code": c, "name": names.get(c, c), "count": n} for c, n in sorted(per_topic.items(), key=lambda t: names.get(t[0], t[0]))]
    if filter == "correct":
        items = [s for s in items if s["status"] == "correct"]
    elif filter != "all":
        items = [s for s in items if s["memory"] == filter]
    if topic:
        items = [s for s in items if s["topic"] == topic]
    if level:
        items = [s for s in items if s["level"] == level]
    if q and (needle := fold(q)):
        items = [s for s in items if needle in fold(s["word"]) or needle in fold(s["meaning_vi"]) or needle in fold(s["context_vi"])]
    return {"items": items[offset:offset + limit], "total": len(items), "limit": limit, "offset": offset, "counts": counts,
            "due": due, "topics": topics}


@router.get("/history/{entry_key}", summary="One word: meaning, pronunciation, examples, results per game and every answer")
def history_entry(entry_key: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    entries = collect(db, user, entry_key)
    if entry_key not in entries:
        raise APIError(404, "word_not_found", "This word is not in your history")
    e = entries[entry_key]
    info = word_info(db, entries)[entry_key]
    return {**summary(entry_key, e, info, masteries(db, user).get(entry_key, 0)), "phonetic": info["phonetic"], "example_en": info["example_en"],
            "example_vi": info["example_vi"], "can_practice": info["in_bank"], "attempts": e["attempts"]}


class PracticeCreate(BaseModel):
    game: Literal["word_shooter", "meteor"] = Field(description="word_shooter: Anh → Việt; meteor: Việt → Anh")
    entry_keys: list[str] | None = Field(default=None, min_length=1, max_length=PRACTICE_LIMIT,
                                         description="Words to practise; omitted: the “Cần ôn” words, most recent first")
    mode: Literal["practice", "challenge"] = "practice"
    duration_minutes: int = Field(default=15, ge=5, le=60)
    timezone: str = Field(default="UTC", max_length=80)
    start_paused: bool = Field(default=False, description="Create it paused (the app counts down 3-2-1, then /resume).")
    year: int | None = Field(default=None, ge=2000, le=2100, description="Kho lưu trữ: the words of a finished school "
                                                                         "year; the stage never changes the current year.")


@router.post("/practice", status_code=201, summary="Practise chosen words, or the “Cần ôn” words, in a vocabulary game")
def practice(data: PracticeCreate, idempotency_key: IdempotencyKey = None,
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    """A review stage of the chosen game (lesson "Tổng hợp"): progress, the review list and this history update as in
    any stage; review stages earn no completion reward, so the reward rules are unchanged."""
    archive = data.year is not None and data.year != education.learning_year(db, user.id)
    items = summaries(db, user, data.year)
    known = {s["entry_key"]: s for s in items}
    direction = "en_vi" if data.game == "word_shooter" else "vi_en"
    if data.entry_keys is not None:
        keys = [k for k in dict.fromkeys(data.entry_keys) if k in known]  # only words of this user's own history
    else:
        due = [s for s in items if s["status"] == "review"]
        # Words due in the chosen game first, then words due in the other one.
        due.sort(key=lambda s: (s["directions"].get(direction, {}).get("last_result", "correct") == "correct",))
        keys = [s["entry_key"] for s in due]
    # Only words still in the bank can be served again (a word of an older lesson that never joined it cannot).
    in_bank = set(db.scalars(select(LearningVocabEntry.entry_key).where(
        LearningVocabEntry.entry_key.in_(keys), LearningVocabEntry.status.in_(("active", "retired")))))
    keys = [k for k in keys if k in in_bank]
    lesson_code, _ = QUICK_GAMES[data.game]
    lesson = db.scalar(select(LearningLesson).where(LearningLesson.code == lesson_code))
    if lesson is None:
        raise APIError(404, "lesson_not_found", "Lesson not found")
    spell = "spell." if data.game == "word_shooter" else ""
    review_keys = [f"{lesson.code}.{spell}{k}" for k in keys[:PRACTICE_LIMIT]]
    if not review_keys:
        raise APIError(409, "no_words_to_practice", "There are no words to practise")
    s = create_session(db, user, lesson=lesson, mode=data.mode, duration_minutes=data.duration_minutes, variant=None,
                       device_zone=data.timezone, kind="archive" if archive else "review", idempotency_key=idempotency_key,
                       review_keys=review_keys, start_paused=data.start_paused, archive_year=data.year if archive else None)
    return session_out(db, s)


# ---------------------------------------------------------------------------------------------------------------
# Khám phá từ mới: levels, new words left, the celebration of a completed level (vocab_discovery.py)
# ---------------------------------------------------------------------------------------------------------------

VocabGame = Literal["meteor", "word_shooter"]


@router.get("/progress", summary="Khám phá từ mới: levels, new words left, topics, words due and a level to celebrate")
def discovery_progress(game: VocabGame = "meteor", user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Per game. The grade is the learner's own (education profile), never one sent by the app. `levels[].status`:
    completed | unlocked | locked | above_grade (beyond this grade's highest level). `celebration`: a completed level
    not celebrated yet; show it once, then POST /levels/{game}/{level}/celebrated."""
    education.sync(db, user)
    return vocab_discovery.progress(db, user, game)


@router.post("/levels/{game}/{level}/celebrated", summary="The celebration of a completed level was shown (it never comes back)")
def level_celebrated(game: VocabGame, level: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(VocabLevelProgress).where(VocabLevelProgress.user_id == user.id, VocabLevelProgress.game == game,
                                                     VocabLevelProgress.level == level))
    if row is None or row.completed_at is None:
        raise APIError(404, "level_not_completed", "This level is not completed")
    if row.celebrated_at is None:
        row.celebrated_at = clock.now()
        db.commit()
    return {"game": game, "level": level, "celebrated": True}
