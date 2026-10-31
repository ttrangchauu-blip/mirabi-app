# Game assets: the game worlds

The art of the visual learning games is **vector art drawn in code** with `react-native-svg` (no emoji, no
placeholder as a main image). It scales to any screen, costs no download, and every state of an object is a prop.
Each component is `React.memo`, deterministic and hook-free; motion is added by the game (transforms), never inside
the art.

| Folder (`mobile/src/games/art/`) | Game | Contents |
|---|---|---|
| `mathBattle.tsx` | Math Battle | 6 characters × 4 moods, 4 arenas × 4 parallax layers, 4 effects |
| `magicLab.tsx` | Magic Lab | lab backdrop, 14 apparatus objects with their states, 16 materials |
| `wordForest.tsx` | Word Forest | forest × 4 parallax layers, brook, bridge, door, runes, chest, creature, vines, props |
| `effects.tsx` | (shared feedback) | `Slash` (a monster's claws), `MagicCircle` (a spell gathering), `Shard` × 4 shapes (anything breaking), `Puff` (did not work), `ZapSpark` (connected / dead), `WaterDrop`, `HeartFx` (thanks), `Gem` (a reward), `Boulder` and `GoalFlag` (Robot Adventure), `FieldLines` (a magnet's field) |
| `space.tsx` | Space Adventure (Tiếng Anh lessons) | space × 3 parallax layers, rocket + dome glass + thruster, 3 asteroids + rubble, laser, 4 planets × asleep / rescued |
| `timeTravel.tsx` | Time Traveler (Lịch sử) | 4 era scenes + drifting clouds, time gate + portal swirl, 7 artifacts, dig mound, the owl guide × 4 moods |
| `treasureMap.tsx` | Treasure Explorer (Địa lí) | parchment map (village, mountains, river and bridge, forest, lighthouse, island, compass), trail, fog, flag |
| `kit.tsx` | (shared) | outline ink, gradients, seamless-strip helper, seeded blobs and twinkles for the three files above |

Shared engine (`mobile/src/games/engine/`): `Parallax.tsx` (layers), `rig.ts` (character actions, `stop` to jump to
rest), `drag.tsx` (drag and drop), `feedback.tsx` (the visual feedback loop: phases, reactions, watchdog, skip; see
LEARNING_GAMES.md). The pet is the app's own artwork (`components/PetArt`, `assets/pets/<element>/`), unchanged.

## Math Battle (`mathBattle.tsx`)

- **Characters** (viewBox 120, facing left, `{ size, mood: 'idle' | 'attack' | 'hurt' | 'defeated' }`): `Slime`,
  `Mushroom` (Nấm phép thuật), `Golem` (Golem đá), `ShadowSpirit` (Tinh linh bóng tối), `Drake` (Rồng nhỏ),
  `CrystalKing` (Vua Pha Lê, the boss). `MONSTER_ART` maps ids to names, art and colour.
- **Arenas** `ArenaLayer({ zone, layer, width, height })`: zones `forest` (magic forest), `cave` (crystal cave),
  `castle` (monster castle), `boss` (boss arena); layers `sky` (still), `far`, `mid`, `near` (strips two widths long
  that repeat exactly, for seamless scrolling; ground at 80% of the height). At most ~60 elements per layer.
- **Effects**: `MagicBolt`, `Impact`, `Sparkle` (any colour: the pet's element), `CrystalShield` (the boss's phase 2).

## Magic Lab (`magicLab.tsx`)

- `LabBackdrop` (wall, window, pegboard, shelves, wooden counter from 66% of the height).
- Apparatus (viewBox 100): `Battery`, `Bulb({ lit })`, `Switch({ on })`, `Wire`, `Beaker({ state: empty | ice |
  water | boiling | steam, level })`, `HotPlate({ on })` (no flames), `ColdBox({ open })`, `Torch({ on })`, `Screen`,
  `Pot({ stage: 0–5, wet })` (soil, seed, sprout with seed leaves, first true leaves, young plant, flowering; `wet`:
  darker, glistening soil just watered),
  `WateringCan`, `Microscope`, `Magnet`.
- `Material({ kind })`: nail, spoon, clip, foil, coin, copper, ruler, rubber, wood, wool, eraser, glass, book, paper,
  cardboard, cup (the parts of the circuit, shadow and magnet experiments; `curriculum_games.LAB_SCENES` lists which a scene
  may use, checked when the catalog loads).

## Word Forest (`wordForest.tsx`)

