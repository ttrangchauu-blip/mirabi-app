"""Khám phá từ mới in a lesson's vocabulary games (Học tập theo bài → Tiếng Anh → bài → Bắn thiên thạch / Từ rơi).

A lesson lists its own words (lesson_catalog: `words`, the core words of the curriculum). Its games are not limited to
them: once they are discovered, the lesson goes on with new words of the same theme, then of related themes, then of
the next level, so "Chơi lại" always brings new words. The history, levels and adaptive difficulty are the shared ones
of vocab_discovery.py (one history per game: a word discovered in one lesson or in free practice is never new again in
that game, whatever the lesson). A stage is up to 15 words, picked in this order:

1. core   – the lesson's own words not discovered yet (whatever the open levels: they are the lesson);
2. topic  – new words of the lesson's themes (the bank topics that hold at least a quarter of its words), open levels;
3. related – new words of related themes that the grade has opened (RELATED ∩ the grade's suggested topics and the
   themes of its unlocked lessons), open levels;
4. next level – new words of the lesson's and related themes one level above the highest open one (never above the
   grade's ceiling): a few in a stage when the learner does well, all of the rest once 1–3 are used up.

Never served: words more than one level below the lesson's own words, words above the grade's ceiling or in a topic blocked for the grade (vocab_discovery.policy_for), and the
core words of lessons of a higher grade or of a locked lesson of this grade. Within each tier the shared picker
(vocab_discovery.pick_discovery) mixes easier and harder words by the learner's "challenge"; the stage is ordered from
easy to hard. No new word left: [] (the stage does not start: 409 vocabulary_exhausted, and the app offers Ôn tập).
Rules: docs/LEARNING_GAMES.md#khám-phá-từ-mới-theo-bài.
"""
from __future__ import annotations

import json
import random
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import lesson_catalog as lc
from . import vocab_discovery as vd

TOPIC_SHARE = 0.25  # a bank topic is one of the lesson's themes when it holds at least this share of its words

# Themes close to each other: a lesson goes on with these once its own themes are used up (only those the grade has
# opened). Keys and values are learning_vocab.TOPICS codes.
RELATED: dict[str, tuple[str, ...]] = {
    "animals": ("environment", "countryside", "weather", "food", "science"),
    "food": ("health", "shopping", "home", "countryside", "daily_life"),
    "family": ("relationships", "home", "daily_life", "emotions", "appearance"),
    "home": ("family", "daily_life", "actions", "describing", "city_places"),
    "school": ("thinking", "time", "communication", "science", "sports"),
    "careers": ("work", "business", "school", "society", "money"),
    "work": ("careers", "business", "communication", "money", "technology"),
    "health": ("food", "sports", "safety", "emotions", "daily_life"),
    "environment": ("weather", "science", "animals", "countryside", "society"),
    "technology": ("media", "science", "communication", "work", "entertainment"),
    "science": ("technology", "environment", "thinking", "health", "animals"),
    "weather": ("environment", "time", "travel", "clothes", "describing"),
    "travel": ("transport", "city_places", "weather", "money", "arts_culture"),
    "transport": ("travel", "city_places", "safety", "daily_life"),
    "city_places": ("transport", "shopping", "home", "travel", "society"),
    "shopping": ("money", "clothes", "food", "city_places"),
    "clothes": ("appearance", "shopping", "weather", "describing"),
    "countryside": ("animals", "environment", "food", "home"),
    "daily_life": ("home", "time", "actions", "food", "family"),
    "relationships": ("family", "emotions", "communication", "personality"),
    "emotions": ("personality", "relationships", "health", "describing"),
    "personality": ("emotions", "relationships", "appearance", "describing"),
    "appearance": ("personality", "clothes", "describing", "health"),
    "communication": ("relationships", "media", "technology", "thinking"),
    "time": ("daily_life", "school", "weather", "entertainment"),
    "money": ("shopping", "business", "work", "society"),
    "business": ("work", "money", "careers", "media"),
    "law": ("society", "safety", "business"),
    "society": ("law", "environment", "media", "relationships"),
    "media": ("technology", "entertainment", "communication", "society"),
    "entertainment": ("sports", "arts_culture", "media", "time"),
    "sports": ("health", "entertainment", "actions", "school"),
    "actions": ("daily_life", "sports", "describing", "home"),
    "describing": ("appearance", "actions", "weather", "home"),
    "arts_culture": ("entertainment", "travel", "society", "communication"),
    "thinking": ("school", "communication", "science", "society"),
    "safety": ("health", "transport", "environment", "law"),
}
STRETCH = ((80, 3), (60, 2))  # challenge ≥ threshold → next-level words in a stage that still has easier ones


