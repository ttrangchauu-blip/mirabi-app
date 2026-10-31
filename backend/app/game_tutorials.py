"""Interactive game tutorials: each game teaches itself in its own screen, with its own demo content.

A tutorial is played in the real game (mobile GameScreen in Tutorial Mode): the same renderer, input, drag, animations
and answer checks as a stage, but the session is a local demo on the device. Nothing here creates a learning session,
writes an event, moves mastery, takes a heart or grants EXP or rewards: the only rows written are the tutorial's own
progress (`learning_tutorial_views`).

- `app/data/game_tutorials.json` is the definition table (game_tutorial_definitions): per game its mode, gameplay and
  tutorial versions, the demo content and the steps. It is validated when the app starts (an invalid file stops the
  server), and every demo item is built by the same snapshot builder a lesson uses (curriculum_games, lesson_games,
  learning_vocab), so the demo looks and checks exactly like the real thing.
- Steps are data only: an action, a target region, the expected learner action and result, a demo animation and short
  feedback, each from a fixed list the app knows (mobile learning/tutorial/registry.ts). No code, no callbacks.
- `POST .../tutorial/check` answers a demo turn with the game's own checker (learning.check_answer and the
  curriculum/lesson checkers) on an item that is never saved.

Rules and the API: docs/GAME_TUTORIALS.md.
"""
from __future__ import annotations

import json
import logging
import random
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import clock, curriculum_games as cg, game_registry, lesson_games as lg
from .db import get_db
from .errors import APIError
from .learning import GameId, check_answer, correct_answer_text, correct_option_ids, word_pair
from .learning_engine import TYPED_TARGET_KINDS, WRONG_POLICY, InvalidAnswer, answer_key
from .learning_vocab import snapshot as vocab_snapshot
from .lesson_catalog import limits
from .models import LearningSessionItem, LearningTutorialView, User
from .ratelimit import enforce
from .security import current_user

log = logging.getLogger("refmi.tutorials")

DATA = Path(__file__).parent / "data" / "game_tutorials.json"
GAMES: tuple[str, ...] = GameId.__args__  # type: ignore[attr-defined]

# The registry the app draws from (mobile learning/tutorial/registry.ts): keep both in step.
ACTIONS = {"observe", "tap", "drag", "type", "submit", "connect", "aim", "interact"}
TARGETS = {"header", "prompt", "play", "aimed", "input", "none"}
EXPECTED_ACTIONS = {"next", "answer", "miss", "continue"}
EXPECTED_RESULTS = {"correct", "any"}
ANIMATIONS = {"none", "arrow", "pulse", "hand_tap", "hand_drag", "hand_type", "watch"}
MODES = {"practice"}
STATUSES = {"completed", "skipped", "in_progress"}
MAX_STEPS = 6
MAX_INSTRUCTION = 90  # one short line: a tutorial is played, not read
MAX_FEEDBACK = 110


class TutorialError(ValueError):
    """A tutorial definition that must not be served."""


# ---------------------------------------------------------------------------------------------------------------
# Demo content: built by the real builders
# ---------------------------------------------------------------------------------------------------------------

def _vocab(spec: dict) -> dict:
    e = spec["entry"]
    entry = SimpleNamespace(word=e["word"], meaning_vi=e["meaning_vi"], context_vi=e.get("context_vi"), phonetic=e.get("phonetic"),
                            part_of_speech=e.get("part_of_speech"), accepted_json=json.dumps(e.get("accepted") or [e["word"]]),
                            difficulty=None, cefr=None, level="", topic="tutorial", example_en=e.get("example_en", ""),
                            example_vi=e.get("example_vi", ""), entry_key=f"tutorial.{e['word']}", content_version=1)
    return vocab_snapshot("tutorial", entry, spec["kind"], "tutorial")


