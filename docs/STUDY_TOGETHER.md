# Study Together (Học cùng bạn bè)

Friends, shared study rooms with one server-driven Pomodoro, cooperative team quests and in-app notifications. It runs
next to personal study: the **Học tập** tab has a *Học cá nhân / Học cùng bạn bè* switch and Home has a *Học cùng bạn*
shortcut. No existing tab, route, table or login flow changed.

The backend owns every number that matters (time, cycles, EXP, quest progress). The app only displays snapshots.

## Architecture

```
Mobile (Expo)                                   Backend (FastAPI, one process)
 screens/together/*  ──REST /api/...──────────▶ friends.py  study_rooms.py  team_quests.py  notifications.py
 studyTogether/useStudyRoom ◀─WebSocket──────── realtime.py (ticket auth, hub, post-commit outbox)
 studyTogether/realtime (reconnect, ping)       study_rooms.sweep  ◀── lifespan ticker (STUDY_ROOM_TICK_SECONDS)
                                                       │ finalize_session (once)
                                                       ▼
                         study_sessions (+ progression.award_study_exp)  exp_events  pet_evolutions
```

Reused, not duplicated: `users` (identity, display name, avatar, pet and level), `study_sessions` + `award_study_exp`
(group minutes are study minutes), `exp_events` (idempotent EXP ledger with per-source daily caps), the auth
dependency, `APIError` codes, the in-memory rate limiter and the additive startup migration.

## Rules

**Rooms**
- `visibility=private`: invitation only (the code alone is refused with `room_invite_only`). `visibility=code`: anyone
  with the 8-character code (alphabet without 0/O/1/I, ~40 bits), and the host's friends see it on their home.
- A user is an active member of at most one room (partial unique index `uq_study_room_one_active_room`).
- Seats are claimed with `UPDATE study_rooms SET member_count = member_count + 1 WHERE member_count < max_members`, so
  concurrent joins can never overfill a room. Changes to one room are serialized (`locked_room`: process lock plus
  `SELECT … FOR UPDATE` on databases that support it).
- Host leaves → the longest-present member (online first) becomes host. Last member leaves → room closes and any
  running session is settled. Host silent for longer than the grace period while someone else is online → hand-over by
  the sweep. Every member silent for `STUDY_ROOM_IDLE_CLOSE_MINUTES` → room closes.
- Only the host starts, pauses, resumes, ends a session, edits settings, creates quests and closes the room. Timer
  settings (`focus_minutes`, `break_minutes`, `cycles`) are locked while a session runs.

**Session clock and valid time**
- Phases: `focus` → `break` → `focus` … for `cycles` cycles. Status: `active | paused | completed | cancelled`; a room
  with no session is *waiting*. The server advances phases from `phase_ends_at` on every read and from the ticker; the
  client never decides when a phase ends.
- A member is *present* from joining or their latest heartbeat (WebSocket `ping` every 25 s, or `POST …/heartbeat`)
  until they leave, or until `STUDY_ROOM_AWAY_GRACE_SECONDS` (600) after their last heartbeat. A locked screen or a
  short network loss therefore costs nothing; disappearing stops the credit where the grace ends, and coming back
  resumes it. Only focus time while present counts, never paused or break time.
- A cycle counts for a member who is present at the end of the focus phase **and** studied at least half of it.
- Displayed presence (`online` / `away`) is separate: away after 70 s without a heartbeat or when the socket closes.

**Results and EXP** (`finalize_session`, runs exactly once per session via a conditional `finalized_at` update)
- Each participant with ≥ 60 valid seconds gets a `study_sessions` row: `mode=pomodoro`, `pomodoro_cycle=room<id>`
  (unique per user), `status=completed` if they finished a cycle, otherwise `cancelled` (an early end still credits its
  minutes, exactly like personal Pomodoro). EXP then comes from the existing rule: 2 EXP per full 5 minutes,
  **sharing the 48 EXP/day study cap** with personal study. Many rooms or accounts can't create extra study EXP.
- "Learning together" bonus: 2 EXP per completed cycle, only when at least two participants completed a cycle, capped
  at `GROUP_DAILY_EXP_CAP` (10) per day.
