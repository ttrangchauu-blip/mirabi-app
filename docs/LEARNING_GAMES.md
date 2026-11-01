# Learning games: English & Math (Anh & Toán)

> **Học tập now goes by lesson** for every subject of every grade: see [Học theo bài](#học-theo-bài). The games below are
> still offered as free practice (*Luyện tập* on a subject's screen, or the subject itself when it has no lessons yet)
> and keep their rules.

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
or Math game, or a focus timer running or paused) is offered as the one *Tiếp tục học* card of the subject screen.

**Content is new every session**, for English as for Math: a vocabulary stage holds up to 15 words this user has never
been shown in that game (see [Khám phá từ mới and Ôn tập](#khám-phá-từ-mới-and-ôn-tập)) and the lesson shown before
playing teaches exactly those words; grammar sentences are generated from word pools by rules (am/is/are, -s/-es/-ies, has/does), so
no two stages are the same.

## Học theo bài

Học tập is organised **Chương trình → Khối lớp → Môn học → Chương/Chủ đề → Bài học → Trò chơi** (backend
`lesson_catalog.py` and `lesson_api.py`, content in `backend/app/data/catalog/`; writing lessons:
[LESSON_CONTENT.md](LESSON_CONTENT.md); what exists per grade: [LESSON_INVENTORY.md](LESSON_INVENTORY.md)).

```
Học tập → môn (chương → bài) → màn bài học (chọn trò, Bắt đầu) → Cách chơi lần đầu → 3-2-1 → Chơi → Kết quả
                                                                                            ├ Chơi lại
                                                                                            ├ Trò khác trong bài
                                                                                            └ Bài tiếp theo
```

- **The subject screen** (*Học tập*) is kept short: a small header (*Học tập*, *Lớp 2 — Năm học 2027–2028* with a lock,
  icons for *Sổ tay kiến thức* and *Kho lưu trữ học tập*, and *Cần ôn (n)* only when something is due), at most one
  *Tiếp tục học* card, then the subjects as a grid of 3 columns (2 on phones narrower than 370 pt): an icon and a short
  name, no statistics. Each subject appears once: the grade's subjects of Chương trình GDPT 2018 (Thông tư 32/2018 as
  amended by 20/2021, 13/2022 and 17/2025), named as at that grade (Tiếng Việt / Ngữ văn; Tự nhiên và Xã hội, Khoa học,
  Khoa học tự nhiên; Đạo đức, Giáo dục công dân, Giáo dục kinh tế và pháp luật; Tin học và Công nghệ in grades 3–5…),
  then *Học tự chọn*. A subject with lessons opens its chapters; one without lessons but with free-practice games opens
  its games; one with neither (Nội dung giáo dục của địa phương, Tiếng dân tộc thiểu số, Ngoại ngữ 2, Chuyên đề học tập:
  they depend on the province or the school) is left out, so no tile leads to an empty screen. The year's progress and
  the next promotion are shown in *Kho lưu trữ*.
- **Grade**: the learner's grade, locked at registration and moved on by the school calendar (`education.py`,
  [LEARNING_ARCHIVE.md](LEARNING_ARCHIVE.md)). There is no grade picker: a request naming another grade gets
  `403 grade_locked`. Finished years are read and reviewed from *Kho lưu trữ học tập*. Learners without a school grade
  (Sinh viên, Người đi làm) practise with the games by level (chips under the header).
- **THPT**: the learner ticks the elective subjects they study (at most 4, `PUT /api/learning/programme/selection`,
  stored in `users.study_subjects`) on *Môn lựa chọn*, a tile of the grid; the grid then shows the chosen ones.
- **Tiếp tục học**: one card, for the stage left open (with a small × to drop it), else the focus timer running, else
  the lesson of the current grade and school year last practised; hidden when there is none. Grade and subject are
  never asked again after a stage: the result leads back to the lesson.
- **The subject screen** is the same for every subject (its own icon and colour): a small header (back, the subject's
  icon and name, *Lớp 3 · Năm học 2026–2027*; no grade picker), the subject's progress (lessons completed / ready this
  school year), a filter *Tất cả / Đã mở / Chưa mở*, then every lesson once. The subject's free-practice games are
  behind the game-controller icon of the header.
