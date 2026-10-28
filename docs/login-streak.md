# Login streak popup

The backend owns the login streak. The app only displays what the login or check-in response says.

## Rules

- A day is a calendar day in `LOGIN_STREAK_TIMEZONE` (default `Asia/Ho_Chi_Minh`).
- A day is counted when the user signs in (`POST /api/auth/login`) or opens the app with a
  saved session (`POST /api/streak/check-in`). The app checks in after restoring the session and
  every time it comes back to the foreground. Token refresh and other requests never count.
- The first login or app open of a day stores one `login_streak_days` row (unique per user and
  date). If yesterday has a row, the streak goes up by 1; otherwise it starts again at 1.
- Later logins or app opens the same day (after logout, on another device, or at the same time)
  find the existing row: no new streak, no EXP and no popup.
- `longest_streak` is the highest streak ever recorded, so it only changes when the current
  streak goes past it.
- If the streak can't be recorded, login still succeeds and `login_streak` is `null`.

## Popup and retries

`should_show_popup` is `true` only for the request that recorded the day. The app sends
an `Idempotency-Key` header (8–64 characters, `A-Z a-z 0-9 _ -`) with each login or check-in attempt and
keeps it only while the outcome is unknown (network error or timeout). If the response was lost,
the retry has the same key and gets the same answer, popup included. Any other request that
day gets `false`. A malformed key is ignored and doesn't block login.

If a check-in fails, the app opens normally without a popup. The app keeps the popup in memory from that one response and clears it when the popup is
closed or the user signs out. Closing it sends nothing to the backend. If `login_streak` is
missing or its numbers aren't valid, no popup is shown.

## Response

`POST /api/auth/login` → `login_streak`, and `POST /api/streak/check-in` (signed in) → body:

```json
{
  "current_streak": 4,
  "longest_streak": 9,
  "last_login_date": "2026-10-23",
  "should_show_popup": true,
  "daily_exp_awarded": 5,
  "milestone_exp_awarded": 0,
  "already_claimed": false
}
```

`GET /api/streak` returns the same `current_streak`, `longest_streak` and `last_login_date`
plus the 7-day calendar and milestones shown on the journey screen.