- `ForestLayer({ layer: sky | far | mid | near })` (seamless strips, as above), `Stream`, `Plank`, `BridgePost`,
  `DoorFrame` + `DoorLeaf({ side })` (`DOOR_OPENING` gives where the leaves fit), `Rune({ lit })`, `Chest({ open })`,
  `Creature({ mood: trapped | happy })`, `Vines({ layer: 0 | 1 | 2 })` (stacked: a thick tangle), `Mushroom({ color })`,
  `Flower({ open })`, `LetterStone` (letters and syllables are printed over it by the game).

## Space Adventure (`space.tsx`)

- `SpaceLayer({ layer: sky | far | near })`: a nebula sky with a ringed giant (still), small stars and two far planets,
  bright twinkles and drifting rocks (seamless strips, as above).
- `Rocket` (body, fins, the inside of the dome) and `RocketGlass` (the dome's glass, drawn over the pet: the pet sits at
  `ROCKET_SEAT`), `Thruster` (the flame, stretched by the game to flicker), `Asteroid({ variant: 0–2 })`, `Rubble`, `Laser`.
- `Planet({ kind: ocean | jungle | candy | ice, rescued })`: grey with closed eyes until rescued, then its colours, a
  smile and sparkles (`PLANET_NAME` names them).

## Time Traveler (`timeTravel.tsx`)

- `EraScene({ era: stone | bronze | feudal | modern })`: a cave and a smoking volcano; rice paddies, bamboo and a stilt
  house; a citadel wall with its gate tower, banners and a lotus pond; a city street. Everyday life only: no real person
  is drawn. `EraClouds`: the drifting cloud strip over every era.
- `TimeGate({ lit })` (a stone clock ring on a pedestal) and `PortalSwirl` (spun by the game inside the ring).
- `Artifact({ kind })`: Rìu đá, Trống đồng, Bình gốm, Đồng xu cổ, Con dấu cổ, Cuộn thư tịch, Đèn dầu (`ERA_ARTIFACTS`: which
  era gives which). `DigMound({ dug })`. `Owl({ mood: idle | talk | cheer | worry })`: Cú Thời Gian, the guide.

## Treasure Explorer (`treasureMap.tsx`)

- `MapBoard`: the whole map, drawn at the scene's size. `MAP_STOPS` are its seven places; `ROUTE` is the trail, a
  Catmull-Rom curve through them sampled into a polyline that both draws the dotted path and places the pet
  (`routeAt(f)`, `stopFractions`), so the pet never leaves it.
- `FogCloud` (over a place not reached yet), `MapFlag` (a place reached). The chest is Word Forest's.

## Sounds (`mobile/assets/audio/sfx-*.wav`)

Seven short cues made by `mobile/scripts/generate-game-sfx.py` (stdlib only, 22.05 kHz mono, each under 0.7 s, peaks
well under full scale): `cast` (a rising shimmer), `hit` (a soft thump), `pickup` (two bright notes), `unlock` (a click
and a chord), `complete` (a short fanfare), `wrong` (a gentle low wobble, never harsh), `whoosh` (a portal). The
shooters' `game-shot.wav` and `game-break.wav` are reused as `shot` and `break`. `games/engine/sfx.tsx` plays them.

## Not drawn yet (specification)

These need a designer (or a raster pipeline) and are **not** in the app yet:

1. **Pet action sprite sheets.** The pets have idle, walk, move and study strips (`petSprites.ts`). Attack, cast,
   hit reaction, jump, celebrate and victory are made with transforms of the idle art (`rig.ts`). For real frames:
   one PNG strip per pet × evolution stage × action, the same grid as the existing strips (`SPRITE_LAYOUT`), 8–12
   frames, the pet's own design and anatomy kept, transparent background, ≤ 2048 px wide. Then add the actions to
   `PetActivity` and `PetArt` plays them.
2. **Monster animation frames.** Monsters change pose by mood (4 drawings) and move by transforms. Frame-by-frame
   idle / attack / hit / defeat would need sprite strips per monster (same constraints as above).
3. **Music.** Every scene game has sound effects now (see *Sounds*); there is no background music per world yet.
4. **Picture clues of Ghép chữ.** The word's picture comes from the content (`picture` in
   `backend/app/data/curriculum/word_builder.json` and lessons) and is an emoji there: replacing it needs one
   illustration per word.
5. **Worlds for the other subjects**: Tin học's lesson games (outside Lập trình đường đi), Âm nhạc, Mĩ thuật, Giáo dục thể
   chất, Giáo dục công dân, Công nghệ, Hoạt động trải nghiệm and Quốc phòng have no world yet (their games are the
   cards on their own). Real historical figures are not drawn (a portrait needs a reviewed source).
6. **More scenes**: the solar system, ecosystems, two magnets' poles pushing and pulling (the magnet scene shows which
   materials are attracted); the other Word Forest quests (fill-in by context, word classes, paragraphs); Robot
   Adventure switches and doors (need level rules).