def lesson_topics(core_topics: list[str]) -> list[str]:
    """The bank topics of a lesson's words that hold at least a quarter of them, most words first."""
    counts = Counter(core_topics)
    return [t for t, n in counts.most_common() if n >= TOPIC_SHARE * len(core_topics)]


@dataclass
class Scope:
    """What one lesson's game may serve to one learner (canonical words already discovered left in, see fresh())."""
    core: list[vd.Word]
    topic: list[vd.Word]
    related: list[vd.Word]
    next_level: list[vd.Word]
    found: set[str]
    unlocked: set[int]
    topics: list[str]
    related_topics: list[str]
    challenge: int = vd.CHALLENGE_START
    blocked: set[str] = field(default_factory=set)

    def fresh(self, words: list[vd.Word]) -> list[vd.Word]:
        return [w for w in words if w.canonical not in self.found]


def _vocab_words(entry: dict) -> list[str]:
    return list(dict.fromkeys(k for spec in entry["lesson"].get("games", []) if spec["game"] in lc.VOCAB_GAMES
                              for k in spec.get("words", [])))


def _unlocked_lessons(db: Session, user, grade: int) -> set[str]:
    """The ready, unlocked English lessons of the learner's grade this school year (learning_unlocks' rules)."""
    from . import education, learning_unlocks
    from .lesson_api import _all_states
    keys = [lesson["key"] for c in lc.chapters("english", grade) for lesson in c["lessons"] if lesson["status"] == "ready"]
    year = education.learning_year(db, user.id)
    nodes = learning_unlocks.peek(db, user.id, "english", grade, year, _all_states(db, user.id, keys, year))
    return {k for k in keys if nodes[k]["open"]}


def _higher_or_locked_words(grade: int, unlocked: set[str]) -> set[str]:
    """Entry keys of the core words of English lessons the learner may not open: a higher grade, or this grade but
    locked (or still being written)."""
    out: set[str] = set()
    for key, entry in lc.catalog()["lessons"].items():
        if entry["subject"] != "english":
            continue
        if entry["grade"] > grade or (entry["grade"] == grade and key not in unlocked):
            out.update(_vocab_words(entry))
    return out


def _opened_topics(user, grade: int, unlocked: set[str], by_key: dict[str, vd.Word]) -> set[str]:
    """The themes a grade has opened: the topics suggested for it and the themes of its unlocked lessons and of the
    lessons of earlier grades."""
    from .study_profile import preferred_vocab_topics
    opened = set(preferred_vocab_topics(user.school_grade))
    for key, entry in lc.catalog()["lessons"].items():
        if entry["subject"] == "english" and (entry["grade"] < grade or key in unlocked):
            opened.update(lesson_topics([by_key[k].topic for k in _vocab_words(entry) if k in by_key]))
    return opened