BUILDERS = {
    "vocab": _vocab,
    "item": lambda spec, rng: dict(spec["item"]),
    "word_build": lambda spec, rng: cg._word_build(spec["item"], rng),
    "spell_fix": lambda spec, rng: cg._spell_fix(spec["item"], {}, rng),
    "sort_card": lambda spec, rng: cg._sort_card(spec["set"], spec["card"]),
    "code_path": lambda spec, rng: cg._code_path(spec["level"], 1),
    "order": lambda spec, rng: cg.order_steps(spec["task"], rng, spec["title"]),
    "match": lambda spec, rng: cg.match_pairs(spec["task"], rng, spec["title"]),
    "choice": lambda spec, rng: cg.choice_explain(spec["task"], rng, spec["title"], spec.get("style", "quiz")),
    "lab": lambda spec, rng: cg.lab_experiment(spec["task"], rng, spec["title"], spec["scene"]),
    **{game: (lambda g: lambda spec, rng: lg.snapshot(g, spec["task"], rng, spec["title"]))(game) for game in lg.GAMES},
}
# The turn kinds each game plays (learning_engine.GAME_KINDS and the lesson games): a demo item of another kind would
# teach another game.
GAME_KINDS = {
    "word_shooter": {"word_spelling"}, "meteor": {"vocab_typing"}, "gate": {"gate_choice"}, "bridge": {"bridge_order"},
    "grammar": {"gate_choice", "bridge_order"}, "defense": {"math_input"}, "math_bridge": {"missing_number", "compare"},
    "word_builder": {"word_build"}, "spelling_detective": {"spell_fix"}, "sorting": {"sort_card"}, "code_path": {"code_path"},
    "order": {"order_steps"}, "match": {"match_pairs"}, "choice": {"choice_explain"}, "lab": {"lab_experiment"},
    **{game: {lg.KIND[game]} for game in lg.GAMES},
}


def build_item(spec: dict) -> dict:
    """One demo item ({kind, prompt, answer, hints, explanation, ...}), the same every time (seeded)."""
    builder = BUILDERS[spec["build"]]
    rng = random.Random(f"tutorial.{spec['id']}")
    return builder(spec) if spec["build"] == "vocab" else builder(spec, rng)


def transient_item(item: dict, turn_id: str) -> LearningSessionItem:
    """The demo item as a session item the checkers read. Never added to a database session."""
    return LearningSessionItem(turn_id=turn_id, position=0, question_key="tutorial", skill_key="tutorial", skill_label="Hướng dẫn",
                               kind=item["kind"], prompt_json=json.dumps(item["prompt"], ensure_ascii=False),
                               answer_json=json.dumps(item["answer"], ensure_ascii=False), hints_json="[]",
                               explanation=item.get("explanation"), state="issued", attempts=0, wrong_attempts=0, hints_used=0)


def turn_out(item: dict, turn_id: str, position: int) -> dict:
    """The demo turn as the app gets a stage's turn (learning._turn_out): the prompt only, never the answer. Falling
    words carry the keys of their accepted answers, so they shoot as soon as they are typed right, as in a stage."""
    prompt = dict(item["prompt"])
    if item["kind"] in TYPED_TARGET_KINDS:
        prompt["answer_keys"] = [answer_key(turn_id, a, item["answer"].get("lang")) for a in item["answer"].get("accepted", [])]
    return {"turn_id": turn_id, "position": position, "kind": item["kind"], "skill_label": "Hướng dẫn", "prompt": prompt,
            "hints_shown": [], "hints_total": 0, "attempts": 0, "wrong_attempts": 0, "practice": False, "travel_seconds": 0,
            "on_screen_ms": 0}


# ---------------------------------------------------------------------------------------------------------------
# Loading and validating the definitions
# ---------------------------------------------------------------------------------------------------------------

