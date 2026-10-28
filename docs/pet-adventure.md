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
- **returned → rested**: the user taps "Nhận quà". This only sets `pet_walks.collected_at` (the popup was
  confirmed). It never grants anything.
- While a walk is `returned`, the next walk doesn't start. Confirm the popup first.

## When rewards are granted

Rewards don't depend on the app being open:

- The API process runs a sweep every `PET_REWARD_SWEEP_SECONDS` (default 60; 0 turns it off).
- `GET /api/pet/space`, `GET /api/pet/inventory`, `GET /api/dashboard` and the confirm endpoints grant
  first, so the numbers they return are up to date even right after the walk ends.

Granting starts with a conditional update on `rewarded_at IS NULL`. Only one request, sweep or worker
can win it. The `ExpEvent` unique reference is a second guard for the EXP. The items are seeded by the
walk id (`roll_rewards`), so the same walk always gives the same gifts.

## Gifts

Each walk brings back exactly **one** gift: either `ADVENTURE_EXP` (30 EXP) or one item (quantity 1),
never both. `pick_gift` chooses it when the walk starts and stores it in `pet_walks.item_id`
(`EXP_GIFT` = `"exp"` for EXP), so it stays a surprise until the pet returns:

- 40% EXP (`EXP_GIFT_CHANCE`).
- 60% an item: a rarity tier is drawn by `GIFT_ODDS` (common 55%, rare 35%, epic 10%), then an item of
  that tier.

Items have `name`, `emoji`, `rarity` (`common`, `rare`, `epic`), `kind` (`find`, `seedling`,
`decoration`) and `quantity`. The catalog is `REWARD_ITEMS`. Its ids are stored in the database, so
only ever add to it. In `pending_reward`, an EXP gift is `exp: 30, items: []`, and an item gift is
`exp: 0, items: [one item]`.

The app draws each item from `mobile/src/rewardArt.ts`: SVG markup keyed by item id, shown by
`RewardItemArt`. An item without a drawing shows its `emoji` instead, so the backend can add items
before their art exists. When you add an item, add its drawing there too.
Preview: [pet-adventure-previews/reward-art.png](pet-adventure-previews/reward-art.png).

## API

- `GET /api/pet/space` → `pending_reward`: `{walk_id, returned_at, exp, items[]}` for the oldest
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
