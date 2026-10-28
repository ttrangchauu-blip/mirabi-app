# Mirabi Focus Space — Cozy Fantasy Study Room

## Mobile app correction

Focus Space is the existing React Native app screen. Layout now follows
`useViewportSize()` (the app viewport), rather than the browser window. The web
preview stays in the phone frame, including its bottom sheets; opening Pomodoro
no longer switches to a full-width desktop website. Android/iOS retain native
modal sheets and safe-area/keyboard handling. TypeScript and 14 Pomodoro tests
passed after this correction. Physical-device testing has not been performed.

The existing Pomodoro screen is refactored into one room and timer surface,
a compact statistics strip and a four-tool toolbar. Timer state, session
lifecycle, shared database, Study Streak and EXP rules remain unchanged.

## Layout and interaction

- Desktop (1024px and wider): room and timer share the main surface. Tools open
  in a 350px companion panel, with its own scroll area sized to the viewport.
- Mobile: room, timer and primary action appear first. Tools and statistics open
  in an accessible bottom sheet with a backdrop, close control and keyboard handling.
- Starting focus hides secondary headings and course navigation and closes the
  current tool. Any tool can be opened again while focus continues. Opening,
  closing or switching tools never pauses or resets the timer.
- Time and audio settings are hidden until requested. Time edits stay in a draft
  until Save; applying them during a running session is disabled. Replacing a
  paused focus duration, resetting or skipping an active focus requires confirmation.
- Statistics display only today's minutes, completed sessions and Study Streak
  on the main surface. Charts, goals and habit analysis remain in the detail panel.

## Artwork and accessibility

`FocusRoom` draws a native SVG room with an arched window, twilight landscape,
wooden desk, lamp, books, greenery and soft lighting. It reuses `PetArt` and its
existing evolution assets without changing species or colors. A small writing
motion and pet interaction accompany study; breaks use a relaxed pose and a
closed book. Walking pets leave an empty place at the desk.

The room is memoized independently of countdown ticks. Animations use transforms
with native drivers and stop with reduced motion. All controls use Ionicons and
text labels rather than emoji. Desktop Escape closes the panel even from a text
input, then returns focus to its trigger. Mobile sheets use modal accessibility.

The web phone-preview wrapper is shared by all screens, including Focus Space.
Its preview dimensions also govern tool layout, keeping tools inside the phone.

## Tools and data

- Read: existing device speech, for typed text or notes.
  Speech stops when leaving this screen/account; closing its panel can keep playback.
- Notes and session goal: existing per-user AsyncStorage keys; content remains
  available when a panel closes and after reload. Storage failures are visible.
- Statistics: existing authenticated statistics endpoints.

## Verification — 2026-10-23

- TypeScript passed.
- 24 focused frontend tests passed: timer, tools/panels, notes, summary, speech,
  settings confirmation, statistics, coaching, API client and date/time helpers.
- 12 backend regression tests passed: sessions, statistics, timezone/DST, streaks,
  user isolation, AI Engine integration and additive migration.
- Full frontend suite: 47 passed, 4 existing auth/onboarding/Pet tests failed.
  These are the same earlier failures for the login-success alert, adoption text
  and old pet-space buttons; they are outside this UI refactor.
- Actual Chrome checks passed at 1440×1000, 390×844 and 320×780: no horizontal
  overflow and no JavaScript exceptions. Checks exercise real text entry, panel
  switching, summary/tutor rendering, notes persistence, Escape, reduced motion,
  resize and reload during an active timer. Browser-only fixtures supply sample
  account/statistics/AI responses; they do not modify the local database or call
  a paid provider. These are mobile browser checks, not physical-device audio tests.

Current app preview: [Phone frame](focus-space-previews/phone-preview-focus.png),
[phone tool sheet](focus-space-previews/phone-preview-tool-sheet.png),
[mobile](focus-space-previews/mobile-focus.png),
[mobile tool](focus-space-previews/mobile-tool-sheet.png),
[320px](focus-space-previews/narrow-focus.png).
Machine-readable browser results: [browser-checks.json](focus-space-previews/browser-checks.json).

To repeat the browser checks, run the local app on 8081, launch Chrome headless
with a separate profile and DevTools on port 9223, then run from the repository root:

```powershell
node mobile/scripts/check-focus-space.mjs
```

The script writes previews under `docs/focus-space-previews/` and closes its own
test pages. It requires Node's built-in WebSocket support and installs no package.
