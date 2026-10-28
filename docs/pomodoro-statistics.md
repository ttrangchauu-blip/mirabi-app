# Pomodoro statistics

The existing `study_sessions` table remains the source of truth. An additive,
idempotent startup migration adds `started_at`, `ended_at`, `timezone`, and
`status`. `pomodoro_settings` stores one preferences row per user. Existing
completed Pomodoro records still count; their `created_at` is the completion
timestamp and the user's current timezone is the fallback for legacy records.
No aggregate/streak/recommendation tables are required.

## Rules

- Only completed `mode=pomodoro` sessions lasting at least 60 seconds count.
- Completed time is credited to the completion day in the session's IANA timezone.
  New sessions record the device timezone; changing devices does not redate them.
- A date contributes once to the streak. Consecutive calendar dates increment it,
  including across daylight-saving changes. A streak ending yesterday remains
  current until today is missed. Longest streak spans the full history.
- Week means Monday through today; month means the first through today.
- Completion rate uses the cohort of sessions **started** within the selected
  period. A cross-midnight completion contributes study time on its completion
  date but belongs to the start date's completion-rate cohort.
- Focus duration excludes paused time. Breaks never create study sessions.
  Resetting, skipping, or changing focus duration cancels an active focus cycle.
- Pet EXP from study: +2 EXP per full 5 valid minutes, counted over the local
  day's completed sessions so leftover minutes carry into the next block. Pomodoro
  cycles and `POST /api/study/sessions` share one cap of 48 EXP/day (120 valid
  minutes, `STUDY_DAILY_EXP_CAP`). Sessions ended early (cancelled) still add
  their studied minutes (and EXP) but are not completed sessions and do not extend
  the streak. Unfinished, under-60-second and break sessions earn nothing; each session is awarded once. Reading statistics,
  achieving streaks and changing goals award no XP.
- Background sound plays only while a focus session runs, pauses with it and is
  turned off when the session is ended early. Focus mode (opt-in) hides in-app
  toasts and notification banners while a focus session runs.

## API (authenticated business backend)

- `GET/PUT /api/study/pomodoro-settings`: timezone, daily goal and timer preferences.
- `PUT /api/study/pomodoro/{cycle}`: started/cancelled/completed lifecycle events;
  optional UTC `occurred_at` preserves timestamps during offline delivery.
  Completion requires a start, at least 60 seconds and duration no longer than
  the event's elapsed wall time. Terminal transitions are conditional and unique
  `(user_id, pomodoro_cycle)` prevents duplicates. The old POST endpoint remains
  for compatibility with earlier clients.
- `GET /api/study/pomodoro-statistics?period=day|week|month`: daily series,
  totals, goal, current/longest streak, start-cohort completion rate, unfinished
  and cancelled counts, duration counts and current-week hourly observations.
  `GET /api/study/dashboard?period=…` returns the same payload.
- Split views of the same aggregates (always consistent with the dashboard):
  - `GET /api/study/summary`: `today_seconds`, `today_sessions`, `current_streak`
    for the focus-space strip.
  - `GET /api/study/minutes?period=…`: today/week/month/all-time seconds, period
    total and daily average, daily goal progress and a per-day `seconds` series.
  - `GET /api/study/completed-sessions?period=…`: today's completed sessions,
    started/completed/cancelled/in-progress counts, completion rate, hourly and
    duration breakdowns and a per-day `started`/`completed` series.
  - `GET /api/study/streak`: `current_streak`, `longest_streak`, `active_days`.
    This is the study streak; the login streak stays at `GET /api/streak`.
- `GET /api/dashboard` → `study` uses the same aggregates for the Home screen.

The client persists an ordered per-account event queue and retries every 15
seconds. Settings are restored from the server on login; unsynchronized settings
show an explicit retry button. The dashboard refreshes after completion/settings
changes, on returning to the foreground, and every minute while mounted.
Completion animations honor reduced motion and are hidden during focus.

## Verification

From the repository root in PowerShell:

```powershell
$env:PYTHONPATH = "$PWD;$PWD\backend"
backend\.venv\Scripts\python.exe -m pytest backend/tests/test_pomodoro_statistics.py backend/tests/test_study_pomodoro.py backend/tests/test_migrations.py -q -p no:cacheprovider --basetemp=backend/.pytest-pomodoro-stats-check
cd mobile
npm.cmd run typecheck
npm.cmd test -- --runInBand __tests__/pomodoro.test.tsx __tests__/pomodoro-panel.test.tsx
```

Install backend requirements including `tzdata` (needed for IANA zones on Windows).
Device notification delivery and
real audio output require a device/browser manual check.

Validation on 2026-10-23: 12 focused backend tests, 17 frontend tests (timer,
panel, API client and date/time helpers), and TypeScript passed. Metro compiled
the web bundle and both local services returned healthy responses.

The full existing regression suite was also attempted. Its backend run returned
94 passed, 7 failures and one temporary-directory permission error. The failures
were in AI prompt-version seeding/old direct-provider test assumptions,
onboarding prerequisites, and progression assertions that omit existing login
XP. The migration test passed when rerun with an explicit writable `--basetemp`.
The auth-flow frontend suite retains four failures for a removed login-success
alert, pet adoption text and the old pet-space buttons. These failures remain
outside this Pomodoro change; the full suite is not green.
