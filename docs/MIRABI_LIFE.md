# Cuộc sống Mirabi (Mirabi Life)

Cuộc sống Mirabi adds life features for working adults on top of the existing account, pet, EXP, task, room, album,
inventory and friends systems. It reuses those systems and does not create parallel ones. This document covers the
audit, the six features, who can use them, how to test them, and what is still missing.

| Phase | Scope (name in the app) | Status |
|---|---|---|
| 0 | Audit, reuse plan, schema, API contracts | Done (this document) |
| 1 | Work Quest (**Nhiệm vụ công việc**), Healing Room (**Góc thư giãn**) | Implemented, backend and mobile tests pass |
| 2 | Life Adventure (**Phiêu lưu cuộc sống**), Money Garden (**Vườn tài chính**) | Implemented, backend and mobile tests pass |
| 3 | Mirabi Town (**Thị trấn Mirabi**), Career Journey (**Hành trình sự nghiệp**) | Implemented, backend and mobile tests pass |
| 4 | Polish, regression, device builds | Partly: automated regression run, web bundle built; no device/simulator run (see "Known gaps"). Scenes, weather and navigation: `docs/LIVING_WORLD.md` |

**Who can use it:** accounts whose age (given at registration or in "Độ tuổi & lớp học") is **16 or over**. Every
endpoint depends on `life_access.life_user` (403 `age_restricted` otherwise); the app hides the six entries, the
Góc thư giãn button of the room and the screens (`mobile/src/life/access.ts`). An account without an age sees a prompt
to fill in "Độ tuổi & lớp học". The age is self-reported: this is an audience rule, not an identity check. The town only
shows and reaches friends who are 16+ too, so younger friends are never visible or reachable from it.

## 1. Audit of the existing system

Stack: Expo SDK 53 / React Native 0.79 / TypeScript (mobile); FastAPI + SQLAlchemy 2 + SQLite (PostgreSQL in
production) (backend). The schema is upgraded at startup by `backend/app/migrations.py`: `create_all` creates new
tables, then additive, idempotent `ALTER TABLE ADD COLUMN` statements run. There is no Alembic yet.

| Module | Exists | Reused as is | Extended | New |
|---|---|---|---|---|
| Tasks (`tasks.py`, `user_tasks`, `user_task_completions`) | Recurring tasks, completion per occurrence, EXP once per occurrence | Recurrence engine, completion ledger, `lock_daily_goals` | Columns `project_id, priority, due_at, estimated_minutes, archived_at, updated_at`; `PATCH`/`DELETE` task; steps | `user_task_steps`, `user_task_step_completions` |
| EXP (`progression.py`, `exp_events`) | Idempotent award per reference, per-source daily caps; tasks and learning share a 60 EXP/day pool | `award_exp`, `daily_exp_remaining`, pool `task` | `task_exp(priority)` with `MAX_TASK_EXP = 15` | None |
| Pet evolution / hatch (`progression.py`, `companion.py`) | Thresholds, hatch confirmation, level-up memories | Unchanged | None | None |
| Pet exploration (`companion.py`, `pet_walks`) | One 8-hour walk per day (`days.py`) once every goal of the day is done; hatching before walking | `today_goals`, `maybe_start_walk`, walk status | Removed (archived) tasks no longer count as goals | None |
| Pomodoro (`study.py`, `usePomodoroTimer`) | Device timer + server sessions, study EXP cap | The Work Quest desk drives the same timer | None | None |
| Personal room (`pet_room.py`, `RoomTab`, `RoomScene`) | Layout, decorating, pet interactions, offline cache | Room scene, pet menu, `poseFor('rest')`, window sky variants | Healing mode toggle, `RoomScene.underlay`, Healing panel | `room_ambience_preferences` |
| Album (`memories.py`) | Private memories, user and automatic events | `create_once`, album list | Event type `journal_moment` (title only, no "new memory" notice) | None |
| Inventory (`inventory.py`) | Stacks + event ledger with `event_key` idempotency | `grant()`, `use_one()`, `record()` for chests, milestones and gifts | None | `work_reward_claims`, `adventure_reward_claims`, `gift_transfers` |
| Garden (`garden.py`) | Plots, seeds, care | Unchanged; Vườn tài chính is its own screen next to it (money must not mix with seeds) | None | `finance_*` tables |
| Friends / visits (`friends.py`, `room_visits.py`) | Friendships, blocks, reports, visits, pet play with capped EXP | `list_friends`, blocks, `/api/users/{id}/report`, room visit + pet play | Visiting a room writes `visit_logs` | `town_events`, `community_projects`, `community_contributions` |
| Notifications | In-app inbox | `notify()` | Kind `town_gift` | None |
| Career (`career.py`) | Static recommendations and a quiz, not in the menu | Left as is (old route `/api/career`) | None | `careers.py` + `data/careers.json` (`/api/careers`) |
| Assets | Pet sprite sheets: idle, walk, study, move, hatch; ambient audio: rain, forest, stream, lofi, cafe, white noise | Idle/walk/study sheets, audio files | None | Vector art for the desk, islands, chests and window scenes (no bitmaps) |

