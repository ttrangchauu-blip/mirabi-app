# Interactive game tutorials

Every learning game teaches itself **in its own game screen**: the learner watches, does the real move and gets
feedback before the first real stage. A tutorial is never a page of text and never a fake copy of a game.

```
Lớp → Môn → Bài → Trò chơi ─┬─ tutorial required? ── Tutorial Mode (real GameScreen + demo session) ── "Bắt đầu chơi" ─┐
                            └─ no ─────────────────────────────────────────────────────────────────────────────────────┴─ Play Mode: 3-2-1 → stage
```

## Two modes, one game engine

| | Tutorial Mode | Play Mode |
|---|---|---|
| Screen | `GameScreen` (same renderer, input, drag, animations, feedback loop) | `GameScreen` |
| Session | `DemoSession` on the device (`mobile/src/learning/tutorial/demoSession.ts`), id `-1` | the server's (`learningApi`) |
| Content | the tutorial's demo turns, built by the real snapshot builders | the lesson's |
| Answer check | the game's own server checker, via `POST /api/games/{game}/tutorial/check` (writes nothing) | the stage's answer event |
| Score, hearts, EXP, mastery, lesson progress | never (no stage exists; demo hearts only, never below 1) | yes |
| Countdown | none (`instant`) | 3-2-1 |

`GameScreen` takes an optional `backend: GameBackend` (default `learningApi`) and `tutorial: TutorialHost`. Nothing else
in the game differs: the hint row, *Xem đáp án* and the scratch pad are hidden, and the pause menu becomes *Tạm dừng
hướng dẫn* (continue, *Bỏ qua* when allowed, leave).

## Parts

| Part | File | Role |
|---|---|---|
| Definitions | `backend/app/data/game_tutorials.json` | per game: mode, gameplay and tutorial versions, demo items, steps (data only) |
| Loader, API | `backend/app/game_tutorials.py` | validates at startup (a bad file stops the server), builds demo items with `curriculum_games` / `lesson_games` / `learning_vocab` builders, serves, checks, saves progress |
| Progress | `learning_tutorial_views` (= user_game_tutorial_progress) | `status` completed / skipped / in_progress, `version`, `gameplay_version`, `current_step` |
| Registry | `mobile/src/learning/tutorial/registry.ts` | the actions, targets, animations a step may name (mirror of the backend lists) |
| State machine | `mobile/src/learning/tutorial/machine.ts` | pure reducer, see below |
| Controller | `mobile/src/learning/tutorial/useTutorialController.ts` | timers, releases demo turns per step, saves the step reached |
| Demo session | `mobile/src/learning/tutorial/demoSession.ts` | a `GameBackend` on the device |
| UI | `mobile/src/screens/learning/tutorial/` | `InteractiveTutorial` (loads, mounts `GameScreen`), `TutorialLayer` (coach line, spotlight, progress, ready card) |
| Progress hook | `mobile/src/learning/tutorial/progress.ts` | `needs`, `finish`, `skip`, `left`; device copy per account, resent when back online |

## State machine

```
NOT_STARTED → INTRO → DEMONSTRATING → WAITING_FOR_ACTION → VALIDATING_ACTION → STEP_COMPLETED → INTRO (next) … → TUTORIAL_COMPLETED
                                             ↑──────── wrong: retry_feedback, same step ────────┘
any active state → SKIPPED
```

- A wrong action never advances or skips: the step stays with its `retry_feedback`.
- `TUTORIAL_COMPLETED` needs every hands-on step (`expected_action` ≠ `next`); the backend checks `steps_done` too.
- Reduced motion: no demo animation (INTRO → WAITING), the ring and hand stay still.
- Every timer belongs to one phase and is cleared when it changes or the screen is left.

## A step

```json
{"id": "type", "action": "type", "instruction": "Gõ nghĩa của “apple”: quả táo", "target": "aimed",
 "demo_animation": "hand_type", "expected_action": "answer", "expected_result": "correct",
 "success_feedback": "Chính xác! Pet bắn ngay!", "retry_feedback": "Chưa đúng. Gõ “quả táo” nhé.",
 "release": ["t1"], "fall_seconds": 6, "advance_ms": 3500}
```