def _validate(game: str, d: dict, problems: list[str]) -> None:
    where = f"{game}"
    if game not in GAMES:
        problems.append(f"{where}: unknown game")
        return
    if d.get("game_mode") not in MODES:
        problems.append(f"{where}: game_mode must be one of {sorted(MODES)}")
    registry = game_registry.GAMEPLAYS.get(game)
    expected_gameplay = registry["engine_version"] if registry else 1
    if d.get("gameplay_version") != expected_gameplay:
        problems.append(f"{where}: gameplay_version {d.get('gameplay_version')} is not the game's engine version {expected_gameplay}"
                        " (a changed gameplay needs its tutorial checked again)")
    if not isinstance(d.get("tutorial_version"), int) or d["tutorial_version"] < 1:
        problems.append(f"{where}: tutorial_version is a positive integer")
    for key in ("ready",):
        if not isinstance(d.get(key), list) or len(d[key]) > 2 or any(not isinstance(x, str) or len(x) > MAX_FEEDBACK for x in d[key]):
            problems.append(f"{where}: {key} is at most 2 short lines")
    if not isinstance(d.get("done_title"), str) or not d["done_title"] or len(d["done_title"]) > MAX_FEEDBACK:
        problems.append(f"{where}: done_title is one short line")
    demo = d.get("demo") or []
    ids = [x.get("id") for x in demo]
    if not demo or len(set(ids)) != len(ids):
        problems.append(f"{where}: demo items need distinct ids")
    for spec in demo:
        if spec.get("build") not in BUILDERS:
            problems.append(f"{where}.{spec.get('id')}: unknown builder {spec.get('build')}")
            continue
        try:
            item = build_item(spec)
        except (KeyError, TypeError, ValueError, StopIteration) as exc:
            problems.append(f"{where}.{spec['id']}: cannot be built ({exc!r})")
            continue
        if item["kind"] not in GAME_KINDS[game]:
            problems.append(f"{where}.{spec['id']}: a {item['kind']} turn is not played in {game}")
        if spec["build"] in lg.GAMES:
            lg.validate_task(spec["build"], spec["task"], limits(5), f"{where}.{spec['id']}", problems)
    steps = d.get("steps") or []
    if not 1 <= len(steps) <= MAX_STEPS:
        problems.append(f"{where}: 1–{MAX_STEPS} steps")
    released: list[str] = []
    hands_on = 0
    step_ids = [s.get("id") for s in steps]
    if len(set(step_ids)) != len(step_ids):
        problems.append(f"{where}: step ids must be distinct")
    for i, s in enumerate(steps):
        at = f"{where}.steps[{i}]"
        if s.get("action") not in ACTIONS:
            problems.append(f"{at}: action must be one of {sorted(ACTIONS)}")
        if s.get("target") not in TARGETS:
            problems.append(f"{at}: target must be one of {sorted(TARGETS)}")
        if s.get("demo_animation", "none") not in ANIMATIONS:
            problems.append(f"{at}: demo_animation must be one of {sorted(ANIMATIONS)}")
        expected = s.get("expected_action")
        if expected not in EXPECTED_ACTIONS:
            problems.append(f"{at}: expected_action must be one of {sorted(EXPECTED_ACTIONS)}")
        observing = s.get("action") == "observe"
        if observing != (expected in ("next", "miss")):
            problems.append(f"{at}: an observe step waits for next or miss; any other step for the learner's action")
        if expected == "answer":
            hands_on += 1
            if s.get("expected_result", "correct") not in EXPECTED_RESULTS:
                problems.append(f"{at}: expected_result must be one of {sorted(EXPECTED_RESULTS)}")
            if not s.get("retry_feedback"):
                problems.append(f"{at}: an answer step says what to do after a wrong try (retry_feedback)")
        if expected == "next" and not isinstance(s.get("advance_ms", 0), int):
            problems.append(f"{at}: advance_ms is milliseconds")
        if not isinstance(s.get("instruction"), str) or not s["instruction"] or len(s["instruction"]) > MAX_INSTRUCTION:
            problems.append(f"{at}: instruction is one short line (≤ {MAX_INSTRUCTION} characters)")
        for key in ("success_feedback", "retry_feedback"):
            if key in s and (not isinstance(s[key], str) or len(s[key]) > MAX_FEEDBACK):
                problems.append(f"{at}: {key} is one short line")
        for rid in s.get("release", []):
            if rid not in ids:
                problems.append(f"{at}: releases unknown demo item {rid}")
            released.append(rid)
    if sorted(released) != sorted(ids):
        problems.append(f"{where}: every demo item is released exactly once")
    if hands_on == 0:
        problems.append(f"{where}: a tutorial has at least one hands-on step (expected_action answer)")


