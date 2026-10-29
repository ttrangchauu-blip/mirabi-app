# Phòng cá nhân (personal pet room)

The third tab of the main menu (it replaced "Nghề nghiệp"; `CareerTab.tsx` and `/api/career/*` are kept, just not in
the menu). The pet lives in an illustrated room the user decorates, photographs into the memory album, and friends can
visit. As a tab of the main menu it keeps the menu bar (decorating too) and has no back button.

## Pieces

| Where | What |
| --- | --- |
| `mobile/assets/room/room-art.json` | Every wall, floor and room item as an SVG fragment (personal room 420 × 770, focus room 640 × 440), with its colour variants, size (`box`), what it may do (flip, tilt) and where the pet sits on it. Read by the app **and** the backend photo renderer, so the screen and the photo use the same drawing. |
| `backend/app/pet_room.py` | Catalog (groups, items, ownership), saved room, keeping items inside the room, photo rendering, friend visits and greetings. |
| `backend/app/models.py` | `PetRoom` (one row per user: name, wall, floor, placed items as JSON, `version`), `FocusRoomLayout` (the decorated Phòng tập trung, same shape without a name) and `PetRoomItem` (owned decorations, `source = "starter"`). |
| `mobile/src/room/` | API client, offline cache (AsyncStorage), `art.ts` (drawing order, geometry, palettes and thumbnails, the same rules as the backend) and `rules.ts` (every decorating change and whether it may stay). |
| `mobile/src/screens/room/useRoomEditor.ts` | The draft, selection and undo history shared by both rooms' "Trang trí". |
| `mobile/src/screens/main/FocusRoom.tsx` | The Focus Space room (Học tự chọn): the saved focus layout with the pet at its desk, and its full-screen decorating view. |
| `mobile/src/screens/room/` | `RoomTab` (owner), `RoomScene` (the drawing and the drag layer), `DecoratePanel` (groups, cards and the selected item's tools), `PhotoSheet`, `VisitRoom` (a friend's room, read only, opened from the Bạn bè tab). |

## Rules

- **Layout**: `{wall, floor, items: [{item, variant, x, y, flip, rotate}]}`. Floor items stand with their feet on
  `(x, y)`; wall items and rugs are centred on it. Each item is in the room at most once (32 at most); everything else
  the user owns is in the storage ("Trong kho"). Ids of surfaces, items and variants are stable and only ever added.
- **Rooms saved before items could move** (fixed slots: `background`, `rug`, `study`, …) are read as the same items at
  their old places (`LEGACY_ITEMS`); the next save stores the new format. Nothing is migrated in the database.
- **Inside the room**: wall items stay on the wall, rugs on the floor, floor items stand on the floor, and no item
  sticks out of the room. The app keeps a dragged item inside while it moves, and the backend applies the same rule
  when saving, so a stored position is always one the app drew.
- **Drawing order**: wall, floor, wall items, rugs, window light, floor items from the back of the room to the front,
  a soft vignette, then the pets. A pet on its rug or bed is always on top. At its desk it sits on the chair behind the
  desk, and the desk's `cover` (top edge, drawers, lamp and books: the part in front of the seat) is drawn again over
  it, so only its upper body and the book of its study strip show above the desk. A pet without a study strip (and
  every photo, which uses the still artwork) sits lower by the seat's `sink`, so the desk hides its legs. Things are
  layered by where they touch the floor: the floor items standing in front of the pet's feet that overlap it
  (`art.itemsInFront`, drawn again over it without shadows) cover it, whether it walked behind a plant or a shelf or
  stands on its spot; never its own bed or desk, and never the items being dragged.