- **Lesson order** (`lesson_api.sort_lessons`, mirrored by `mobile/src/learning/lessonOrder.ts`): *Đang học*
  (`in_progress`) → *Đã mở* (`unlocked`, not started) → *Đã hoàn thành* (`completed`) → *Chưa mở* (`locked`); within a
  group, the curriculum's chapter then lesson order (`chapter_order`, `lesson_order`), never ids or dates. Being open
  and being done are separate states: a lesson is locked while it is still being written (*Sắp có*) or until what opens
  it is completed **this school year** ([Tự động mở khóa](#tự-động-mở-khóa)); a locked lesson is *Chưa mở* whatever it
  has done. The backend decides both and refuses to play a locked lesson (`409 lesson_locked`) whatever the request says.
- **A lesson card**: its state as an icon, the title, the chapter in small type and the state in words, with a thin bar
  while it is being studied. *Đã hoàn thành* opens again for review; *Chưa mở* is neutral and a tap says how it opens
  (*Hoàn thành “…” để mở bài này*, with a link to that lesson) without opening anything.
- **When states change** (a stage finished, a lesson completed, its follow-up opened): back on the subject, the last list
  is shown at once (kept per subject for the current grade and school year, scrolled where it was left), the backend's
  new states are read, and only the cards that changed group slide to their new place (≈0.25 s); a lesson that has just
  opened glows once. Cards rise in only on a first visit. Nothing moves with reduced motion. The list is a `FlatList`.
- **The lesson screen**: the title, the short content (*Kiến thức tóm tắt*; *Xem ví dụ* folded), then *Chọn trò chơi*:
  the games as small cards (picture and name, a tick once passed); the game left open, else the first not passed yet,
  is picked and its one line on how it plays is shown; one button plays it (*Bắt đầu*, *Chơi lại* or *Tiếp tục*), with
  *Cách chơi* beside it. Back from a lesson opened from a subject (also after playing) returns to that subject's list.
- Moving between these screens fades in and rises a few points (0.2 s); nothing moves with reduced motion.
- **The organisation is declared**: every file is `topic` (by the curriculum's topics, "không theo mục lục bộ sách
  nào"); a file following a textbook would name its series and edition and map each lesson (`textbook_ref`).

### Tự động mở khóa

A subject opens step by step as the learner completes what is required (`backend/app/learning_unlocks.py`; the rules are
built from the catalog by `lesson_catalog.unlock_path`). Nobody unlocks anything by hand, and the app never says what
is completed or open.

**The rules**

| Content | Opens when |
|---|---|
| First chapter of a subject at a grade | At once |
| Next chapter | Every required lesson of the chapter before it is completed. A chapter with nothing required is skipped: it never counts as completed and never blocks |
| First lesson of an open chapter | With the chapter |
| Next lesson | The required lesson before it is completed. `"progression": "free"` on a chapter opens all its lessons with it. `requires` adds prerequisites of its own (branches that split or join) |
| A game of an open lesson | With the lesson (all of them) |

- **A `free` subject** (`"progression": "free"` at the top of its file): every chapter and lesson opens at once; a lesson's
  own `requires` still applies. In the bundled catalog: Âm nhạc, Mĩ thuật, Giáo dục thể chất and Hoạt động trải nghiệm,
  whose lessons do not build on each other. The other subjects are sequential.
- **Required**: a ready lesson not marked `"optional": true`, and in it a game not marked `"optional": true`. Optional
  content opens in its place and never holds anything back; a lesson must keep at least one required game.
- **Still being written** (`planned`): never open, and skipped by the path.
- **Completed** is what it always was (`lesson_api.lesson_state`), read from the sessions: each required game passed by a
  completed stage with `completion.min_first_try` of its answers right at the first try, checked on the stage's own
  items. Opening a game, leaving it or finishing its tutorial never counts. Playing again opens nothing new.
- **No loops**: `lesson_catalog.catalog()` refuses to load a catalog whose rules go round (`find_cycle`), whatever the
  `order` fields say. `requires` names an earlier lesson of the same grade.

**What is stored.** Progress is not stored twice: it stays in the sessions. `learning_unlocks` holds what the rules
opened, one row per learner, school year and chapter or lesson (`uq_learning_unlock`, so a retry or a second device
stores it once), with why (`source`: `start`, `migration`, `completed`, `progress`) and when it was celebrated. Stored
unlocks are **never taken back**: a lesson added to a completed chapter does not close the next one (the chapter simply
shows as being explored again), and a withdrawn lesson is skipped. Each school year has its own, and last year's stay
as they were.

**When.** Inside the transaction of `POST /sessions/{id}/complete`, and again on every read of the subject or lesson and
on `POST /progress/sync`, so a result lost on the way is caught up. `complete` returns `unlocked`: what is open and not
celebrated yet, until `POST /unlocks/celebrated` says the animation was shown.

**Accounts from before this.** Every lesson used to be open. On the first read of a subject in a school year, every
lesson up to the furthest one the learner has started stays open (`migration`, not celebrated); beyond it the rules
apply. A learner who never played a subject starts at its first lesson.

**The app.** A subject opens on its **journey map** (`JourneyMap.tsx`; *Danh sách* keeps the list sorted by state): each
chapter an area, each lesson a point on one winding path. *Chưa mở*: a lock, slightly faded. *Đã mở*: clear colours and a
soft light. *Đang học*: a progress bar. *Đã hoàn thành*: a tick and a medal. The pet stands by the lesson the learner is
at. When something has just opened, the lock shakes and opens, light spreads, the point goes from faded to clear and
the pet jumps for joy; a small notice (`UnlockNotice.tsx`, never a popup over the screen) names it, with *Khám phá ngay*.
Nothing waits for the animation, and with reduced motion nothing moves but the notice still appears. The map brings what
has just opened into view (else, on a first visit, the lesson the learner is at). *Bài tiếp theo* on a result is offered
only when that lesson is open (`catalog.next.locked`).

### Games of a lesson

One gameplay per game, the content passed by the lesson; a stage only ever holds the lesson's own questions (never
another lesson's or grade's, never one asked twice to fill it). The vocabulary games are the exception by design: they
start with the lesson's own words and then go on with new words beyond them (see *Khám phá từ mới theo bài* below). The backend checks that the game belongs to the
lesson, the lesson to its subject and grade, and that it is ready and unlocked (`409 lesson_locked`,
`lesson_not_ready`, `lesson_not_published`, `422 game_not_in_lesson`).

| Game | Kind | Used for | Wrong answer |
|---|---|---|---|
| Sắp xếp thứ tự (`order`) | `order_steps` | vòng đời, dòng thời gian, quy trình, các bước giải, thứ tự động tác, ghép câu | `retry`; the cards in their right place stay locked (`result.kept`), the rest is placed again |
| Ghép cặp (`match`) | `match_pairs` | sự kiện–nhân vật, phép tính–kết quả, địa danh–đặc điểm, từ–nghĩa, kí hiệu–tên | `retry`; the right pairs stay (`kept`) |
| Chọn đáp án có giải thích (`choice`) | `choice_explain` | tình huống, đọc hiểu / đọc tư liệu, dự đoán hiện tượng, kiến thức, tự đánh giá | `retry`; the option chosen explains itself and is crossed out |
| Phân loại, Thám tử chính tả, Ghép chữ, Lập trình đường đi | as before | with the lesson's own set, sentences, words or levels | as before |
| Bảo vệ căn cứ, Xây cầu toán học | as before | generated problems of the lesson's settings only (`table: 2` = 2 × 1…10, `no_carry`…) | as before (3 hearts) |
| Bắn thiên thạch, Bắn từ tiếng Anh | as before | the lesson's own words first, then new words of its themes (*Khám phá từ mới theo bài*) | as before (15 words, 5 hearts; fewer only when fewer new words are left) |
| Hành trình dòng thời gian (`timeline`) | `timeline_place` | Lịch sử: sự kiện theo thời gian | `retry`; events on their right marker stay (`kept`: `"m2:e1"`), the others go back to the pile |
| Xây câu (`sentence`) | `sentence_build` | Tiếng Anh: cấu trúc câu, ngữ pháp | `retry`; the right start of the sentence locks (`kept`: tile ids), the first wrong wagon is named |
| Xưởng hình học (`geometry`) | `geometry_build` | Toán: đo góc, tổng ba góc, chu vi, diện tích | `retry`; the feedback says what was built measures and what is missing |
| Cân bằng phương trình (`balance`) | `equation_balance` | Hoá học / KHTN: lập phương trình | `retry`; the elements still unbalanced are named, or the factor to divide by |
| Cầu trục số (`number_line`) | `number_line_place` | Toán: thứ tự, so sánh, làm tròn số, phân số, số thập phân | `retry`; points on their right tick lock (`kept`: `"p1:47"`), the first one off says which way |
| Giải toán từng bước (`step_solver`) | `step_solve` | Toán: bài toán có lời văn, phương trình giải bằng phép ngược | steps confirmed one by one (`advance`); `retry`; a right calculation with a wrong result is kept |
| Thám tử đọc hiểu (`story_detective`) | `story_evidence` | Tiếng Việt / Tiếng Anh: đọc hiểu, thể loại, biện pháp tu từ | the clue first (`advance`), then the options; `retry`, each wrong pick explained |
| Soi câu (`sentence_xray`) | `sentence_paint` | Tiếng Việt: từ loại, kiểu câu, so sánh, từ láy/ghép, điệp ngữ | `retry`; pieces painted right lock (`kept`: `"w1:c1"`), the first wrong one is named |

### Subject gameplays

Eight gameplays made for one kind of knowledge each (`backend/app/lesson_games.py`, `lesson_games_math.py`,
`lesson_games_reading.py`; `mobile/src/games/subject/`). Each
draws its own world and shows the result of a right answer in it before the explanation (a critical reaction of the
feedback loop). Which lessons use which gameplay, and which still wait for one: [GAME_AUDIT.md](GAME_AUDIT.md).

- **Hành trình dòng thời gian**: a parchment road, its milestones in time order from the top. Events are dragged onto
  a milestone (or tapped, then the milestone tapped). Content: `events` with `year` (negative = TCN), optional `label`
  (*Thời Lê sơ*, *9/3/1945*) and `seq` (events of one year in a known order get a marker each; events of the same year
  and `seq` share one marker with several places, either order right). `years: hidden` shows the dates only once the
  timeline is complete. Right: the road fills with gold, each milestone lights up as it is reached, the pet travels it.
- **Xây câu**: a train whose wagons are the sentence's places; the tiles are crates, `distractors` stay in the yard.
  Compared by text, so the same word twice is two tiles that can be swapped; `accepted` lists other right orders. Right:
  the wagons light up one by one, the train moves off a little and the sentence is read aloud (sound on).
- **Xưởng hình học**: a blueprint. `kind: angle`: a protractor, the arm turned by its handle or − / + on the `step`;
  the target is `degrees` or a `class` (nhọn, vuông, tù, bẹt); without `readout` the measure is read on the scale and a
  wrong answer never says it. `kind: rect`: a centimetre `grid`, the corner dragged; the target is any of `area`,
  `perimeter`, `square`, `sides`, and every rectangle meeting it is right. Right: the angle's arc fills, or the unit
  squares fill one by one, and the measures are written in. Answers: `angle:<degrees>`, `rect:<w>x<h>`.
- **Cân bằng phương trình**: a two-pan balance, each pan holding its side's molecules as atom models; the beam levels
  only when every element matches; a table counts the atoms live. Content: `reactants`, `products`, `coefficients`
  (checked when loaded: balanced, smallest, the only answer up to a factor). The backend counts the atoms of what is
  sent (`["2","1","2"]`), so a balanced but not reduced answer is told to divide. A simulation only.
- **Cầu trục số**: the number line is a bridge, its ticks the planks. A number (flag) is taken from the bank and planted
  by touching or sliding along the bridge; ◀ ▶ (and ◀◀ ▶▶ by a long step) move it, and alone place it — no dragging
  needed. Content: `line` {`from`, `to`, `step` (long, labelled ticks), `snap` (where a point can stand), `labels`:
  majors | all | ends}, `points` [{`label`, `value`}] (ints or "3/4", "2,5", "-5"; a line written in fractions keeps
  fraction labels), `marks` (numbers already shown, e.g. the one to round). The app gets ticks and labels only, never
  values; the answer is a tick per point (`"p1:47"`). Right: the flags turn green and the pet crosses, stopping at each.
- **Giải toán từng bước**: a staircase, one stair per step. Each step asks one question; the learner taps two number
  chips (the problem's `numbers`, then earlier results `r1`…) and an operator (+ − × :) and types the result on a keypad
  (comma and fraction bar allowed). Answer: `[chip, op, chip, result]`. A right step before the last is confirmed by the
  backend (`lesson_games.advance`: the turn stays open, `correct: true, resolved: false`, the prompt moves on and the
  result becomes a chip), so the plan is never sent ahead. Content: `problem`, `numbers` (each written in the problem),
  `steps` [{`ask`, `expr` ("48 - 12", "r1 : 4"), `result`, `unit`, `accepted`}] — checked exactly (fractions) on load;
  a + b / b + a and a × b / b × a are the same step.
- **Thám tử đọc hiểu**: a case file. The passage comes as sentences (`sentences`); first the sentence that proves the
  answer is tapped (`phase: find`); only once the backend confirms it (`advance`) are the `options` sent (`phase:
  answer`). A wrong clue is crossed out with the task's `clue`; a wrong answer with its `why`. Content: `passage` (text
  or list), `evidence` (sentence numbers, at most half), `question`, `options`, `clue`, `lang`. Right: "Đã phá án".
- **Soi câu**: a light box and 1–3 highlighters, one per role (`roles`). Pieces are painted with the pen in hand (the
  same colour again clears); punctuation cannot be. Content: `sentence` with `[piece|n]` markup (`|0`: a phrase with no
  role, so the chunking gives nothing away). Answer: painted pieces (`"w3:c2"`, `["none"]` when nothing is painted).
  Right: a scan line sweeps the box and the painted pieces light up.
- **Lessons moved to them** keep their learners: a game with `credit_from: "order"` (or `"choice"`) is passed by a pass
  of that game (`lesson_api.game_passed`), so a lesson completed before stays completed, and stages of a retired game
  count as having started it. The retired game's sessions and results stay (its database lesson is retired, never
  deleted).
- **Choosing the game** (`backend/app/game_registry.py`): `GAMEPLAYS` is the game definition table (family,
  interaction, grades, status `ready` / `planned`; `GET /api/learning/gameplays`); `ACTIVITIES` maps a learning activity
  to the gameplays made for it. A lesson declares its `activity` or it is inferred from its title, chapter and
  objectives, never from the subject alone. `python -m app.game_audit --strict` fails when a ready lesson publishes the
  wrong kind of game, the same gameplay twice, a question also used by another lesson, or a game outside its grades
  (a test runs it); `--markdown` writes GAME_AUDIT.md.

The new games have no hearts and no clock (they are not quizzes against time); every option of a *choice* explains
why it fits or not, several options can be acceptable by stated criteria, and a *tự đánh giá* question (`graded:
false`) has no wrong answer and never counts as right, wrong or *cần ôn*. After a right answer the explanation shows
before the next question. Each game has its own 3-page guide drawn with its real play area.

**By learner group** (`lesson_catalog.limits`, enforced on the content): grades 1–2 at most 4 cards, 4 pairs, 3
options, 40-character cards; grades 3–5 at most 5 / 5 / 4; secondary school can read a passage (up to 1 400
characters). Code passages (Tin học) show in a fixed-width font so their indentation reads as written.

### Khám phá từ mới theo bài

A lesson's `words` (lesson_catalog, 15 per lesson) are its **core words**, not the limit of its games
(`vocab_bank.discover`, app/vocab_lesson.py). Each stage of Bắn thiên thạch (Việt → Anh) or Từ rơi / Bắn từ
(Anh → Việt) holds up to 15 words **never shown before in that game**, taken in this order:

1. **core**: the lesson's own words not discovered yet (whatever the open levels: they are the lesson);
2. **topic**: new words of the lesson's themes (the bank topics holding ≥ 25% of its words; e.g. ta5.nghe_nghiep:
   careers + work);
