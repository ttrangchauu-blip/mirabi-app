# Bạn bè và ghé thăm (friends and room visits)

Friends visit each other's personal pet room ([personal-room.md](personal-room.md)), read only, and can greet the pet,
send a preset cheer, or invite the host into a Study Together room ([STUDY_TOGETHER.md](STUDY_TOGETHER.md)). It reuses
the existing friendships, blocks, reports, study rooms, invitations and notifications; the visit reads the host's saved
room and pet from `pet_rooms` / `users` / `pet_walks`, never a copy.

## Where it is in the app

- **Bạn bè** in the main menu (the tab formerly called *Cộng đồng*; its internal key is still `Community`). One screen,
  no tabs (`mobile/src/screens/together/FriendsScreen.tsx`), top to bottom: the title with a gear (*Cài đặt*: the privacy
  toggles); a box *Nhập mã để thêm bạn* with search and QR scan buttons (a code or a name; a match shows a short profile
  and nothing is sent until *Kết bạn*) and *Mã của tôi* (QR code, copy, share); *Lời mời kết bạn (N)* with up to 3
  requests (*Chấp nhận* / *Từ chối*, *Xem tất cả* for the rest; hidden when there are none); *Đã gửi* folded into one row
  that opens the sent requests (*Hủy lời mời*); and *Bạn bè (N)*: each friend's pet, *Ghé thăm*, ⋯ for joining their open
  study room, unfriend, block, report, with a name search once the list has 6 or more friends. The name search and the
  code box stay separate.
- **Bảng tin** (the post feed, unchanged) is a tile in **Tiện ích** that opens `mobile/src/screens/main/FeedScreen.tsx`;
  back returns to Tiện ích.
- The menu icon carries a badge with the friend requests waiting for an answer (`dashboard.pending_friend_requests`,
  hidden at 0); it refreshes when a request is answered and when the tab or Home is opened.
- Shortcuts open the tab: the people button in **Phòng cá nhân** (and ⋯ → *Ghé phòng bạn bè*), *Xem tất cả* / *Tìm bạn* /
  pending requests on the **Học cùng bạn bè** home, and friend request notifications. The Home card that
  used to say *Cộng đồng* says *Bạn bè*.
- A visit opens over the current tab; back returns to where it was opened.
- **Visit screen** (`mobile/src/screens/room/VisitRoom.tsx`): the saved room, the host's pet where its state puts it, your
  pet on the fixed guest spot (never covering the host's pet). No row of buttons under the room: the header has the room
  name and *Rủ học* (book icon; pick subject and rhythm), which stays there while the pet is out, since it invites the
  owner. A tap on the host's pet opens a small menu next to it (above its head, below its feet when there is no room
  above, always inside the room): *Chào pet* (hand) plays with it and greets the owner, *Động viên* (heart) picks a preset
  message. While the pet is out walking, a marker where it would be opens the same menu with *Để lại lời chào*. An item
  sent a moment ago is dimmed in the menu ("đã gửi, chờ một lát"); a tap outside the menu closes it. Visitors never move
  the host's pet or anything in the room. When the host takes no study invitations, *Rủ học* is dimmed and says so.
- **Notifications**: the Home bell (with unread count) opens the inbox. Greetings and cheers open the sender's room; study
  invitations open the invitation screen (room, subject, rhythm, members, time left, or why it can no longer be joined).

## Rules (backend)

