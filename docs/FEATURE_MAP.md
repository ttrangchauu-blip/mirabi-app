# Feature map and recommended implementation phases

## Included in this starter
| Area | Starter behavior | Next step |
|---|---|---|
| Home | User level, coins, XP, daily quests, quick navigation | Real quest completion and streak rules |
| Study | Pomodoro timer, session persistence, XP award | Background timer behavior, planner, notes, flashcards |
| Campus | Seeded course catalog | Course/module/lesson tables, progress, quizzes |
| Career | Career list and interest-based ranking | Validated assessment, Big Five/Holland with consent |
| Community | Read/create/like posts | Comments, groups, reporting, moderation, image upload |
| Companion | Theme field and placeholder mascot | Asset pipeline, evolution states, interaction animations |
| Room | Inventory list placeholder | User inventory, purchase/equip transactions |
| Auth | Email/password (Argon2id), short-lived JWT + rotating refresh tokens, logout, password reset by email code, rate limiting, SecureStore session restore | Email verification, deep-link reset, shared (Redis) rate limiting, Alembic migrations |

## Suggested production data model
- users, profiles, refresh_tokens
- study_sessions, daily_goals, quest_definitions, quest_progress, streaks
- courses, lessons, lesson_progress, quiz_attempts
- career_profiles, assessment_questions, assessment_answers, career_recommendations
- community_posts, comments, reactions, groups, memberships, reports, moderation_actions
- pets, pet_states, inventory_items, user_inventory, room_layouts

## Architecture
Mobile app -> FastAPI REST API -> SQL database

## Backend API modules
Each feature router lives in its own `backend/app` module and is registered in `backend/app/main.py`:

| Module | API area |
|---|---|
| `auth.py` | Registration, login, token refresh, logout, password reset |
| `dashboard.py` | Aggregated home screen data |
| `study.py` | Study session history and creation |
| `campus.py` | Course catalog and lesson exploration |
| `career.py` | Recommendations and interest quiz |
| `community.py` | Posts and likes |
| `profile.py` | Profile, pet adoption, onboarding |
| `companion.py` | Pet room, daily quests, walks and collection |
| `tasks.py` | Personal scheduled tasks and calendar occurrences |
| `friends.py` | Study Together: social profile and privacy, search, friend requests, blocks, reports (+ admin queue) |
| `study_rooms.py` | Study Together: rooms, invitations, server-driven group session, summaries, history, background sweep |
| `team_quests.py` | Study Together: cooperative room quests from fixed templates |
| `notifications.py` | In-app notifications (read/unread) |
| `realtime.py` | WebSocket hub with ticket auth and post-commit event delivery |
| `study_together.py` | Aggregated Study Together home screen data |
| `learning.py` | English & Math learning games: catalog, sessions (state machine, idempotent events), progress, review list, stage rewards |
| `learning_engine.py` | Pure game rules: answer checking, deterministic Math generation, scoring, mastery |
| `learning_content.py` | Built-in lessons and the versioned content seeder |

Existing `/api/...` paths are retained so current mobile clients remain compatible.