Navigation: since the Living World redesign (`docs/LIVING_WORLD.md`) there are four fixed tabs (Trang chủ, Học tập, Cuộc
sống, Tiện ích), and Cuộc sống holds four places (Nhà, Vườn, Khám phá, Bạn bè). The six features open from where they
belong: Nhiệm vụ công việc, Hành trình sự nghiệp and Vườn tài chính from **Tiện ích → Học tập và tập trung**, Phiêu lưu cuộc
sống from **Khám phá**, Thị trấn Mirabi from **Bạn bè**. Góc thư giãn is a mode of **Nhà của pet** (the leaf button in the
room's bar), so it is not a separate room. Every user-facing text is Vietnamese.

## 2. Design rules kept

- **One task system.** A work task is a normal task with `category: "work"` and/or a `project_id`. It is created,
  edited, completed and deleted through `/api/tasks`. `/api/work/*` only adds projects, the dashboard, statistics and
  chests.
- **One EXP ledger.** Completing a task calls `award_exp(source="task")`: one award per occurrence (unique
  `exp_events` reference), counted in the shared 60 EXP/day task/learning pool. Priority sets the amount:
  low/medium 5 (the old fixed value, so existing tasks are unchanged), high 8, urgent 10, never more than 15.
  Concurrent completions of the same occurrence award EXP once (tested).
- **Steps are not tasks.** A step earns no EXP and is not a walk goal, so splitting a task can't multiply rewards or
  goals. That is why steps get their own table instead of a `parent_task_id` on `user_tasks`.
- **Exploration rules unchanged.** Every task due today, work or not, is a goal of the day's walk. A task added after
  the walk started, or completed during it, changes nothing (tested). Deleting the last unfinished task of today may
  start the walk, through the same locked `maybe_start_walk`. Evolution-before-exploration ordering is untouched.
- **Deleting archives.** `DELETE /api/tasks/{id}` sets `archived_at`. The task disappears from lists and goals; its
  completions and EXP stay in the history and statistics.
- **Chests grant items, never EXP**, so they can't push anyone past the cap. At most 10 completions per day of the server's
  calendar (`days.py`) count toward chests, so creating and ticking off empty tasks can't rush them. A chest opens once
  (`work_reward_claims` unique per user/chest, plus inventory `event_key`s; tested with concurrent requests).
- **Healing data is private.** Moods, journal pages and relaxation sessions are only ever returned to their owner;
  anyone else gets 404. Journal text is never logged or copied: "Lưu vào Album" stores only the page title as a
  `journal_moment` memory. Moods and relaxation earn no EXP. The pet's answer to a mood is a fixed, kind line; nothing
  infers or diagnoses feelings or health. Sad and stressed check-ins add a gentle pointer to trusted people.
- **Sound is opt-in for each visit.** Saved preferences never start audio by themselves. The user taps "Bật âm thanh".
  Sound pauses when the app goes to the background and stops when the Healing panel unmounts (leaving the mode, the
  tab or the app).
- **Reduced motion.** Every new animation uses the native driver (transform and opacity only), stops on unmount and
  stays still when the OS "reduce motion" setting is on (`useReduceMotion`).

## 3. API (Phase 1)

All endpoints need `Authorization: Bearer <access token>`. Errors are `{detail, code}`.

### Tasks (existing router, extended)
| Method & path | Notes |
|---|---|
| `POST /api/tasks` | New optional fields: `category: "work"`, `project_id`, `priority` (`low/medium/high/urgent`), `due_at` (ISO datetime, one-time tasks only; `422 due_in_past` if more than 5 minutes in the past), `estimated_minutes` (1–1440), `steps` (up to 20 titles). `404 project_not_found` for another user's project. |
| `GET /api/tasks?start_date&end_date` | Each occurrence now includes `project_id, priority, due_at, estimated_minutes, exp, steps[{id,title,done}]`. Removed tasks are left out. |
| `PATCH /api/tasks/{id}?occurrence_date=` | Edits title, description, category, project, priority, deadline, estimate. The schedule can't be changed (`422`), because completions are stored per occurrence. EXP already granted is kept. |
| `DELETE /api/tasks/{id}` | Archives the task (see above). |
| `POST /api/tasks/{id}/complete` | Unchanged contract. EXP depends on priority; `awarded_exp`, `already_completed`, `daily_exp_remaining`. |
| `POST /api/tasks/{id}/steps` | `{title}` adds a step. `409 too_many_steps` beyond 20. |
| `PUT /api/tasks/{id}/steps/{step_id}` | `{occurrence_date, done}` ticks or unticks a step on one occurrence. Idempotent; `409 task_not_scheduled` on a day the task doesn't occur. |
| `DELETE /api/tasks/{id}/steps/{step_id}` | Removes a step and its ticks. |

### Work Quest (`backend/app/work.py`)
| Method & path | Notes |
|---|---|
| `GET /api/work/projects?include_archived=` | Projects with `tasks_total/done` (one-time tasks), `recurring_tasks`, `progress`, `build_stage` 0–5, `ready_to_complete`. |
| `POST /api/work/projects` | `{name, theme, description?}`; themes `meadow, beach, forest, snow, desert, sky`. At most 30 active projects. |
| `PATCH /api/work/projects/{id}` | Name, theme, description, `status` (`active/completed/archived`). Completing sets `completed_at`, and the island is fully built and lit. |
| `GET /api/work/dashboard?tz=` | `tasks_today`, `overdue` (one-time work tasks past their day or deadline), `upcoming` (next 6 days, nearest first; the app draws a task that is in both `tasks_today` and `overdue` once), `projects`, `chests`, `summary` (done/total, focus minutes today, EXP left today), `walk` (status, goals done/total), `pet_line`. |
| `GET /api/work/statistics?period=day\|week\|month&tz=` | Completions per local day, on time vs late, by priority, by project, best day. Removed tasks count. |
| `GET /api/work/rewards` | Chest progress (capped at 10 per day) and chest states. |
| `POST /api/work/rewards/{code}/claim` | Opens a ready chest once. `409 chest_locked`, `404 chest_not_found`; a repeat returns `already_opened: true` and grants nothing. |

### Góc thư giãn (`backend/app/life.py`)
| Method & path | Notes |
|---|---|
| `POST /api/life/moods` | `{mood, note?, timezone}`; moods `happy, neutral, tired, stressed, sad, excited`. Stored with the user's local date. Returns `pet {animation, line, suggest, support_hint?}`. Limit: 24 per local day (`429`). |
| `GET /api/life/moods/history?days=&tz=` | Entries, each day's last mood, counts. |
| `GET /api/life/journal?limit=&before=` | The owner's pages, newest first, cursor `next_before`. |
| `POST /api/life/journal` | `{kind: free\|gratitude, title, content, mood?, save_to_album?}`. Always private. Limit: 50 per 24 hours. |
| `PATCH /api/life/journal/{id}` / `DELETE /api/life/journal/{id}` | Owner only (404 otherwise). Delete is permanent (204). |
| `POST /api/life/relaxation-sessions` | `{activity_type, duration_seconds (1–7200), client_ref, timezone}`; a repeated `client_ref` is recorded once (200 with `already_recorded`). Returns the day's and week's summary. |
| `GET /api/life/room-ambience` / `PUT /api/life/room-ambience` | `{ambience_type, sound_enabled, volume}`; scenes `cozy_night, rainy_day, morning_calm, forest_retreat, starry_night`. Default `cozy_night`, sound off. |
| `GET /api/life/healing?tz=` | Everything the panel opens with: ambience, today's mood and pet answer, relaxation summary, journal count. |

## 4. Database migration

New tables (created by `create_all`): `work_projects`, `user_task_steps`, `user_task_step_completions`,
`work_reward_claims`, `mood_entries`, `journal_entries`, `relaxation_sessions`, `room_ambience_preferences`.

New `user_tasks` columns (added by `migrations.ADDED_COLUMNS`, all nullable or defaulted, so existing rows read as
medium priority, no project, no deadline, not archived), plus indexes `ix_user_tasks_project_id` and
`ix_user_tasks_user_archived`. Unique constraints: step tick per occurrence, chest per user, relaxation `client_ref`
per user. Indexes on every `user_id` and on `mood_entries (user_id, local_date)`. No money is stored in Phase 1.

**Rollback:** `migrations.downgrade_mirabi_life_schema(engine)` drops the eight new tables (journal, mood and step data
is lost) and clears `user_tasks.project_id`. The added task columns stay (old code ignores them). Tasks and their
completions are never touched. Tested in `tests/test_migrations.py`.

There is no seed data for Phase 1: chests are constants in `work.py`, checked at import against the item catalog.

## 5. Mobile

| File | What it is |
|---|---|
| `src/life/types.ts`, `src/life/api.ts` | Types, API wrappers, the offline completion queue (AsyncStorage), the Healing cache |
| `src/screens/work/WorkQuestScreen.tsx` | The Work Quest world: Focus Desk, mission board, project map, chests, upcoming, statistics; loading skeleton, error + retry, empty board |
| `src/screens/work/workArt.tsx` | Vector art and animation: drifting sky, desk (lamp glow, steam), islands (6 build stages, pop on growth, lit when finished), chest (bounce when ready, lid opening), star burst |
| `src/screens/work/WorkTaskSheet.tsx` | "Nhận nhiệm vụ": priority, project, repeat (daily / weekdays), deadline presets, estimate, steps; keyboard-safe |
| `src/screens/healing/HealingLayer.tsx` | A faint colour grade over the room, cross-faded between scenes |
| `src/screens/healing/RoomAmbience.tsx` | Drawn into the room's own canvas (`RoomScene.underlay`): the room's windows show the scene's sky (display-only variant, never saved), rain / twinkling stars / leaves only behind their glass, a soft fading glow on the room's own lamps. A room without windows or lamps gets no extra objects |
| `src/screens/healing/HealingDock.tsx` | The Healing panel: scenes, mood check-in, opt-in sound, guided breathing (4-4-6), rest timer (5/10 min), private journal and "3 điều tích cực", petting |
| `src/screens/healing/ambience.ts` | Scenes, moods and breathing steps |
| `RoomTab.tsx`, `MainApp.tsx`, `MoreTab.tsx` | Healing toggle in the room header; Work Quest overlay; Mirabi Life entry cards |

Behaviour worth knowing:

- **Rewards come only from the server.** A tapped quest is stamped at once, but the "+N EXP" line, the pet's jump
  and the star burst wait for the server's answer.
- **Offline completions.** A completion without a connection is kept, the card shows "CHỜ GỬI", and it is sent on the
  next load (the server completes once, so a duplicate from another device is harmless).
- **Pet animation.** The pet walks to the desk when a focus session starts, then plays its study sheet; it walks back
  when the session stops. It jumps on a confirmed completion. In Góc thư giãn it lies down (rest pose, on the bed if
  the room has one) during breathing and rest sessions, and says the mood answer in the room's speech bubble.
- **Offline room.** The room already opens from its cache. The Healing panel opens with its last summary and scene
  and shows an offline icon.

## 5b. Phases 2–3

### Phiêu lưu cuộc sống (`backend/app/adventure.py`)
- Five regions (Thung lũng Xanh, Làng Ấm Áp, Rừng Tri Thức, Hồ Mộng Mơ, Núi Phiêu Lưu), four real-life activities
  each, milestones at 3 / 7 / 12 with room items. Regions, activities and milestones are versioned in code (codes are
  stored; never rename them).
- **Taking on an activity creates an ordinary task** for that day (`user_tasks.adventure_activity`), so it is
  completed with `/api/tasks/{id}/complete` (same EXP cap, same walk goals). Only completions move a region: the backend
  decides progress. At most 3 a day per region count. Editing or removing a task never undoes what was done.
- Regions unlock in order (3 in the previous region; the mountain also needs a step everywhere). Milestone rewards are
  inventory items granted once (unique claim + inventory event keys, serialized by the per-user lock), never EXP.
- **Not the pet's walk.** The eight-hour walk (`companion.py`) is unchanged; the map is the user's own journey.
- API: `GET /api/adventure/map?day=`, `GET /api/adventure/regions/{code}`, `GET /api/adventure/progress`,
  `POST /api/adventure/activities/{code}/start {scheduled_date}` (today−1 … today+7), `POST /api/adventure/rewards/{milestone}/claim`,
  `GET /api/adventure/history`.

### Vườn tài chính (`backend/app/finance.py`)
- Goals (`finance_goals`), transactions (`finance_transactions`: deposit / withdraw to a goal, income / expense with a
  category), categories (13 built-in, seeded by code; up to 30 custom), monthly budgets (`finance_budgets`).
- **Money is whole VND in BIGINT** (no float): amounts are strict positive integers up to 100 billion.
- A goal's tree: Hạt giống (0) → Mầm cây (first deposit) → Cây non 25 % → Cây phát triển 50 % → Cây trưởng thành 75 %
  → Cây nở hoa 100 % (`STAGE_PERCENTS`). It shrinks back when money is withdrawn.
- Withdrawals, edits and deletions that would take a goal below zero are refused (409), decided under the per-user
  lock; `client_ref` makes a retried save count once (tested with concurrent withdrawals).
- Only the owner can read anything; no friend or town endpoint shows money; amounts are never logged. Only what the
  user records moves the garden: no tasks, coins or bank. No advice is given.
- A month is the user's own calendar month: `tz` from the app, else their Pomodoro settings' zone (as in `life.py`). An
  entry is dated when it is saved, so the app records income and expenses only while the current month is on screen; a
  budget can be set for any month shown.
- At most 20 active goals, also when an archived goal is brought back (409 `too_many_goals`).
- The screen (`mobile/src/screens/money`): a 3D garden rendered in advance (`scripts/render-scenes`, `GardenScene.tsx`) with one plant per goal, the live sky and weather, and the user's own pet. Everything it shows comes from the server: the stage, `percent` (held at 100 past the target while `saved_amount` stays real) and the sum on the board (the `saved_amount` of the goals on show). Celebration plays only after the server has answered. The app edits a goal's name, target and species with `PATCH /api/finance/goals/{id}`, sending only what changed.
- API: `GET/POST /api/finance/goals`, `PATCH /api/finance/goals/{id}`, `GET/POST /api/finance/transactions`
  (`?period=YYYY-MM&tz=&transaction_type=income,expense&before=`; one type or several, comma-separated),
  `PATCH/DELETE /api/finance/transactions/{id}`, `GET/POST /api/finance/categories`, `GET/POST /api/finance/budgets?tz=`,
  `GET /api/finance/summary?period=YYYY-MM&tz=`.

### Thị trấn Mirabi (`backend/app/town.py`)
- The map: Quảng trường, Phố Bạn bè (one house per 16+ friend: visit their room or garden through the existing visit
  APIs, send a gift, report), Vườn Cộng đồng, Sân Sự kiện, Tiệm Quà tặng, Sảnh Thành tựu (friends who share their stats).
- Community projects are built with in-game coins: a conditional `UPDATE users SET coins = coins - n WHERE coins >= n`,
  an atomic add to the project, at most 1 000 coins a day, `client_ref` for retries, no EXP.
- Gifts move one free (not placed) inventory copy to a 16+ friend, once per `client_ref` (tested concurrently);
  keepsakes can't be given; 10 a day; the receiver gets a `town_gift` notification.
- Visits to friends' rooms are logged (`visit_logs`, at most one per pair per 10 minutes), only between accounts of 16
  and over, and the history shows only those. Pet play keeps its existing capped EXP. Blocks and the visit permission are the friends system's own.
- Seeds: three projects and two events by code (events start when first seeded).
- API: `GET /api/town/map`, `GET /api/town/events`, `GET /api/town/projects`, `POST /api/town/projects/{id}/contribute`,
  `POST /api/town/gifts`, `GET /api/town/gifts`, `GET /api/town/giftable`, `GET /api/town/visits/history`.

### Hành trình sự nghiệp (`backend/app/careers.py`, `backend/app/data/careers.json`)
- Ten careers (QA/QC with the five groups of the brief, Lập trình viên, BA, UI/UX, Quản lý dự án, Marketing, Sales, Kế
  toán, Nhân sự, Phân tích dữ liệu) are content, not app code. At startup they are upserted by code; a changed path gets a
  new `content_version`; a skill removed from the file is retired (never deleted, progress kept); an unknown
  prerequisite or a cycle stops the start. Administrators edit the file and call `POST /api/admin/careers/reload`.
- A skill opens when its prerequisites are practised. Statuses say what they are: **in_progress** (the user's own
  estimate), **practiced** (the user says they did a practice), **assessed** (passed the skill's short check; answers are
  checked on the server and never sent to the app). "Verified" does not exist yet and nothing claims it.
- Practising and passing a check give 5 EXP each, once per skill, inside the shared 60/day task pool. Badges (each
  group, and the whole tree) are awarded once. Changing career keeps every career's progress.
- QA/QC and Lập trình viên have a short check on every skill; the other careers' skills have none yet (they reach
  "practiced" at most).