| | |
|---|---|
| Friend code | 8 characters per account (`social_profiles.public_code`). The QR code holds `MIRABI-FRIEND:<code>`. `POST /api/users/lookup {public_code}` accepts either, case and spaces ignored; returns the short public profile and `relationship` (`none/outgoing/incoming/friend/self`). Someone who blocked you looks nonexistent. |
| Requests | Existing rules: no self request, no duplicates, cooldown after a decline, asking someone who asked you accepts, accept is idempotent (one `friendships` row per pair). |
| Who may visit | Accepted friends only, never across a block (`404 room_not_found` otherwise), and only while the host has `allow_room_visits` on (`403 room_visits_disabled`). Checked on every request, so unfriending or blocking revokes it at once. |
| Visit payload | `owner` (id, name, avatar, pet, pet name, level), `room` (name, layout), `pet`, `activity` (`studying` only if the host shares presence), `walk.away` (no return time), `guest_pet`, `can_invite_study`, `available_at`. No tasks, notes, schedule, statistics, email or friend code. |
| Read only | There is no write endpoint for another user's room or pet; opening a visit settles no walk and awards nothing. |
| Limits | Per visitor and host, each of `hello`, `cheer`, `study_invite` once per `VISIT_INTERACTION_COOLDOWN_MINUTES` (10) → `429 greeting_cooldown` with `Retry-After`; at most `VISIT_INTERACTION_DAILY_LIMIT` (40) per visitor per 24 h → `429 visit_daily_limit`; burst limit `RATE_LIMIT_VISIT_INTERACTION`. |
| Retries | Every send carries `client_request_id`; a repeat returns the stored result (`replayed: true`) and notifies nobody again. |
| EXP | Greetings, cheers and study invites never give EXP. Playing with the pet does, within limits (below). |
| Cheers | One of `study_well`, `keep_going`, `take_break`, `believe`, `proud` (`room_visits.CHEERS`). No free text. |
| Rủ học | Uses the visitor's current open room (its own rhythm), or creates a private room *Học cùng …* with the chosen subject, focus/break minutes and cycles, then a normal `study_room_invitations` row and a `room_invitation` notification (`data.source = "visit"`). Refused if the host has `allow_study_invites` off (`403 study_invites_disabled`), is already in that room, or the room is full. |
| Joining | `POST /api/room-invitations/{id}/accept` checks again: still friends (else the invitation is cancelled), room open (`409 room_closed`), not expired (`410 invitation_expired`), free seat, no block. `GET /api/room-invitations/{id}` returns `state`: `pending / expired / room_closed / accepted / declined / cancelled`. |
| Unfriend / block | Both cancel pending study invitations between the two, both ways. |
| Invites setting | `allow_study_invites` off also skips the user in ordinary room invitations (`skipped: invites_disabled`). |
| Notifications | Unread greetings (or cheers) to one host within `VISIT_NOTIFICATION_GROUP_HOURS` (12) merge into one notification ("Linh và 2 bạn khác ghé thăm phòng"). Reading it marks the interactions `seen_at`. Open apps receive the merged one with `replaces: <old id>`. |

Privacy settings (`GET/PATCH /api/social/me`): `allow_room_visits`, `allow_study_invites` (both default on, friends only),
`presence_visibility` (online/studying shown to friends unless `nobody`), `share_study_stats`, `discoverable`.

## Playing with a friend's pet

*Chào pet* always plays with the host's pet in the app (a hop, a short line, little hearts), and sends a `hello`
greeting unless one was sent within the cooldown. Taps during its animation (`PLAY_MS`, 1.2 s) are ignored, so it is not
replayed or sent again by fast taps. The first *Chào pet* of a visit also calls
`POST /api/personal-room/visit/{user_id}/pet-play`, which decides whether it gives the pet EXP:

| | |
|---|---|
| Amounts | `FRIEND_PET_EXP_PER_FRIEND` (2) from each friend once per day, at most `FRIEND_PET_EXP_DAILY_CAP` (10) per pet and day from all friends (`app/config.py`). Its own cap: the 60 EXP/day of tasks and learning is unchanged. |
| Day | The **host's** account day (`pomodoro_settings.timezone`, UTC without one), never a zone sent by the visitor. |
| Checked | Friendship, block and visit setting (as any visit: `404` / `403`), not your own pet (`404`), the pet at home (`reason: pet_away`, greetings only), the friend's daily gift (`already_given`), the pet's daily cap (`pet_full`). |
| Atomic | `friend_pet_exp_grants` has unique keys on (host, pet, day, friend) and on (host, pet, day, slot 1..N); a grant takes the next free slot and retries when another visitor took it, so fast taps, retries, several devices and concurrent visitors never give more. A repeat of the same `client_request_id` returns the first answer (`replayed: true`). |
| EXP | Through `progression.award_exp` (source `friend_pet`, reference `friend_pet:<grant id>`): the pet's progress, level and evolution memories as for any EXP. `award_exp` now adds in SQL (`total_xp = total_xp + n`) and reads the total back, so concurrent awards to one pet all count. |
| App | `+2 EXP cho <pet>` when it gave EXP; when it can't (`pet_gift` in the visit payload or the answer), one short note per visit, then only play. A lost connection keeps the request id for the next tap. |

