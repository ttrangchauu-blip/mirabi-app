# Mirabi Study Space

## Architecture

```mermaid
flowchart LR
  Mobile[Expo Study Space] -->|JWT: tutor request| API[Mirabi FastAPI]
  Mobile -->|local user-scoped timer, notes, goal| Store[AsyncStorage]
  Mobile -->|local audio| Audio[expo-audio]
  Mobile -->|local completion notice| OS[Expo Notifications]
  API -->|service token, minimal supplied text| Engine[AI Engine]
  Engine -->|configured provider/model| Provider[AI provider]
  API -->|study completion, idempotency key| DB[(Existing SQL database)]
  API -->|authorized pet state| DB
```

The Study Space reuses the existing Expo app, FastAPI authentication, AI Engine and SQL database. It creates no separate database and does not copy Pet, task, or progress records into AI storage. The AI tutor receives only the text the learner submits. Its registered feature, prompt, model, run and usage records use the existing AI platform tables and admin controls.

## Pomodoro state and data

Timer preferences and the active deadline are stored on the device in AsyncStorage under a key scoped to the authenticated user ID. A wall-clock deadline is persisted, so the display is recalculated after tab changes, app suspension, reload, or relaunch. The OS receives one scheduled local notification for the current phase when permission is granted. Web builds use the same timestamp recovery; browser notifications depend on browser support and permission.

Completed focus cycles are posted to `POST /api/study/pomodoro/{completion_key}?duration_seconds=1500`. `completion_key` is an opaque, per-cycle alphanumeric idempotency key. The backend associates it with the authenticated user, records it in the existing `study_sessions` table, and applies the current study XP daily cap exactly once. A unique `(user_id, pomodoro_cycle)` index prevents duplicate recording. The endpoint does not accept Pet/EXP values and cannot change Pet evolution directly.

`study_sessions.pomodoro_cycle` is nullable so existing records and the legacy session API remain compatible. The migration is additive and idempotent; the current project migration runner supports forward upgrades but does not provide a general SQL downgrade engine. Rollback by reverting the application release; retain the nullable column/index during rollback so completed study data remains intact. Back up the existing database before production schema upgrades using the deployment's normal database snapshot process.

## Study API contract

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/study/pomodoro/{completion_key}?duration_seconds={seconds}` | Idempotently record a completed focus cycle under the caller's account and existing study reward rules. |
| `POST` | `/api/ai/study/tutor` with `{ "text": "..." }` | Send up to 5,000 characters to the registered `study_tutor` AI feature; returns `{ answer, provider, run_id }`. |

Both endpoints require a Mirabi access token. The tutor does not read raw SQL, mutate business data, or execute tools. It returns a safe provider unavailable response when the AI Engine/provider is down; study timer and notes remain available.

## Audio and speech

`mobile/assets/audio/*.wav` are bundled, original procedurally generated 12-second ambience loops. They have no third-party recording or external network dependency. The rain, forest, stream, cafe, lo-fi and white-noise labels describe synthesized textures, not field recordings. `expo-audio` loops the selected local asset and applies a device volume control. `expo-speech` reads the generated tutor response using the device's Vietnamese TTS voice where available. Background audio behavior follows iOS/Android OS settings and user permissions.

After changing Expo native modules, rebuild a custom native client as required by the deployment workflow. Expo Go includes the SDK-compatible modules for local preview.

## Operations

- Keep `AI_SERVICE_TOKEN` and model-provider credentials in the backend/AI Engine environment or secret manager. Do not add them to the mobile environment.
- Configure/register `study_tutor` in the AI admin console; the backend seeds its agent and initial prompt on startup. Disable the feature or provider in admin to stop AI requests without affecting the timer.
- Run the existing FastAPI migration/startup path before serving the updated app. Schema changes are additive.
- Deploy the backend and AI Engine using their existing release process. Roll back application artifacts through the normal release process; the additive nullable database column is backward compatible.

## Verification

From `mobile/`, run `npm run typecheck` and `npm test`.

From `backend/`, set `PYTHONPATH=..` and run `python -m pytest`. `tests/test_study_pomodoro.py` covers idempotency, per-user isolation, invalid completion keys and the authenticated tutor contract.
