# Game animation: the falling-word games, the pet, the result screen

Scope of this note: *Bắn từ tiếng Anh* (`word_shooter`) and *Bắn thiên thạch* (`meteor`), the pet's body in them, the
pet's sprite playback (`PetArt`), and the scene changes of Học tập outside the game screen. Math Battle, Magic Lab, Word
Forest, the lesson worlds and the game screen's feedback loop are described in [LEARNING_GAMES.md](LEARNING_GAMES.md).

## Architecture (unchanged, extended)

- **One game loop** per play field (`Playfield.tsx`): one `requestAnimationFrame` steps the falling-word engine
  (`wordField.ts`, plain TypeScript: SPAWNING → FALLING → LOCKED → HIT → DESTROYING → REMOVED, or FALLING → MISSED) by
  the real frame time (capped, so a frame after the app was away never jumps), then every frame callback in `ticker`
  (the shooter, the landings). Nothing re-renders per frame: positions and effects are `Animated.Value`s written from
  the loop. Paused (pause menu, background, an explanation open) the loop stops and every clock with it.
- **Pure timelines** (`shooterFx.ts`): a shot is planned once (`planShot`: walk under the word, aim, fire, bullets,
  impact, crack, break) and every visual is a function of the effect clock, so pausing freezes it exactly and a
  replayed frame gives the same picture. Impact happens where the word is (it stops when answered right), at the time the
  bullet reaches it; the word breaks once, counted once (backend), withdrawn if the server does not count it.
- **Writes only on change** (`put`): every value of the shooter and the landings is written only when it changes (most
  sit at rest), which matters most on the web, where each write is a style update.
- **Lite mode for weak devices** (`nextLite`): the loop's average frame time is checked every 30 frames; slower than
  26 ms (about 38 fps) leaves out the decorative extras (embers, sway, bullet trails, sparks of joy, landing dust and
  pebbles) until it is back under 19 ms. The game itself (words, shots, breaks, meanings, hearts) never changes.
  Reduced motion ("Giảm chuyển động") leaves all of them out, and the pet still.

## What moves, and how

| Moment | Motion | Where |
|---|---|---|
| Pet strolling between shots | each leg eased (sets off slowly, slows before it stops); the walk strip follows the distance walked, one loop per `STRIDE_PX` (feet stay planted) | `strollX`, `PetArt phase` |
| Pet idle | its drawn idle strip (breath, blinks, ears, tail) + a small head tilt now and then on an irregular beat | `idleTiltAt` |
| Pet shooting | dart under the word → crouch 140 ms (anticipation, overlapping the dart: never delays the shot) → stretch and a kick back as it fires (90 ms) → damped wobble (follow-through, 260 ms) | `shotPoseAt` |
| Jump of joy, with drawn strips (hệ Sương, hệ Lửa) | its jump strip as the word breaks, 640 ms, then its celebrate strip, 960 ms, then its idle | `leapProgress`, `cheerProgress`, `PetArt leap`, `cheer` |
| Pet shooting, with a drawn attack (hệ Sương, hệ Lửa) | dart under the word → its attack strip, 8 frames in 720 ms, the first bullet leaving at frame 3 (the lunge); it stands until the strip is over, no squash or stretch on top; then its idle | `strikeProgress`, `PetArt strike` |
| Bullets | 2–3, from the pet's head, spread at the muzzle and converging on the word, a fading 3-dot trail | `bulletAt`, `trailAt` |
| Hit | the word flashes at each bullet, cracks, breaks into spinning shards (light gravity) and specks of light; its meaning pops in with a small overshoot, holds 1.3 s, floats up and fades | existing `targetLook`, `shardsAt`, `sparksAt`, `burstLook` |
| Right answer | a hop of joy (squat, arc with a little turn, squash on landing, 420 ms) and four sparks rising over its head | `hopAt`, `joyAt` |
| Wrong answer | a startled little hop back with the head tilted, 420 ms, gentle (never blocks the game) | `startleAt` |
| Meteor falling | the rock spins (the word on it stays level) and sheds embers up its tail, read from its own position (no timer); turns red near the ground | `Rock` |
| Word tile falling | rocks ±2.5° in step with its fall | `WordTile` |
| Target reaching the ground | a flash, a dust ring spreading, five pebbles thrown up and falling back, a 3 px jolt of the sky and ground (not of the words); one heart, once (backend) | `landingAt`, `LandingLayer` |
| Screen change in Học tập | fade and rise, 260 ms | `PageIn` |
| Result | the pet hops twice on a completed stage; the stars pop in one by one with a spring | `ResultScreen` (`Victory`, `Stars`) |