- API: `GET /api/careers`, `GET /api/careers/{code}`, `GET /api/careers/{code}/skills`, `POST /api/careers/profile`,
  `GET /api/careers/my-progress`, `PATCH /api/careers/skills/{id}/progress`, `POST /api/careers/skills/{id}/assessment`,
  `GET /api/careers/achievements`, `POST /api/admin/careers/reload` (admin).

### Mobile (phases 2–3)
| File | What it is |
|---|---|
| `src/life/access.ts`, `src/life/worlds.ts` | The 16+ rule; API wrappers, VND formatting/parsing |
| `src/screens/adventure/AdventureMapScreen.tsx` | The map: five drawn regions on a winding trail, fog over closed ones, the pet walking to the furthest open region, region panel (activities, today's tasks, milestone chests) |
| `src/screens/money/MoneyGardenScreen.tsx` | Trees per goal (six drawn stages, sway, pop when growing, petals in bloom), deposit/withdraw sheets, history; Thu chi tab (month totals, budgets, categories, entries) |
| `src/screens/town/TownScreen.tsx` | A scrolling street (sky and street lamps by the clock), fountain / garden / lanterns built with the projects, houses of friends, the pet strolling; sheets for friends, projects, events, gifts, the hall, visit history |
| `src/screens/career/CareerJourneyScreen.tsx` | Career picker, skill tree branches with glowing nodes (pop when a skill opens), skill sheet with self-estimate, practice, short check, badges |

Database: phase 2–3 tables are created by `create_all`; `user_tasks.adventure_activity` is added by
`ADDED_COLUMNS`; `downgrade_mirabi_life_schema` drops every Mirabi Life table (tasks are kept).

## 6. Running the tests

```bash
cd backend
.venv/Scripts/python -m pytest tests/test_work_quest.py tests/test_healing_room.py tests/test_life_phase2.py tests/test_migrations.py
cd ../mobile
npx jest __tests__/mirabi-life.test.tsx __tests__/mirabi-life-worlds.test.tsx
```

Phases 2–3 and access (`tests/test_life_phase2.py`, 18 tests): the 16+ rule on every feature (15, no age, 16, signed
out); adventure activities as tasks, unlock order, invalid days, milestone claimed once under concurrency, progress kept
after edits, deletion and logout; money stages up and down, retries, overdraw refused, bad amounts (0, negative,
decimal, string, over 100 billion), edits/deletions that would go negative, concurrent withdrawals, budgets and summary,
privacy towards another user and the town; town friends limited to 16+, gifts moved once under concurrency, nothing
left to give, keepsakes refused, younger friends unreachable, notifications, blocks, visit logs, contributions exact /
capped / idempotent / no EXP / not below zero coins; careers: unlock by prerequisites, self-estimate vs practice vs
check, EXP once and within the cap, badges once, switching keeps progress, answers never sent, content cycles refused,
retired skills keep progress, seed twice adds nothing.

Mobile (`__tests__/mirabi-life-worlds.test.tsx`, 11 tests): the shared rules; the map (regions, locked hint, taking on
and ticking an activity, retry); the garden (trees, deposit once with a client reference, overdraw blocked in the app,
empty state and disclaimer); the town (house → visit, contribution, empty street); careers (choose, practise → next
skill opens, no "verified" claim). `__tests__/mirabi-life.test.tsx` now also checks the six Vietnamese cards for 16+, and
that they are hidden under 16.

Backend coverage:
- **Work Quest (11 tests):** create with project/steps/priority; validation (missing or blank title, past deadline,
  bad priority or estimate, foreign project); recurring steps per occurrence; weekday repeat; edit and overdue;
  IDOR on tasks, steps and projects; work tasks as walk goals; deleting the last goal starts the walk; tasks added
  during a walk don't reset it; the 60/day cap; concurrent completions; chests (locked, daily count cap, concurrent
  open, inventory grant); statistics.