@lru_cache(maxsize=1)
def definitions() -> dict[str, dict]:
    data = json.loads(DATA.read_text(encoding="utf-8"))
    problems: list[str] = []
    games = data.get("games") or {}
    for game, d in games.items():
        _validate(game, d, problems)
    if problems:
        raise TutorialError(f"{DATA.name}: " + "; ".join(problems[:12]))
    out = {}
    for game, d in games.items():
        items = {spec["id"]: build_item(spec) for spec in d["demo"]}
        out[game] = {**d, "game_id": game, "items": items}
    if missing := missing_tutorials(out):
        log.warning("tutorial_missing: no interactive tutorial yet for %s (%s)", ", ".join(missing), DATA.name)
    return out


def missing_tutorials(defs: dict[str, dict] | None = None) -> list[str]:
    """The games that can be played but have no tutorial yet: a configuration to finish, never filled by another game's."""
    defs = definitions() if defs is None else defs
    return [game for game in GAMES if game not in defs]


def definition(game: str) -> dict:
    """The tutorial of a game. Unknown game: 404 game_not_found. A game without one: 404 tutorial_missing, logged for the
    administrators; the app then says the game is not set up yet and never shows another game's tutorial."""
    if game not in GAMES:
        raise APIError(404, "game_not_found", "Unknown game")
    d = definitions().get(game)
    if d is None:
        log.warning("tutorial_missing: game %s has no tutorial definition in %s", game, DATA.name)
        raise APIError(404, "tutorial_missing", "This game's tutorial is not set up yet")
    return d


def public(d: dict) -> dict:
    """What the app gets: the steps and the demo turns (prompts only, never the answers)."""
    order = [spec["id"] for spec in d["demo"]]
    return {"game_id": d["game_id"], "game_mode": d["game_mode"], "gameplay_version": d["gameplay_version"],
            "tutorial_version": d["tutorial_version"], "subject": d["subject"], "hearts": d.get("hearts", 0),
            "skippable": bool(d.get("skippable", True)), "done_title": d["done_title"], "ready": d["ready"],
            "steps": [{"expected_result": "correct", "demo_animation": "none", "release": [], **s} for s in d["steps"]],
            "demo": [turn_out(d["items"][tid], tid, i + 1) for i, tid in enumerate(order)], "status": "published"}


def hands_on_steps(d: dict) -> set[str]:
    return {s["id"] for s in d["steps"] if s["expected_action"] != "next"}


# ---------------------------------------------------------------------------------------------------------------
# Progress (user_game_tutorial_progress = learning_tutorial_views)
# ---------------------------------------------------------------------------------------------------------------

def required(row: LearningTutorialView | None, d: dict) -> bool:
    """The tutorial is asked for unless it was completed or skipped at this tutorial version and gameplay version."""
    return not (row is not None and row.status in ("completed", "skipped") and row.version >= d["tutorial_version"]
                and (row.gameplay_version or 1) >= d["gameplay_version"])


def progress_out(row: LearningTutorialView | None, d: dict) -> dict:
    done = row is not None and row.status in ("completed", "skipped")
    return {"game_id": d["game_id"], "game_mode": d["game_mode"], "tutorial_version": d["tutorial_version"],
            "gameplay_version": d["gameplay_version"], "required": required(row, d),
            "status": "not_started" if row is None else row.status, "played_version": row.version if row else None,
            "current_step": row.current_step if row else 0,
            "completed_at": row.completed_at.isoformat() if done and row.completed_at else None}


def _row(db: Session, user: User, game: str) -> LearningTutorialView | None:
    return db.scalar(select(LearningTutorialView).where(LearningTutorialView.user_id == user.id, LearningTutorialView.game == game))


def _check_versions(d: dict, mode: str, tutorial_version: int) -> None:
    if mode != d["game_mode"]:
        raise APIError(422, "mode_mismatch", f"This tutorial is for mode {d['game_mode']}")
    if tutorial_version != d["tutorial_version"]:
        raise APIError(409, "tutorial_outdated", "A newer tutorial is available: reload it")


