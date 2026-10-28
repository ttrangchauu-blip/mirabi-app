# Phòng cá nhân (personal pet room)

The third tab of the main menu (it replaced "Nghề nghiệp"; `CareerTab.tsx` and `/api/career/*` are kept, just not in
the menu). The pet lives in a small illustrated room the user decorates, photographs into the memory album, and
friends can visit.

## Pieces

| Where | What |
| --- | --- |
| `mobile/assets/room/room-art.json` | Every wall, floor and room item as an SVG fragment on one 400 × 440 canvas, with its colour variants, size (`box`), what it may do (flip, tilt) and where the pet sits on it. Read by the app **and** the backend photo renderer, so the screen and the photo use the same drawing. |
| `backend/app/pet_room.py` | Catalog (groups, items, ownership), saved room, keeping items inside the room, photo rendering, friend visits and greetings. |
| `backend/app/models.py` | `PetRoom` (one row per user: name, wall, floor, placed items as JSON, `version`) and `PetRoomItem` (owned decorations, `source = "starter"`). |
| `mobile/src/room/` | API client, offline cache (AsyncStorage), and `art.ts`: drawing order, geometry and thumbnails, the same rules as the backend. |
| `mobile/src/screens/room/` | `RoomTab` (owner), `RoomScene` (the drawing and the drag layer), `DecoratePanel` (groups, cards and the selected item's tools), `PhotoSheet`, `VisitRoom` (a friend's room, read only, opened from the Bạn bè tab). |

## Rules

- **Layout**: `{wall, floor, items: [{item, variant, x, y, flip, rotate}]}`. Floor items stand with their feet on
  `(x, y)`; wall items and rugs are centred on it. Each item is in the room at most once (24 at most); everything else
  the user owns is in the storage ("Trong kho"). Ids of surfaces, items and variants are stable and only ever added.
- **Rooms saved before items could move** (fixed slots: `background`, `rug`, `study`, …) are read as the same items at
  their old places (`LEGACY_ITEMS`); the next save stores the new format. Nothing is migrated in the database.
- **Inside the room**: wall items stay on the wall, rugs on the floor, floor items stand on the floor, and no item
  sticks out of the room. The app keeps a dragged item inside while it moves, and the backend applies the same rule
  when saving, so a stored position is always one the app drew.
- **Drawing order**: wall, floor, wall items, rugs, window light, floor items from the back of the room to the front,
  a soft vignette, then the pets. A pet on its own spot (rug, desk, bed) is always on top. A pet that walked somewhere
  is covered by the floor items standing in front of its feet (`art.itemsInFront`, drawn again over it without shadows),
  so it can go behind a plant or a shelf.
- **Ownership**: the first open grants the starter set (rows in `pet_room_items`; items added to the starter set later
  are granted on the next open). `small_pot` and `lantern_shelf` are owned while the walk finds `small_pot` /
  `moon_lantern` are in the inventory. Saving an item the user doesn't own is refused (`403 item_not_owned`), as are a
  second copy (`duplicate_item`), an unknown colour (`invalid_variant`) and a flip or tilt the artwork doesn't have
  (`invalid_transform`). No currency or shop.
- **Saving** sends the `version` that was opened; an outdated save gets `409 room_version_conflict` and the app reloads
  the latest room. The room is created once with the default layout and never overwritten by a read. "Hủy" asks first
  when something changed.
- **Pet state** is read, never changed: walk from `pet_walks` (opening the room does not settle or start a walk),
  "studying" from a running focus session (`study_sessions.status = "started"`, within the focus length) or a group room
  in focus. On the owner's device the local Pomodoro timer decides first (focus → desk, break → bed). The pet sits at
  its desk or on its bed wherever they were put (the first one in the room); without one it stays on its rug, and
  without a rug in the middle of the room. Pet, level and EXP come from `users`.
- **Interaction** ("Tương tác" or tapping the pet) is local: a hop and a short line. It never awards EXP.
- **Tap the floor to walk** (`mobile/src/room/walk.ts`, `RoomScene`): in the owner's room, outside "Trang trí", while the
  pet is on its rug (not studying, resting or out walking), a tap on free floor walks the pet there: a small ring marks
  the target and fades, the pet plays its walk strip facing its way (the strips face right; walking left mirrors them),
  or its still artwork with a light bob for a pet without one, at `WALK_SPEED` (120 canvas units a second, so the time
  follows the distance), then stands still again. A new tap turns it from where it is. It stays on the floor inside the
  walls by its feet and size (`walkBounds`), and floor items block it by their footprint widened by its width
  (`obstacles`; rugs are walked on); the path goes around them (grid Dijkstra, then straightened). A tap on a blocked
  spot leads to the nearest reachable spot within `NEAR_TARGET` (70); with no way there the pet stays. A tap on the pet
  is play, a tap on a piece of furniture or the wall does nothing, and a drag or a second finger is never a tap.
  Visitors never move the host's pet. The position is not saved: decorating, studying or resting puts it back on its spot.
- **Photos**: `photo/preview` returns the exact SVG that `photo` stores (1080 × 1350: the saved room in a frame plus
  title, optional note, pet, level and date; no buttons or editing frames). The memory (`event_type = "room_photo"`,
  album category "Pet") keeps the image and a snapshot of the room and pet; it is never re-rendered, even when its
  caption is edited. `client_request_id` makes retries safe. No photo while the pet is out walking (`409 pet_away`).
- **Visits** (`backend/app/room_visits.py`, details in [friend-visits.md](friend-visits.md)): only accepted friends who
  allow visits, never across a block (`404` otherwise, so a room's existence isn't revealed). The visitor sees the saved
  room only, cannot change it, and their pet stands on the fixed guest spot. "Chào pet" and "Động viên" (preset messages)
  send a `room_visit` notification, merged per kind while unread; "Rủ học" sends a real study room invitation. Each is
  limited per friend and per day by the backend, retry-safe, and never gives EXP. Greetings work while the host's pet is
  away (left for later). Tapping the host's pet plays with it (hop, line, hearts) and can give it a little EXP once a
  day (see [friend-visits.md](friend-visits.md#playing-with-a-friends-pet)).

## Assets

The furniture is vector art in one pastel palette (no bitmap furniture set exists in the project). To change or add
art, edit `room-art.json`: keep gradient ids prefixed with the item id, use `@token` colours that every variant fills,
and update `box` if the drawing's size changes (the backend tests check ids, tokens and that the default and old-slot
positions are inside the room). A resting pet uses its still artwork because no pet has a drawn sleep animation.
Photos embed the 256 px evolution stills, so the pet is drawn at about 1.1× in a 1080 × 1350 photo; the furniture is
vector and stays sharp.