- **Healing (7 tests):** moods on a UTC+14 local day; validation; no EXP; history privacy; journal privacy, edit and
  delete; album moment keeps the title, not the text, and raises no notice; pagination; relaxation idempotency and
  summary; ambience defaults, validation, per user.
- **Migration (1 test):** an old `user_tasks` table upgraded twice without loss; rollback; upgrade again.

Mobile coverage (11 tests):
- **Work Quest:** the world renders from the server; stamp then server-confirmed EXP; offline queue then sync on next
  load; error + retry and empty board; chest opened once.
- **Deadlines:** deadline presets.
- **Healing:** saved scene with no sound until tapped; mood → pet answer + support hint; offline cache; journal with
  album option; every scene layer renders with reduced motion.
- **Tiện ích:** entry cards.

Manual check (Expo web or device): Tiện ích → Work Quest → "Nhận nhiệm vụ" → fill in → tap ✓ on the card → stamp,
"+N EXP", the pet jumps. Press ▶ on the desk: the pet walks to the desk and studies. Phòng cá nhân → leaf button →
change scene, check in a mood (the pet answers), Hít thở, Nhật ký → save → reopen the journal.

## 7. Asset specification (to replace the placeholders)

The vector art is intentional placeholder art, not final illustration. The pet has no drawn **sit, sleep, yawn,
celebrate, interact** or **focus** sheets yet. Work Quest uses the existing *study* and *walk* sheets plus a jump
transform. Góc thư giãn uses the still artwork in the rest pose. Wanted, per element and evolution stage (Lv0–Lv6),
same format as `assets/pets/<element>/<activity>/` (square frames, a row of 8 frames, `scripts/slice-sprite-sheet.mjs`):

