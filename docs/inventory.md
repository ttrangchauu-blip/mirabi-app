# Vật phẩm khám phá, Kho đồ và Vườn nhà

What a pet brings back from its walk, where it is kept, and where it is used. The flow is real end to end: the pet
comes back → the backend rolls and stores its gifts → they are in the inventory → they are placed in a room or planted
in the garden.

## Pieces

| Where | What |
| --- | --- |
| `backend/app/items_catalog.py` | The catalog: 63 items (55 found on walks, 8 kept from the walks before it), 4 rarities, the walk places and their loot tables. Ids are stored everywhere: only ever add. |
| `backend/app/inventory.py` | Stacks (`inventory_stacks`), the history of every change (`inventory_events`), `GET /api/inventory`, item detail, "seen". The catalog is also written to `item_catalog` at startup. |
| `backend/app/companion.py` | Rolling and granting a walk's rewards (`roll_rewards`, `grant_rewards`, `walk_rewards` table). |
| `backend/app/pet_room.py` | Found decorations placed copy by copy (`placed_items`, `sync_copies`, `reconcile_copies`). |
| `backend/app/garden.py` | Vườn nhà: 6 plots (`garden_plots`), planting, clearing, watering and tending (`garden_care`), friends' visits. |
| `mobile/assets/room/room-art.json` | The room drawing of every decoration (also its inventory picture). |
| `mobile/src/itemArt.ts`, `mobile/src/gardenArt.ts` | Icons of seeds, materials and keepsakes (one badge per place); the garden's plants (3 stages each) and soil. |
| `mobile/src/inventory/` | API, offline cache, rarity colours, `requestPlace` (Kho đồ → a room's decorating). |
| `mobile/src/screens/inventory/InventoryScreen.tsx`, `mobile/src/screens/garden/` | Kho đồ and Vườn nhà (`GardenScreen`, `FriendGardenScreen`, shared `gardenUi`). |
| `mobile/src/screens/main/PetRewardPopup.tsx` | The pet back with its gift bag. |

## Catalog

Groups: Hạt giống (6), Cây trang trí (4), Đồ học tập (5), Đồ chơi pet (5), Nội thất nhỏ (5), Đồ trang trí (6),
Đồ vải (5), Nguyên liệu (5), Đồ nguyên tố (6), Kỷ vật (5). Each item has an id, name, description, group, rarity, use
(`room`, `garden`, `album`, `craft`) and variants. A decoration's variants are its colours in the room artwork; the
location badge has one variant per place. **Each variant is its own stack** (a pink and a blue pot are two entries).

Rarities: `common` Thường, `rare` Hiếm, `special` Đặc biệt, `legendary` Huyền thoại. The app always shows the name
with the colour (`mobile/src/inventory/rarity.ts`).

Finds from before the catalog keep their ids (`shell`, `crystal`, `seedling`, `small_pot`, `moon_lantern`, …); the ones
that are no longer found have `drop: False`. Their old `user_inventory_items` rows are moved into stacks once
(`inventory.migrate_legacy`, event key `legacy:<item>`).

## Rewards

- A walk picks its place when it starts (`pet_walks.location_id`): Đồi hoa, Bờ biển, Rừng thông, Thị trấn nhỏ, Núi
  tuyết. Every pet can find every item; the place decides the groups of the main gift and the bonus list.
- When it ends: **one main item**, rarity by `MAIN_ODDS` (65 / 25 / 9 / 1 %) among the place's groups, a random
  variant; and with `BONUS_CHANCE` (50 %) a **bonus** of 1–3 of a seed or material from the place's `bonus` list. Every
  place has items of every rarity (tested).
- Granted by the backend only, once: the walk is claimed (`rewarded_at IS NULL`), the roll is seeded by the walk id
  and stored in `walk_rewards` (`walk_id`, `slot` unique), and each grant carries the event key
  `walk:<id>:<slot>`. A failed grant leaves nothing and the retry gives the same items. The sweep grants walks that
  end while the app is closed.
- Duplicates add to the stack. `first_time` (shown as "Mới" in the popup) is true when the user never owned that item
  in that variant. In Kho đồ an item is "Mới" until its detail is opened.
- A keepsake also becomes an album memory (`walk_keepsake`, source `keepsake:walk:<id>`, no "new memory" notice); its
  detail links to it.
- Walks started before the catalog (an `item_id` of `exp` or an old find) still bring exactly that gift.

## The pet coming back

`GET /api/pet/space` → `pending_reward: {walk_id, returned_at, exp, location, items: [{id, variant, name, art, rarity,
rarity_label, quantity, slot, is_new, …}]}`. The app shows the pet, its gift bag opening (at once with reduced motion)
and the list, with "Xem kho đồ" and "Đóng". Both only confirm the popup (`POST /api/pet/walks/{id}/acknowledge`).

An egg that reaches its hatching EXP during the walk waits: gifts first, then the hatch (`hatch.status` is
`waiting_return` until the popup is confirmed), as in [pet-adventure.md](pet-adventure.md). Neither confirming nor
hatching starts a second walk the same day.

## Kho đồ

Opened from Phòng cá nhân → Cài đặt → Kho đồ, from the "Kho đồ" button of both rooms' decorating header, from Vườn nhà
and from the return popup. Tabs Tất cả / Trang trí / Hạt giống / Nguyên liệu / Kỷ vật; search by name (without
accents), filters by rarity and by use, newest first or by name. Grid cards: picture, name, rarity, "Còn N" or
"Còn 1 · Đang đặt 2", "Mới". Detail (`GET /api/inventory/items/{id}?variant=`): description, total owned, in use, free,
where each copy is, the history (received from which walk and place, planted, placed, stored). No capacity limit.
States: loading, empty, error with "Thử lại", offline (the last confirmed inventory, read only: every change needs the
backend's answer).

Actions: a decoration "Đặt vào phòng" → choose the room → its decorating opens with one more copy (or, inside
decorating, straight into that room's draft); a seed "Trồng" → the garden with that seed chosen; a keepsake "Xem trong
Album kỷ niệm" → its memory; a material only says "Dùng để chế tạo trong tương lai".

## Quantities

`owned = available + placed`. `InventoryStack.quantity` is what is owned; placed copies are `placed_items` rows (each
with its own id, shown as the placement's `uid` `"p<id>"`, its room and position).

- A room's save (`PUT /api/personal-room`, `PUT /api/focus-room`) runs under the user's lock in one transaction
  (`pet_room.save_layout`): kept copies (same uid, item and variant) only move; a new copy takes a free one; a copy no
  longer in the room goes back to the inventory. Too few free copies → `409 not_enough_items`, nothing changes. So a
  copy is never in two rooms and nothing goes below zero. Moving within a room changes no count; "Hủy" drops the draft
  and loses nothing; an outdated or repeated save gets `409 room_version_conflict`.
- A found decoration's copy keeps its colour (no recolouring, palettes skip it): another colour is another stack.
- Starter items stay one of each per room, as before.
- A small pot or moon lantern shelf saved in a room before copies were counted becomes a copy when the room opens; with
  no free copy left it goes back to the inventory (`reconcile_copies`).
- Planting (`POST /api/garden/plots/{plot}/plant`, `client_request_id`) takes one seed only when the plot is empty and
  the seed is owned; a retry with the same id plants once (event key `plant:<id>`). Errors: `plot_taken`,
  `not_enough_items`, `not_a_seed`.

## Vườn nhà

6 plots. A plant is "Mới nảy mầm", then "Đang lớn" after 4 h and "Đã lớn" after 12 h (`garden.STAGE_HOURS`); a grown
plant can be cleared to free its plot (`POST /api/garden/plots/{plot}/clear`). Offline it shows the last garden the
server confirmed and every change waits.

**Ways in**, all to the same screen (`mobile/src/screens/garden/GardenScreen.tsx`, overlay `garden` in `MainApp`):
Tiện ích → Vườn nhà, Phòng cá nhân → Cài đặt → Vườn nhà, "Trồng" in Kho đồ (with the seed chosen), and a "garden care"
notification. The bottom tab bar is unchanged (five tabs). The screen has two tabs, "Vườn của tôi" and "Vườn bạn bè".

**Vườn của tôi**: a one-line summary (planted plots, grown, still to water, seeds), the tools with icon and short label
(Trồng, Tưới, Chăm sóc) and the plots three to a row. A chosen tool acts on the plots tapped next; with no tool a tap
opens the plant's detail (stage, time to the next one, today's care and who did it) with its actions (Tưới nước,
Chăm sóc, Dọn ô once grown). An empty plot tapped offers the seeds.

**Care** (`POST /api/garden/plots/{plot}/care`, `{kind: water | tend, client_request_id}`): each planting takes each kind
once per owner day (the account timezone, as for friend pet play), from the owner or a friend: unique key
`garden_care(planting_id, kind, local_date)`. A second one that day answers `cared: false, reason: already_cared`; the
same request id answers `replayed: true`. Care gives nothing (no EXP, no items) and does not change growth. Clearing a
plot deletes its care; a new planting starts fresh. `GET /api/garden` shows each plot's `care` for today.

## Vườn bạn bè

- "Vườn bạn bè" lists friends (pet avatar, name, presence) with "Thăm vườn"; the friend's menu in Bạn bè has
  "Thăm vườn" too. A friend's garden opens over it (`FriendGardenScreen`, overlay `gardenVisit`) with the owner's name and
  a back button; back returns to the tab it came from. States: loading, error with retry, no friends, an empty garden,
  visits turned off, no longer friends.
- `GET /api/garden/visit/{user_id}` → `{owner, garden: {size, plots, care_kinds, care_day, server_now}, care:
  {daily_limit, used, left}}`. The owner's real plots and growth, never their seeds. Accepted friends only, never across
  a block (`404 garden_not_found`), and only while the owner lets friends visit, the same switch as room visits
  (`403 garden_visits_disabled`). Opening it changes nothing.
- `POST /api/garden/visit/{user_id}/plots/{plot}/care` → the care result plus the garden as it is now. The same checks,
  plus the visitor's daily limit: at most `garden_care_daily_limit` (20) plants a day across all friends' gardens
  (`429 garden_care_daily_limit`, a rolling day, counted under the visitor's lock) and a burst limit
  (`rate_limit_garden_care`). `409 plot_empty` when nothing grows there.
- A guest can only water and tend: there is no endpoint to plant, clear, move or store in someone else's garden (those
  only ever act on one's own), and the app offers none of it.
- The owner gets one notification (`garden_care`), merged while unread like room greetings; opening it opens the
  garden. Their garden shows who watered or tended each plant today the next time it loads.
- The garden has no decorations of its own yet: what a friend sees is exactly the owner's plots.

## Tests

`backend/tests/test_inventory.py` (rolls and odds, granting while the app is closed, retries, duplicates and "Mới",
keepsake memory, egg waiting to hatch, placing / moving / storing copies, not enough copies, both rooms racing,
legacy placements, planting once per request, the last seed racing), `backend/tests/test_garden_visit.py` (a friend's
view without seeds, friends only and visits on, once a day per plant from anyone, retries, the owner's day, the
visitor's daily limit, friends watering at once, no EXP, a guest cannot plant or clear, clearing starts care over),
`mobile/__tests__/inventory.test.tsx` (pictures for every catalog item, copies in the editor, filters, the screen's
states and actions, the garden's retry) and `mobile/__tests__/garden.test.tsx` (watering with a retried request, the
friends tab, a friend's garden: tending, watered, limit used up, empty, visits off; Tiện ích → Vườn nhà).
