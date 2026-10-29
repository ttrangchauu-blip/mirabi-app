# Pet Adventure rewards

The pet's daily walk (`backend/app/companion.py`) brings back gifts. The backend grants them by itself;
the app only shows them and lets the user confirm the popup.

## Lifecycle

`locked → ready → walking → returned → rested`

- **locked → walking**: the walk starts by itself once **every goal of today** is done: the daily quests
  *and* the user's own tasks (`user_tasks`) that occur today, i.e. the same list as the Home "Nhiệm vụ hằng ngày"
  card (UTC day, like the quests). Five quests and two tasks added before the walk: all seven must be done. Tasks of
  other days (or another day's occurrence of a repeating task) never count, and an empty list never starts a walk.
  Completing a quest, a focus session, a lesson, a post or one of the user's tasks checks again; so does reading
  `GET /api/pet/space`.
- **Started is final**: a task added once the walk has started changes nothing: the walk is not cancelled, called
  back or given a new return time, and finishing that task starts no second walk the same day (`rested`, plus the
  unique `(user_id, task_cycle_id)` index).
- **Latest data, no interleaving**: `maybe_start_walk` first checks without a lock; if the walk looks ready it takes
  a per-user lock (`lock_daily_goals`: the user's row `FOR UPDATE` on PostgreSQL, the write lock on SQLite) and
  decides again from the database. `POST /api/tasks` takes the same lock before inserting, so a task added at the
  same moment is either there first (the walk waits for it) or comes after the walk started (it changes nothing).
  Retries, concurrent requests and other devices start one walk at most.
- **walking → returned**: when `returns_at` passes, the backend grants the walk's rewards once:
  its one gift. EXP goes through `award_exp` (source `pet_adventure`, reference `walk:<id>`); an item
  goes into `user_inventory_items`. Then `pet_walks.rewarded_at`, `reward_exp` and `rewards` are set.
  All of this is one database transaction, so a walk is either fully rewarded or not at all.
- **returned → rested**: the user closes the popup ("Đóng" or "Xem kho đồ"). This only sets `pet_walks.collected_at` (the popup was
  confirmed). It never grants anything.
- While a walk is `returned`, the next walk doesn't start. Confirm the popup first.

## Hatching and the walk

The egg (Lv.0) hatches at 300 EXP, and hatching and walking never overlap:

- **Hatching waits for the app**: reaching 300 EXP records the EXP but keeps the pet at Lv.0, waiting to hatch
  (`pet_evolutions.hatched_at IS NULL`). The app plays the hatch and the congratulations. Closing them calls
  `POST /api/pet/hatch`, which sets `hatched_at`, brings the level up to the EXP and records the "pet_hatched" memory.
- **Hatch first**: while the egg waits at home, the walk doesn't start even with every goal done. The status is
  `waiting_hatch`, the app shows "Pet sẽ đi khám phá sau khi nở xong", and `POST /api/pet/walk` answers
  `409 hatch_first`. The hatch checks today's goals again and starts the walk if they are all done. A task added
  before that counts. The 8 hours are timed from the hatch, not from the last goal.
- **Back first**: an egg that reaches 300 EXP during a walk keeps its shape. The walk is neither stopped nor
  shortened. `hatch.status` is `waiting_return` until the pet is back *and* its gift popup is confirmed (the walk's
  own EXP gift counts toward hatching). Then it is `ready`. Before that, `POST /api/pet/hatch` answers `409 pet_away`.
- **Once**: the hatch takes the same lock as starting a walk and claims `hatched_at IS NULL`, so retries, reloads and
  other devices hatch once (`hatched: false` after that). It never starts a second walk or gives back the day's walk.
- `GET /api/pet/space` → `hatch: {status: "none" | "ready" | "waiting_return", level}`, where `level` is the level
  once hatched. Pets already past Lv.0 before this existed are marked hatched at startup.
- The app (`usePetHatch`, `PetHatchedPopup`) keeps the step reached on the device. An app closed after the
  animation reopens on the congratulations; one closed during it plays the animation again. Nothing hatches until
  the congratulations are closed.

## When rewards are granted

Rewards don't depend on the app being open:

- The API process runs a sweep every `PET_REWARD_SWEEP_SECONDS` (default 60; 0 turns it off).
- `GET /api/pet/space`, `GET /api/pet/inventory`, `GET /api/dashboard` and the confirm endpoints grant
  first, so the numbers they return are up to date even right after the walk ends.

Granting starts with a conditional update on `rewarded_at IS NULL`. Only one request, sweep or worker
can win it. The `ExpEvent` unique reference is a second guard for the EXP. The items are seeded by the
walk id (`roll_rewards`), so the same walk always gives the same gifts.

## Gifts

Each walk goes to a place and brings back **one main item** and, half the time, a bonus of 1–3 seeds or materials,
rolled from the item catalog when it ends and kept in `walk_rewards`; see [inventory.md](inventory.md) for the catalog,
odds, places and the inventory they go into. Walks started before the catalog (`pet_walks.item_id` of `exp` or an old
find id) still bring exactly the one gift they picked: 30 EXP (`ADVENTURE_EXP`) or that item.

The app draws decorations from the room artwork and every other item from `mobile/src/itemArt.ts` (`ItemIcon`); an
item without a drawing shows its `emoji`.

## API

- `GET /api/pet/space` → `pending_reward`: `{walk_id, returned_at, exp, location, items[]}` for the oldest
  rewarded walk not yet confirmed, or `null`. It also includes `inventory`.
- `POST /api/pet/walks/{walk_id}/acknowledge` → confirms the popup. It's idempotent: repeated taps,
  retries and other devices all get `200` and nothing is granted again. Returns `404` for a walk that
  doesn't exist or belongs to someone else, and `409 walk_not_returned` if the walk isn't over yet.
- `GET /api/pet/inventory` → the user's items with quantities.
- `POST /api/pet/walk/collect` (older clients) → confirms the latest returned walk.

## App

`usePetReward` (in `mobile/src/screens/main`) asks `GET /api/pet/space` when the app opens, when it
returns to the foreground, and when the walk is due back. If there's a `pending_reward`, `PetRewardPopup`
shows it. If confirming fails, the popup stays open with a retry message and the hook reloads the state
from the backend. If the backend says the walk is already confirmed (a lost response, or another
device), the popup closes. Malformed data shows no popup.
