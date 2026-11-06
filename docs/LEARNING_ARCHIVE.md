# School grade, automatic promotion and Kho lưu trữ học tập

Backend: `backend/app/education.py` (calendar, promotion, archives, notes, admin API), `data/academic_calendar.json`
(regions; no dates are bundled), `migrations.backfill_education_profiles` (existing accounts). App:
`mobile/src/learning/education.ts`, `screens/learning/ArchiveScreens.tsx`, `NotesScreen.tsx`, `PromotionCelebration.tsx`,
the header in `SubjectPicker.tsx`, `screens/admin/EducationAdminScreen.tsx`. Tests: `backend/tests/test_education.py`,
`mobile/__tests__/grade-promotion.test.tsx`, `notes.test.tsx`, `education-admin.test.tsx`.

## The grade is locked

- Registration asks age and grade (as before) plus an optional `education_region` (default `VN`, the only region
  configured). The grade is the one of the **current school year** (the form says which: `GET
  /api/education/calendar/current`). Age never overrides a confirmed grade.
- `user_education_profiles` stores `initial_grade`, `current_grade`, `academic_year` (first calendar year: `2026` is
  2026–2027), `enrollment_date`, `education_region`, `status` (`studying` | `completed` | `outside_school`) and
  `locked_at`. `users.school_grade` mirrors `current_grade` for older readers; only `education.py` writes either.
- Học tập has no grade picker, no *Lớp khác*, no *Sửa lớp*. Cài đặt shows the grade read-only (age stays editable).
- The backend never takes a grade from the app: `programme`, `programme/subjects`, `catalog`, `play`,
  `lesson-catalog/{key}` and `lesson-catalog/{key}/play` use the stored grade and school year and answer
  `403 grade_locked` to any other one. `PUT /api/profile/study` sets the grade only the first time (accounts created
  before registration asked for it); another grade later is `409 grade_locked`.
- A wrong grade is fixed only through support, after verification (admin endpoints below, with reason and ticket).

## School years and promotion

`academic_year_configs` holds one row per region and school year: `school_start_date` (tựu trường), `opening_date`
(khai giảng), `promotion_date` (the official day grades change; tựu trường by default), `end_date`, the decision that
sets them (`source`, `decision_number`) and its verification (`verified`, `verified_at`, `verified_by`). **No dates
are bundled**: an administrator enters each year from the Ministry's *khung kế hoạch thời gian năm học* (or the
province's decision) with `PUT /api/admin/education/calendar` or the admin screen, and marks it verified once checked
against the document (verifying needs a source and a decision number; every change needs a reason and is kept in
`academic_calendar_changes` with who, when, before and after). The guessed dates of the first release (the last
Monday of August, unverified, never edited) are removed by the migration.

**Grades move up only on a verified date**, at midnight in the region's timezone (`Asia/Ho_Chi_Minh` for VN). While a
school year that has begun is not verified (or not entered), learners keep their grade (`awaiting_calendar: true`),
the app announces no date, and administrators are told: `GET /api/admin/education/alerts` (and the admin screen's
banner) lists each such year as `overdue` with the number of learners waiting, or `upcoming` within 45 days; the sweep
also logs it. An administrator can still confirm one learner's promotion by hand once the year has begun
(`POST /api/admin/education/users/{id}/promote`), through the same once-per-year path.

`ACADEMIC_YEAR_EXPECTED_START` (`09-05`, khai giảng) only *names* the current school year while its dates are not
entered (registration, the header); it never promotes anyone. There is no promotion on 1 January.

`education.sync` brings a learner to the current school year, **one year at a time**, each in one transaction:

