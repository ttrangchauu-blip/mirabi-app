# Mirabi — Mobile App Full-stack Starter

> Formerly "Refmi". Only user-facing names changed; internal identifiers (`refmi.db`, the `refmi.session.v1` storage key, JWT issuer/audience `refmi-api`/`refmi-mobile`, package and folder names) are unchanged so existing sessions and data keep working.

A runnable MVP scaffold inspired by the provided reference image. It includes:
- Mobile app: Expo (SDK 53) + React Native + TypeScript
- Backend API: FastAPI + SQLAlchemy + SQLite
- Email/password authentication: Argon2id hashing, short-lived JWT access tokens, rotating refresh tokens, logout, password reset
- Study timer session tracking
- Campus course catalog
- Career recommendations / mini interest quiz
- Community posts and reactions
- Avatar customization, room inventory, daily quests
- Private pet memory album with automatic milestones, manual captures, filters, favorites, download and privacy-safe sharing
- Optional AI features executed by the separate AI Engine process
- English & Math learning games (vocabulary, grammar, arithmetic, missing numbers, comparison, order of operations)
  with server-side scoring, progress, review list and EXP — see [docs/LEARNING_GAMES.md](docs/LEARNING_GAMES.md)

> This is a functional starter, not a production-ready clone of every visual detail in the reference. Icons, illustrations and art assets (the pets are built-in vector art) can be replaced separately — see [Pet artwork and animation](#pet-artwork-and-animation).

## Requirements
- Node.js 20+ (tested with 24) and npm
- Python 3.11+ (tested with 3.13)
- Expo Go on a phone, or iOS Simulator / Android Emulator

## 1. Start the backend

The backend is **Python** — install it with `pip`, never `npm`.

Windows (PowerShell):
```powershell
cd backend
py -3.13 -m venv .venv                   # any Python 3.11–3.13
.venv\Scripts\Activate.ps1
pip install -r requirements.txt          # use requirements-dev.txt to also run tests
copy .env.example .env                   # then set JWT_SECRET (see below)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8011
```

macOS/Linux:
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8011
```

Check it: http://localhost:8011/health → `{"status":"healthy"}`. API docs: http://localhost:8011/docs
(disabled when `ENVIRONMENT=production`). For local password-reset testing set `EMAIL_BACKEND=console`: the
reset code is printed in this terminal.

### Database initialization and migrations
There is no separate init step: on startup the API creates missing tables and runs
[`app/migrations.py`](backend/app/migrations.py), which **adds** any columns introduced since the first
release (`users.status`, `users.token_version`, `users.updated_at`) and the new `refresh_tokens` and
`password_reset_tokens` tables. It never drops tables or deletes data, so an existing `refmi.db` keeps
its users. Users created by the first release (bcrypt hashes) can still sign in; their hash is upgraded to
Argon2id on their next successful login.

Before moving to PostgreSQL, replace this with Alembic migrations.

## 2. Start the mobile app

Keep the backend running and open a **second** terminal:

```bash
cd mobile
npm install
npm run web       # opens the app in your browser at http://localhost:8081
# or: npm run start   (then scan the QR code / press "a" for an Android emulator)
```

No `.env` is needed for local development: the app automatically calls the API on the computer that runs
Metro (`http://<that computer's IP>:8011`), which works for the browser, emulators and a phone on the same Wi‑Fi.

### API base URL
Set `EXPO_PUBLIC_API_URL` in `mobile/.env` (copy `.env.example`) only when you need something else, then restart
Expo with `npm run start -- --clear`:
- the backend runs on another machine, or you use `expo start --tunnel`: `http://<backend host>:8011`
- release / production builds: required, and must be `https://…` (the app refuses plain HTTP outside development)

For a phone, start uvicorn with `--host 0.0.0.0` (as above) and allow Python through Windows Firewall when prompted.

### Troubleshooting
| Symptom | Fix |
|---|---|
| `npm install` in `backend/` fails with `ENOENT … backend\package.json` | The backend is Python, not Node: use `pip install -r requirements.txt` inside the activated venv. `npm` commands belong in `mobile/`. |
| PowerShell: `Activate.ps1 cannot be loaded because running scripts is disabled` | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or skip activation and run `.venv\Scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8011`. |
| `uvicorn` / `pip` "not recognized" | The venv isn't active. Activate it, or call `.venv\Scripts\python -m …` directly. |
| Expo Go: "Project is incompatible with this version of Expo Go" | Expo Go from the app store only runs the newest Expo SDK; this project uses SDK 53. Use `npm run web`, or an Android emulator (`npm run android` installs a matching Expo Go), or upgrade the project's SDK. |
| App says "Không thể kết nối tới máy chủ" | The backend isn't running or isn't reachable: check http://localhost:8011/health on the computer and `http://<computer IP>:8011/health` in the phone's browser (same Wi‑Fi, firewall allowed). |
| `Address already in use` on 8011 / 8081 | Another backend/Metro is still running; close it or choose another port. |

## 3. Try registration and login
1. Open the app → **Chưa có tài khoản? Đăng ký ngay** → enter an email and a password with at least
   8 characters including a letter and a digit → **Tạo tài khoản ✨**. You land on Home.
2. **More → Đăng xuất** → confirm. You return to the login screen and the server revokes the session.
3. Log in with the same credentials → **Bắt đầu hành trình ✨**.
4. Close and reopen the app: the session is restored without logging in again.

Or with curl — see [docs/API_EXAMPLES.md](docs/API_EXAMPLES.md).

## 4. Run tests and checks

```bash
# Backend (54+ tests: registration, login, tokens, refresh rotation/replay, logout, reset, rate limits, migrations)
cd backend
pip install -r requirements-dev.txt
python -m pytest -q

# Mobile (Jest + React Native Testing Library) and TypeScript
cd mobile
npm test
npm run typecheck
```

## Authentication overview

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | – | `{email, password, display_name?}` → `201` + session. `409 email_taken` if the email exists. |
| `POST /api/auth/login` | – | `{email, password}` → session. `401 invalid_credentials` for a wrong password **or** unknown email (identical response). |
| `POST /api/auth/refresh` | – | `{refresh_token}` → new session; the old refresh token is revoked (rotation). |
| `POST /api/auth/logout` | – | `{refresh_token}` → `204`; revokes that device's session. Idempotent. |
| `GET /api/auth/me` | Bearer | Current user's public profile. `401` if the token is missing, invalid or expired. |
| `POST /api/auth/password/forgot` | – | `{email}` → `202` with the same message whether or not the account exists. `503 email_not_configured` if email delivery isn't set up. |
| `POST /api/auth/password/reset` | – | `{token, new_password}` → `200`. Ends all sessions for the user. `400 invalid_reset_token`. |

A session response is `{access_token, refresh_token, token_type: "bearer", expires_in, user}`.
Errors are `{"detail": "<message>", "code": "<machine code>"}`; validation errors (`422`) add
`"errors": [{field, message, type}]` and never echo submitted values.

**How it works**
- Passwords are hashed with **Argon2id** (`argon2-cffi`). Plaintext passwords are never stored or logged.
- Emails are normalized (trimmed, lower-cased) before storage and lookup; `users.email` is unique.
- **Access tokens**: HS256 JWTs, 15 min by default, with `sub`, `exp`, `iat`, `iss`, `aud`, `type` and a
  `ver` claim checked against `users.token_version` (so a password reset kills outstanding access tokens).
- **Refresh tokens**: random 384‑bit opaque strings, 30 days by default. Only their SHA‑256 is stored.
  Each refresh rotates the token; presenting an already-rotated token is treated as theft and revokes the
  whole session family on that device.
- **Brute-force protection**: sliding-window rate limits per account and per IP on login, plus limits on
  register, refresh and password reset (`429` with `Retry-After`). Unknown emails still pay the hashing cost,
  so timing doesn't reveal which accounts exist.
- **Mobile storage**: tokens live in **Expo SecureStore** (iOS Keychain / Android Keystore,
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). The old AsyncStorage token from the first release is deleted on
  startup. The API client refreshes once on a `401` (shared between concurrent requests), and if refresh
  fails it clears the session and returns to login with "Phiên đăng nhập đã hết hạn". Being offline does
  **not** log the user out.

### Configuring secure token handling
In `backend/.env`:
- `JWT_SECRET` — generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. With
  `ENVIRONMENT=production` the server refuses to start if it is the default/placeholder or shorter than 32 chars.
  Rotating it signs everyone out of their access tokens (refresh tokens are unaffected).
- `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `JWT_ISSUER`, `JWT_AUDIENCE`.
- `RATE_LIMIT_*` — `"<requests>/<seconds>"`.

### Configuring email delivery for password recovery
Password reset is fully implemented server-side and in the app (**Quên mật khẩu?** → enter email → **Tôi đã
có mã** → paste the code + new password), but it needs a way to deliver the code:

| `EMAIL_BACKEND` | Behaviour |
|---|---|
| `disabled` (default) | `/password/forgot` returns `503 email_not_configured`; the app says the feature isn't available. Nothing pretends an email was sent. |
| `console` | Development only. The email (including the code) is printed to the server log. Rejected when `ENVIRONMENT=production`. |
| `smtp` | Sends via `SMTP_HOST`/`SMTP_PORT` with STARTTLS (`SMTP_STARTTLS=true`) and optional `SMTP_USERNAME`/`SMTP_PASSWORD`. Works with any SMTP provider (SES, SendGrid, Mailgun, Postmark, Gmail app passwords, …). |

Set `EMAIL_FROM` to a sender your provider has verified. Optionally set `PASSWORD_RESET_URL` to a web page or
deep link that receives `?token=…`; the app doesn't register a deep link yet, so the email always includes
the code for pasting. Codes expire after `PASSWORD_RESET_MINUTES` (30) and are single-use; requesting a new
code invalidates older ones.

## First sign-in: pet adoption and welcome tour
1. **Register** creates the account only (`201` with the public profile, no tokens). The app returns to the
   login screen with email and password pre-filled (kept in memory only, never stored).
2. **First login**: while `user.pet_name` is `null` the app shows the pet picker. The user chooses one of six pets
   — one per element: Water (Sóng, dolphin), Fire (Hỏa, fox), Grass (Mầm, turtle), Ice (Tuyết, penguin chick),
   Electric (Tia, bunny), Mist (Mây, cat); elements live in [`mobile/src/elements.ts`](mobile/src/elements.ts) —
   and names it (1–30 characters) on the same screen. Saving calls `PUT /api/pet {"pet": "...", "name": "..."}`.
3. **Welcome tour**: while `user.onboarded` is `false` the app shows a 6-step welcome + feature tour
   (Home, Study, Campus, Career, Community). Finishing or skipping calls `POST /api/onboarding/complete`.

Users created before this flow existed see the picker and tour on their next sign-in. The pet list lives in
[`mobile/src/pets.ts`](mobile/src/pets.ts) and must match `PetId` in [`backend/app/schemas.py`](backend/app/schemas.py).

## App layout
- Main menu (bottom tab bar): Trang chủ, Học tập (subjects: English and Math games, Học tự chọn = Pomodoro), Phòng cá nhân
  (the pet's room, see [docs/personal-room.md](docs/personal-room.md); it replaced Nghề nghiệp, whose screen and API are kept),
  Bạn bè (friends, requests, friend code/QR and visits; formerly Cộng đồng, see
  [docs/friend-visits.md](docs/friend-visits.md)), Tiện ích (includes Bảng tin, the post feed).
  Screens live in [`mobile/src/screens/main/`](mobile/src/screens/main/); shared UI pieces in [`mobile/src/ui/kit.tsx`](mobile/src/ui/kit.tsx).
- Designed for iPhone 15 Pro Max (430×932 pt). On a desktop browser the web build renders inside an iPhone 15 Pro Max
  frame (Dynamic Island, status bar, home indicator, 59/34 pt safe areas); on devices the real safe areas are used.

## Brand: logo and font
- Logo files live in `mobile/assets/`: `logo.png` (full logo, login screen only), `logo-mark.png` (mascot only, spare), `icon.png` (app icon), `adaptive-icon.png` (Android, background `#EEF6FD`), `favicon.png` (web).
- All UI text uses **Nunito** (`@expo-google-fonts/nunito`), loaded in `App.tsx` before the first render. Import
  `Text`/`TextInput` from [`src/components/Typography.tsx`](mobile/src/components/Typography.tsx) instead of
  `react-native`: it maps `fontWeight` to the matching Nunito file (400–900), which Android needs for custom fonts.

## Pet artwork and animation
Each pet is vector art in [`mobile/src/petArt.ts`](mobile/src/petArt.ts), drawn as separate layers so parts move
independently: tails wag, ears twitch, flippers paddle, eyes blink and the body breathes
([`PetArt`](mobile/src/components/PetArt.tsx)). On top of that [`PetCompanion`](mobile/src/components/PetCompanion.tsx)
adds a per-pet idle motion (float, sway, hop, waddle, swim, stroll) and a jump when tapped. All motion stops when
the OS "reduce motion" setting is on.

To use designer artwork instead, pass a bitmap: `<PetCompanion pet="fox" source={require('../../assets/aqua.png')} />`.

## Environment
Backend `.env` (full list with comments in [backend/.env.example](backend/.env.example)):
- `ENVIRONMENT`: `development` | `production` (production enables strict checks, HTTPS redirect + HSTS, hides `/docs`)
- `JWT_SECRET`: required, see above
- `DATABASE_URL`: defaults to SQLite
- `CORS_ORIGINS`: only needed for the Expo web build; `*` is rejected in production
- `EMAIL_BACKEND` / `SMTP_*`: password reset delivery
- `AI_SERVICE_URL` / `BACKEND_AI_SERVICE_TOKEN`: private AI Engine address and shared service credential
- `OPENAI_MODEL`: default model registered by the business backend; provider credentials are configured only in `ai_engine/.env`

### Run the separate AI Engine

The business backend and AI Engine run as separate processes. Copy `ai_engine/.env.example` to `ai_engine/.env`, set a random
`AI_SERVICE_TOKEN` equal to backend `BACKEND_AI_SERVICE_TOKEN`, and put `OPENAI_API_KEY` only in `ai_engine/.env`.
Both processes use the existing database; only the business backend applies migrations.

From the repository root, start these in separate terminals:

```powershell
# Terminal 1: business API
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8011

# Terminal 2: AI Engine
cd ..
backend\.venv\Scripts\python.exe -m uvicorn ai_engine.app:app --reload --host 127.0.0.1 --port 8002 --env-file ai_engine\.env
```

Keep port 8002 private. The mobile app continues to call only the backend on port 8011.

Mobile `.env`:
- `EXPO_PUBLIC_API_URL`: backend base URL. Everything prefixed `EXPO_PUBLIC_` is bundled into the app and
  public — never put secrets there.

`.env` files and `*.db` are git-ignored.

## Main API routes
- Auth: see the table above
- `GET /api/dashboard`
- `POST /api/study/sessions`, `GET /api/study/sessions`
- `GET /api/campus/courses`
- `GET /api/career/recommendations`, `POST /api/career/quiz`
- `GET /api/community/posts`, `POST /api/community/posts`, `POST /api/community/posts/{id}/like`
- `GET /api/profile`, `PATCH /api/profile`
- `GET /api/room/items`, `POST /api/room/equip`
- Personal pet room: `GET/PUT /api/personal-room`, `POST /api/personal-room/photo/preview`, `POST /api/personal-room/photo`,
  `GET /api/personal-room/visit/{user_id}`, `POST /api/personal-room/visit/{user_id}/greetings`,
  `POST /api/personal-room/visit/{user_id}/study-invite`. See [docs/personal-room.md](docs/personal-room.md) and
  [docs/friend-visits.md](docs/friend-visits.md) (friends, friend code/QR, visits, greetings, cheers, study invites).
- Memory album: `GET/POST /api/memories`, `GET/PATCH/DELETE /api/memories/{id}`,
  `GET /api/memories/pending`, `POST /api/memories/{id}/acknowledge`
- `POST /api/ai/reflection`
- Learning games: `/api/learning/catalog`, `/api/learning/lessons/{id}`, `/api/learning/sessions` (+ `/current`,
  `/{id}/answer|hint|reveal|miss|next|pause|resume|extend|complete|abandon|result`), `/api/learning/review`,
  `/api/learning/progress`. See [docs/LEARNING_GAMES.md](docs/LEARNING_GAMES.md).
- Study Together: `/api/study-together/home`, `/api/friends`, `/api/friend-requests`, `/api/users/search`,
  `/api/study-rooms`, `/api/room-invitations`, `/api/group-sessions`, `/api/team-quests`, `/api/notifications`,
  `/api/realtime/ticket` + `WS /api/realtime/ws`. See [docs/STUDY_TOGETHER.md](docs/STUDY_TOGETHER.md).

## English & Math in personal study
**Học tập** opens the subject screen: *Tiếng Anh*, *Toán* or *Học tự chọn* (the focus timer, sounds and study tools).
English offers two vocabulary directions (*Bắn từ tiếng Anh*, Anh → Việt; *Bắn thiên thạch*, Việt → Anh) and two
grammar games (*Chọn đáp án ngữ pháp* and *Sắp xếp câu*). Tap a game to play immediately (every game plays in *Học
tập*; the separate *Thử thách* mode was merged into it); the backend automatically selects content at the learner's
current level and mixes new, review and mastered items. Math keeps its setup for grade, topic and duration. The first
time a game is opened, its own 3-page guide (*Cách chơi*: goal, controls, how the stage ends) comes first; it is saved
per account and game, and can be read again from the game list or the pause menu. Every start, replay or continue goes
through a 3-2-1 *Bắt đầu!* countdown before the clock runs. Words, sentences and Math problems are drawn at random
for every session. An unfinished session is offered as *Tiếp tục phiên học*. The backend
checks every answer and owns score, hearts, progress, the review list (*Cần ôn*) and EXP (10 per valid stage, once per
subject per local day, within the 60 EXP/day task pool). Lessons are seeded automatically at startup
(`python -m app.learning_content` reseeds on demand). Rules, data model, API and error codes:
[docs/LEARNING_GAMES.md](docs/LEARNING_GAMES.md).

## Study Together (học cùng bạn bè)
**Học tập → Học cùng bạn bè** (or the *Học cùng bạn* tile on Home): add friends by name or public code, create a
private or code-joinable room, study on one server-driven Pomodoro with everyone's pet at a shared desk, and get a
summary whose minutes and EXP are computed by the backend. Group minutes share the personal study EXP cap; a small
"learning together" bonus and team quest rewards have their own daily caps. Realtime updates use a WebSocket with
single-use tickets and fall back to 15-second polling. Rules, data model, API, realtime protocol, settings and
limitations: [docs/STUDY_TOGETHER.md](docs/STUDY_TOGETHER.md).

## Known limitations
- **Rate limits are in-process memory.** With several uvicorn workers or instances each keeps its own
  counters, and they reset on restart. In production, enforce equivalent limits at the gateway/reverse proxy or
  move the limiter to Redis.
- **Registration reveals whether an email is registered** (`409`). This is rate limited; removing it requires an
  email-verification sign-up flow.
- **No email verification** yet; accounts are active immediately.
- **Logout revokes the refresh token**; the current access token stays valid until it expires (≤ 15 min).
  A password reset invalidates all access tokens immediately.
- **No onboarding flow exists in the app**, so new users go straight to Home after registering.
- **Web build**: SecureStore isn't available on web, so tokens are kept in memory only and the session is not
  restored after a page reload.
- The schema upgrader is additive only; use Alembic for anything more complex.

## Production checklist
- Set `ENVIRONMENT=production`, a strong `JWT_SECRET`, explicit `CORS_ORIGINS`, and `EMAIL_BACKEND=smtp`.
- Terminate TLS in front of the API and run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy IP>` so
  HTTPS detection, the HTTPS redirect and per-IP rate limits see the real scheme and client address.
- Build the app with an `https://` `EXPO_PUBLIC_API_URL`.
- Replace SQLite with PostgreSQL; configure migrations (Alembic).
- Move rate limiting to a shared store or the gateway; add audit logging of auth events.
- Store secrets in a secret manager.
- Add email verification, moderation/report/block flows and privacy controls for community.
- Add push notifications, analytics consent, backups.
- For minors, design age-appropriate community safeguards and data retention.