`PetArt` takes an optional `phase` (1 = one loop of its strip) for the walk and move strips; without it every caller
plays the strips on their own clock as before.

## The drawn attack

A pet with an `attack` strip (`petSprites.ts`; so far hệ Sương and hệ Lửa, Lv.0 to Lv.6) plays it wherever it attacks: *Bắn từ*,
*Bắn thiên thạch*, Math Battle and Math Kingdom, the rescue in Word Forest, Space Adventure (in its dome), and the guide's
shot in `TutorialArt`. `MagicLab` and `LabQuest` "cast" a mix, which is not an attack: they keep their own motion. Other
pets stay as they were: `attackWindupMs` is 0 for them, and every game then runs its old timing.

- **One clock.** The strip is not played on its own timer: `PetArt` takes `strike`, one `Animated.Value` going 0 → 1, and
  shows the frame for that point. The game's shot runs off the same moment, so they cannot drift apart, on a slow phone
  or across a pause. Playfield writes it from its effect clock; the others from `useRig` (`attackStrip`).
- **The shot** leaves at `ATTACK_RELEASE_FRAME` (frame 3 of 8, after `attackWindupMs` = 270 ms): the bolt, the laser, the
  bullets or the vine breaking wait for it. So does the hit: the pet is still following through when it lands.
- **Back to idle** needs nothing: at 0 and 1 the strip is hidden and what the pet was doing shows again. Stopped halfway
  (`rig.stop`, a skipped reaction), it goes back at once.
- **Android and iOS.** The strip stays mounted at opacity 0 from the start of the game, so it is drawn at once, without
  the blank first frames of a picture mounted as it is needed; `useGameAssets` loads it before the countdown, and until it
  has loaded the pet simply stays in its idle. Frames sit on whole points in a frame with clear edges, so a phone's
  rounding shows no sliver of the next frame. The strip is 2048 px wide, within what phones draw.
- **Size.** The attack boards draw the pet smaller than the idle boards, so `scripts/fit-action-strip.mjs` lays the first
  frame over the idle's (same amount of pet, same middle, same ground line); the strip's frame is `ACTION_WINDOW.attack`
  (1.2) times the idle's, for the lunge. The proportions of the two boards differ a little (the idle's head is larger),
  which shows only as the pet turning into its wind-up.
- **Touching poses.** Where a sheet's poses touch (hệ Lửa's cheek against the next frame's tail), `slice-sprite-sheet.mjs`
  parts them along the dark outlines where they meet before it cuts the frames, so no frame shows a piece of its neighbour.

## The drawn jump

A pet with a `jump` strip (so far hệ Sương and hệ Lửa, Lv.0 to Lv.6: 8 frames in 640 ms, in a 4 x 2 grid so the larger
`ACTION_WINDOW.jump` of 1.5 stays sharp within 2048 px) plays it wherever the pet jumps in a game, with `PetArt leap`, the
same way as the attack: `rig.play('jump')` in Word Forest and Time Traveler, the jump that opens `rig.play('celebrate')`,
the jump of joy when a word breaks in the falling-word games (`leapProgress`; the pet stands until it lands, and a new shot
cuts it short), and the result screen. The rise and fall are drawn in the frames, so nothing is moved or stretched on top;
other pets keep their hops. A pet that sets off walking in Treasure Explorer or Word Forest cuts its jump short: jump frames
do not slide along the ground.

