# Learning games: English & Math (Anh & Toán)

Mini games for **Tiếng Anh** (vocabulary, grammar) and **Toán** (+ − × :, missing number, comparison, order of
operations). **Học tập** in the menu always opens the **subject screen**: 🇬🇧 *Tiếng Anh*, 🧮 *Toán* or 📚 *Học tự
chọn* (the focus timer with its duration settings, sounds and study tools, unchanged). English and Math then list
their games. English games start at once; Math games open their setup (grade, topic, duration), a short lesson, then
the game. Every game plays in *Học tập* (`practice`): *Thử thách* used to be a second way into the same games, lessons,
progress and rewards, so it is no longer offered (see [Học tập only](#học-tập-only-thử-thách-merged)). The first time
a game is played its guide comes first (see [Cách chơi](#cách-chơi-first-time-guide-and-countdown)):

```
Học tập → Chọn môn ─┬─ Học tự chọn → focus timer (back returns to Chọn môn)
                    ├─ Tiếng Anh → Từ vựng ─┬─ Anh → Việt: Bắn từ vựng      → setup → lesson → play
                    │              │        └─ Việt → Anh: Bắn thiên thạch  → setup → lesson → play
                    │              └─ Chọn cổng đúng | Xây cầu bằng từ       → setup → lesson → play
                    └─ Toán      → Bảo vệ căn cứ | Xây cầu toán học                    → setup → lesson → play
```

Only *Bắt đầu* (or a tap on an English game) creates a session on the backend, one at a time; browsing subjects,
games and guides never does. An open session (an English
or Math game, or a focus timer running or paused) is offered as *Tiếp tục phiên học* on the subject screen.

**Content is random every session**, for English as for Math: a vocabulary stage picks 12 different words from the
vocabulary bank for this user (see [Vocabulary bank](#vocabulary-bank)) and the lesson shown before playing teaches
exactly those words; grammar sentences are generated from word pools by rules (am/is/are, -s/-es/-ies, has/does), so
no two stages are the same.

## Học tập only (Thử thách merged)

- The app no longer shows the *Học tập / Thử thách* switch (game list, Math setup) nor the mode name (lesson, *Tiếp
  tục phiên học*). Every new stage, replay and review is created with `mode: practice` (`PLAY_MODE` in
  `mobile/src/learning/labels.ts`); a mode saved on the device by older versions is ignored.
- Nothing is lost: lessons, questions, progress, the review list, the history and EXP never depended on the mode. A
  session started in *Thử thách* before stays playable as it was (moving targets, score, combo) and its result still
  shows its score; *Chơi lại* plays it again in Học tập. The backend keeps accepting both modes.

## Cách chơi (first-time guide) and countdown

- **Per game**: each game (`word_shooter`, `meteor`, `gate`, `bridge`, `grammar`, `defense`, `math_bridge`) has its
  own 3 pages in `mobile/src/learning/tutorials.ts`: *Mục tiêu*, *Cách thao tác* (an animated copy of the game drawn
  like the real one: a falling word, letter boxes filling then *Bắn*, the gates, the planks, the number pad…), *Kết
  thúc* (how the stage ends in Học tập: vocabulary costs no heart and words wait; grammar and Math have 3 hearts; time
  up is never a loss). Page indicator, *Trước* / *Tiếp*, *Bắt đầu* on the last page, *Đóng* (×).
- **When**: before the session exists when the game is known (English "Chơi ngay", *Luyện lại* from *Từ đã học*);
  after the lesson with the session still paused for Math; right after creating a paused review stage (*Ôn lại*),
  whose game the backend decides. Nothing runs behind it: no clock, no question issued, no countdown.
- **Saved** per account and game on the backend (`learning_tutorial_views`, unique `(user_id, game)`), only when *Bắt
  đầu* is pressed (closing it shows it again next time), with a device copy per account for offline use (sent on the
  next load). Afterwards it is skipped; *Cách chơi* on each game of the list, and in the pause menu (*Đã hiểu*),
  shows it again.
- **Countdown** (`useLearningSession`): on the game screen, big in the middle, `3 → 2 → 1 → Bắt đầu!`, for every
  start, replay and continue. Review and word-practice stages are now created paused too (`start_paused`), so the
  backend clock, the targets, answers and score only start with `/resume` at *Bắt đầu!*; the answer field only appears
  then. It waits for the game's pictures (`useGameAssets`, at most 4 s). Taps that would create a second session while
  one is on its way are ignored. Sent to the background during the countdown, it stops and counts again from 3 on
  return (also when the resume was already on its way: the session is paused again).
- **Studying together**: there is no group game yet. `GameScreen` takes a `startsAt` (the room's start time, on this
  device's clock): the countdown then follows that time and is never restarted locally, so every member starts at
  once, and finishing the guide never starts anything.

| Method & path | |
|---|---|
| `GET /api/learning/tutorials` | `{seen: [game, …]}`: the guides this account has finished |
| `POST /api/learning/tutorials/{game}` | Mark one finished (idempotent); `422` for an unknown game |

## Vocabulary bank

Both vocabulary games draw from one bank (`learning_vocab_entries`), filled from tab-separated files in
`backend/app/data/vocabulary/` (one file per topic; they open in any spreadsheet). One row is one **sense**: a word with
several meanings has one row per meaning, each with its own key (`bank.money` / `bank.river`, `cold.illness` /
`cold.weather`, `book` / `book.reserve`, `change.alter` / `change.money`, `date.calendar` / `date.romantic`,
`fine.ok` / `fine.penalty`) and a `context_vi` that the game shows.

| Column | |
|---|---|
| `key` | Stable id of the sense. Progress is kept per key (`en.word.<key>` Việt → Anh, `en.spell.<key>` Anh → Việt): never reuse a key for another meaning |
| `word`, `pos` | The English word or phrase (letters, spaces, hyphens), part of speech: noun, verb, adjective, adverb, phrase, phrasal_verb, … |
| `level`, `topic` | CEFR A1–C2; one of the 12 topics (daily_life, family, food, school, work, technology, health, travel, emotions, environment, animals, communication) |
| `meaning_vi`, `context_vi` | The Vietnamese meaning in context; the context is required when the word has other senses |
| `example_en`, `example_vi` | An example sentence and its translation |
| `accepted` | Other correct answers for Việt → Anh, separated by `\|` (`trash\|garbage`). Anh → Việt only accepts the word shown |
| `phonetic`, `source` | IPA (optional for phrases); where the row comes from (default `mirabi-original`) |

**Import** (run from `backend/`): `python -m app.learning_vocab check [files]` validates (default: the bundled files)
and prints the counts per topic and level; `import [files] [--retire-missing]` upserts by key (new keys inserted,
changed rows updated, unchanged rows skipped; nothing is deleted, `--retire-missing` only retires keys missing from the
files, kept for old sessions); `report` counts the active entries in the database. The bundled files are imported at
startup the same way, so they are the source of truth for their keys. Errors block a row (missing fields, unknown
level/topic/part of speech, duplicate key, characters that can't be typed, several senses without `context_vi`, the
same sense twice, two entries with the same meaning and context that don't accept each other's word — Việt → Anh would
be a guess); warnings are only reported (no phonetic, an example that doesn't seem to use the word).

**Content and rights**: the 444 bundled entries were written for Mirabi (meanings, contexts and examples are original;
no dictionary or word list was copied). Levels are an editorial estimate of difficulty, not official CEFR labels (such as
the English Vocabulary Profile, which is licensed), and should be reviewed by a teacher. Data imported from elsewhere must
be licensed for this use and say so in `source`.

| Topic | A1 | A2 | B1 | B2 | C1 | C2 | Total |
|---|---|---|---|---|---|---|---|
| Đời sống (daily_life) | 12 | 9 | 7 | 5 | 3 | 1 | 37 |
| Gia đình (family) | 11 | 8 | 8 | 5 | 4 | 2 | 38 |
| Ăn uống (food) | 13 | 11 | 8 | 5 | 4 | 2 | 43 |
| Học tập (school) | 16 | 6 | 8 | 5 | 2 | 2 | 39 |
| Công việc (work) | 8 | 6 | 8 | 6 | 4 | 2 | 34 |
| Công nghệ (technology) | 5 | 8 | 8 | 7 | 5 | 2 | 35 |
| Sức khỏe (health) | 7 | 7 | 7 | 6 | 4 | 2 | 33 |
| Du lịch (travel) | 8 | 7 | 8 | 5 | 4 | 2 | 34 |
| Cảm xúc (emotions) | 6 | 9 | 7 | 7 | 4 | 2 | 35 |
| Môi trường (environment) | 9 | 8 | 8 | 8 | 3 | 2 | 38 |
| Động vật (animals) | 16 | 8 | 6 | 6 | 4 | 2 | 42 |
| Giao tiếp (communication) | 9 | 6 | 8 | 7 | 4 | 2 | 36 |
| **Total** | **120** | **93** | **91** | **72** | **45** | **23** | **444** |

**How a stage picks its words** (`learning_vocab.pick_entries`, per game: Anh → Việt and Việt → Anh have their own
progress and level):
- **Level**: starts at A1. A level is passed once 12 of its words (or all of them) were seen and at least 80% of those
  answers were right at the first try; the working level is the first level not passed. Words above it are never drawn,
  except one level up to fill a stage that a small topic can't fill at the user's level. The level is computed on the
  whole bank; a topic only narrows which words are drawn.
- **Mix** (12 turns, each word at most once; only a re-practice after "Xem đáp án" repeats a word): up to 3 words to
  review (open "cần ôn" items: missed, wrong, hinted or revealed, until answered right at the first try in a later
  stage), 2 learned words not seen in the last 3 stages (least recently seen first), then new words of the working
  level, then words left from easier levels. When new words run out, the stage is filled with review and learned words
  instead of coming back empty.
- **Recent**: words of the last 3 stages of the same game are not drawn again as new or learned words while others are left.
- **Fall time**: 24 s, +1.5 s per letter over 7 and +2 s per extra word, at most 40 s (`travel_seconds` of each turn).
- **Lessons**: *Tổng hợp* (`en.vocab.mix`, all topics, chosen by default) and one lesson per topic, all at level
  *Tự điều chỉnh*: the setup has nothing to choose but the mode, so "Bắt đầu" is one tap away. The lessons
  `en.animals.starter` and `en.school.starter` keep their codes and word keys, so existing progress and review items
  carry on; their older versions (fixed word lists) stay for the sessions that used them.

The backend is the source of truth for answers, score, combo, hearts, the end of a stage, progress, completion and
EXP. The app animates, reports what the user did (answer, hint, "Xem đáp án", a target that reached the ground or the
base) and shows what the backend returns. Requires a network connection (see [Network and recovery](#network-and-recovery)).

## Architecture

```
Mobile (Expo)                                       Backend (FastAPI)
 screens/learning/LearningScreen  (stack)
   SubjectPicker → GamePicker → GameSetup → LessonIntro → GameScreen → ResultScreen, ReviewScreen
 learning/useLearningSession ──REST /api/learning──▶ learning.py         router, state machine, events, rewards
   (busy lock, retry with same event id,              learning_engine.py  answer checks, Math generator, scoring
    AppState pause, countdown)                        learning_content.py lessons + versioned seeder
 learning/useGameClock (pause-aware positions)        learning_grammar.py generated English grammar sentences
                                                      progression.award_exp ──▶ exp_events, pet_evolutions
                                                      companion (daily "learning" task, pet walk)
```

Reused, not duplicated: `users` (identity, pet, level), `exp_events` + `award_exp` (idempotent EXP ledger),
`pomodoro_settings.timezone` (the account timezone, kept in sync by the app), daily tasks (`activities` quest rows),
`APIError` codes, the auth dependency and the additive startup migration (`create_all`).

## Product rules

**Session = one stage (màn)** of 10–15 turns (12 by default) with a time budget (default 25 min, 15/25/40 in the app,
5–60 accepted). "Chơi lại" starts a new session. At most one open (active or paused) session per account.

| | Học tập (`practice`) | Thử thách (`challenge`) |
|---|---|---|
| Time per question | none; meteors/monsters drift in slowly (≈30 s) and stop short of the ground/base to wait | meteors/monsters move (`travel_seconds` per lesson: 24 s English, 18–30 s Math) |
| Hints, explanations | yes | yes (hinted answers score less) |
| Hearts | 3; every wrong answer −1; 0 hearts → `failed`. **Vocabulary games: no hearts** (`hearts_max` 0), nothing is lost | 3; 0 hearts → `failed` |
| Score, combo | not counted | first try 100 + 20 × combo (max ×5), hinted 60, corrected 40, re-practice 20 |
| Wrong choice (gate, bridge, compare) | answer + explanation, −1 heart, "Tiếp tục", the question comes back later ("thử lại") | answer + explanation, −1 heart |
| Wrong typed answer (meteor, monster, missing number) | −1 heart, correct it and try again | correct it; meteor/monster: no heart lost, missing number: −1 heart |
| Target reaches ground/base | impossible | −1 heart, turn `missed`, answer shown |

- **"Xem đáp án"** resolves the turn as `revealed` and queues a re-practice turn of the same question. The stage can
  only complete once every revealed question has a correctly answered re-practice. The original result stays
  `revealed` (re-practice never rewrites it) and never counts toward mastery.
- **Time up** is not a loss. Open turns can still be answered; no new turn is issued. The user then chooses
  *Học thêm 5 phút* (`/extend`, max 90 min in total) or *Kết thúc* (`/abandon` with `reason=time_up`, no completion reward).
- **Two vocabulary games** share each topic's word bank (`variant` on `POST /sessions`, stored as the session's `game`):

  | | Anh → Việt — *Bắn từ vựng* (`word_shooter`, kind `word_spelling`) | Việt → Anh — *Bắn thiên thạch* (`meteor`, kind `vocab_typing`, default) |
  |---|---|---|
  | Falls | the English word (`prompt.word`) | a meteor with the Vietnamese meaning |
  | User types | the same English word; only that spelling is accepted | the English word; declared equivalents accepted |
  | After a hit | the Vietnamese meaning, shown where the word broke, plus pronunciation | the pair to remember (*apple — quả táo*) with its phonetic, plus pronunciation |
  | Progress skill | `en.spell.<word>` (`skill_type` `spelling`): typing the shape of the word | `en.word.<word>` (`skill_type` `word`): recalling the word, the vocabulary mastery |

  The meaning of an Anh → Việt word is never sent before it is resolved (`result.word = {en, vi, phonetic}` on a hit,
  miss or reveal), and seeing it never counts as knowing the word: the two games keep separate progress, review items
  (`<lesson>.spell.<word>`, labelled *Mặt chữ: …*) and mastery. A review session of Anh → Việt items only is played as
  *Bắn từ vựng*. The meaning shown after a hit stays about 1.2 s, then fades (0.5 s), under the other falling words, and
  never blocks typing. A miss shows the English–Vietnamese pair. *Xem đáp án* is not offered in Anh → Việt (the word
  is on screen).
- **A typed shot** (both vocabulary games) hits whichever open word it matches, not only the aimed one; when several
  match, the one closest to the ground (issued first) is destroyed, one per shot. `result.turn_id` is the turn hit. A
  wrong shot counts against the aimed word.
- **Answer boxes**: in each word's (or meteor's) own frame, right under its text, moving with it: one box per letter
  (`prompt.letters`, e.g. `[6]` → *6 chữ cái*), the length shown, never the word. The aimed target shows what is typed;
  the others show small empty boxes, and tapping one answers that target. There is no *Bắn* and no Enter: as soon as
  the typed text is right for any falling word the answer is sent and the pet shoots. Each falling word carries
  `prompt.answer_keys` (SHA-256 of `turn_id|normalized answer`, 16 hex digits, one per accepted answer, never the
  answers; `learning_engine.answer_key` and `mobile/src/learning/answerKey.ts`); the backend still checks what is
  sent. Every box filled but not right is sent after a 0.7 s pause (time to finish a longer equivalent) and counts as
  wrong, as before; the same text is never sent twice. Behind the boxes there is one text
  field for the whole play field (`Playfield`, never remounted), so a falling target, choosing another one or a word
  breaking never closes and reopens the keyboard, and the typed text is kept. Hints: first letter, then last letter.
- **No overlapping words** (`games/fieldLayout.ts`): lanes spread over the whole width; each target (from the
  ground up) keeps its natural spot unless it would cover another word or a word held for a shot, then moves sideways to
  a free spot, or, when the field is too narrow, waits just above the word below it (just below only when there is no
  room above). A word is never shown higher than a moment before, so nothing jumps back up after a shot; sideways moves
  slide over a few frames. The aimed frame is only as wide as its answer boxes need, and grows downward. After a shot
  the next word in falling order is aimed and the answer field keeps the focus (on the web without scrolling).
- **The field never moves on screen**: the question card above it and the "Gợi ý" row under it stay in place, at a
  height that never shrinks (`Steady` in `GameScreen.tsx`), while no word is falling for a moment (a blank card, the
  buttons dimmed), and a notice or the hints take the card's one line under the word (at most two) instead of adding
  rows. Otherwise the field would grow and shrink between words, and every falling word would shift with it.
- **The pet shoots** (both vocabulary games, `mobile/src/screens/learning/games/shooterFx.ts` and `Playfield.tsx`): the
  user's pet (its idle strip, its walk strip while moving, mirrored to face its way; never redrawn) drifts gently along
  the bottom while waiting. A right answer is the backend's: "Chính xác!" shows at once and the word it resolved is held
  where it was (it no longer falls and can never be missed or scored again), the pet glides under it (≤ 0.28 s), stops
  to aim, and fires 3 small bullets with short trails from its head, 150 ms apart, each flying 500–800 ms depending on
  the distance (`SHOT_TUNING` in `shooterFx.ts`: bullets, gap, speed, flight bounds); the first one to arrive breaks the
  word into a few pieces (shot and break sounds,
  following *Âm thanh*), then the meaning or pair shows there and the English word is pronounced. A wrong answer shoots
  nothing: the word keeps falling and the pet shakes a little. Typing the next word works throughout. Position and
  sprite are separate (the pet's coordinates change, it never teleports or leaves the field), and everything runs on one
  pause-aware effect clock that moves Animated values frame by frame (the shooter layer is memoised and does not
  re-render with the game's 50 ms ticks, so shots stay smooth): pausing (or a lost connection, an explanation, the countdown) freezes the falling words, the
  pet, the bullets and the effects together. A new stage starts clean (the game screen is rebuilt). With reduced
  motion the pet does not drift and meanings do not rise as they fade.
- **Multiple targets** (Thử thách meteor/defense): up to 2 at once. The default target is the one closest to the
  ground/base; tapping another selects it.
- **English content** (`learning_grammar.py`, vocabulary banks in `learning_content.py`): grammar items record the
  rule they practise (`en.grammar.to_be.is`, `en.grammar.present_simple_s.es`, …); review sessions generate new
  sentences for exactly the rules that were missed. Sessions store their seed and every generated item, so results
  stay reproducible.
- **English answers**: case-insensitive, whitespace collapsed, curly apostrophes and trailing `.!?,;:` ignored. Only
  declared equivalents are accepted (`rubber` = `eraser`, `bunny` = `rabbit`, `school bag` = `schoolbag`). Words with
  several Vietnamese meanings carry a context (`cái bàn` → *bàn học của học sinh*). Bridges accept every declared
  word order (`I am happy today` / `Today I am happy`); every token must be used once.
- **Math** (all in `learning_engine.py`, never AI, never `eval`): problems are expression trees generated from a seed
  stored on the session, evaluated by our own code. Division is always exact and never by 0; missing-number problems
  are brute-force checked to have exactly one answer in range; order of operations is brackets → × : → + −. Answers
  are parsed as numbers (`-3`, `−3`, `2,5`, `2.5`); empty or malformed input returns `422 invalid_answer_format` and is
  **not** counted as wrong. A tolerance only applies when a question declares one (none of the built-in ones do).
  Hints are steps that never contain the final result. Error types are recorded when determinable
  (`order_of_operations`, `wrong_operation`, `carry_error`, `borrow_error`, `sign_error`, `times_table_slip`,
  `wrong_inverse_operation`, `reversed_sign`, …), otherwise none.

### Session states

```
active ⇄ paused          active → completed | failed | abandoned          paused → completed | abandoned
```
`completed`, `failed` and `abandoned` are final. Any other transition is `409 invalid_transition`; turn actions on a
paused session are `409 session_paused`, on an ended one `409 session_ended`. Server-side housekeeping on read: an
active session with no request for `LEARNING_AUTO_PAUSE_SECONDS` (90) is paused (app killed, network gone), and an
open session untouched for `LEARNING_EXPIRE_HOURS` (24) becomes `abandoned` (`end_reason=expired`).

**Play time** is measured by the server: between two requests at most `LEARNING_IDLE_CAP_SECONDS` (60) is counted, and
nothing while paused. A miss is accepted only after the target has been on screen (server play time) for half its
travel time (`409 miss_too_early`) — a plausibility check, not real-time anti-cheat; no per-frame positions are sent.

## Progress and review

Per account and **skill**: each word (`en.word.cat`, Việt → Anh), each word's spelling (`en.spell.cat`, Anh → Việt,
kept apart so retyping a word never marks it mastered), each grammar point (`en.grammar.to_be`), each Math problem type
(`math.arith.div`, `math.missing.sub`, `math.order_ops`, `math.compare`, …). Stored separately: `first_try`,
`corrected` (wrong then right), `hinted`, `revealed`, `missed`, `wrong`, attempts, error-type counts and a mastery
score 0–100 (≥ 80 = mastered). Revealed answers lower mastery; a correct re-practice after a reveal only adds +5.
Progress is written in the same transaction as the confirmed answer — never from client numbers. When a stage ends
with an open turn that already had wrong attempts, it is recorded as `wrong`.

**Cần ôn (review list)**: a question (English) or a problem type (Math) is added on `hinted`, `corrected`, `wrong`,
`revealed` or `missed`, and cleared by a first-try answer in a *later* session. "Luyện lại" starts a `review` session
from the topic's open items (Math generates fresh problems of the weak types). New lesson sessions weight their
turns toward weaker skills and open review items.

## Từ đã học (vocabulary history)

**Từ đã học** on the English game list (top right, next to the title) lists every word met in the two vocabulary
games, most recently studied first, with a search (English word or Vietnamese meaning, accent-insensitive) and the
filters *Tất cả*, *Trả lời đúng*, *Cần ôn*, 15 words a page (*Trước* / *Sau*; the page, filter and search are kept while a word is open, and a new filter or search starts on page 1). A word opens its detail: word, meaning and context, phonetic, part of
speech and example **only when the word bank (or the turn's frozen copy) has them**, a pronunciation button (the
device's text-to-speech, as in the games), right/wrong counts per game, every answer newest first, and *Luyện lại*.

- **Source, no new table**: the history is read from `learning_session_items` (turns of kind `word_spelling` =
  Anh → Việt and `vocab_typing` = Việt → Anh) joined to the user's sessions (`app/learning_history.py`). One entry
  per **sense** (`entry_key`, from the turn's answer or its skill key), so `bank.money` and `bank.river` are two
  entries and every stage updates the same entry. Meaning and details come from `learning_vocab_entries`, or from the
  turn's frozen copy for a word no longer in the bank. Sessions played before this screen existed are included with
  their real results; nothing is invented.
- **Results**: *đúng* = `first_try` or `hinted` (a letter hint, the answer never seen); *sai* = `corrected`, `wrong`,
  `revealed`, `missed`; *chưa trả lời* = a turn that was on screen (`issued`) and never resolved (the stage was
  paused, closed or ended). Turns still `queued` were never shown and are not history. Re-practice turns after
  *Xem đáp án* are listed (*luyện lại sau khi xem đáp án*) but never counted.
- **Cần ôn** (this screen): the last counted answer was wrong or unanswered in at least one of the games the word was
  played in. A right answer in one game does not cover the other, and one right answer is never "mastered". (The
  topic review list `learning_review_items` keeps its own rules, unchanged.)
- **Idempotent by construction**: an answer resent with the same `client_event_id` is replayed and changes nothing,
  and a turn is one row however often it is synced, so counts never double.
- **Luyện lại**: one word (its detail) or the *Cần ôn* group, in the game the user picks (*Bắn từ tiếng Anh* or *Bắn
  thiên thạch*). `POST /api/learning/vocabulary/practice` starts a `review` stage of *Tổng hợp* with those words
  (at most 12; the group: words due in the chosen game first, then words due in the other one), through the existing
  `create_session` / `bank_items` review path, so progress, the review list and this history update as in any stage.
  Review stages earn no completion reward: the reward rules are unchanged.
- **Sổ tay kiến thức**: there is no notebook feature in the app yet, so the detail has no "save" button.

| Method & path | |
|---|---|
| `GET /api/learning/vocabulary/history?q=&filter=all\|correct\|review&limit=15&offset=0` | One page (`limit` 1–100, default 15) of entries (word, meaning, context, part of speech, first/last seen, status, counts, per game `{correct, wrong, unanswered, last_result, last_at}`); `total` = words matching the filter and search; `counts` (the filter tabs) and `due` (Cần ôn words per game) are for the whole history |
| `GET /api/learning/vocabulary/history/{entry_key}` | One entry with `phonetic`, `example_en/vi`, `can_practice`, `attempts` (newest first); `404 word_not_found` when it is not in the user's own history |
| `POST /api/learning/vocabulary/practice` | `{game, entry_keys?}` (+ `Idempotency-Key`) → a review session; `409 no_words_to_practice` when none of the words is the user's (or none is due) |

## EXP and daily tasks

- A **valid stage** (lesson session, ≥ 10 required turns, `completed`) earns `LEARNING_STAGE_EXP` (10).
- **Once per subject per local day**: unique `learning_rewards (user_id, subject_id, local_date)`. The local day is
  the **account timezone** (`pomodoro_settings.timezone`; set from the device on first use), not the server's.
- **Daily task**: if the user picked the *Học một điều mới* (`learning`) daily task and it is not done today, the first
  completed stage completes that task and gets its task EXP **instead of** the stage reward (`reward.status=daily_task`).
- **Daily cap 60**: stage EXP shares the existing 60 EXP/day task pool (`TASK_DAILY_EXP_CAP`). The amount can be lower
  than 10 near the cap (`capped`) or 0 (`daily_cap_reached`).
- Replays, review sessions, `failed` and `abandoned` sessions keep progress but earn no completion reward
  (`already_claimed` / `not_eligible`).
- Atomic: the status change, claim row and `exp_events` row are one transaction; the claim and EXP ledger are unique
  keys, and the session row is version-checked, so retries, other devices and concurrent requests award once.

**Where this differs from the existing reward system (kept compatible)**
- `TASK_DAILY_EXP_CAP` now counts `task` **and** `learning` EXP (`progression.CAP_POOLS`), so the total of both stays
  ≤ 60. Task-only behaviour is unchanged.
- Existing daily tasks still use the **UTC** day (unchanged, to avoid moving quest days for current users); the
  learning reward uses the account's local day. Around local midnight the two "days" can differ by a few hours.
- The 60 EXP cap is not a global cap on all EXP: login streak, study minutes, group and team-quest EXP keep their own
  caps as before.

## Data model (new tables)

| Table | Purpose |
|---|---|
| `learning_subjects`, `learning_levels`, `learning_topics` | Catalog (unique codes per subject) |
| `learning_lessons` | Lesson per topic and level; `current_version` |
| `learning_lesson_versions` | Immutable content version: intro JSON, game/difficulty config JSON, `content_hash` |
| `learning_vocab_entries` | The vocabulary bank, one row per sense: word, part of speech, CEFR level, topic, meaning and context, examples, accepted answers, phonetic, source, status (active/retired), content hash; unique `entry_key` |
| `learning_vocab_items` | Words of lesson versions published before the bank (kept for the sessions that used them) |
| `learning_questions` | Fixed questions (vocab, gate, bridge): prompt, server-only answer, hints, explanation |
| `learning_sessions` | One stage: subject, topic, level, lesson, `game_type` and `game` (the game picked: `word_shooter`, `meteor`, `gate`, `bridge`, `grammar` = both, `defense`, `math_bridge`), mode, status, seed, scoring snapshot, timezone, play time, hearts, score, combo, reward; `version` (optimistic lock); partial unique index = one open session per user; unique `(user_id, client_request_id)` |
| `learning_session_items` | Each turn served, with a frozen copy of its question and answer, state, attempts, hints, outcome, error type, re-practice link |
| `learning_events` | Every accepted action; unique `(session_id, client_event_id)` → idempotent replay |
| `learning_skill_progress` | Per-user skill counters and mastery; unique `(user_id, skill_key)` |
| `learning_review_items` | "Cần ôn"; unique `(user_id, lesson_id, question_key)` |
| `learning_rewards` | Stage reward claim; unique `(user_id, subject_id, local_date)`, unique `session_id` |

All timestamps are UTC. Old sessions keep `lesson_version_id`, their item snapshots and `scoring_json`, so editing
content or rules never changes old results. Tables are created at startup by the existing additive upgrader.

**Content and seed**: built-in lessons are defined in `backend/app/learning_content.py` — English: *Tổng hợp* and one
vocabulary lesson per topic (words from the [vocabulary bank](#vocabulary-bank), 12 per stage), *Động từ to be* and
*Thì hiện tại đơn* (sentences generated per stage by `learning_grammar.py`); Math: 12 lessons across the 4 topics and
grades 2, 3, 4, 6 (negative integers). The seeder runs at startup and with `python -m app.learning_content`; it imports
the vocabulary bank, then publishes a new lesson version only when a lesson's content changed.

## API

All routes need `Authorization: Bearer <access token>`. Sessions belong to their user: anyone else gets
`404 session_not_found`. Errors use the project format `{"detail": "...", "code": "..."}`. OpenAPI subset:
[learning-openapi.json](learning-openapi.json) (regenerate with `backend/scripts/export_learning_openapi.py`); live
docs at `/docs`.

| Method & path | Purpose |
|---|---|
| `GET /api/learning/catalog` | Subjects → levels, topics (with open review counts), lessons. No answers. |
| `GET /api/learning/lessons/{id}` | Lesson + intro (words / grammar / Math method) |
| `POST /api/learning/sessions` | Start `{lesson_id, mode, duration_minutes, variant?, timezone, start_paused?}`; header `Idempotency-Key` → `201 SessionOut`. The app sends `start_paused: true`: the session's lesson is shown first and the clock starts with `/resume`. |
| `GET /api/learning/sessions/current` | `{session: SessionOut \| null}` to resume after reopening the app |
| `GET /api/learning/sessions` · `GET /sessions/{id}` · `GET /sessions/{id}/intro` | History, state, the intro of this session (vocabulary: exactly the words drawn for it) |
| `POST /sessions/{id}/next` | `{count}` open more turns (up to the game's target count) |
| `POST /sessions/{id}/answer` | `{turn_id, client_event_id, answer}` (text, option id, or ordered token ids) |
| `POST /sessions/{id}/hint` · `/reveal` · `/miss` | `{turn_id, client_event_id}` |
| `POST /sessions/{id}/pause` · `/resume` | Idempotent by state |
| `POST /sessions/{id}/extend` | `{minutes, client_event_id}` after time is up |
| `POST /sessions/{id}/complete` | Finish and claim the reward once (repeat → same result, `replayed: true`) |
| `POST /sessions/{id}/abandon` | `{reason: user_ended \| time_up}` end early, no completion reward |
| `GET /sessions/{id}/result` | Final state, outcome counts, every **seen** turn with its answer and explanation |
| `GET /api/learning/review?subject=` · `POST /api/learning/review/sessions` | Review list; start a review session `{topic_id, mode, start_paused?}` |
| `GET /api/learning/progress?subject=` | Skill progress |

Turn actions return `EventOut {result: TurnResultOut | null, session: SessionOut, replayed}`. `correct_answer` and
`explanation` are only filled once the turn is resolved or revealed; open turns never carry answers (a word turn's
label is just "Từ vựng"). Score, hearts, EXP and completion flags in a request body are ignored.

Stable error codes: `lesson_not_found`, `topic_not_found`, `session_not_found`, `turn_not_found` (404);
`open_session_exists`, `session_paused`, `session_ended`, `session_incomplete`, `session_not_finished`,
`invalid_transition`, `turn_not_open`, `too_many_attempts`, `no_more_hints`, `miss_not_allowed`, `miss_too_early`,
`idempotency_conflict`, `concurrent_update`, `nothing_to_review`, `duration_limit` (409); `invalid_answer_format`,
`variant_not_supported`, `invalid_timezone`, `validation_error` (422).

**Idempotency and concurrency**: every action carries a `client_event_id` chosen by the app per user action and
reused for every retry; a repeat returns the stored result (`replayed: true`) and changes nothing — a repeated answer
scores once, a repeated miss costs one heart. Using the same id for another action is `409 idempotency_conflict`.
Each session write is `UPDATE … WHERE version = :read_version` (SQLAlchemy `version_id_col`); a concurrent writer
re-reads and retries (then replays). Session creation is idempotent by `Idempotency-Key`.

## Mobile

`mobile/src/learning/` (API client, types, session hook, game clock, preferences, labels) and
`mobile/src/screens/learning/`:

- **Entry**: the Study tab (*Học tập*) shows `LearningScreen`, which starts on **SubjectPicker**: the three subject
  cards, *Tiếp tục phiên học* for an open game (also one started on another device; it can be dropped) or a focus
  timer under way, the *Học cá nhân / Học cùng bạn bè* switch and *Cần ôn*. Tapping *Học tập* in the menu always
  returns here. *Học tự chọn* shows the focus space (`StudyTab` → `PomodoroPanel`), whose back arrow returns here;
  the Home *Tập trung* tile opens it directly.
- **GamePicker**: the games of the subject (`SUBJECT_GAMES` in `learning/labels.ts`), each with *Cách chơi*.
- **GameTutorial** / **TutorialArt**: the game's guide (see above).
- **GameSetup**: English: topic, then level; Math: grade, then topic; then duration. Only lessons playable
  with the chosen game are offered (grammar lessons for *Chọn cổng đúng* / *Xây cầu bằng từ*, which are sent as the
  `variant`). *Bắt đầu* creates the session.
- **LessonIntro**: the 7 words drawn for this session with phonetic, 🔊 pronunciation (device text-to-speech),
  examples; or the grammar rule in Vietnamese with examples; or the Math method with worked examples. The session is
  created paused; *Bắt đầu chơi* starts the countdown and the clock; closing drops the unplayed session.
- **GameScreen**: HUD (back, pause, time left, turns, hearts, score for an older Thử thách stage, sound), question card, the game (*Bắn thiên thạch*, *Bảo vệ căn cứ*, *Chọn cổng đúng*,
  *Xây cầu bằng từ*, *Xây cầu toán học*), text input for English (KeyboardAvoidingView) or an on-screen number pad
  for Math (± for negative numbers), hint and *Xem đáp án*, collapsible scratchpad (*Nháp*, never sent), feedback
  card with answer and explanation, time-up choice, pause menu (*Tiếp tục học*, sound, reduced motion, *Cách chơi*,
  the lesson (*Kiến thức*), *Kết thúc phiên*). Back (the HUD arrow or Android back) pauses everything and opens this menu.
- **ResultScreen**: status, score, outcome counts, the EXP message the server decided, every question with its answer;
  *Ôn lại*, *Chơi lại*, back. **ReviewScreen**: open review items grouped by topic, *Luyện lại*.

Pet art uses the existing `PetArt` (sprite sheets, with the still evolution art when a sheet is missing). Sound and
reduced motion are saved per account on the device; reduced motion defaults to the OS setting and makes targets
step once a second instead of gliding. The tab bar is hidden while a game is on screen.

## Network and recovery

Scope: online learning. **Offline play is not supported** (no local queue or sync).
- Pausing (button, Android back, app sent to background) stops the local clock and every target at once, then tells
  the backend. Continuing shows a 3-2-1 countdown before the backend resumes the session.
- A network failure pauses the game, keeps what was typed, and retries the same request with the same event id every
  3 s or on *Thử lại*; waiting never costs a heart (the clock is stopped and nothing is reported as missed).
- Reopening the app: *Anh & Toán* offers the open session (`GET /sessions/current`), restored paused when it was left
  running. Each open turn carries `on_screen_ms` (server play time since it was issued), so falling targets continue
  from where they were instead of starting again at the top. If the session was ended or paused on another device, the next action reloads the real state and shows it.
- EXP is only shown from the server's completion response.

## Configuration (`backend/.env`, all optional)

| Setting | Default | |
|---|---|---|
| `LEARNING_STAGE_EXP` | 10 | EXP of a valid stage |
| `TASK_DAILY_EXP_CAP` | 60 | Shared daily pool for tasks and stage rewards |
| `LEARNING_IDLE_CAP_SECONDS` | 60 | Max play time counted between two requests |
| `LEARNING_AUTO_PAUSE_SECONDS` | 90 | Pause a running session with no request for this long |
| `LEARNING_EXPIRE_HOURS` | 24 | Abandon open sessions untouched for this long |
| `LEARNING_MAX_DURATION_MINUTES` | 90 | Limit for "Học thêm" |

## Running and testing

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001   # creates tables + seeds lessons
.\.venv\Scripts\python.exe -m app.learning_content      # optional: (re)seed content without starting the API
.\.venv\Scripts\python.exe -m pytest -q tests/test_learning_engine.py tests/test_learning_api.py
cd ..\mobile
npm run web            # Học tập → choose subject → game → setup → Bắt đầu
npx jest __tests__/learning-games.test.tsx
npm run typecheck
```

Backend tests cover English normalization and equivalents, bridge orders, number parsing, Math generation against an
independent evaluator (40 seeds × every lesson), unique missing numbers, no division by 0, error types, scoring and
mastery, state transitions, idempotent and concurrent answers/completion, ownership, pause/auto-pause/restore,
time-up and extension, content versioning, review list, weighting of weak content, the shared 60 EXP cap, the daily
learning task and the reward day in the account timezone. Mobile tests cover the flow from choosing a lesson to the
result, network loss and retry with the same event id, pausing in the background with the countdown, a session ended
on another device, Học tập only (no mode switch), the number pad, and the guides and countdown: first time, closed and
shown again, skipped once finished, read again from the list and the pause menu, Math after the lesson, replay,
background during the countdown, waiting for pictures, one session per double tap, and a room's start time.

Screenshots of a real end-to-end run (backend → Expo web → headless Chrome) are in
[learning-games-previews/](learning-games-previews/).

## Known limitations

- Online only; no offline queue.
- Sound is device text-to-speech for English words; there are no game sound-effect assets yet.
- Built-in lessons are defined in code (versioned on change); vocabulary is edited in its data files and imported with
  `python -m app.learning_vocab`; there is no admin editor. CEFR levels of the bank are editorial estimates.
- Time spent in a learning game is not added to the focus-timer statistics or study-minute EXP (the stage reward is
  separate); *Học tự chọn* sessions count exactly as before. Focus-timer rows in `study_sessions` carry
  `study_type = self_study` (Study Together rooms: `together`).
- Daily tasks still use the UTC day while stage rewards use the account's local day (see above).
- Play-time and miss checks are plausibility limits, not anti-cheat.