3. **related**: new words of related themes (`vocab_lesson.RELATED`) that the grade has opened: the topics suggested
   for the grade (study_profile) and the themes of its unlocked lessons and of earlier grades' lessons;
4. **next level**: words one level above the highest open level, never above the grade's ceiling: 2–3 per stage
   once the learner does well (`challenge` ≥ 60 / ≥ 80), all of the rest once 1–3 are used up.

Never served: a word of a level above the grade's ceiling or of a topic blocked for the grade
(`vocab_discovery.policy_for`), a word more than one level below the lesson's own (a grade-10 lesson of level-3 words
goes on from level 2), and the **core words of lessons of a higher grade or of a locked lesson** of this grade.

- **One history per game**, shared with free practice (`vocab_discoveries`, one row per canonical word, written when
  the word is put on screen): changing lessons, signing out or playing on another device never brings a word back,
  and two senses or two topics of one word ("bat" the animal, "bat" in sport) are one word. Words never put on
  screen (the stage ended first) stay new.
- **Easy to hard**: within a tier the easiest words come first (by level, random within a level) with a share of
  harder ones that grows with `challenge` (10% → 70%; none while it is below its starting value, i.e. after mostly
  wrong answers); each stage is ordered from easy to hard. Each tier starts again from its easiest words.
- **Nothing new left**: the stage does not start (`409 vocabulary_exhausted`); the app offers *Ôn tập từ đã học*
  (`POST /api/learning/play {vocab: "review"}`), which serves words already met (wrong and due ones first) and never
  writes a discovery. Old words are never used to fill a Khám phá stage; the last stage is simply shorter.