- Team quest reward: once per quest, through the EXP ledger, capped at `TEAM_QUEST_DAILY_EXP_CAP` (30) per day.
- Group minutes appear in the personal statistics, streak and daily focus quest like any Pomodoro.

**Friends, blocking, reports, privacy**
- One `friendships` row per pair (`user_low_id < user_high_id`, unique). Sending a request to someone who already
  asked you accepts it, so two people asking at the same moment end up as one friendship.
- Duplicate request → `friend_request_exists`; already friends → `already_friends`; after a decline the requester
  waits `FRIEND_REQUEST_COOLDOWN_HOURS` (24) (`friend_request_cooldown`); the person who declined can ask any time.
- Blocking removes the friendship and pending invitations both ways. The blocked person sees the blocker as
  nonexistent (`user_not_found`, absent from search, `room_unavailable` on their rooms); the blocker gets
  `user_blocked`.
- Reports (`spam | harassment | inappropriate | impersonation | other`, optional text ≤ 500, optional room) go to an
  admin queue: `GET /api/admin/social/reports`, `POST /api/admin/social/reports/{id}/resolve`
  `{"action": "dismiss" | "disable_user"}`. Disabling also invalidates the user's tokens.
- Search and every view of another person return only: id, display name, avatar preset, pet, pet name, pet level and
  public code. Never email, role, personal goals or notes.
- Friend codes can be looked up exactly (`POST /api/users/lookup`, also from the friend QR code `MIRABI-FRIEND:<code>`).
  Unfriending, like blocking, cancels pending room invitations between the two; accepting an invitation checks the
  friendship again. Friends visit each other's pet room: see [friend-visits.md](friend-visits.md).
- Settings (`GET/PATCH /api/social/me`): `presence_visibility` (`friends | nobody`), `share_study_stats` (others see
  your minutes and quest contributions, or "Ẩn"), `discoverable` (name search; the exact code always works),
  `allow_room_visits` (friends may visit the pet room), `allow_study_invites` (friends may invite you into rooms; off →
  `skipped: invites_disabled`).
- The personal session goal in the active room stays on the device only (AsyncStorage).

**Room chat** (`room_chat.py`)
- Only active members read and send. Each member sees messages sent since they (last) joined, so someone who joins
  by code never reads the earlier conversation.
- People who blocked each other (either way) never see each other's messages or typing: hidden in the history and
  skipped by the realtime fan-out (`Hub.publish(..., skip=...)`).
- Plain text, 1–500 characters after trimming; line breaks allowed (runs of blank lines folded), other control
  characters refused. Rate limited per user (`RATE_LIMIT_ROOM_MESSAGE`). A retry with the same `client_id` returns the
  original message (`replayed: true`), so a flaky network never posts twice.
- The sender can unsend; the host can remove anyone's message. Both leave a "removed" marker (`body: null`,
  `removed_by: sender | host`). Reporting a message (`POST /api/users/{id}/report` with `message_id`) copies its text
  into the report, so the evidence outlives an unsend or the purge.
- Messages are deleted `STUDY_ROOM_MESSAGE_RETENTION_DAYS` (30) after they were sent, by the sweep.
- Not stored: typing indicators. Not implemented: read receipts, images/attachments, direct messages outside a room,
  automatic content filtering (moderation relies on host removal, block and report).

## Data model (new tables)