| Sheet | Frames | Loop | Used for |
|---|---|---|---|
| `sleep` | 8 (breathing, curled up) | 3600 ms | Healing rest pose |
| `yawn` | 8 | once | Healing, tired mood |
| `celebrate` | 8 | once | Quest completed, chest opened |
| `sit` | 8 | 2400 ms | Waiting next to the desk |
| `comfort` | 8 (leaning in, gentle) | 3000 ms | Stressed or sad mood answer |

The silhouette, number of legs, colours and element must match the existing stage art. Also wanted: a painted desk
background (16:9, 1080 px wide), six island illustrations × six build stages, and five window scenes.

## 8. Known gaps

- The age rule uses the self-reported age; the backend has no birth date, so a 15-year-old who turns 16 updates "Độ
  tuổi & lớp học" to get access.
- Only QA/QC and Lập trình viên skills have short checks; the other eight careers need question writing.
- The town's events are seeded once with dates from their first start; there is no admin screen for events or projects
  yet (edit the seed or the rows).
- Gifts are one copy at a time; coins have no in-app top-up (they are the existing in-game balance).
- An archived project or goal has no way back in the app yet (the API can restore it): the app asks before archiving.
- The town street, map, garden trees and skill tree are vector art made for this; final illustration and the pet's
  extra sprite sheets (section 7) are still wanted.

- No run on a real device or simulator; no Android/iOS build. A web bundle was built with `expo export` (see the
  Phase 1 report).
- The pet's walk-to-desk is a horizontal slide using the walk sheet, not a path through the room.
- Task statistics count completions by their UTC timestamp converted to the requested zone. The walk's goals and the
  task EXP cap use the server's calendar day (`days.py`, `DAILY_RESET_TIMEZONE`).
- Healing mood and journal limits are per-account database counts, not a gateway rate limit.
- Child accounts: Phase 1 adds no social features. The privacy review for Mirabi Town (Phase 3) is still to do.
- `tests/test_education.py::test_the_learning_openapi_document_is_valid_and_up_to_date` needs
  `openapi_spec_validator` (requirements-dev), which isn't installed in this venv.
  `test_pomodoro_statistics.py::test_events_validate_duration_and_terminal_state_idempotency` fails when Bangkok's
  date differs from UTC's (17:00–24:00 UTC). Both failures predate Mirabi Life.