- Lesson detail (`GET /api/learning/lesson-catalog/{key}`) gives each vocabulary game an `explore` block:
  `core_total`, `core_discovered`, `core_completed`, `core_completed_session` (the stage that discovered the lesson's
  last own word: its result says *"Bạn đã hoàn thành từ vựng của bài này! Hãy tiếp tục khám phá những từ mới cùng chủ
  đề nhé!"*), `new_words_left`, `exhausted`, `next_stage_words` (also `turns`), `level`, `topics`, `related_topics`.
- Levels, their completion celebration (pet animation) and unlocking are the shared ones of the vocabulary games
  (`vocab_discovery.settle_levels`); a level completed from a lesson stage is celebrated after its result. Words added
  to the bank later are simply new words: nothing is reset.
- Archive replays (Kho lưu trữ) keep the lesson's own words and discover nothing. A lesson's progress and completion
  rules are unchanged (a completed stage of ≥ 80% right at the first try passes the game).

`python -m app.vocab_lesson report` prints, per ready lesson and game, how many words each tier can serve to a new
learner of its grade. With the bundled data (9 403 active senses, 37 topics) every lesson has 83–948 words per game
instead of 15:

| Lesson | Grade | Ceiling | Core | Topic | Related | Next level | Total (meteor) |
|---|---|---|---|---|---|---|---|
| ta1.con_vat | 1 | 1 | 15 | 46 | 45 | 0 | 106 |
| ta2.do_an | 2 | 1 | 15 | 46 | 29 | 0 | 90 |
| ta3.tu_vung_gia_dinh | 3 | 2 | 15 | 20 | 0 | 48 | 83 |
| ta4.ngoi_nha | 4 | 2 | 14 | 29 | 35 | 105 | 183 |
| ta5.nghe_nghiep | 5 | 2 | 15 | 47 | 54 | 153 | 269 |
| ta6.truong_moi | 6 | 3 | 15 | 56 | 73 | 151 | 295 |
| ta7.suc_khoe | 7 | 3 | 15 | 42 | 134 | 223 | 414 |
| ta8.moi_truong | 8 | 4 | 15 | 97 | 221 | 200 | 533 |
| ta9.cong_nghe | 9 | 4 | 14 | 90 | 272 | 263 | 639 |
| ta10.tu_vung_moi_truong | 10 | 5 | 15 | 119 | 376 | 274 | 784 |
| ta11.loi_song_khoe | 11 | 5 | 15 | 112 | 173 | 151 | 451 |
| ta12.nghe_nghiep | 12 | 5 | 15 | 104 | 346 | 251 | 716 |

(Core 14: one word whose meaning shows the answer is only asked Anh → Việt.)

### Progress and completion

Every stage records its lesson, grade, content version and school year (`learning_sessions.catalog_lesson`,
`catalog_grade`, `content_version`, `academic_year`), so progress is read per school year → grade → subject → lesson → game from the user's own sessions and turns
(never stored twice, never from the app's numbers), and an old result never changes when a lesson is edited (the
lesson publishes a new version; old sessions keep their frozen questions). Sessions played before lessons existed are
not attributed to any lesson.

- **Completed** (*Đã hoàn thành*): every game of the lesson (`completion.games: "all"`, or `"any"`) has a completed
  stage with at least `completion.min_first_try` (default 80%) of its graded questions right at the first try. Opening
  a lesson or playing a stage is not enough; review stages never count.
- Right at the first try, attempts, hints and the questions to review are the turns' own (`first_try`, `attempts`,
  `hints_used`, outcomes); wrong ones go to **Cần ôn** under the lesson's chapter as for every game, and *Ôn lại*
  plays them again from the same lesson.