def _save(db: Session, user: User, game: str, d: dict, status: str, step: int) -> LearningTutorialView:
    """Writes the progress, never going back: a tutorial completed at the current versions stays completed (watching it
    again or skipping it later changes nothing), a skipped one can still be completed."""
    row = _row(db, user, game)
    now = clock.now()
    if row is None:
        row = LearningTutorialView(user_id=user.id, game=game, version=d["tutorial_version"])
        db.add(row)
    elif not required(row, d) and (row.status == "completed" or status != "completed"):
        return row
    row.version, row.gameplay_version, row.game_mode = d["tutorial_version"], d["gameplay_version"], d["game_mode"]
    row.status, row.current_step, row.updated_at = status, step, now
    if status in ("completed", "skipped"):
        row.completed_at = now
    try:
        db.commit()
    except IntegrityError:  # the same tutorial saved at the same moment on another device
        db.rollback()
        row = _row(db, user, game)
    return row


# ---------------------------------------------------------------------------------------------------------------
# Checking a demo answer: the game's own checker, nothing saved
# ---------------------------------------------------------------------------------------------------------------

def check(d: dict, turn_id: str, answer: Any) -> dict:
    """The result of a demo answer, shaped as a stage's (learning.answer_event) without score, hearts or combo. Retry
    games keep the turn open after a wrong answer; reveal games resolve it (the app plays it again, as a stage does)."""
    item = d["items"].get(turn_id)
    if item is None:
        raise APIError(404, "turn_not_found", "Not a turn of this tutorial")
    kind = item["kind"]
    prompt = dict(item["prompt"])
    result: dict[str, Any] = {"turn_id": turn_id, "event": "answer", "correct": False, "outcome": None, "resolved": False,
                              "retry_allowed": False, "error_type": None, "score_delta": 0, "hearts_delta": 0, "combo": 0,
                              "hint": None, "correct_answer": None, "explanation": None, "practice_added": False, "word": None,
                              "feedback": None, "kept": None, "prompt": None}
    try:
        if kind == "spell_fix" and isinstance(answer, list) and len(answer) == 2:
            # The second step: the word was found (the app sends it with the spelling chosen).
            if answer[0] != item["answer"]["wrong_id"]:
                raise InvalidAnswer("expected the found word and an option")
            prompt.update(step="fix", found=answer[0], options=item["answer"]["options"])
        elif kind == "spell_fix" and cg.spell_found(prompt, item["answer"], answer):
            text = next(t["text"] for t in prompt["tokens"] if t["id"] == answer[0]).strip(".,!?;:")
            prompt.update(step="fix", found=answer[0], options=item["answer"]["options"])
            return {**result, "correct": True, "prompt": prompt, "feedback": f"Đúng rồi, “{text}” viết sai! Giờ chọn cách viết đúng."}
        probe = transient_item({**item, "prompt": prompt}, turn_id)
        if kind in cg.KINDS:
            correct, error_type, _, feedback = cg.check(kind, prompt, item["answer"], answer)
        else:
            (correct, error_type, _), feedback = check_answer(probe, answer), None
    except InvalidAnswer:
        raise APIError(422, "invalid_answer_format", "Empty or malformed answer; it was not counted")
    result.update(correct=correct, error_type=error_type, feedback=feedback)
    if correct or WRONG_POLICY[kind] == "reveal":
        result.update(resolved=True, outcome="first_try" if correct else "wrong", correct_answer=correct_answer_text(probe),
                      correct_options=correct_option_ids(probe), explanation=item.get("explanation"), word=word_pair(probe))
    else:
        result["retry_allowed"] = True
        result["kept"] = cg.kept(kind, prompt, item["answer"], answer)
    return result


def landed(d: dict, turn_id: str) -> dict:
    """A falling demo target that reached the ground: what it carried, as a stage's miss shows it (learning.miss_event),
    without the heart (the app takes a demo heart of its own)."""
    item = d["items"].get(turn_id)
    if item is None or item["kind"] not in TYPED_TARGET_KINDS | {"math_input"}:
        raise APIError(404, "turn_not_found", "Not a falling turn of this tutorial")
    probe = transient_item(item, turn_id)
    return {"turn_id": turn_id, "event": "miss", "outcome": "missed", "resolved": True, "hearts_delta": 0, "combo": 0,
            "correct_answer": correct_answer_text(probe), "explanation": item.get("explanation"), "word": word_pair(probe)}