## Data

| Table | Purpose |
|---|---|
| `room_visit_interactions` | visitor, host, kind, cheer key, host away, study room and invitation, notification, `client_request_id` (unique per visitor), `seen_at`, time. Source of truth for cooldowns and the daily cap. |
| `social_profiles` | gained `allow_room_visits`, `allow_study_invites` (added by the startup upgrader). |
| `friend_pet_exp_grants` | host, visitor, pet, host day, slot, amount, `client_request_id`: one row per EXP a friend gave by playing with the pet (limits as unique keys). |

Everything else is existing tables. `downgrade_study_together_schema` also drops `room_visit_interactions`.

## API

| Method & path | Body → result |
|---|---|
| `POST /api/users/lookup` | `{public_code}` → public profile + `relationship`, `request_id` |
| `GET /api/personal-room/visit/{user_id}` | visit payload (above) |
| `POST /api/personal-room/visit/{user_id}/greetings` | `{kind: "hello" \| "cheer", message?, client_request_id?}` → `201 {sent, id, kind, message, host_away, available_at, replayed}` |
| `POST /api/personal-room/visit/{user_id}/pet-play` | `{client_request_id}` → `{granted, reason: granted \| already_given \| pet_full \| pet_away, pet_name, pet_level, replayed}`; the visit payload also has `pet_gift: {exp, daily_cap, available, reason}` |
| `POST /api/personal-room/visit/{user_id}/study-invite` | `{subject, focus_minutes, break_minutes, cycles, client_request_id}` → `201 {room, invitation, created_room, available_at, replayed}` |
| `GET /api/room-invitations/{id}` | invitation with `state` |
| `GET /api/dashboard` | gained `unread_notifications` and `pending_friend_requests` |

## Tests

`backend/tests/test_room_visits.py` (codes and QR lookup, idempotent accept, visit payload and privacy, permission revoked
by settings/unfriend/block, hidden presence, limits and replay, daily cap, no EXP, walking host, merged notifications and
seen state, study invites: new room, current room, setting, closed/expired/withdrawn, re-check on join, block), plus
`test_pet_room.py`, `test_friend_pet_play.py` (2 EXP per friend and day, retry, cap 10 across friends, settings, concurrent
taps from many friends, walking pet, permissions, the host's day, evolution). Mobile: `__tests__/room-interactions.test.tsx`
(tap to walk, retarget, mirroring, furniture/wall/drag taps, depth, when it is off; playing with a friend's pet),
`__tests__/room-walk.test.ts` (paths around furniture, blocked targets, shut in, stepping out), `__tests__/personal-room.test.tsx` (visit, greet, cheer with retry on the same request id,
Rủ học, visits/invites turned off), `__tests__/study-together.test.tsx` (QR code, typed and scanned code, friend list
search/states/visit, invitation screen, merged notification), `__tests__/room-visit.test.ts`.

## Friends' gardens

"Thăm vườn" (Vườn nhà → Vườn bạn bè, or a friend's menu in Bạn bè) opens a friend's garden with the same access rules
as a room visit (friends only, no block, `allow_room_visits`). A visitor may water and tend plants within the daily
limits and nothing else. See [inventory.md](inventory.md#vườn-bạn-bè).

## Not included

Push notifications to devices (the backend has no device-token registry or APNs/FCM credentials; the in-app inbox and
realtime toasts work), real-time pet movement between visitor and host, free chat, gifts and friendship points. The
place a pet walked to in its room is not saved or shown to visitors.
Scanning a QR code needs a camera (`expo-camera`); on a desktop browser without one, type the code.