| Table | Purpose | Key constraints |
|---|---|---|
| `social_profiles` | public code, privacy settings, last activity | PK `user_id`, unique `public_code` |
| `friendships` | pending / accepted / declined pair | unique `(user_low_id, user_high_id)` |
| `user_blocks` | who blocked whom | unique `(blocker_id, blocked_id)` |
| `user_reports` | moderation queue | index `status` |
| `study_rooms` | settings, code, `member_count`, `version`, current/last session | unique `code`, unique `(host_id, idempotency_key)` |
| `study_room_members` | membership, role, presence, last heartbeat | unique `(room_id, user_id)`, partial unique `user_id WHERE status='active'` |
| `study_room_invitations` | invitation per room and invitee | unique `(room_id, invitee_id)` |
| `study_room_sessions` | phase machine, accrual cursor, `finalized_at` | index `room_id`, `status` |
| `study_room_participants` | per-member valid `focus_ms`, cycles, presence, rewards | unique `(session_id, user_id)` |
| `team_quests` / `team_quest_members` | goal, progress, status, contributions | unique `(quest_id, user_id)` |
| `team_quest_events` | idempotency ledger for progress | unique `(quest_id, source_ref)` |
| `social_notifications` | in-app inbox, `read_at` | index `(user_id, read_at)` |
| `room_visit_interactions` | greetings, cheers and study invites from pet room visits ([friend-visits.md](friend-visits.md)) | unique `(visitor_id, client_request_id)` |
| `study_room_messages` | room chat; `deleted_at`/`deleted_by_id` for unsend and host removal | unique `(room_id, sender_id, client_id)`, index `(room_id, id)` |

`user_reports` gained `message_id` and `message_body` (added by the startup upgrader).

Created by `upgrade_schema` at startup (additive, idempotent, never touches existing data). Rollback:
`app.migrations.downgrade_study_together_schema(engine)` drops only these tables; group minutes already written to
`study_sessions` and their EXP stay, like any study history. Notifications older than 90 days are purged by the sweep.

## API

All routes need `Authorization: Bearer <access token>` and answer errors as `{"detail", "code"}` (422 adds `errors`).
Full schemas: live Swagger at `/docs` (development) or [study-together-openapi.json](study-together-openapi.json)
(regenerate with `backend/scripts/export_study_together_openapi.py`).

| Method & path | Purpose | Notable errors |
|---|---|---|
| `GET /api/study-together/home` | everything for the Study Together home in one call | |
| `GET/PATCH /api/social/me` | my public code and privacy settings | |
| `GET /api/users/search?q=` | by display name (≥ 2 chars, wildcards literal) or exact public code, max 20 | `rate_limited` |
| `POST /api/users/lookup` `{public_code}` | exact friend code or QR text → short profile + `relationship` | `user_not_found`, `rate_limited` |
| `GET /api/friends` | friends with presence (`studying/online/offline/hidden`) and joinable room | |
| `DELETE /api/friends/{user_id}` | unfriend | `not_friends` |
| `POST /api/friend-requests` | `{user_id}` or `{public_code}` → 201, `auto_accepted` | `friend_request_exists`, `already_friends`, `friend_request_cooldown`, `user_blocked`, `user_not_found`, `cannot_friend_self` |
| `GET /api/friend-requests?direction=incoming\|outgoing` | pending requests | |
| `POST /api/friend-requests/{id}/accept`, `/decline`; `DELETE /api/friend-requests/{id}` | respond / withdraw | `not_request_recipient`, `friend_request_not_pending` |
| `POST/DELETE /api/users/{id}/block`, `GET /api/blocks` | block list | |
| `POST /api/users/{id}/report` | `{reason, details?, room_id?, message_id?}` → 201 | `cannot_report_self`, `message_not_found` |
| `POST /api/study-rooms` | create (header `Idempotency-Key` replays the same room); `invitee_ids` optional | `already_in_another_room`, `pet_not_adopted` |
| `GET /api/study-rooms` | rooms I can enter: mine, invited, friends' code rooms | |
| `GET /api/study-rooms/current` | my room snapshot or `null` | |
| `POST /api/study-rooms/lookup` `{code}` | preview with `can_join` and `reason` (code in body, not URL) | `room_not_found`, `rate_limited` |
| `POST /api/study-rooms/join` `{code}`, `POST /api/study-rooms/{id}/join` | join by code / from invitation or friend's room | `room_full`, `room_closed`, `room_invite_only`, `room_unavailable`, `already_in_another_room` |
| `GET /api/study-rooms/{id}`, `GET …/preview` | snapshot (members only) / preview (invitees, friends) | `room_not_found` (also for no access) |
| `PATCH /api/study-rooms/{id}` | host edits | `not_room_host`, `session_in_progress`, `max_members_too_low` |
| `POST /api/study-rooms/{id}/start` · `pause` · `resume` · `end` · `close` | host controls; start/end/close are retry-safe | `no_active_session`, `session_not_running`, `session_not_paused` |
| `POST /api/study-rooms/{id}/leave` | leave (retry-safe) | |
| `POST /api/study-rooms/{id}/heartbeat` | presence + snapshot (polling fallback) | |
| `POST /api/study-rooms/{id}/invitations` `{user_ids}` | invite friends → `{invited, skipped}` | |
| `POST /api/study-rooms/{id}/reactions` `{reaction}` | `cheer|clap|star|fire|coffee|heart` → 202, not stored | `rate_limited` |
| `GET /api/study-rooms/{id}/messages?before_id&limit` | chat history, newest page first, items oldest → newest, `next_before_id` | `room_not_found` |
| `POST /api/study-rooms/{id}/messages` `{body, client_id?}` | send → 201 `{message, replayed}` | `room_closed`, `rate_limited` |
| `DELETE /api/study-rooms/{id}/messages/{message_id}` | unsend (sender) or remove (host); retry-safe | `not_message_owner`, `message_not_found` |
| `GET /api/room-invitations`, `GET …/{id}` (with `state`), `POST …/{id}/accept`, `…/decline` | my invitations | `invitation_expired` (410), `invitation_not_pending`, `room_closed` |
| `GET /api/group-sessions/history?limit&before_id` | my finished sessions, cursor pagination (`next_before_id`) | |
| `GET /api/group-sessions/{id}/summary` | server-computed result for a participant | `session_not_found` |
| `GET /api/team-quests/templates`, `GET /api/team-quests`, `GET /api/team-quests/{id}` | quests | `quest_not_found` |
| `POST /api/study-rooms/{id}/team-quests` `{template_key}` · `POST /api/team-quests/{id}/join` | host creates, members join | `quest_already_active`, `quest_not_active`, `not_room_member` |
| `GET /api/notifications?limit&before_id`, `POST …/{id}/read`, `POST …/read-all` | inbox with `unread_count` | |
| `POST /api/realtime/ticket` → `WS /api/realtime/ws?ticket=` | realtime (below) | |