def build_scope(allowed: list[vd.Word], words: list[str], found: set[str], unlocked: set[int], ceiling: int,
                blocked_keys: set[str], opened: set[str], challenge: int = vd.CHALLENGE_START) -> Scope:
    """The tiers of a lesson's game (pure): `allowed` are the senses the grade may meet in this game, `words` the
    lesson's own entry keys, `blocked_keys` the core words of lessons the learner may not open, `opened` the themes
    the grade has opened."""
    by_key = {w.key: w for w in allowed}
    core = [by_key[k] for k in words if k in by_key]
    core_canon = {w.canonical for w in core}
    blocked = {by_key[k].canonical for k in blocked_keys - set(words) if k in by_key} - core_canon
    topics = lesson_topics([w.topic for w in core])
    related = list(dict.fromkeys(t for topic in topics for t in RELATED.get(topic, ()) if t in opened and t not in topics))
    # Never far below the lesson: a lesson of level-3 words goes on from level 2 (free practice keeps every open level).
    floor = max(1, min((w.level for w in core), default=1) - 1)

    def tier(codes: list[str], levels_: set[int]) -> list[vd.Word]:
        best: dict[str, vd.Word] = {}
        for w in allowed:
            if (w.topic in codes and w.level in levels_ and w.level >= floor and w.canonical not in blocked and w.canonical not in core_canon
                    and (w.canonical not in best or vd.hardness(w) < vd.hardness(best[w.canonical]))):
                best[w.canonical] = w
        return list(best.values())

    above = max(unlocked) + 1
    next_levels = {above} if above <= ceiling else set()
    topic_words = tier(topics, unlocked)
    seen = {w.canonical for w in topic_words}
    related_words = [w for w in tier(related, unlocked) if w.canonical not in seen]
    return Scope(core=vd.one_per_word(core), topic=topic_words, related=related_words,
                 next_level=tier(topics + related, next_levels), found=found, unlocked=unlocked, topics=topics,
                 related_topics=related, challenge=challenge, blocked=blocked)


def scope(db: Session, user, game: str, lesson_key: str, words: list[str], rows=None) -> Scope:
    """The tiers of a lesson's game for this learner (bank `rows` may be passed in to share one read)."""
    from . import clock, education
    entry = lc.lesson(lesson_key)
    grade = entry["grade"] if entry else lc.GRADES[0]
    policy = vd.policy_for(user.school_grade)
    allowed = vd.senses(rows if rows is not None else vd.bank_rows(db), policy, game)
    found = vd.discovered(db, user.id, game)
    levels = vd.settle_levels(db, user, game, policy, vd.one_per_word(allowed), found, education.learning_year(db, user.id),
                              clock.now())
    unlocked_lessons = _unlocked_lessons(db, user, grade)
    by_key = {w.key: w for w in allowed}
    return build_scope(allowed, words, found, vd.open_levels(levels, policy) or {1}, policy.ceiling,
                       _higher_or_locked_words(grade, unlocked_lessons), _opened_topics(user, grade, unlocked_lessons, by_key),
                       vd.challenge(db, user.id, game))


def easiest_first(words: list[vd.Word], exclude: set[str], n: int, challenge: int, rng: random.Random) -> list[vd.Word]:
    """n new words of a tier: the easiest ones (by level, in a random order within a level) and, when the learner does
    well, a share of harder ones (vd.hard_share: 10% → 70%, from just after the easy part). Below the starting
    challenge (more wrong answers lately) only the easiest."""
    fresh = sorted((w for w in words if w.canonical not in exclude), key=lambda w: (w.level, rng.random()))
    fresh = list({w.canonical: w for w in reversed(fresh)}.values())[::-1]  # one sense per word, the easiest kept
    if len(fresh) <= n:
        return fresh
    hard_n = round(n * vd.hard_share(challenge)) if challenge >= vd.CHALLENGE_START else 0
    easy = fresh[:n - hard_n]
    rest = fresh[n - hard_n:]
    harder = sorted(rest, key=lambda w: (w.level == easy[-1].level if easy else False, w.level, rng.random()))
    return easy + harder[:hard_n]


def pick(sc: Scope, count: int, rng: random.Random) -> list[tuple[vd.Word, str]]:
    """Up to `count` new words, each word once, by tier (see the module docstring), ordered from easy to hard."""
    picked: dict[str, tuple[vd.Word, str]] = {}

    def take(words: list[vd.Word], source: str, n: int) -> None:
        n = min(n, count - len(picked))
        if n > 0:
            for w in easiest_first(words, sc.found | set(picked), n, sc.challenge, rng):
                picked.setdefault(w.canonical, (w, source))

    stretch = next((n for threshold, n in STRETCH if sc.challenge >= threshold), 0)
    take(sc.core, "core", count)
    if stretch and sc.fresh(sc.topic) + sc.fresh(sc.related):  # doing well: a few words of the next level already
        take(sc.next_level, "next_level", stretch)
    take(sc.topic, "topic", count)
    take(sc.related, "related", count)
    take(sc.next_level, "next_level", count)
    return sorted(picked.values(), key=lambda p: vd.hardness(p[0]))