# ---------------------------------------------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------------------------------------------

router = APIRouter(prefix="/api/games", tags=["game tutorials"])


class ProgressIn(BaseModel):
    game_mode: Literal["practice"] = "practice"
    tutorial_version: int = Field(ge=1, le=1000)
    current_step: int = Field(default=0, ge=0, le=MAX_STEPS)
    status: Literal["in_progress", "skipped"] = "in_progress"


class CompleteIn(BaseModel):
    game_mode: Literal["practice"] = "practice"
    tutorial_version: int = Field(ge=1, le=1000)
    gameplay_version: int = Field(ge=1, le=1000)
    steps_done: list[str] = Field(default_factory=list, max_length=MAX_STEPS)


class CheckIn(BaseModel):
    tutorial_version: int = Field(ge=1, le=1000)
    turn_id: str = Field(min_length=1, max_length=32)
    answer: str | list[str] | None = None
    # "miss": a demo target landed; the word it carried is told (shown where it landed), nothing is checked.
    event: Literal["answer", "miss"] = "answer"


@router.get("/tutorials/progress", summary="Every game's tutorial progress for this account (which ones are still asked for)")
def all_progress(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = {r.game: r for r in db.scalars(select(LearningTutorialView).where(LearningTutorialView.user_id == user.id))}
    return {"games": {game: progress_out(rows.get(game), d) for game, d in definitions().items()}}


@router.get("/{game_id}/tutorial", summary="A game's interactive tutorial: steps and demo turns (never the answers)")
def get_tutorial(game_id: str, user: User = Depends(current_user)) -> dict:
    return public(definition(game_id))


@router.get("/{game_id}/tutorial/progress", summary="This account's progress in a game's tutorial")
def get_progress(game_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    d = definition(game_id)
    return progress_out(_row(db, user, game_id), d)


@router.post("/{game_id}/tutorial/progress", summary="Save where the tutorial was left, or that it was skipped")
def save_progress(game_id: str, data: ProgressIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    d = definition(game_id)
    _check_versions(d, data.game_mode, data.tutorial_version)
    if data.current_step >= len(d["steps"]):
        raise APIError(422, "step_out_of_range", "No such step in this tutorial")
    return progress_out(_save(db, user, game_id, d, data.status, data.current_step), d)


@router.post("/{game_id}/tutorial/complete", summary="The tutorial was played to its end (every hands-on step done)")
def complete(game_id: str, data: CompleteIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Records the tutorial only. A tutorial never grants EXP, rewards or lesson progress, and never counts as a stage."""
    d = definition(game_id)
    _check_versions(d, data.game_mode, data.tutorial_version)
    if data.gameplay_version != d["gameplay_version"]:
        raise APIError(409, "tutorial_outdated", "The game has changed: reload its tutorial")
    missing = hands_on_steps(d) - set(data.steps_done)
    if missing:
        raise APIError(422, "steps_missing", f"Every hands-on step must be done first (missing: {', '.join(sorted(missing))})")
    return progress_out(_save(db, user, game_id, d, "completed", len(d["steps"]) - 1), d)


@router.post("/{game_id}/tutorial/check", summary="Check a demo answer with the game's own checker (nothing is saved)")
def check_demo(game_id: str, data: CheckIn, user: User = Depends(current_user)) -> dict:
    d = definition(game_id)
    if data.tutorial_version != d["tutorial_version"]:
        raise APIError(409, "tutorial_outdated", "A newer tutorial is available: reload it")
    enforce("tutorial_check", "120/60", str(user.id))
    if data.event == "miss":
        return {"result": landed(d, data.turn_id)}
    if data.answer is None:
        raise APIError(422, "invalid_answer_format", "Empty or malformed answer; it was not counted")
    return {"result": check(d, data.turn_id, data.answer)}