- **Ownership**: the first open grants the starter set (rows in `pet_room_items`; items added to the starter set later
  are granted on the next open), one of each per room. Decorations pets find on walks ("Đồ khám phá" tab, every item
  with `inventory_id`) are placed copy by copy from the inventory: each copy is a `placed_items` row whose uid is stored
  with the placement, so a room may hold several and a copy is in one room only (details in
  [inventory.md](inventory.md#quantities)). Saving an item the user doesn't own is refused (`403 item_not_owned`), as
  are a second copy of a starter item (`duplicate_item`), more found copies than are free (`409 not_enough_items`), an
  unknown colour (`invalid_variant`) and a flip or tilt the artwork doesn't have (`invalid_transform`). No currency or
  shop.
- **Saving** sends the `version` that was opened; an outdated save gets `409 room_version_conflict` and the app reloads
  the latest room. The room is created once with the default layout and never overwritten by a read. "Hủy" asks first
  when something changed. After a save the screen shows the room the backend answered with; a read that started
  before it and answers later (an older `version`) is ignored, on screen and in the offline cache.
- **Pet state** is read, never changed: walk from `pet_walks` (opening the room does not settle or start a walk),
  "studying" from a running focus session (`study_sessions.status = "started"`, within the focus length) or a group room
  in focus. On the owner's device the local Pomodoro timer decides first (focus → desk, break → bed). The pet sits at
  its desk or on its bed wherever they were put (the first one in the room); without one it stays on its rug, and
  without a rug in the middle of the room. Pet, level and EXP come from `users`.
- **Buttons**: plain icons (20 points, 44 × 44 to touch, no circle) at the right of the header panel's first row:
  "Ghé phòng bạn bè", "Cài đặt" (gear) and "Chụp ảnh" (camera). "Cài đặt phòng" holds "Trang trí phòng",
  "Màu tường, sàn và chủ đề" (decorating, opened on the "Tường và sàn" tab), "Âm thanh trong phòng",
  "Hiệu ứng trong phòng", "Kho đồ", "Vườn nhà", "Đổi tên phòng" and "Album kỷ niệm". What the pet is doing ("Đang học
  cùng bạn", "Đang khám phá · Về lúc 20:30"…, without the pet's name) is the panel's last line, never over the room.
- **Screen layout**: the room fills the whole width and everything above the menu bar edge to edge, from under the
  status bar down under the bar's rounded corners (`TAB_BAR_RADIUS`, so no other background shows beside them); the
  bar stays on top of it. Floating over its wall, inside the safe area, one translucent panel (14 corners, about 96
  points) of three fixed rows: the room's name (16) and the icons; a 24-point avatar, "Mây · Cấp 1" (13; the stage's
  name only for screen readers), the EXP bar (5 high, taking the width left) and "417/800"; the status line (12). The
  offline notice is a small line under it. On a narrow screen the room's and pet's names are cut first. The room is as wide as the screen at the canvas proportions, never stretched (`art.roomView`), its content
  (everything below `top`, 160: no wall item hangs behind the header) between the header and the bar, and the bottom of
  the canvas (the front edge of the floor items stand on) exactly at the bottom of what is shown above the bar, so no
  floor is drawn there that nothing could be put on; whatever space is left is more wall above (carried on in the
  wall's top colour past its drawn bleed on a very tall screen). On a wider screen it gets smaller and more wall and
  floor show at its sides. (Until 2026-10-29 the wall–floor line was pinned at 57 % of the screen, which on a tall
  screen left a strip of floor under the canvas: an item dragged to the front while decorating, which showed the
  canvas alone, then looked pushed up.) The wall and floor are drawn around the canvas
  (`bleed`) for that; items, walks and the pet stay on the canvas. The pet's menu and lines stay between the header and
  the bar.
- **A camera set only by the screen**: outside decorating the room (`RoomScene`) fills the tab's whole space with the
  header floating over its wall, and its camera (`roomView`) is computed from the screen size and fixed reserves only:
  `HEADER_RESERVE` (110 points under the safe area: the header panel and its margins) and the bar's
  corners. A measured header is used only to keep the pet's menu and lines below it (`menuTop`), so a status line or
  the offline notice appearing never moves or rescales the room. Touches map back to canvas units through the same
  camera (`k`, `view`). Decorating keeps the menu bar: another tab with unsaved changes asks first ("Bỏ các thay
  đổi?"; "Trang trí tiếp" stays). **Decorating uses the very same camera**: its header and panel (fixed heights,
  `EDIT_HEADER` 56 and `decoratePanelHeight`, about a third of the screen) are drawn over the room, which keeps its
  scale and place, so an item is on the same spot of the screen while decorating and after saving. To reach what is
  under them the room slides (it only moves, never rescales; positions are canvas units either way): a drag on an
  empty spot slides it, and a selected or newly added item under the panel or header is brought into view
  (`RoomScene` `chrome`). Leaving decorating slides it back. The header
  (`DecorateHeader`, shared with the focus room) is one row of 40-point buttons: close ("Hủy") on the left, the title
  and a short hint, then undo and "Lưu".
- **Interaction** is a tap on the pet: a small menu next to it (above its head, below its feet when there is no room)
  with "Vuốt ve" (it leans in, hearts), "Cho ăn" (a treat drops, it nibbles), "Chơi cùng" (a ball bounces past, it
  jumps) and "Trò chuyện" (a hop and a line for where it is). Choosing one closes the menu and plays it with a short line
  and sound. A tap anywhere else in the room only closes the menu (no walk); a walking pet stops when its menu opens. It
  is local: no EXP and nothing used up. An egg answers with how far it is from hatching, an egg being hatched on Home
  with "Trứng sắp nở rồi!", and a pet out on its walk is not in the room: a marker where it would be says so, with its
  return time. Taps while an interaction plays (`PLAY_MS`, 1.2 s) are ignored, so it is not started again and again.
- **Sound and effects** (`mobile/src/room/prefs.ts`, per account on the device, `mirabi.room.prefs:<userId>`): the
  sounds are four short clips in `mobile/assets/audio/room-*.wav`; effects (the hop, lean, hearts, treat, ball and walk
  ring) start off when the OS asks for reduced motion. With effects off the pet still answers and walks.
- **Tap the floor to walk** (`mobile/src/room/walk.ts`, `RoomScene`): in the owner's room, outside "Trang trí", while the
  pet is on its rug (not studying, resting or out walking), a tap on free floor walks the pet there: a small ring marks
  the target and fades, the pet plays its walk strip facing its way (the strips face right; walking left mirrors them),
  or its still artwork with a light bob for a pet without one, at `WALK_SPEED` (120 canvas units a second, so the time
  follows the distance), then stands still again. A new tap turns it from where it is. It stays on the floor inside the
  walls by its feet and size (`walkBounds`), and floor items block it by their footprint widened by its width
  (`obstacles`; rugs are walked on); the path goes around them (grid Dijkstra, then straightened). A tap on a blocked
  spot leads to the nearest reachable spot within `NEAR_TARGET` (70); with no way there the pet stays. A tap on the pet
  opens its menu, a tap on a piece of furniture, the wall, a button or the open menu does nothing to the walk, and a drag
  or a second finger is never a tap.
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

## Decorating (both rooms)

- **Two rooms, one catalog**: Phòng cá nhân (`/api/personal-room`, 420 × 770, floor from 440) and Phòng tập trung
  (`/api/focus-room`, `GET`/`PUT` with `{wall_id, floor_id, items, version}`, 640 × 440, floor from 292). Each keeps its
  own layout and `version`; the first open stores a complete default room (`defaults` in the artwork). Spawn points of
  new items are on the old 400 × 440 canvas (`art.legacyPoint` moves them onto the personal room's).
- **Rooms saved on an older canvas**: the personal room was 400 × 440 (floor from 292) until art v5, 360 × 760 (floor
  from 436) in art v5 and is 420 × 770 since art v6 (2026-10-29). A stored room without `"canvas": 6` is read on
  today's canvas (`pet_room.from_legacy`, from `OLD_CANVAS`): the same arrangement across today's width, the wall items
  spread over today's wall, the floor items evenly over today's deeper floor (a desk a sixth of the way into the old
  floor is a sixth of the way into today's: an earlier reading kept the back of the room in place and left furniture
  crowded against the wall with the front of the floor empty), and what stands on a desk or shelf moves with it. A
  top item that stands on nothing when a room is read (saved before that rule, or from an older canvas) is put on the
  free part of the nearest desk or shelf top it fits on (`pet_room.seated_tops`); with none in the room it goes back to
  the storage, still owned. Nothing else is moved. Fixed-slot rooms are
  read the same way, a room saved during the short-lived 400 × 640 canvas (the only one with anything below 440) keeps
  its depth, and one marked `"canvas": 5` is read from that canvas. Nothing is rewritten in the database; the next
  save stores today's positions with the marker. The app's offline cache key moved to `mirabi.room.v3`, so a cached
  room from before art v5 is never drawn on the new canvas. Its default room for new users: a study corner (desk with its chair, open book, pencil
  cup, cup of water), a clock and a small painting, a shelf, the rug in the middle, the bed with a pillow and blanket and
  a bowl, the plush with a toy basket, a ball, and plants on both sides. 60 items in 11 groups (Bàn,
  Ghế, Tủ và kệ, Đèn, Cây, Trang trí tường, Đồ học tập, Đồ sinh hoạt, Đồ cho pet, Đặc biệt) plus 13 walls and floors.
- **Where an item goes** (`mount`, shown on every card): on the wall, on the floor, laid on the floor (rugs), or on top
  of a desk or shelf (`top`). Supports list their tops (`tops: [x0, x1, dy]`); a top item stands on one when its feet are
  on that line and it fits its width (`support_of` / `supportOf`). Top items are drawn right after their support, and
  those on the desk the pet sits at are drawn in front of the pet. Moving, flipping or storing a support takes what
  stands on it along; a new top item goes to a free part of a top (never on another item).
- **Never in the pet's way**: a floor item may not stand on the pet's spot (rug, desk or bed; the desk in the focus
  room) nor stand in front of it hiding over a quarter of it (`blocking_items` / `blockingItems`). The app also keeps at
  least a quarter of the personal room's floor reachable for walks (`reachableShare`). Buttons, the focus timer and the
  room's status line are outside the drawing, so items never cover them.
- **Dragging**: a touch selects the item under it (a touch on nothing clears the selection); moving the finger more
  than a few points drags it. The item keeps the grab point under the finger (it never jumps to the finger's centre),
  in canvas units whatever the room's scale and offset. When the drag starts the item, with what stands on it, is
  lifted onto its own layer, and the room is drawn once without them; the layer then only moves (`rules.dragTo`: inside
  its part of the room, a top item snapped onto the top under it), so nothing is redrawn while the finger moves. Whether
  it may stay is checked every 100 ms (`moveItem`, the full rules): its frame is green, or red with the reason.
  Dropped where it may stay, the room keeps it there (one change, one undo step); anywhere else it goes back to where
  it was. Nothing is sent to the backend before "Lưu". The backend refuses the same (`422 unsupported_item`,
  `422 blocks_pet`) for placements that changed; placements stored before these rules are kept.
- **Nothing moves around the room while decorating**: the room stays at the same place in the screen's tree and the
  same size (it is never built again when decorating starts), its camera is the one outside decorating (above), the header's hint is one
  fixed line, the decorating panel keeps one height (`decoratePanelHeight`, about a quarter of the screen; its grip unfolds it over
  the room, never moving the room) on every tab and selection, and each tab keeps where its list was scrolled. The selected item's tools (`ItemTools`) are docked at the
  top of the panel, always in the same place (the list under them scrolls); its frame is drawn over the room. Recolouring keeps the item's anchor; storing removes only it and what
  stands on it, the rest of the room keeps its order and places. Placed items are keyed by their item id (each is in a
  room at most once), never by their index.
- **Hoàn tác / Hủy / Lưu**: every change (add, move, turn, recolour, store, wall, floor) can be undone; "Hủy"
  asks before dropping changes; "Lưu" sends the whole layout with the `version` that was opened.

## Assets

The furniture is vector art in warm, saturated colours with darker edges (no bitmap furniture set exists in the
project). Each wall and floor is drawn twice, for the personal room's canvas with its bleed (x −120 to 540, y −240 to
1000: the wallpaper above the wainscot, the planks and tiles in perspective) and for the 640-wide focus canvas (`svg`
and `focus`), so no pattern is stretched. Pets are 25 % bigger since art v4 (rug 145, desk 125, beds 130); in the
personal room they are drawn at `petScale` (0.8) of that against its furniture (rug 116, desk 100, beds 104), with a
soft contact shadow, and the seat's sinks scale with them. At the desk, the studying strip is lowered by the seat's `studySink` (9) so the desk's front edge hides its bottom
and the book lies on the desk top; the standing artwork by `sink` (30). The personal room's light layer (`vignette`)
adds warm light from the window and darker corners. Photos show the canvas from 40 above its `top` down (`photo_area`). To change or add
art, edit `room-art.json`: keep gradient ids prefixed with the item id, use `@token` colours that every variant fills,
keep an item's `cover` a copy of the front part of its `svg`, and update `box` if the drawing's size changes (the
backend tests check ids, tokens, covers and that the default and old-slot positions are inside the room). A resting pet uses its still artwork because no pet has a drawn sleep animation.
Photos embed the 256 px evolution stills, so the pet is drawn at about 1.1× in a 1080 × 1350 photo; the furniture is
vector and stays sharp.