Example: create, then a member's view of the running room.

```bash
curl -X POST http://localhost:8001/api/study-rooms -H "Authorization: Bearer $TOKEN" -H 'Idempotency-Key: 6f1c…' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ôn thi Hóa 12","goal":"Đề số 2","subject":"science","focus_minutes":25,"break_minutes":5,"cycles":4,"max_members":6,"visibility":"code","invitee_ids":[12]}'
# 201 {"room": {...snapshot...}, "invitations": {"invited": [12], "skipped": []}, "replayed": false}
```

```json
{"id": 7, "code": "H4HS7KVH", "name": "Ôn thi Hóa 12", "state": "focus", "host_id": 3, "version": 9,
 "members": [{"user_id": 3, "display_name": "Linh", "pet": "cat", "pet_level": 1, "role": "host", "presence": "online",
              "in_session": true, "focus_seconds": 540, "cycles_completed": 0}],
 "session": {"id": 2, "status": "active", "phase": "focus", "cycle": 1, "total_cycles": 4, "remaining_ms": 960000,
             "phase_seconds": 1500, "phase_ends_at": "2026-10-23T10:25:00Z"},
 "team_quests": [{"id": 1, "title": "Cùng nhau tập trung 300 phút", "progress": 1, "target": 300, "member_ids": [3]}],
 "last_session_id": 1, "server_time": "2026-10-23T10:09:00Z"}
```

## Realtime protocol

1. `POST /api/realtime/ticket` → `{ticket, path, expires_in: 60, heartbeat_seconds: 25}`. Single use, kept hashed in
   memory. Browsers can't set headers on a WebSocket and the ticket keeps the JWT out of URLs and logs. A ticket can
   appear in access logs, but it has already been redeemed by then.
2. Open `ws(s)://<api>/api/realtime/ws?ticket=…` → `{"type":"hello","user_id":…}`. A bad or reused ticket is refused.
3. Client → server: `{"type":"subscribe","room_id":n}` (active members of open rooms only, else
   `{"type":"error","code":"room_not_found"}`), `{"type":"unsubscribe","room_id":n}`, `{"type":"ping"}` (presence;
   answered with `pong`), `{"type":"typing","room_id":n}` (subscribed rooms only, relayed at most every 2 s).