1. lock and re-read the profile (`SELECT … FOR UPDATE` on PostgreSQL); stop if the year was already closed;
2. freeze the closing year: `learning_year_archives` + `archived_learning_results` + `archived_learning_notes`
   (from that year's sessions only);
3. insert the `grade_promotion_history` row (unique per user and school year for the yearly kinds);
4. compare-and-set the profile (`WHERE academic_year = <closing year>`) to the next grade and year, and mirror
   `users.school_grade`.

It runs on login, on every Học tập read (`/api/education`, programme, catalog, play…) and from a background sweep
(`GRADE_PROMOTION_SWEEP_SECONDS`, default 3600). A retry, a second device or a second worker gets a unique-key or
compare-and-set failure, rolls back, and sees the year already closed: never a double promotion or archive.

- **Away for years**: each missed year is closed in turn; a year without any learning is archived with zeros and
  `skipped: true` (nothing is made up). One celebration is shown, for the grade reached.
- **A stage being played** on promotion day: the promotion waits until it ends (or goes stale after
  `LEARNING_EXPIRE_HOURS`); `promotion_pending: true` meanwhile. That stage counts for the closing year.
- **Last grade** (`grade12`): no grade that does not exist; `status: completed`, kind `completed`, no further years.
  `preschool` moves to `grade1`. Sinh viên / Người đi làm (`outside_school`) never move.
- **Học lại** (repeat): support sets `hold_next_promotion`; the next school year keeps the grade (kind `repeat`, no
  celebration). For a year that has already moved on, use the grade correction.
- **Region change**: support changes `education_region`; the school year reached is kept. A region whose year starts
  later never moves the learner back, one whose year already started promotes once through the same unique key.
- **Existing accounts** (migration): the grade they gave becomes their grade of the current school year (when it was
  given is unknown, so no year is closed retroactively), locked, with a `migration` history row; their sessions are
  tagged with that year.

## What changes with the grade

Every learning session stores `academic_year`; progress (lesson states, *Tiếp tục học*, the header's progress) is read
for the current year only, so a closed year's results never become the new grade's. After a promotion the programme,
lessons, curriculum games, Math level, suggestions and statistics are those of the new grade; nothing of the old grade
is offered as current content. *Cần ôn* too: the open items of lessons made for another grade become `archived` (they
are in the year's `mistakes`), while the word bank's belong to no grade and stay; a repeated grade keeps its list.
Pets, EXP, coins, inventory, streaks and every other feature are untouched (the promotion writes only the tables above,
those review items and `users.school_grade`).

## Kho lưu trữ học tập

- The three most recent **finished** years (`LEARNING_ARCHIVE_VISIBLE_YEARS`), never the current one. Older ones stay
  stored but are not offered (`404 archive_not_found`) until `LEARNING_ARCHIVE_RETENTION_YEARS` (default `0` = keep)
  deletes them; the purge touches only the three archive tables.
- A year's snapshot (`snapshot_version` 1, plus the `curriculum_versions` row of the catalog then): subjects → chapters
  → lessons with their content versions and states, each lesson game's stages / best / passed / last result, the
  free-practice games, statistics (sessions, stages, minutes, score, EXP, days, first-try accuracy, lessons completed),
  and notes: `knowledge` (the objectives, summary and examples of each lesson studied, as they read then), `vocab`
  (words met) and `mistakes` (questions answered wrong, with the right answer). At most 500 words and 500 mistakes
  per year (the most recent).
- Read only: there is no "switch to this grade". A lesson is read from its frozen copy (or the catalog for a lesson
  not studied). *Ôn tập* plays its games as `kind: "archive"` sessions with `archive_year`: they never change the
  snapshot, the current year's progress, *Cần ôn* or the stage reward (`not_eligible`), and are listed apart
  (`reviews`). Only the owner can read or play an archive.
- **Sổ tay kiến thức** has two parts. *Tóm tắt*: the lessons studied this school year with their summaries
  (`GET /api/education/notebook`); a finished year's are in its archive (`knowledge`, frozen). *Ghi chú của tôi*:
  notes the learner writes (`learning_notes`), on a subject of their grade and optionally a lesson, kept per school
  year and grade, searchable (accents and case ignored), editable and deletable by their owner only. A promotion never
  touches them; a finished year's notes are listed with that year in Kho lưu trữ, and older years stay listed
  (*Tất cả năm học*). The retention policy never deletes notes.

## The app

- The lesson screen has a *Ghi chú* button: Sổ tay opens on *Ghi chú của tôi* with a note started for that lesson.
- Cài đặt → *Quản trị lớp học* (administrators only; the backend checks the role on every call): find a learner by
  email or name, see their grade, year, region and every change (who, when, why); correct the grade, confirm *học
  lại* or *lên lớp*, change the region; manage each region's school years. Every action asks for a reason and the
  verification (ticket) and is confirmed in a dialog before it is saved.
- Header of Học tập: *Lớp 2 — Năm học 2027–2028* with a lock, and two icons: *Sổ tay kiến thức* and *Kho lưu trữ học
  tập*. Below: at most one *Tiếp tục học*, then the subjects (see [LEARNING_GAMES.md](LEARNING_GAMES.md#học-theo-bài)).
- Kho lưu trữ: first the current year in a few lines (its progress, lessons completed / ready, and when the next
  promotion happens, or that it waits for the calendar), then one row per finished year (grade, year, progress), the
  year (subjects and lessons with results, words, mistakes), a lesson (frozen knowledge, the year's results, *Ôn tập*).
- Celebration (once per promotion, any device: `POST /api/education/celebrations/{id}/seen`): the pet in the middle
  jumping, light rays and stars, *Chúc mừng! Bạn đã lên lớp 2!*, the new school year, *Khám phá lớp học mới*.
  Still when the OS asks for less motion.
- Offline: the last state read is kept on the device (`mirabi.education:<user>`) and shown until the backend answers;
  coming back to the foreground reloads it, so an app offline across a new school year gets the new grade then.

## API

| Method & path | |
|---|---|
| `GET /api/education` | Grade, school year, status, year progress, next promotion, `promotion_pending`, `celebration`, archive count. Runs the promotion check first |
| `POST /api/education/celebrations/{id}/seen` | The celebration was shown (idempotent) |
| `GET /api/education/calendar/current?region=` | Public: the current school year (registration) |
| `GET /api/education/archives` | Kho lưu trữ: cards of the visible finished years |
| `GET /api/education/archives/{year}` | One finished year (owner only) |
| `GET /api/education/archives/{year}/lessons/{key}` | Read one of its lessons again, with that year's results and its games |
| `POST /api/education/archives/{year}/lessons/{key}/play` | `{game}` (+ `Idempotency-Key`) → a paused `archive` session |
| `GET /api/education/notebook` | Sổ tay kiến thức, tóm tắt of the current year |
| `GET /api/education/notes?q=&academic_year=&subject=&lesson_key=` | Ghi chú của tôi, newest first, with search |
| `POST /api/education/notes` | `{title, body, subject, lesson_key?}` for the current year and grade (`422 note_subject_invalid`, `note_lesson_invalid`, `note_empty`) |
| `PUT /api/education/notes/{id}`, `DELETE /api/education/notes/{id}` | Edit / delete one's own note (`404 note_not_found` otherwise) |
| `GET /api/admin/education/regions`, `/alerts` | Admin: the regions; the unverified school years with learners waiting |
| `GET/PUT /api/admin/education/calendar` | Admin: a region's school years and recent changes; set one (`{…dates, source, decision_number, verified, reason}`; `422 invalid_calendar`, `verification_incomplete`) |
| `GET /api/admin/education/users?q=`, `/users/{id}` | Admin: find learners; one learner with their history (who, when, why) |
| `POST /api/admin/education/users/{id}/grade` | Admin, verified: correct a grade (`{grade, reason, verification}`) |
| `POST /api/admin/education/users/{id}/repeat` | Admin, verified: the next school year keeps the grade |
| `POST /api/admin/education/users/{id}/promote` | Admin, verified: lên lớp now (`409 school_year_not_started`, `game_in_progress`) |
| `POST /api/admin/education/users/{id}/region` | Admin, verified: another region's calendar |
| `GET /api/admin/education/users/{id}/history` | Admin: every grade / year change |

Every admin endpoint answers `401` without a token and `403 admin_required` without the administrator role. The full
contract (schemas, error codes per response, bearer security) is `docs/learning-openapi.json`, generated and validated
by `backend/scripts/export_learning_openapi.py` (`--check` fails when it is out of date; a test runs the same check).

Settings: `EDUCATION_DEFAULT_REGION`, `ACADEMIC_YEAR_EXPECTED_START`, `GRADE_PROMOTION_SWEEP_SECONDS`,
`LEARNING_ARCHIVE_VISIBLE_YEARS`, `LEARNING_ARCHIVE_RETENTION_YEARS`.

## Database

New tables (created by `upgrade_schema`): `user_education_profiles`, `academic_year_configs`,
`grade_promotion_history` (partial unique index `uq_grade_promotion_user_year` on `(user_id, academic_year)` for
`promotion | repeat | completed`), `curriculum_versions`, `learning_year_archives` (unique `(user_id,
academic_year)`), `archived_learning_results`, `archived_learning_notes`. New columns: `learning_sessions.academic_year`
(indexed) and `learning_sessions.archive_year`; then `academic_year_configs.decision_number`, `verified_at`,
`verified_by`, the tables `academic_calendar_changes` and `learning_notes`, and the index
`ix_learning_sessions_user_year_lesson (user_id, academic_year, catalog_lesson)`.

**Learning progress has no separate `learning_progress` table, on purpose.** Everything it would hold (per user, year,
grade, subject, lesson: completion, best score, attempts, last studied) is read from `learning_sessions` and
`learning_session_items`, filtered by `academic_year`: one source of truth, nothing to keep in step, and an old result
never changes when a lesson is edited (sessions keep their content version). The query reads the sessions of the
lessons on screen through the composite index above and only the item columns progress needs. A finished year is
frozen into `archived_learning_results`, so its progress never depends on later data. Revisit this if a screen ever
needs progress across many years or users at once.

The upgrade is additive and idempotent; run it against a copy of production data first, as with every migration here.