- **EXP is unchanged**: a completed lesson stage is a whole stage (`stage_turns` = the lesson's number of questions)
  and earns the stage reward once per subject per local day through the same claim row and EXP ledger.

| Method & path | |
|---|---|
| `GET /api/learning/programme` | Every subject of the learner's grade with type, support, lessons ready / listed and this school year's progress; `academic_year_label`; `selection` (THPT); `resume` (Tiếp tục học); `grade: null` without a school grade. `?grade=` other than the learner's: `403 grade_locked` |
| `PUT /api/learning/programme/selection` | `{subjects}`: THPT electives (at most 4); `422 not_an_elective`, `too_many_electives` |
| `GET /api/learning/programme/subjects/{code}?q=` | This school year: `chapters` (by curriculum order) and `lessons` (sorted by state, see [lesson order](#học-theo-bài)), each with `lesson_id`, `subject_id`, `grade_id`, `academic_year`, `chapter_order`, `lesson_order`, `unlock_status`, `progress_status`, `progress_percent`, `unlock_requirements` (`lesson` / `content`), `group`; `progress` (completed / ready); `404 subject_not_in_grade` |
| `GET /api/learning/unlock-map?subject=` | A subject as a journey: chapters, lessons and games with `status` (`LOCKED`, `UNLOCKED`, `IN_PROGRESS`, `COMPLETED`), `requirements`, `required`, `celebrate`; `pending`. `409 grade_required`, `404 subject_not_in_grade` |
| `POST /api/learning/progress/sync` | Applies the unlock rules again to the recorded stages (any body is ignored) → `{academic_year, unlocked}`, the unlocks not celebrated yet |
| `POST /api/learning/unlocks/celebrated` | `{ids}`: the animation was shown, it does not come back (idempotent, only the learner's own) |
| `GET /api/learning/lesson-catalog/{key}` | A lesson of the learner's grade (`403 grade_locked` otherwise). The lesson screen: objectives, summary, examples, games with progress, completion rule, prerequisites, next lesson, review status and content version |
| `POST /api/learning/lesson-catalog/{key}/play` | `{game}` (+ `Idempotency-Key`) → a paused session of that game of that lesson; the session's `catalog` names the lesson, its other games and the next lesson |


## By grade: the programme and the curriculum games

**The learner's grade decides the content** (`backend/app/curriculum.py`; the grade is locked, see
[LEARNING_ARCHIVE.md](LEARNING_ARCHIVE.md)). The curriculum is Vietnam's *Chương trình giáo
dục phổ thông 2018*; subjects are named as at that grade (Tiếng Việt / Ngữ văn; Tự nhiên và Xã hội 1–3, Khoa học 4–5,
Khoa học tự nhiên 6–9; Tiếng Anh and Tin học from grade 3). `GET /api/learning/catalog` returns `programme`: only the
subjects and games **with content for that grade**, each game with the grades it supports. A subject or game without
enough reviewed content is not offered (no short or padded stage), and an empty grade says so (`note`).

- **No other grade**: `?grade=` / `{grade}` naming another grade than the learner's is refused (`403 grade_locked`);
  older years are reviewed from Kho lưu trữ học tập.
- **Sinh viên, Người đi làm/Học tự do**: no school grade is assumed. They pick a level (`?level=basic|intermediate|advanced`,
  *Cơ bản / Trung cấp / Nâng cao*, kept on the device) and see Tiếng Anh, Toán and Tin học.
- Math: the learner's grade is the only grade offered in the setup (content exists for grades 2, 3, 4 and 6).
- Flow unchanged: subject → game → first-time guide → 3-2-1 → play. `POST /api/learning/play {game, level?}` (the grade is the learner's)
  answers `409 game_not_available` for a grade without content.

| Game | Subject | Grades | Stage | Rules (Học tập) |
|---|---|---|---|---|
| Ghép chữ (`word_builder`, *Word Forest*) | Tiếng Việt | 1 (letters), 2 (syllables) | 10 words | A gate per word, its picture on the sign; the pieces glow on the forest floor: drag one onto a stone of the lock (or tap: first free stone), *Mở cổng*. Wrong: the gate shakes, the pieces stay, fix and open again. Right: the gate opens, the pet gets a book piece and walks on to the next gate. |
| Thám tử chính tả (`spelling_detective`) | Tiếng Việt | 2–5 | 10 sentences | Tap the misspelled syllable; only then are the spellings sent; choose the right one. Wrong word or spelling: a reason, try again. The explanation shows before the next sentence. |
| Phân loại cùng pet (`sorting`) | TNXH / Khoa học | 1–5 | 10 cards of one set | Drag the card onto its group (or tap the group). Wrong: the card returns with the reason. |
| Lập trình đường đi (`code_path`, *Robot Adventure*) | Tin học | 3–12, outside school | 5 levels | Blocks Tiến / Rẽ trái / Rẽ phải (+ *Lặp lại* from Trung cấp, loops not nested), at most `max_blocks`; *Chạy* rolls the pet's robot step by step (the block being done lights up), then the backend checks the program. Off course: the step that went wrong is named (*Bước 2 (Tiến): robot đụng tảng đá*), its block turns red and the robot bumps the rock. Unlimited retries, *Dừng*, *Đặt lại*. |

All four: no hearts, no clock (`timed: false`), no *Xem đáp án*; a wrong answer is `retry` with `feedback`, and a right
answer after a mistake is recorded as `corrected` (never `first_try`), in progress and the review list (*Cần ôn*, *Ôn
lại*). A whole stage earns the usual stage reward (Lập trình đường đi's 5 levels count as a whole stage).

**Content** (`backend/app/data/curriculum/*.json`, written for Mirabi and reviewed by hand): every question carries
curriculum, subject, grades, topic, difficulty, answer, explanation and version, and is validated when loaded (an
invalid file stops the server). A content change publishes a new lesson version; sessions keep their frozen copy.
Ghép chữ leaves out words whose pieces make another word in another order (cá/ác, tai/tia…); every spelling sentence
has exactly one wrong syllable and no wrong choice that makes a correct sentence; each level has a solution the tests
run, and the Trung cấp / Nâng cao levels cannot be solved without a loop within their limit (checked by search).

| Game | Content |
|---|---|
| Ghép chữ | 37 words (grade 1), 34 words (grade 2) |
| Thám tử chính tả | 36 sentences (grades 2–5, a grade gets its own and up to two grades below), 11 spelling rules |
| Phân loại cùng pet | 5 sets, 69 cards: Động vật / Thực vật (1–2), Trên cạn / Dưới nước (1–3), Các giác quan (1), Thể rắn / lỏng / khí (4–5), Nhóm thức ăn (4–5) |
| Lập trình đường đi | 19 levels: Cơ bản 7 (grades 3–5), Trung cấp 6 (6–9), Nâng cao 6 (10–12) |

Not built yet (not shown in the app): Đếm cùng pet, Đường đua phép tính, Vòng đời kỳ diệu, Khám phá bản đồ, Lắp
mạch điện (Dòng thời gian, Cân bằng phương trình, Trục số, Giải toán từng bước and Thám tử đọc hiểu are lesson games
now: [Subject gameplays](#subject-gameplays)); conditions and functions in
Lập trình đường đi.

## Visual games: Math Battle, Magic Lab, Word Forest, Robot Adventure, and the lesson worlds

Four games are played in a drawn 2D world (vector art in `mobile/src/games/art/`, see
[GAME_ASSETS.md](GAME_ASSETS.md)); the backend still decides every answer, heart and EXP. Shared modules in
`mobile/src/games/engine/`: `Parallax` (scene layers at several depths, scrolled by transform and wrapped with no seam),
`rig.ts` (`useRig`: a character's actions — enter, attack, cast, hit, defeat, jump, celebrate — as short transform
sequences, plus an idle breath; nothing re-renders while they play), `drag.tsx` (`DropArea`, `DropZone`, `Draggable`:
drop zones measured on screen, drag or tap, a drop elsewhere springs back). Tests: `mobile/__tests__/game-redesign.test.tsx`,
`art-math-battle.test.tsx`, `art-lab-forest.test.tsx`, `game-worlds.test.tsx`; backend `tests/test_magic_lab.py`,
`test_lesson_catalog.py` (worlds). Screenshots of a real run (backend → Expo web → headless Chrome) are in
[game-screenshots/](game-screenshots/) (`world-*.png`, `pause-volume.png`). The falling-word shooters' particles and
collisions, the pet's walk phase and the result screen's animation: [GAME_ANIMATION.md](GAME_ANIMATION.md).

**Visual feedback loop** (`games/engine/feedback.tsx`, tests `__tests__/feedback-loop.test.ts`,
`feedback-gameplay.test.tsx`): every learning action is seen in the world before anything moves on. The game screen owns
one `FeedbackLoop` per stage; an action goes `IDLE → INTERACTING → VALIDATING → SUCCESS_ANIMATION | FAILURE_ANIMATION →
WORLD_UPDATED → NEXT_CHALLENGE → IDLE` (a wrong answer goes back to `INTERACTING`, the same challenge). The screen drives
the first half (`submit`, the backend's verdict `judge`); the scenes drive the second: each reaction they play (the
spell, the crossing, the door, the experiment) is `begin`…`end` (`useReactions`, `useQuestEvents`).
- While a **critical** reaction plays, nothing can be sent (`disabled`), the challenge answered stays on screen and the
  next one waits (Ghép chữ, Magic Lab and the falling words hand over themselves), the explanation card waits, and the
  stage does not finish. Independent effects (falling words, a bubbling beaker) are not critical and never wait.
- A wrong answer never holds the learner by itself: the pieces kept can be fixed at once. Only a reaction that matters
  holds them (Math Battle's counter-attack, which costs the heart, ~1 s).
- One answer at a time (`busy` while one is validated); the exact answer already judged wrong for a challenge is not sent
  again (*Đáp án này vừa chưa đúng…*: it would only cost another heart); a verdict is shown once per request (its event
  id), so a retried request or a re-render never replays it. Points and EXP stay the backend's (idempotent).
- Every reaction has a watchdog (`maxMs`, default 6 s): an animation that never reports back (stopped, unmounted, broken)
  is put in its end state and released, so the game can never jam. *Bỏ qua* (shown after 0.7 s of a reaction) jumps the
  skippable reactions to their end state at once. Scenes ignore the late callbacks of a run skipped or replaced.
- Leaving mid-reaction loses nothing: the answer was already counted by the backend; the loop is disposed with its timers.

- **Math Battle** (`defense`, `games/MathBattle.tsx`): a turn-based duel. HUD on top (the pet's hearts as its HP bar,
  the monster's HP bar, *Màn n/N*, combo), the arena in the middle (pet left, monster right), the problem and the
  number pad under it. Monsters of 2 hit points come one after another through three zones — *Rừng phép thuật*
  (Slime, Nấm phép thuật), *Hang pha lê* (Golem đá, Tinh linh bóng tối), *Lâu đài quái vật* (Rồng nhỏ) — then the
  last questions are **Vua Pha Lê** in the boss arena (`battleFoe`): phase 1, phase 2 behind a crystal shield (the next
  right answer breaks it), phase 3 enraged on its last point. Right: a magic circle gathers round the pet, it casts
  (a skill: it lunges), a magic bolt flies, the impact bursts with sparks and the damage, the monster flashes and loses
  a point; at zero it is defeated, the pet cheers and the next one walks in (the scene scrolls). The problem solved stays
  on its card (green) until then. Wrong: the monster lunges and its claws fly at the pet, the pet staggers, its lost
  heart empties on the HP bar (the backend's heart), and the pet says a short hint from the kind of mistake (`MATH_TIP`:
  *Nhớ sang hàng bên trái nhé!*…); the fight goes on. Three right in a row power the pet's element skill (*Cầu lửa*,
  *Sóng thần*…; counted on the device, a display only).
- **Magic Lab** (the lesson game `lab`, `games/MagicLab.tsx`): a lab bench with the pet as assistant (it gives the
  task). The parts lie on the bench; the learner drags them onto the apparatus (or taps: first free place) and runs
  the experiment. A part put in place snaps in (and in a circuit, sparks where it connects). Five scenes
  (`curriculum_games.LAB_SCENES`): **circuit** (battery, bulb, gaps closed with a conductor; the switch: current flows
  round the loop and the bulb's light grows), **shadow** (an object between the torch and the screen: a dark, faint or
  no shadow), **water** (the beaker on the hot plate or in the freezer: ice melts, water boils off, steam condenses into
  drops, water freezes), **plant** (the growth stages in order; the can waters the pot, the drops fall, the soil darkens,
  then the seed grows stage by stage and flowers), **magnet** (the objects put in the magnet's reach: it comes down, the
  magnetic ones fly up and stick under its poles, what was left on the bench stays put). The answer is
  `["slot:part", …]`; a wrong part: the experiment fizzles (a grey puff, a dead spark), the part's own reason shows
  (`why`), the wrong parts go back to the bench and the right ones stay (`kept`). Right: the experiment plays out (a
  reaction: *Thí nghiệm tiếp theo* or *Bỏ qua* jumps to its end) with its explanation until *Thí nghiệm tiếp theo* (the
  stage waits for it before completing). Lessons: `kh4.anh_sang`, `kh4.chuyen_the_nuoc`, `kh5.mach_dien`,
  `kh5.dan_dien_cach_dien`, `kh5.cay_con`, `kh7.nam_cham` (magnetic and non-magnetic materials, the two poles; 4–5
  experiments each; `completion.games: any`, so a lesson completed with its first game stays completed). Simulations
  only: nothing is a procedure to try for real.
- **Word Forest** (Tiếng Việt): the pet explores a forest drawn in four depths.
  - *Ghép chữ* (`word_builder`, `games/WordForest.tsx`): each word is a brook whose bridge lacks its planks, one per
    letter or syllable. The pieces glow on the forest floor (`scatter`: never touching); drag one onto a plank
    (`placeTile`) or tap it (it drops onto its plank), then *Xây cầu*. Right: the planks light up one after another,
    the pet runs across and the forest scrolls to the next brook (*Bỏ qua* jumps to the far bank). Wrong: the bridge
    wobbles, the pieces stay.
  - The Tiếng Việt lessons' own games get a forest quest above them (`games/ForestQuest.tsx`): *Sắp xếp* (sentences,
    story order) opens a **secret door** (the runes light one after another, the door rumbles, the leaves slide open,
    the pet walks in); *Ghép cặp* and *Chọn đáp án* (synonyms, antonyms, the right word) **free a creature** from three
    layers of thorny vines, one layer per third of the stage (`vinesLeft`: the layer cut bursts into pieces), and the last
    right answer frees it: it runs to the pet to thank it (hearts) and the treasure chest opens on a gem.
- **Robot Adventure** (`code_path`, in `games/CurriculumGames.tsx`): the pet drives a robot that rolls between cells and
  turns the short way between drawn boulders; `codePath.trace` lights the block being done and `codePath.fault` names
  the step that went wrong, its block (red) and the cell it could not enter (the robot stops there and bumps it; the
  program is kept, to be fixed). At the goal it picks up the gem and the flag goes up. Switches, doors and moving
  obstacles are not in the levels' rules yet (they would need new level data and backend checks).
- **The worlds of the lesson games** (`mobile/src/games/quests/`): a lesson's Sắp xếp, Ghép cặp, Chọn đáp án and Phân loại
  are played under a drawn scene of its subject's world, which moves on with each right answer (progress is the
  session's `resolved_count / required_count`) and reacts to each wrong one (`wrongKey`). The backend names the world:
  `catalog.world` on the session (`lesson_catalog.world_of`: Toán `kingdom`, Tiếng Anh `space`, Tiếng Việt `forest`,
  Khoa học / Vật lí / Hoá học / Sinh học `lab`, Lịch sử `time`, Địa lí `map`; Lịch sử và Địa lí plays its *Địa lí:*
  chapters on the map and the rest in time, and a lesson may set `"world"` itself — the grade 4–5 lessons about places
  and nature do; the world is not part of the lesson's version). `null`: no world (Tin học's lesson games, Âm nhạc, Mĩ
  thuật, GDTC, GDCD, Công nghệ, HĐTN, Quốc phòng); an older backend's session falls back to the subject.
  - *Math Kingdom* (`KingdomQuest`): Math Battle's arena without hearts or problem card; the answers are the pet's spells.
  - *Space Adventure* (`SpaceQuest`): the pet's rocket fires at the asteroid in its way (it bursts into rubble, the
    stars stream past, the next drifts in); each third of the stage (two from 4 questions, one below) wakes a grey planet.
  - *Time Traveler* (`TimeQuest`): each answer digs up an artifact of the era (it rises and flies to the shelf, the owl
    cheers); each era's share lights the time gate and the pet steps through into the next (one era per three
    questions, up to four).
  - *Treasure Explorer* (`MapQuest`): the pet walks the map's trail a step per answer; fog lifts and a flag goes up at
    each place reached; the last answer opens the chest on the island.
  - *Magic Laboratory* (`LabQuest`): each answer is an ingredient the pet casts into the potion; the last sets it
    bubbling and lights the bulb (the hands-on experiments stay Magic Lab's).
  - *Word Forest* (`ForestQuest`): as before, now for Phân loại too.

  The scene stays for the whole stage (during the countdown, between questions, after the last one). After a right
  answer the world's reaction plays first, as a reaction of the feedback loop: the explanation card waits until the
  scene reports it done (`QUEST_RIGHT_MAX_MS`, 4.5 s, at most), the next question cannot be answered meanwhile, and the
  stage does not finish before it. A wrong answer is felt in the world without holding the game. Reduced motion: no wait.
- **Sound effects** (`games/engine/sfx.tsx`): Math Battle, Magic Lab, Word Forest and every world play short cues (spell,
  hit, pick-up, unlock, level done, a gentle "not yet", portal). One set of players per game screen, shared through
  context. A cue never restarts within 90 ms and at most two start within 160 ms (the rest are dropped). Silent while
  *Âm thanh* is off; the pause menu sets the volume (*Nhỏ / Vừa / Lớn*, saved per account on the device with the other
  learning preferences). On the web, sound starts after the learner's first tap (browser rule).
- **Stars** on the result (`stageStars`, shown only): a completed stage gets 3 from 90% right at the first try, 2
  from 70%, else 1; the highest combo shows from x3.

Reduced motion: no lunges, bolts, bobbing or scrolling; results show at once.

## Học tập only (Thử thách merged)

- The app no longer shows the *Học tập / Thử thách* switch (game list, Math setup) nor the mode name (lesson, *Tiếp
  tục phiên học*). Every new stage, replay and review is created with `mode: practice` (`PLAY_MODE` in
  `mobile/src/learning/labels.ts`); a mode saved on the device by older versions is ignored.
- Nothing is lost: lessons, questions, progress, the review list, the history and EXP never depended on the mode. A
  session started in *Thử thách* before stays playable as it was (moving targets, score, combo) and its result still
  shows its score; *Chơi lại* plays it again in Học tập. The backend keeps accepting both modes.

## Cách chơi (first-time interactive tutorial) and countdown

- **Per game, in the game itself**: each game has its own interactive tutorial, played in the real game screen
  (Tutorial Mode) with demo content: watch, do the real move (type, tap, drag, the number pad…), get feedback, step by
  step, then *Bạn đã sẵn sàng!* and *Bắt đầu chơi*. It never scores, takes a real heart, grants EXP or moves a lesson
  on: no stage exists while it plays. Architecture, steps, API and rules: [GAME_TUTORIALS.md](GAME_TUTORIALS.md).
- **When**: before the session exists when the game is known (English "Chơi ngay", *Luyện lại*, a lesson's game);
  after the lesson with the session still paused for Math; right after creating a paused review stage. It is asked for
  until completed or skipped at the current tutorial and gameplay version (*Bỏ qua* is recorded as skipped, apart
  from completed). *Cách chơi* on each game of the list plays it again; in a stage, the pause menu's *Xem lại hướng
  dẫn* plays it over the paused stage, and *Tiếp tục chơi* resumes that stage after 3-2-1.
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
| `GET /api/games/tutorials/progress`, `GET/POST /api/games/{game}/tutorial…` | the interactive tutorials ([GAME_TUTORIALS.md](GAME_TUTORIALS.md#api)) |
| `GET /api/learning/tutorials`, `POST /api/learning/tutorials/{game}` | older apps' guide pages (kept; a tutorial left unfinished is not "seen") |

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
| `accepted` | Other correct answers for Việt → Anh, separated by `\|` (`trash\|garbage`). Anh → Việt takes its answers from `meaning_vi` (see below) |
| `phonetic`, `source` | IPA (optional for phrases); where the row comes from (default `mirabi-original`) |

**Review (2026-10-31)**: every active entry (9 403 senses) was read by an AI review (Claude, 10 batches), not by a
person. 90 corrections were applied (meanings, contexts, examples, accepted answers, 8 difficulties, 2 parts of
speech); no entry had to be held back. Meanings that name a loanword the way Vietnamese does ("tin tặc, hacker") were
kept: Việt → Anh already leaves them out (`gives_answer`) and Anh → Việt accepts the loanword. 14 words were kept for
lớp 6 and above (`vocab_grade_limits.tsv`) and 6 examples rewritten for young learners. A human review is still to do.

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

### Khám phá từ mới and Ôn tập

How a stage of the bank picks its words (`app/vocab_discovery.py`; a lesson's own words: [Khám phá từ mới theo
bài](#khám-phá-từ-mới-theo-bài)). The two games keep their own history and levels: *Bắn thiên thạch* (`meteor`,
Việt → Anh) and *Từ rơi / Bắn từ tiếng Anh* (`word_shooter`, Anh → Việt).

- **Khám phá từ mới** (one tap on the game, `POST /api/learning/play {game, vocab: "discover", topic?}`): at most 15
  words **never shown before in that game**, each word once (two senses of "bank" are one word: the canonical id is
  the normalized word), ordered **easy to hard**. A word counts as shown when its turn goes on screen
  (`learning.issue_turns` → `vocab_discoveries`), so a stage left after 3 words gives back the 12 it never showed;
  "Chơi lại" and "Bắt đầu" always draw new words; the history is the account's (another device, signing in again).
  With 7 new words left a stage has 7 (never 8 old ones to fill it). With none: `409 vocabulary_exhausted`, the app
  offers *Chọn chủ đề khác* and *Ôn tập*; the history is never reset.
- **Ôn tập** (`vocab: "review"`): words already met in that game, at most 12: the "Cần ôn" ones first (most mistakes
  first), then those due by a spaced schedule (mastery < 40: after 1 day, < 70: 3 days, < 90: 7 days, else 21 days),
  weakest first. It writes no discovery and never changes a level.
- **Levels 1–5** from the bank's internal difficulty (1 → 1 … 5 and 6 → 5): *Rất dễ, Dễ, Trung bình, Khó, Nâng cao*.
  The **grade** (education profile, never sent by the app) sets where they start and the highest one reachable:

  | Grade | Open from the start | Highest | Topics left out |
  |---|---|---|---|
  | Lớp 1–2 | 1 | 1 | law, business, society, media, thinking; idioms |
  | Lớp 3–5 | 1 | 2 | same |
  | Lớp 6–7 | 1 | 3 | law |
  | Lớp 8–9 | 1–2 | 4 | – |
  | Lớp 10–12 | 1–3 | 5 | – |
  | Outside school | 1 | 5 | – |

  Single words a younger grade could reach but should not meet yet (romance words, insults) are kept for an older
  grade in `backend/app/data/vocab_grade_limits.tsv` (`vocabulary`, key, min_grade, reason); outside school there is
  no such limit. A reviewer adds a line there; the word stays in the bank.

- **Completing a level**: once every word of it (for this grade and game) was discovered, the backend marks it
  completed (`vocab_level_progress`), opens the next level if the grade allows it, and the app shows the celebration
  once (pet hops, stars, light confetti; still with reduced motion): *"Chúc mừng! Bạn đã khám phá hết từ vựng cấp 1 –
  Rất dễ!"* / *"Bạn đã khám phá 420 từ. Cấp độ mới đang chờ bạn!"* with *Khám phá cấp độ mới* and *Ôn tập từ đã học*.
  It is marked seen as soon as it is shown (`POST /vocabulary/levels/{game}/{level}/celebrated`). A level is never
  taken back: words added to the bank later are new words of an open level, nothing is celebrated again.
- **Adapting**: a *challenge* (0–100, starting at 30) moves one step (10) per stage from the last 8 stages of the game:
  up after ≥ 85% right at the first try answered within 12 s on average, down below 60%. It sets the share of harder
  new words (10% at 0, 70% at 100), taken just above the middle of the remaining words, never the hardest at once.
  Many mistakes bring easier new words and *Ôn tập* is offered; Khám phá never repeats a word. The falling speed never
  depends on it.
- **School years**: each discovery keeps its school year. A promotion moves the ceiling up; nothing is lost or moved.
  *Sổ tay từ vựng* filters by year (`?year=`), and practising a finished year's words
  (`POST /vocabulary/practice {year}`) is an `archive` stage that never fills this year's "Cần ôn".

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
  | User types | the word shown, letter by letter in its answer boxes (`prompt.letters`) | the English word; declared equivalents accepted |
  | After a hit | the Vietnamese meaning, shown where the word broke, plus pronunciation | the pair to remember (*apple — quả táo*) with its phonetic, plus pronunciation |
  | Progress skill | `en.spell.<word>` (`skill_type` `spelling`): the word's spelling; never counts as knowing the word | `en.word.<word>` (`skill_type` `word`): recalling the word, the vocabulary mastery |

  **Anh → Việt answers**: only the word shown (`accepted = [word]`). Hints help to type it: the number of letters, then
  letter by letter (`spelling_hints`), never its meaning. The meaning is never sent before the word is resolved
  (`result.word = {en, vi, phonetic}` on a hit, miss or reveal; `correct_answer` is the word). The two games keep
  separate progress, review items (`<lesson>.spell.<word>`, labelled *Mặt chữ: …*) and mastery. A review session of
  Anh → Việt items only is played as *Bắn từ vựng*. The meaning shown after a hit pops in, stays about 1.3 s, then floats
  up and fades (0.5 s), under the other falling words, and never blocks typing. A miss shows the English–Vietnamese pair.
  *Xem đáp án* is not offered: the word to type is on screen. Stages created while the meaning was typed instead keep
  their frozen answers (`answer.lang = "vi"`, `prompt.answer_lang`): they can still be finished as they were, with a free
  answer field, tone marks optional, and *Xem đáp án*.
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
  wrong, as before; Enter sends what is typed too. Only Anh → Việt stages created while the meaning was typed have no
  boxes: the aimed word carries one bright answer field with a caret (*Gõ nghĩa tiếng Việt…*), the others a small
  *Nghĩa?* field, and a wrong meaning is checked with Enter. The same text is never sent twice. Behind the boxes there is one text
  field for the whole play field (`Playfield`, never remounted), so a falling target, choosing another one or a word
  breaking never closes and reopens the keyboard, and the typed text is kept. Hints: first letter, then last letter.
- **The falling-word engine** (`games/wordField.ts`, plain TypeScript, tested in `__tests__/word-field.test.ts`): every
  word is an object with its own id, x, y, width, height, speed (px/ms), spawn time and state: `SPAWNING` (queued, not
  on screen) → `FALLING` → `LOCKED` (typed right: stopped where it was) → `HIT` (a bullet reached it) → `DESTROYING` (it
  broke: counted, once) → `REMOVED`; or `FALLING` → `MISSED` (landed) → `REMOVED`; a withdrawn shot goes back from
  `LOCKED`/`HIT` to `FALLING` where it stopped. Coordinates are pixels in the field's own frame, never a share of its
  height, so the keyboard opening or closing moves no word: only the ground moves, and each word's speed is adjusted so
  it still lands at the same moment (a word below the new ground is lifted onto it, the only case where a word moves
  by more than a frame's fall; counted in `stats.teleports`).
- **Movement**: one `requestAnimationFrame` loop in `Playfield` (only while the game runs) steps the engine by the
  frame time, capped at 64 ms (the first frame after the app was frozen never makes words jump), moves each word by
  speed × time, lowest first, and writes its y into that word's own `Animated.Value` (a `translateY`, never `top`):
  nothing re-renders while words fall. The shooter's frame runs in the same loop. Each word is a memoised component
  keyed by its id; its box (tile and answer boxes) has one size for its whole life, from its answer's length
  (`wordBox`), whether it is aimed or not, so aiming another word or typing resizes and moves nothing. Typing
  re-renders the aimed word only. The game clock (HUD, spawn timer) ticks every 250 ms in these games.
- **No overlapping words, ever** (the spawn manager, `WordField.place`): a new word always comes in at the top, at an x
  where its real box (with an 8 px gap) touches no word, and when it shares a column with a word below, far enough
  above it that it can't catch that word up before it lands (longer words fall slower, so speeds differ) or, for a word
  being shot, before it breaks. With no such place it waits in a queue (first come, first served) and is tried again
  every frame: it is never forced in, and `GameScreen` asks the server for no new word while one is waiting. A falling
  word never enters the box of a word below it in its column: it waits just above it (a word being shot) and falls on
  once it has broken. A word waiting in the queue does not fall, so it never appears low on the field nor lands unseen;
  only the words open when the game is reopened go on from where they were (`on_screen_ms`). A miss is reported only
  once at least half the fall time has passed (the backend's `miss_min_share`); later is always accepted. A new word
  fades in. After a shot the next word in falling order is aimed and the answer field (fixed, invisible, at the top of
  the field) keeps the focus. `WordField.stats` counts spawns, words that had to wait, frames where a word waited,
  overlapping boxes (always 0) and the smoothed frame time.
- **The field never moves on screen**: the question card above it and the "Gợi ý" row under it stay in place, at a
  height that never shrinks (`Steady` in `GameScreen.tsx`), while no word is falling for a moment (a blank card, the
  buttons dimmed), and a notice or the hints take the card's one line under the word (at most two) instead of adding
  rows. Otherwise the field would grow and shrink between words, and every falling word would shift with it.
- **The pet shoots** (both vocabulary games, `mobile/src/screens/learning/games/shooterFx.ts` and `Playfield.tsx`): the
  user's pet (its idle strip, its walk strip while moving, mirrored to face its way; never redrawn) drifts gently along
  the bottom while waiting. **As soon as the typed text is right** (its key matches) the word stops where it is, for
  good (it no longer falls and can never be missed or scored again), and the pet shoots at once, without waiting for
  the server: it glides under the word (≤ 0.28 s), stops to aim, and fires 3 small bullets with short trails from its
  head, 150 ms apart, each flying 500–800 ms depending on the distance (`SHOT_TUNING` in `shooterFx.ts`: bullets, gap,
  speed, flight bounds), straight to the stopped word, so every bullet hits it. The word glows softly while locked on,
  flashes at each hit, glows and cracks for 160 ms after the last one, then breaks into spinning fragments and specks of
  light with a flash ring (shot and break sounds, following *Âm thanh*); only then does it count ("Chính xác!", the
  points), its meaning or pair pop in there, and the English word is pronounced. It breaks only once the backend has
  confirmed the answer (`Shot.confirmed`): a slow reply keeps it cracked and glowing where it is; an answer not counted
  after all withdraws the shot and the word is back. When two falling words share the typed meaning, the one closest to
  the ground is shot, as the backend picks. A wrong answer shoots
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

## Sổ tay từ vựng (vocabulary history)

**Sổ tay từ vựng** on the English game list (top right, next to the title) lists every word met in the two vocabulary
games, most recently studied first, with a search (English word or Vietnamese meaning, accent-insensitive), the tabs
*Tất cả*, *Đã học*, *Chưa nhớ* (answered wrong or not answered the last time), *Thành thạo* (mastery ≥ 80), a topic
and a level filter, 15 words a page (*Trước* / *Sau*; the page, filter and search are kept while a word is open, and a new filter or search starts on page 1). A word opens its detail: word, meaning and context, phonetic, part of
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
| `GET /api/learning/vocabulary/history?q=&filter=all\|learned\|review\|mastered\|correct&topic=&level=&year=&limit=15&offset=0` | One page (`limit` 1–100, default 15) of entries (word, meaning, context, part of speech, first/last seen, status, counts, per game `{correct, wrong, unanswered, last_result, last_at}`); `total` = words matching the filter and search; `counts` (the filter tabs) and `due` (Cần ôn words per game) are for the whole history |
| `GET /api/learning/vocabulary/history/{entry_key}` | One entry with `phonetic`, `example_en/vi`, `can_practice`, `attempts` (newest first); `404 word_not_found` when it is not in the user's own history |
| `POST /api/learning/vocabulary/practice` | `{game, entry_keys?, year?}` (+ `Idempotency-Key`) → a review session (an `archive` one for a finished `year`); `409 no_words_to_practice` when none of the words is the user's (or none is due) |
| `GET /api/learning/vocabulary/progress?game=meteor\|word_shooter` | Levels (`completed`/`unlocked`/`locked`/`above_grade`, words discovered/total), `current_level`, `new_words_left`, `review_due`, `challenge`, topics with new words left, `celebration` (a completed level not shown yet) |
| `POST /api/learning/vocabulary/levels/{game}/{level}/celebrated` | The celebration was shown (idempotent); `404 level_not_completed` |
| `POST /api/learning/play` | `+ vocab: "discover"\|"review"`, `topic?` for the vocabulary games; `409 vocabulary_exhausted`, `409 topic_not_available` (a topic left out for the grade), `409 nothing_to_review` |

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
| `vocab_discoveries` | Khám phá từ mới: a word shown for the first time in a game; unique `(user_id, game, canonical)`, its sense, level, topic, school year, session |
| `learning_unlocks` | Tự động mở khóa: a chapter or lesson opened for a learner in a school year; unique `(user_id, academic_year, content_type, content_key)`, its `source`, `trigger_key`, `celebrated_at`. Never taken back |
| `vocab_level_progress` | A vocabulary level of a game: unlocked (why, grade), completed (words, school year), celebrated; unique `(user_id, game, level)` |

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
- English words are spoken by the device's text-to-speech; the scene games have short sound effects but no background
  music per world yet.
- Built-in lessons are defined in code (versioned on change); vocabulary is edited in its data files and imported with
  `python -m app.learning_vocab`; there is no admin editor. CEFR levels of the bank are editorial estimates.
- Time spent in a learning game is not added to the focus-timer statistics or study-minute EXP (the stage reward is
  separate); *Học tự chọn* sessions count exactly as before. Focus-timer rows in `study_sessions` carry
  `study_type = self_study` (Study Together rooms: `together`).
- Daily tasks still use the UTC day while stage rewards use the account's local day (see above).
- Play-time and miss checks are plausibility limits, not anti-cheat.