hệ Lửa's Lv.5 and Lv.6 leap higher than the window of 1.5, so they are imported with `fit` 0.96 (`fit-action-strip.mjs`):
drawn 4% smaller in this strip alone, the window and every other strip as they are. Its Lv.0 sheet draws the egg leaving
the stones of its nest on the ground.

Rockets, robots, monsters and beakers keep their own hops (Space Adventure's `ship`, the robot of `CurriculumGames`). So do
screens that are not games: the journey map, unlock and promotion notices, the companion, the room.

## The drawn celebration

A pet with a `celebrate` strip (so far hệ Sương and hệ Lửa, Lv.0 to Lv.6: 8 frames in 960 ms) plays it with `PetArt cheer`, the
same way, when the player answers right or finishes a challenge. Other pets stay as they were: `rig.play('cheer')` does
nothing for them, and every game's reactions and timings are theirs.

- **A right answer**: `rig.play('cheer')`, the strip alone, once the answer's own reaction has shown what it did. It never
  holds the game: the reaction ends as it starts, and the next answer cuts it short (an attack resets the rig).
- **A challenge done** (a monster defeated, a stage won, a place reached, a brew finished, a completed result screen):
  `rig.play('celebrate')`, a jump and then the strip, with no turning on top. Where a game waits for it to end (the last
  monster), it now waits about 1.6 s.

| Game | When it plays |
|---|---|
| *Bắn từ*, *Bắn thiên thạch* | the word breaks: jump of joy, then the strip (`cheerProgress`); a new shot or a wrong answer cuts it short |
| Math Battle, Math Kingdom | the monster has taken the hit; a jump first when it is defeated |
| Word Forest | on the far bank, after the jump and the run across |
| Forest door, forest rescue | as the door starts to open (over before the pet walks through); once the vine has fallen |
| Space Adventure | in its dome, as the asteroid breaks |
| Time Traveler | after its jump at the dig |
| Treasure Explorer | where it stops; a jump first at a new place |
| Lab world, Magic Lab | as the drop lands; a jump first when the potion or the experiment is done |
| *Chọn đáp án*, *Sắp xếp câu*, the subject scenes, the coding robot | `usePetCheer`, as the question turns solved (the robot's own hop stays) |
| Result screen | a completed stage: a jump, then the strip |

Games with no pet on screen (`GeometryWorkshop`, `SentenceTrain`, `SentenceXray`) have nothing to play it on.

## Measured (Expo web dev build, headless Chrome, 400 × 860, 12 s of play shooting about a word a second)

| | 1× CPU | 4× CPU throttle (weak device proxy) |
|---|---|---|
| Bắn từ, before | 60.1 fps, 0 frames > 25 ms | 26.3 fps |
| Bắn từ, after | 60.0 fps, 0 frames > 25 ms | 32.8 fps |
| Bắn thiên thạch, before | 60.0 fps, 0 frames > 25 ms | 30.5 fps |
| Bắn thiên thạch, after | 60.0 fps, 0 frames > 25 ms | 38.7 fps |
| Bắn thiên thạch, 40 s of landings, after | 60.0 fps, 0 frames > 25 ms | |

Single runs, a development bundle and a desktop browser: indicative, not a device measurement. Not measured: Android
and iOS hardware, native-driver behaviour on device, memory over a long session (the JS heap stayed 30–60 MB).

Screenshots of these runs: [game-screenshots/](game-screenshots/) `anim-*.png`.

## Not done here

- The attacks, jumps and celebrations of the other four elements (they are poses of the drawn strips); per-part secondary motion (ears, tail) beyond what the idle and walk strips draw.
- Particle object pooling beyond the per-shot sets (each shot owns its bullets, trails, shards and sparks for its life).
- A device FPS run (Expo Go / a dev build on a phone) and a long-session memory profile.