4. Server → client: `room.snapshot` (after subscribe), `room.updated` with `event` (`member_joined`, `member_left`,
   `member_status_changed`, `host_changed`, `session_started`, `phase_changed`, `session_paused`, `session_resumed`,
   `session_completed`, `settings_changed`, `team_quest_created`, `team_quest_updated`, `room_closed`) and the full
   snapshot, `room.reaction`, `room.message` (`{message}`), `room.message_deleted` (`{message_id, removed_by}`),
   `room.typing` (`{user_id}`), `room.removed` (you left), `notification`. Chat events carry no `version`; the app
   merges messages by id and re-reads the latest page after a reconnect (and every 15 s while offline).
5. Events are queued on the DB session and sent only **after commit**. Every room event carries `version`; the app keeps
   the newest (`newerSnapshot`), so late or duplicate events are ignored.
6. App behaviour: reconnect with exponential backoff (1 s → 30 s) and a fresh ticket, re-subscribe, resync on returning
   to the foreground. After 3 failed attempts it shows "Mất kết nối" and polls `…/heartbeat` every 15 s until the socket
   is back (never faster). The countdown runs from `remaining_ms` on a monotonic clock, so changing the phone's time
   or timezone can't move it.

## Configuration (`backend/.env`, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `GROUP_DAILY_EXP_CAP` | 10 | daily cap of the learning-together bonus |
| `TEAM_QUEST_DAILY_EXP_CAP` | 30 | daily cap of team quest rewards |
| `STUDY_ROOM_TICK_SECONDS` | 2 | background sweep interval; 0 disables (rooms still advance on every read) |
| `STUDY_ROOM_PRESENCE_SECONDS` | 70 | no heartbeat for this long → shown as away |
| `STUDY_ROOM_AWAY_GRACE_SECONDS` | 600 | focus credit continues this long after the last heartbeat |
| `STUDY_ROOM_IDLE_CLOSE_MINUTES` | 120 | close rooms where nobody has been seen for this long |
| `ROOM_INVITATION_HOURS` | 24 | invitation lifetime |
| `FRIEND_REQUEST_COOLDOWN_HOURS` | 24 | wait after a declined request |
| `VISIT_INTERACTION_COOLDOWN_MINUTES` / `VISIT_INTERACTION_DAILY_LIMIT` / `VISIT_NOTIFICATION_GROUP_HOURS` | 10, 40, 12 | pet room visits ([friend-visits.md](friend-visits.md)) |
| `STUDY_ROOM_MESSAGE_RETENTION_DAYS` | 30 | room chat messages are deleted after this |
| `RATE_LIMIT_USER_SEARCH` / `_FRIEND_REQUEST` / `_ROOM_CODE` / `_ROOM_CODE_IP` / `_ROOM_CREATE` / `_ROOM_INVITE` / `_REPORT` / `_REACTION` / `_ROOM_MESSAGE` / `_REALTIME_TICKET` / `_VISIT_INTERACTION` / `_FRIEND_LOOKUP` | 30/60, 20/3600, 10/300, 60/300, 10/3600, 30/3600, 10/86400, 20/60, 15/60, 30/60, 20/600, 20/300 | `<requests>/<seconds>` |

The mobile app needs nothing new: the socket URL is derived from `EXPO_PUBLIC_API_URL` (`https` → `wss`).

## Mobile

- `src/studyTogether/`: `types.ts`, `api.ts` (typed REST), `realtime.ts` (socket client), `timer.ts` (countdown and
  snapshot ordering), `useStudyRoom.ts` (room state, fallback polling, foreground resync), `useRoomChat.ts` (chat
  history and paging, optimistic send with retry on the same `client_id`, typing, unread count kept per device, speech
  bubbles for the scene).
- `RoomChat` (Messenger-style chat over the room: grouped bubbles, time separators, typing dots, long-press to unsend,
  remove (host) or report; Enter sends on web) opens from the *Trò chuyện* card under the room, which shows the latest
  message and the unread count. New messages also pop up over the sender's pet in `StudyRoomScene`.