def lesson_words(db: Session, user, game: str, generator: dict, seed: int, count: int = vd.STAGE_WORDS) -> list[str]:
    """Called by learning_vocab.bank_items for a lesson's Khám phá stage (`generator`: the lesson game's, with `lesson`
    and vocab_bank.words): the entry keys, easy to hard ([] = no new word left)."""
    sc = scope(db, user, game, generator["lesson"], list(generator["vocab_bank"]["words"]))
    return [w.key for w, _ in pick(sc, count, random.Random(seed))]


def status(db: Session, user, lesson_key: str, words: list[str]) -> dict[str, dict]:
    """Per vocabulary game of a lesson (lesson detail): how many of its own words were discovered, how many new words
    its games can still bring, and the stage that discovered its last own word (the app says so on that result)."""
    from .models import VocabDiscovery
    rows = vd.bank_rows(db)
    out = {}
    for game in vd.GAMES:
        sc = scope(db, user, game, lesson_key, words, rows)
        core = {w.canonical for w in sc.core}
        left = {w.canonical for w in sc.fresh(sc.core + sc.topic + sc.related + sc.next_level)}
        done = core <= sc.found
        last = db.scalar(select(func.max(VocabDiscovery.session_id)).where(
            VocabDiscovery.user_id == user.id, VocabDiscovery.game == game, VocabDiscovery.canonical.in_(core))) if done and core else None
        out[game] = {"core_total": len(core), "core_discovered": len(core & sc.found), "core_completed": done,
                     "core_completed_session": last, "new_words_left": len(left), "exhausted": not left,
                     "next_stage_words": min(vd.STAGE_WORDS, len(left)), "level": max(sc.unlocked),
                     "level_name": vd.LEVEL_NAMES[max(sc.unlocked)], "topics": sc.topics, "related_topics": sc.related_topics}
    db.commit()  # levels opened by settle_levels (as GET /vocabulary/progress does)
    return out


def report() -> list[dict]:
    """Per ready vocabulary lesson, for a new learner of its grade (nothing discovered, the grade's starting levels,
    every ready lesson of the grade unlocked): the words its games can serve in each tier, read from the bundled
    data files. `python -m app.vocab_lesson report`."""
    from types import SimpleNamespace
    from .learning_vocab import check, effective_status
    data, rep = check()
    rows = [SimpleNamespace(entry_key=r.key, word=r.word, difficulty=r.difficulty, topic=r.topic, part_of_speech=r.pos,
                            meaning_vi=r.meaning_vi, context_vi=r.context_vi, accepted_json=json.dumps(r.accepted))
            for r in data if effective_status(r, rep) == "active"]
    out = []
    for key, entry in sorted(lc.catalog()["lessons"].items(), key=lambda kv: (kv[1]["grade"], kv[0])):
        words = _vocab_words(entry)
        if entry["subject"] != "english" or not words or entry["lesson"]["status"] != "ready":
            continue
        grade = entry["grade"]
        policy = vd.policy_for(f"grade{grade}")
        user = SimpleNamespace(school_grade=f"grade{grade}")
        unlocked = {k for k, e in lc.catalog()["lessons"].items() if e["subject"] == "english" and e["grade"] == grade
                    and e["lesson"]["status"] == "ready"}
        row = {"lesson": key, "grade": grade, "ceiling": policy.ceiling}
        for game in vd.GAMES:
            allowed = vd.senses(rows, policy, game)
            sc = build_scope(allowed, words, set(), set(range(1, policy.start + 1)), policy.ceiling,
                             _higher_or_locked_words(grade, unlocked), _opened_topics(user, grade, unlocked, {w.key: w for w in allowed}))
            sizes = {"core": len(sc.core), "topic": len(sc.topic), "related": len(sc.related), "next_level": len(sc.next_level)}
            levels = Counter(w.level for w in sc.core + sc.topic + sc.related + sc.next_level)
            row[game] = {**sizes, "total": sum(sizes.values()), "by_level": dict(sorted(levels.items())),
                         "topics": sc.topics, "related_topics": sc.related_topics}
        out.append(row)
    return out


if __name__ == "__main__":  # python -m app.vocab_lesson report
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    for line in report():
        print(json.dumps(line, ensure_ascii=False))
