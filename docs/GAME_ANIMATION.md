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

- Real sprite frames for attack, jump and celebrate (they are poses of the drawn strips); per-part secondary motion
  (ears, tail) beyond what the idle and walk strips draw.
- Particle object pooling beyond the per-shot sets (each shot owns its bullets, trails, shards and sparks for its life).
- A device FPS run (Expo Go / a dev build on a phone) and a long-session memory profile.