| Field | Values |
|---|---|
| `action` | observe, tap, drag, type, submit, connect, aim, interact (observe holds the game's input) |
| `target` | header, prompt, play, aimed (the falling word, followed as it falls), input, none |
| `expected_action` | next (*Tiếp* or `advance_ms`), answer (a checked answer), miss (a falling target lands), continue (the explanation closed) |
| `expected_result` | correct, any |
| `demo_animation` | none, arrow, pulse, hand_tap, hand_drag, hand_type, watch |
| `release` | demo turn ids that enter the game when the step starts (each exactly once in a tutorial) |
| `fall_seconds` | released falling words land after this long; without it they drift down and wait (never missed) |

Rules enforced at startup: instruction ≤ 90 characters, ≤ 6 steps, ≥ 1 hands-on step, every answer step has
`retry_feedback`, demo items of the game's own turn kinds only, `gameplay_version` = the game's
`game_registry.GAMEPLAYS[...].engine_version` (a changed gameplay fails until its tutorial is checked again).

## API

| Method & path | |
|---|---|
| `GET /api/games/tutorials/progress` | every game's progress for this account, with `required` |
| `GET /api/games/{game}/tutorial` | steps and demo turns (prompts only; falling words carry answer keys, never answers). `404 game_not_found`, `404 tutorial_missing` (logged) |
| `GET /api/games/{game}/tutorial/progress` | one game |
| `POST /api/games/{game}/tutorial/progress` | `{tutorial_version, current_step, status: in_progress \| skipped}`; never undoes a completion |
| `POST /api/games/{game}/tutorial/complete` | `{tutorial_version, gameplay_version, steps_done}`; `422 steps_missing`, `409 tutorial_outdated`. Grants nothing |
| `POST /api/games/{game}/tutorial/check` | `{tutorial_version, turn_id, answer}` or `{…, event: "miss"}`; the game's checker on an unsaved item; rate limited |

A tutorial is **required** unless it was completed or skipped at the current `tutorial_version` and `gameplay_version`.
The old `GET/POST /api/learning/tutorials` (guide pages of older apps) still work; a row left `in_progress` is not
"seen" there. All interactive tutorials start at version 4, so everyone plays each once.

## Edge cases

| Case | Behaviour |
|---|---|
| Left mid-tutorial (pause → *Thoát*, back) | `in_progress` with the step; asked again next time, from the start (the demo is rebuilt) |
| App to background | the demo session pauses like a stage; *Tiếp tục hướng dẫn* goes on |
| Network lost during a check | the game's offline banner, the same answer retried; the step waits in VALIDATING |
| Taps while checking | one request at a time (`useLearningSession.run`); the ready card starts one game |
| Tutorial changed on the server | `409 tutorial_outdated` on check → the definition is reloaded |
| Game without a tutorial / one the app cannot play | *Hướng dẫn chưa sẵn sàng*, logged (server and app); *Chơi luôn* plays the game; never another game's tutorial |
| Watched again during a stage | pause menu → *Xem lại hướng dẫn*: played over the paused stage in its own demo session; *Tiếp tục chơi* resumes the same stage after 3-2-1; nothing is saved |
| Into Play Mode | the tutorial's screen is unmounted (its demo session closed): no demo object survives |

## Adding or changing a tutorial

1. Write the demo items with the builder the lesson games use (`build`: vocab, item, word_build, spell_fix, sort_card,
   code_path, order, match, choice, lab, timeline, sentence, geometry, balance).
2. Write ≤ 6 short steps; at least one hands-on step that uses the game's real control.
3. Raise `tutorial_version` when the change should be played again by everyone.
4. `pytest tests/test_game_tutorials.py` (every demo turn must be solvable by its game's checker), then regenerate the
   app's fixtures (`mobile/test/tutorialFixtures.json`) if a tested game changed.

## Coverage

All 19 games of `learning.GameId` before 2026-11-01 have a tutorial: word_shooter, meteor, gate, bridge, grammar,
defense (Math Battle), math_bridge, word_builder (Word Forest), spelling_detective, sorting, code_path, order, match,
choice, lab (Circuit / Magic Lab, circuit scene), timeline, sentence, geometry, balance. Games added later
(`number_line`, `step_solver`, `story_detective`, `sentence_xray`) are reported as `tutorial_missing` until theirs is
written.