- `src/screens/together/`: `StudyTogetherScreen` (own screen stack, Android back, pull-to-refresh, toasts for pushed
  notifications), `TogetherHome`, `FriendsScreen` (friends, requests, search, block/report, privacy; shown in the "Bạn bè" menu tab, the Study Together
  home links to it),
  `CreateRoomScreen`, `JoinRoomScreen`, `RoomScreen` (waiting room and active room), `StudyRoomScene` (a room in the
  Focus Space style where every member's pet sits at one shared desk; a front row is added above four members;
  pets stay still with more than four members or with reduced motion). The room, shared timer, host controls and
  reactions share one surface, as in Focus Space, `SessionSummaryScreen`,
  `TeamQuestsScreen`, `NotificationsScreen`.
- Integration: `MainApp` renders Study Together when the Study tab is in group mode; `StudyTab` shows the mode switch;
  `HomeTab` gained the *Học cùng bạn* tile. Error codes map to Vietnamese in `src/auth/messages.ts`.

## Running and testing

```bash
cd backend && .venv\Scripts\python -m pytest -q          # all backend tests
.venv\Scripts\python -m pytest -q tests/test_friends.py tests/test_study_rooms.py tests/test_room_sessions.py \
  tests/test_realtime.py tests/test_team_quests.py tests/test_study_together_e2e.py tests/test_migrations.py tests/test_room_chat.py
cd mobile && npm test && npm run typecheck
```

Study Together tests use a controllable clock (`clock` fixture → `app.clock.now`) instead of waiting, and
`STUDY_ROOM_TICK_SECONDS=0` with explicit `study_rooms.sweep(...)` calls.

Regenerate the OpenAPI subset after API changes (from `backend/`):
`.venv\Scripts\python scripts/export_study_together_openapi.py`.

## Status

| | |
|---|---|
| Implemented and tested | friends, requests (incl. simultaneous mutual), search, block, report + admin resolve, privacy settings; rooms, codes, invitations, one-room rule, concurrent join limit, host hand-over, idle close; server timer, pause/resume, early end, valid-time accrual with disconnect grace, cycle rule; EXP via existing study cap + bonus cap, exactly-once settlement; team quests; in-app notifications; realtime (ticket, membership check, ordered updates, presence, reactions, revocation, reconnect restore); migrations up/down; mobile flows (home, create, join, waiting/active room, realtime ordering, offline polling, summary, friend search, navigation) |
| Implemented, verified manually only | full 2.5D scene layout and all screens at 390 pt and 360 pt in a browser against a real backend; live two-client WebSocket session over the network |
| Implemented and tested (room chat) | send/history/paging, join-time visibility, block filtering live and in history, typing relay, unsend and host removal, message reports, idempotent retry, rate limit, retention purge; mobile chat flow (history, optimistic send, live messages, typing, unsend, failed send retry) |
| Not implemented | push notifications to devices (no device-token registry or APNs/FCM credentials yet; in-app inbox and realtime toasts work); scheduled sessions ("starting soon"); kicking a member; chat read receipts, attachments and direct messages outside rooms |
| Depends on deployment | a single API process for realtime and rate limits (see limitations) |

## Known limitations

- **One process.** The realtime hub, tickets and rate limits live in memory, like the existing limiter. With several
  workers or instances, add a shared pub/sub (e.g. Redis) behind `Hub.publish`, share tickets and limits, and route a
  room's sockets consistently. Room locks then come from `SELECT … FOR UPDATE` (PostgreSQL); SQLite relies on the
  process lock.
- **Personal and group timers can overlap.** Running the personal Pomodoro during a group session records both. EXP
  can't exceed the shared daily study cap, but minutes in statistics can be counted twice.
- The sweep re-reads every open room about every 30 s (and only due rooms every tick); fine for an MVP, worth an
  index-driven scheduler at scale.
- Room names and goals are free text shown to members, invitees and friends; moderation relies on reports.
- Room chat is free text between members, who may have met only through a room code. There is no automatic filter;
  moderation relies on the host removing messages, blocking and reports. For young users, consider limiting chat to
  friends-only (private) rooms or adding a word filter before launch.
