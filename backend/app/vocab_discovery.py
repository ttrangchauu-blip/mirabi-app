"""Khám phá từ mới, Ôn tập and the vocabulary levels of the two English word games (rules: docs/LEARNING_GAMES.md).

- Games: `meteor` (Bắn thiên thạch, Việt → Anh) and `word_shooter` (Từ rơi / Bắn từ, Anh → Việt). Each game keeps its own
  history and levels: typing a word you were shown is not the same as recalling it.
- Khám phá: a stage holds up to 15 words never shown before in that game (one row per canonical word in
  vocab_discoveries, written when the word is put on screen). With 7 new words left a stage holds 7; with none the
  stage does not start (409 vocabulary_exhausted) and the history is never reset.
- Ôn tập: words already met in that game, wrong and weak ones first, then those due by a spaced schedule. It never
  writes a discovery and never changes a level.
- Levels 1..5 come from the bank's internal difficulty (1..6; 5 and 6 are level 5). The learner's grade (from the
  education profile, never from the app) decides where the levels start and the highest one it may reach, and which
  topics are left out for young learners. A level is completed once every word of it (for that grade) was discovered;
  completing the highest open level opens the next one up to the grade's ceiling. Levels are never taken back: words
  added to the bank later are new words of an open level, and a completion is celebrated once.
- Difficulty adapts within the open levels: the "challenge" (0..100) moves by at most one step per stage from the
  first-try accuracy and answer time of the last stages, and sets the share of harder new words in a stage. A stage is
  ordered from easy to hard. The falling speed never depends on it.
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .curriculum import grade_number
from .learning_engine import normalize_text
from .learning_vocab import gives_answer

GAMES = ("meteor", "word_shooter")
KIND = {"meteor": "vocab_typing", "word_shooter": "word_spelling"}
PREFIX = {"meteor": "en.word.", "word_shooter": "en.spell."}
GAME_NAMES = {"meteor": "Bắn thiên thạch", "word_shooter": "Từ rơi"}
LEVELS = (1, 2, 3, 4, 5)
LEVEL_NAMES = {1: "Rất dễ", 2: "Dễ", 3: "Trung bình", 4: "Khó", 5: "Nâng cao"}
STAGE_WORDS = 15
REVIEW_WORDS = 12  # a review stage (learning_vocab.bank_items keeps at most 12)

# Topics left out for young learners: their words are abstract or about adult life.
YOUNG_BLOCKED = frozenset({"law", "business", "society", "media", "thinking"})


@dataclass(frozen=True)
class Policy:
    start: int  # levels 1..start are open from the beginning
    ceiling: int  # the highest level this grade may reach
    blocked_topics: frozenset[str] = frozenset()
    grade: int | None = None  # the school grade (None outside school: no word is kept back by GRADE_LIMITS)


# Words a younger grade could reach by level and topic but should not meet yet (romance, insults): app/data/
# vocab_grade_limits.tsv (bank, key, min_grade, reason). A reviewer adds a line; the word stays for older learners.
GRADE_LIMITS_FILE = Path(__file__).resolve().parent / "data" / "vocab_grade_limits.tsv"
_limits: dict = {}


def grade_limits() -> dict[str, int]:
    stamp = GRADE_LIMITS_FILE.stat().st_mtime_ns if GRADE_LIMITS_FILE.exists() else None
    if _limits.get("stamp") != stamp:
        found = {}
        if stamp is not None:
            for line in GRADE_LIMITS_FILE.read_text(encoding="utf-8-sig").splitlines():
                cells = line.split("\t")
                if len(cells) >= 3 and cells[0].strip() == "vocabulary" and cells[2].strip().isdigit():
                    found[cells[1].strip()] = int(cells[2])
        _limits.update(stamp=stamp, keys=found)
    return _limits["keys"]


def policy_for(grade: str | None) -> Policy:
    """Lớp 1–2: level 1 only; 3–5: up to 2; 6–7: up to 3; 8–9: start at 2, up to 4; 10–12: start at 3, up to 5.
    Outside school (sinh viên, người đi làm): from level 1 up to 5."""
    n = grade_number(grade)
    if n is None:
        return Policy(1, 5)
    if n <= 2:
        return Policy(1, 1, YOUNG_BLOCKED, n)
    if n <= 5:
        return Policy(1, 2, YOUNG_BLOCKED, n)
    if n <= 7:
        return Policy(1, 3, frozenset({"law"}), n)
    if n <= 9:
        return Policy(2, 4, frozenset(), n)
    return Policy(3, 5, frozenset(), n)


def level_of(difficulty: int | None) -> int:
    return min(max(difficulty or 1, 1), 5)


def canonical(word: str) -> str:
    """One id per English word or phrase: "Bank", "bank" and the two senses of "bank" are the same word to a learner."""
    return normalize_text(word)


# ---------------------------------------------------------------------------------------------------------------
# Picking (pure: unit-tested in tests/test_vocab_discovery.py)
# ---------------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Word:
    key: str  # entry_key of the sense served
    canonical: str
    level: int
    topic: str
    complexity: float  # longer words and phrases are harder within a level


_POS_WEIGHT = {"phrasal_verb": 2.0, "collocation": 1.0, "phrase": 1.0, "idiom": 4.0}


def complexity(word: str, pos: str) -> float:
    letters = sum(c.isalpha() for c in word)
    return letters + 3.0 * word.count(" ") + _POS_WEIGHT.get(pos, 0.0)


def hardness(w: Word) -> tuple:
    return (w.level, w.complexity, w.key)


def senses(rows, policy: Policy, game: str) -> list[Word]:
    """Every sense a grade may meet in a game (bank rows: entry_key, word, difficulty, topic, part_of_speech, ...)."""
    out = []
    limits = grade_limits() if policy.grade is not None else {}
    for r in rows:
        level = level_of(r.difficulty)
        if level > policy.ceiling or r.topic in policy.blocked_topics:
            continue
        if limits and limits.get(r.entry_key, 0) > (policy.grade or 0):
            continue  # kept for older learners (vocab_grade_limits.tsv)
        if policy.ceiling <= 2 and r.part_of_speech == "idiom":
            continue
        if game == "meteor" and gives_answer(r.meaning_vi, r.context_vi, json.loads(r.accepted_json or "[]") or [r.word]):
            continue  # Việt → Anh never shows a meaning that holds the answer
        out.append(Word(r.entry_key, canonical(r.word), level, r.topic, complexity(r.word, r.part_of_speech)))
    return out


def one_per_word(words: list[Word], topic: str | None = None) -> list[Word]:
    """One sense per word (within a topic): the easiest one."""
    best: dict[str, Word] = {}
    for w in words:
        if (topic is None or w.topic == topic) and (w.canonical not in best or hardness(w) < hardness(best[w.canonical])):
            best[w.canonical] = w
    return list(best.values())


def grade_pool(rows, policy: Policy, game: str, topic: str | None = None) -> list[Word]:
    """The words a grade may meet in a game (within a topic), one sense per word."""
    return one_per_word(senses(rows, policy, game), topic)


def hard_share(challenge: int) -> float:
    """The share of harder new words in a stage: 10% at challenge 0, 70% at 100."""
    return 0.1 + 0.6 * max(0, min(100, challenge)) / 100


def pick_discovery(pool: list[Word], discovered: set[str], unlocked: set[int], count: int, challenge: int,
                   rng: random.Random, preferred: frozenset[str] = frozenset()) -> list[Word]:
    """New words only: never one already discovered, each word at most once, from the open levels; easy to hard.
    The easier part comes from the easiest remaining words, the harder part from just above the middle (never the
    hardest end at once). Words of the `preferred` topics (suggested for the user's grade) come first in each part."""
    fresh = sorted((w for w in pool if w.canonical not in discovered and w.level in unlocked), key=hardness)
    if len(fresh) <= count:
        return fresh
    hard_n = round(count * hard_share(challenge))
    window = max(count * 4, len(fresh) // 4)
    order = lambda w: (bool(preferred) and w.topic not in preferred, rng.random())
    easy_part = sorted(fresh[:window], key=order)
    mid = len(fresh) // 2
    hard_part = sorted(fresh[mid:mid + window], key=order)
    picked: dict[str, Word] = {}
    for part, n in ((hard_part, hard_n), (easy_part, count - hard_n), (fresh, count)):
        for w in part:
            if len(picked) >= count or n <= 0:
                break
            if w.canonical not in picked:
                picked[w.canonical] = w
                n -= 1
    return sorted(picked.values(), key=hardness)


CHALLENGE_START, CHALLENGE_STEP, CHALLENGE_WINDOW = 30, 10, 8
FAST_SECONDS = 12.0  # a right answer within this time on average counts as fluent


def challenge_from(stages: list[tuple[int, int, float | None]]) -> int:
    """(first-try right, answered, average seconds per answer) of the last stages, oldest first. Each stage moves the
    challenge by at most one step: up after a stage of ≥ 85% right at the first try answered fluently, down after one
    below 60%. Stages with fewer than 5 answers say nothing."""
    c = CHALLENGE_START
    for first, answered, seconds in stages[-CHALLENGE_WINDOW:]:
        if answered < 5:
            continue
        rate = first / answered
        if rate >= 0.85 and (seconds is None or seconds <= FAST_SECONDS):
            c += CHALLENGE_STEP
        elif rate < 0.6:
            c -= CHALLENGE_STEP
        c = max(0, min(100, c))
    return c


REVIEW_DAYS = ((40, 1), (70, 3), (90, 7), (101, 21))  # mastery below → days before a word is due again


@dataclass(frozen=True)
class Known:
    key: str
    canonical: str
    mastery: int
    wrong: int  # wrong, missed or revealed answers
    last_seen: float  # timestamp


def due_at(k: Known) -> float:
    days = next(d for limit, d in REVIEW_DAYS if k.mastery < limit)
    return k.last_seen + days * 86400


def pick_review(known: list[Known], flagged: set[str], now: float, count: int) -> list[Known]:
    """Ôn tập: words on the "Cần ôn" list first (most mistakes first), then words due by their schedule (weakest
    first), then the rest, least recently seen first; each word once."""
    def rank(k: Known):
        return (k.key not in flagged, due_at(k) > now, k.key in flagged and -k.wrong, k.mastery, k.last_seen)
    out: dict[str, Known] = {}
    for k in sorted(known, key=rank):
        if len(out) >= count:
            break
        out.setdefault(k.canonical, k)
    return list(out.values())


# ---------------------------------------------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------------------------------------------

def bank_rows(db: Session):
    from .models import LearningVocabEntry as E
    return db.execute(select(E.entry_key, E.word, E.difficulty, E.topic, E.part_of_speech, E.meaning_vi, E.context_vi,
                             E.accepted_json).where(E.status == "active").order_by(E.entry_key)).all()


def _backfill(db: Session, user_id: int, game: str) -> None:
    """Words shown in this game before Khám phá existed (any stage: bank, topic or a lesson's) are not new any more."""
    from .models import LearningSession, LearningSessionItem, VocabDiscovery
    rows = db.execute(select(LearningSessionItem.answer_json, LearningSession.id, LearningSession.academic_year,
                             LearningSessionItem.issued_at)
                      .join(LearningSession, LearningSession.id == LearningSessionItem.session_id)
                      .where(LearningSession.user_id == user_id, LearningSessionItem.kind == KIND[game],
                             LearningSessionItem.state.in_(("issued", "resolved")))).all()
    seen: dict[str, VocabDiscovery] = {}
    for answer_json, session_id, year, at in rows:
        answer = json.loads(answer_json or "{}")
        word = answer.get("display")
        if not word or canonical(word) in seen:
            continue
        seen[canonical(word)] = VocabDiscovery(user_id=user_id, game=game, canonical=canonical(word)[:60],
                                               entry_key=(answer.get("entry_key") or "")[:60], level=level_of(answer.get("difficulty")),
                                               topic=answer.get("topic") or "", academic_year=year, session_id=session_id,
                                               **({"discovered_at": at} if at else {}))
    if seen:
        try:
            with db.begin_nested():
                db.add_all(seen.values())
        except IntegrityError:
            pass  # a concurrent request filled it


def discovered(db: Session, user_id: int, game: str) -> set[str]:
    from .models import VocabDiscovery
    words = set(db.scalars(select(VocabDiscovery.canonical).where(VocabDiscovery.user_id == user_id, VocabDiscovery.game == game)))
    if not words:
        _backfill(db, user_id, game)
        words = set(db.scalars(select(VocabDiscovery.canonical).where(VocabDiscovery.user_id == user_id, VocabDiscovery.game == game)))
    return words


def record(db: Session, s, items) -> None:
    """Called when turns of a Khám phá stage go on screen (learning.issue_turns): from now on they are not new."""
    from .models import VocabDiscovery
    game = (json.loads(s.scoring_json or "{}").get("discovery") or {}).get("game")
    if game not in GAMES:
        return
    words = {}
    for item in items:
        answer = json.loads(item.answer_json or "{}")
        if item.practice_of_id is None and answer.get("display"):
            words.setdefault(canonical(answer["display"])[:60], answer)
    if not words:
        return
    known = set(db.scalars(select(VocabDiscovery.canonical).where(
        VocabDiscovery.user_id == s.user_id, VocabDiscovery.game == game, VocabDiscovery.canonical.in_(words))))
    for word, answer in words.items():
        if word not in known:
            db.add(VocabDiscovery(user_id=s.user_id, game=game, canonical=word, entry_key=(answer.get("entry_key") or "")[:60],
                                  level=level_of(answer.get("difficulty")), topic=answer.get("topic") or "",
                                  academic_year=s.academic_year, session_id=s.id))


def challenge(db: Session, user_id: int, game: str) -> int:
    """From the last stages of this game (bank, topic or a lesson's words; not reviews), oldest first."""
    from .models import LearningSession, LearningSessionItem, as_utc
    ids = list(db.scalars(select(LearningSession.id)
                          .where(LearningSession.user_id == user_id, LearningSession.game == game, LearningSession.kind == "lesson",
                                 LearningSession.status.in_(("completed", "failed", "abandoned")))
                          .order_by(LearningSession.id.desc()).limit(CHALLENGE_WINDOW)))
    if not ids:
        return CHALLENGE_START
    per: dict[int, list] = defaultdict(list)
    for sid, outcome, issued, resolved in db.execute(select(
            LearningSessionItem.session_id, LearningSessionItem.outcome, LearningSessionItem.issued_at, LearningSessionItem.resolved_at)
            .where(LearningSessionItem.session_id.in_(ids), LearningSessionItem.state == "resolved",
                   LearningSessionItem.practice_of_id.is_(None))):
        seconds = (as_utc(resolved) - as_utc(issued)).total_seconds() if issued and resolved else None
        per[sid].append((outcome, seconds))
    stages = []
    for sid in sorted(ids):
        answers = per.get(sid, [])
        times = [t for o, t in answers if o == "first_try" and t is not None]
        stages.append((sum(o == "first_try" for o, _ in answers), len(answers), sum(times) / len(times) if times else None))
    return challenge_from(stages)


def _by_level(pool: list[Word]) -> dict[int, set[str]]:
    out: dict[int, set[str]] = defaultdict(set)
    for w in pool:
        out[w.level].add(w.canonical)
    return out


def settle_levels(db: Session, user, game: str, policy: Policy, pool: list[Word], found: set[str], year: int | None,
                  now: datetime) -> dict[int, object]:
    """Opens the grade's starting levels, marks levels whose every word was discovered as completed, and opens the next
    level when the highest open one is completed (up to the grade's ceiling). Never closes or resets a level."""
    from .models import VocabLevelProgress
    rows = {r.level: r for r in db.scalars(select(VocabLevelProgress).where(
        VocabLevelProgress.user_id == user.id, VocabLevelProgress.game == game))}
    words = _by_level(pool)
    added = []

    def open_level(level: int, reason: str) -> None:
        row = VocabLevelProgress(user_id=user.id, game=game, level=level, unlock_reason=reason, unlocked_at=now,
                                 unlocked_grade=user.school_grade)
        rows[level] = row
        added.append(row)

    for level in range(1, policy.start + 1):
        if level not in rows:
            open_level(level, "start")
    for level in LEVELS:
        row = rows.get(level)
        if row is None or level > policy.ceiling:
            break
        if row.completed_at is None and not (words[level] - found):
            row.completed_at, row.completed_year = now, year
            row.completed_words = len(words[level] & found)
            if not words[level]:  # a level without words for this grade is passed silently
                row.celebrated_at = now
        if row.completed_at is not None and level + 1 <= policy.ceiling and level + 1 not in rows:
            open_level(level + 1, "completed")
    if added:
        try:
            with db.begin_nested():
                db.add_all(added)
        except IntegrityError:  # a concurrent request opened them
            return {r.level: r for r in db.scalars(select(VocabLevelProgress).where(
                VocabLevelProgress.user_id == user.id, VocabLevelProgress.game == game))}
    return rows


def open_levels(rows: dict, policy: Policy) -> set[int]:
    return {level for level in rows if level <= policy.ceiling}


def celebration(rows: dict) -> dict | None:
    """The oldest completed level not celebrated yet (shown once; POST …/celebrated marks it)."""
    pending = sorted((r for r in rows.values() if r.completed_at is not None and r.celebrated_at is None), key=lambda r: r.level)
    if not pending:
        return None
    r = pending[0]
    following = rows.get(r.level + 1)
    return {"level": r.level, "name": LEVEL_NAMES[r.level], "words": r.completed_words,
            "next_level": following.level if following is not None else None,
            "title": f"Chúc mừng! Bạn đã khám phá hết từ vựng cấp {r.level} – {LEVEL_NAMES[r.level]}!",
            "message": (f"Bạn đã khám phá {r.completed_words} từ. Cấp độ mới đang chờ bạn!" if following is not None
                        else f"Bạn đã khám phá {r.completed_words} từ. Hãy ôn tập để nhớ thật lâu nhé!")}


def discovery_words(db: Session, user, game: str, topic: str | None, seed: int, count: int = STAGE_WORDS) -> list[str]:
    """The entry keys of a new Khám phá stage, easy to hard ([] when no new word is left in this scope)."""
    from . import clock, education
    from .study_profile import preferred_vocab_topics
    policy = policy_for(user.school_grade)
    allowed = senses(bank_rows(db), policy, game)
    pool = one_per_word(allowed)
    found = discovered(db, user.id, game)
    levels = settle_levels(db, user, game, policy, pool, found, education.learning_year(db, user.id), clock.now())
    scope = pool if topic is None else one_per_word(allowed, topic)
    preferred = preferred_vocab_topics(user.school_grade) if topic is None else frozenset()
    picked = pick_discovery(scope, found, open_levels(levels, policy), count, challenge(db, user.id, game), random.Random(seed),
                            preferred)
    return [w.key for w in picked]


def review_words(db: Session, user, game: str, now: datetime, count: int = REVIEW_WORDS) -> list[str]:
    """The entry keys of an Ôn tập stage: words met in this game that are still in the bank."""
    known, flagged = _known(db, user, game)
    return [k.key for k in pick_review(known, flagged, now.timestamp(), count)]


def review_due(db: Session, user, game: str, now: datetime) -> int:
    """Words to review now: on the "Cần ôn" list or due by their schedule."""
    known, flagged = _known(db, user, game)
    return len({k.canonical for k in known if k.key in flagged or due_at(k) <= now.timestamp()})


def _known(db: Session, user, game: str) -> tuple[list[Known], set[str]]:
    from .models import LearningReviewItem, LearningSkillProgress, LearningVocabEntry, as_utc
    prefix = PREFIX[game]
    progress = db.scalars(select(LearningSkillProgress).where(LearningSkillProgress.user_id == user.id,
                                                              LearningSkillProgress.skill_key.startswith(prefix))).all()
    keys = {p.skill_key[len(prefix):]: p for p in progress}
    if not keys:
        return [], set()
    entries = {e.entry_key: e for e in db.scalars(select(LearningVocabEntry).where(
        LearningVocabEntry.entry_key.in_(keys), LearningVocabEntry.status.in_(("active", "retired"))))}
    flagged = {r.skill_key[len(prefix):] for r in db.scalars(select(LearningReviewItem).where(
        LearningReviewItem.user_id == user.id, LearningReviewItem.status == "open", LearningReviewItem.skill_key.startswith(prefix)))}
    known = []
    for key, p in keys.items():
        e = entries.get(key)
        if e is None or (game == "meteor" and gives_answer(e.meaning_vi, e.context_vi, json.loads(e.accepted_json or "[]") or [e.word])):
            continue
        known.append(Known(key, canonical(e.word), p.mastery, p.wrong + p.missed + p.revealed,
                           as_utc(p.last_seen_at).timestamp() if p.last_seen_at else 0.0))
    return known, flagged


def progress(db: Session, user, game: str) -> dict:
    """GET /api/learning/vocabulary/progress: levels, words left, topics, what is due for review and a celebration."""
    from . import clock, education
    from .learning_vocab import TOPICS
    from .models import VocabDiscovery
    now = clock.now()
    policy = policy_for(user.school_grade)
    allowed = senses(bank_rows(db), policy, game)
    pool = one_per_word(allowed)
    found = discovered(db, user.id, game)
    year = education.learning_year(db, user.id)
    levels = settle_levels(db, user, game, policy, pool, found, year, now)
    db.commit()
    unlocked = open_levels(levels, policy)
    words = _by_level(pool)
    out_levels = []
    for level in LEVELS:
        row = levels.get(level)
        status = ("above_grade" if level > policy.ceiling else "completed" if row is not None and row.completed_at is not None
                  else "unlocked" if row is not None else "locked")
        out_levels.append({"level": level, "name": LEVEL_NAMES[level], "status": status, "total": len(words[level]),
                           "discovered": len(words[level] & found)})
    remaining = {w.canonical for w in pool if w.level in unlocked and w.canonical not in found}
    topics = []
    for code, name, _ in TOPICS:  # the words of the open levels in each topic (a word of two topics counts in both)
        scope = [w for w in one_per_word(allowed, code) if w.level in unlocked]
        if scope:
            topics.append({"code": code, "name": name, "total": len(scope),
                           "new_words_left": sum(w.canonical not in found for w in scope)})
    this_year = db.scalar(select(func.count()).select_from(VocabDiscovery).where(
        VocabDiscovery.user_id == user.id, VocabDiscovery.game == game, VocabDiscovery.academic_year == year)) if year else None
    return {
        "game": game, "game_name": GAME_NAMES[game], "grade": user.school_grade, "grade_label": education.grade_label(user.school_grade),
        "academic_year": year, "levels": out_levels, "current_level": max(unlocked) if unlocked else 1,
        "max_level": policy.ceiling, "discovered": len(found), "discovered_this_year": this_year,
        "new_words_left": len(remaining), "challenge": challenge(db, user.id, game),
        "review_due": review_due(db, user, game, now), "topics": topics, "celebration": celebration(levels),
    }
