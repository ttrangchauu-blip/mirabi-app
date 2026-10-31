/**
 * The pet that shoots in the falling-word games (Bắn từ tiếng Anh, Bắn thiên thạch): where it stands, how it moves and
 * when its shots fly, as plain functions of one pause-aware effect clock (ms). Nothing here keeps timers: the play
 * field evaluates these on every frame, so pausing the clock freezes the pet, the bullets and the effects together.
 *
 * Position and sprite are separate: `petX` is where the pet is on screen; the play field picks its idle or walk strip
 * from `petMoving`. A shot appends a move (append-only, starting now), so where the pet was at an earlier moment never
 * changes and a bullet always leaves from where the pet actually stood when it fired.
 */

export const PET_SIZE = 56;
/** Gap between the pet and the field's sides. */
export const PET_MARGIN = 8;
const MOVE_SPEED = 1.0; // px per ms: quick, so moving never delays the answer much, yet a visible glide
const MOVE_MIN_MS = 120;
const MOVE_MAX_MS = 280;
/** The short stop to aim before firing, and the rest after it before wandering again. */
export const AIM_MS = 40;
export const HOLD_MS = 260;
/**
 * How the shots fly. Tune here: `bullets` (2–3), the gap between bullets, and the flight time, from the distance at
 * `bulletSpeed` (px per ms) kept between `flightMinMs` and `flightMaxMs`, so near and far words both read clearly.
 */
export const SHOT_TUNING = { bullets: 3, bulletGapMs: 150, bulletSpeed: 0.45, flightMinMs: 500, flightMaxMs: 800 };
export type ShotTuning = typeof SHOT_TUNING;
export const BULLETS = SHOT_TUNING.bullets;
/** Bullets leave this far in from the top of the pet's box (its head, not the middle of the screen). */
const MUZZLE_Y = 10;
const SPREAD = 5;
export const SHATTER_MS = 650;
/** After the last bullet hits, the word glows and cracks this long before it breaks. */
export const CRACK_MS = 160;
/** Each bullet that hits makes the word flash this long. */
export const FLASH_MS = 140;
/** The meaning shown where a word broke: it pops in, stays plainly for a moment, then floats up and fades out. */
export const BURST_POP_MS = 320;
export const BURST_HOLD_MS = 1300;
export const BURST_FADE_MS = 500;
export const BURST_MS = BURST_HOLD_MS + BURST_FADE_MS;
/** Idle: a stroll across the whole field and back (px per ms), resting a moment at each side before turning round. */
const STROLL_SPEED = 0.05;
const STROLL_REST_MS = 700;
/** "Chưa đúng": the pet is a little startled (a small hop back and a tilt of the head), no shot. Short: it never holds
 * up the game. */
export const WIGGLE_MS = 420;

export type Bounds = { min: number; max: number };
export type Move = { t: number; from: number; to: number; dur: number };
export type Point = { x: number; y: number };
/** One shot at a word that was answered. The word stopped where it was when it was answered (`target`, its centre):
 * the pet fires at `fireAt`, the first bullet reaches it at `impactAt` and each one after it `gap` later (the word flashes
 * at each), it cracks after the last one and breaks at `breakAt` into glowing pieces, gone at `doneAt`. */
export type ShotPlan = { createdAt: number; fireAt: number; impactAt: number; breakAt: number; doneAt: number; target: Point;
  flight: number; bullets: number; gap: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** Where the pet's box may go: inside the field, never past its sides. */
export const petBounds = (width: number): Bounds => ({ min: PET_MARGIN, max: Math.max(PET_MARGIN, width - PET_SIZE - PET_MARGIN) });

const lastMove = (moves: Move[], t: number) => {
  for (let i = moves.length - 1; i >= 0; i--) if (moves[i].t <= t) return moves[i];
  return null;
};

/** The left edge of the pet's box at time `t`. `home` is where it starts; `wander` is off with reduced motion. */
export function petX(moves: Move[], t: number, home: number, bounds: Bounds, wander: boolean): number {
  const m = lastMove(moves, t);
  let x: number;
  let restFrom: number;
  if (!m) { x = home; restFrom = 0; }
  else if (t < m.t + m.dur) return clamp(m.from + (m.to - m.from) * easeInOut((t - m.t) / m.dur), bounds.min, bounds.max);
  else { x = m.to; restFrom = m.t + m.dur + HOLD_MS; }
  if (wander && t > restFrom) x = strollX(clamp(x, bounds.min, bounds.max), t - restFrom, bounds);
  return clamp(x, bounds.min, bounds.max);
}

/** Where a pet that set off from `x0` `since` ms ago is on its stroll: first to the farther side, then side to side.
 * Each leg sets off slowly, picks up speed and slows down again before it stops (a sine ease, average speed
 * STROLL_SPEED), so the pet never starts or stops dead. */
function strollX(x0: number, since: number, { min, max }: Bounds): number {
  const span = max - min;
  if (span <= 0) return x0;
  let atMax = max - x0 >= x0 - min; // heading for the right side first
  const firstSpan = atMax ? max - x0 : x0 - min;
  const first = firstSpan / STROLL_SPEED;
  if (since < first) return x0 + (atMax ? 1 : -1) * firstSpan * easeSine(since / first);
  const leg = span / STROLL_SPEED;
  let t = (since - first) % (2 * (STROLL_REST_MS + leg));
  for (let i = 0; i < 2; i++) {
    if (t < STROLL_REST_MS) return atMax ? max : min;
    t -= STROLL_REST_MS;
    if (t < leg) return atMax ? max - span * easeSine(t / leg) : min + span * easeSine(t / leg);
    t -= leg;
    atMax = !atMax;
  }
  return atMax ? max : min;
}

const easeSine = (k: number) => (1 - Math.cos(Math.PI * clamp(k, 0, 1))) / 2;

/** Walking to a firing spot (its walk strip plays), and which way it faces: 1 right, -1 left. */
export function petMoving(moves: Move[], t: number): { moving: boolean; facing: 1 | -1 } {
  const m = lastMove(moves, t);
  if (!m || t >= m.t + m.dur || m.to === m.from) return { moving: false, facing: 1 };
  return { moving: true, facing: m.to >= m.from ? 1 : -1 };
}

/** How far ahead `petDrift` looks, and the least the pet must cover in that time to count as strolling (about 10 px/s):
 * resting at a side before turning round, it just stands. */
const DRIFT_PROBE_MS = 60;
const DRIFT_MIN_PX = 0.6;

/** Strolling while idle (the stroll in `petX`), and which way: 1 right, -1 left; null while it stands or darts. */
export function petDrift(moves: Move[], t: number, home: number, bounds: Bounds, wander: boolean): 1 | -1 | null {
  if (!wander || petMoving(moves, t).moving) return null;
  const d = petX(moves, t + DRIFT_PROBE_MS, home, bounds, wander) - petX(moves, t, home, bounds, wander);
  return Math.abs(d) < DRIFT_MIN_PX ? null : d > 0 ? 1 : -1;
}


export const muzzle = (x: number, fieldHeight: number, petBottom: number): Point =>
  ({ x: x + PET_SIZE / 2, y: fieldHeight - petBottom - PET_SIZE + MUZZLE_Y });

/**
 * A shot at `target` (the centre of the word that was answered) decided at `now`: the pet walks under it (a short,
 * quick move, appended to `moves`), stops to aim, then fires; the first bullet breaks the word.
 */
export function planShot(moves: Move[], now: number, target: Point, home: number, bounds: Bounds, wander: boolean,
  fieldHeight: number, petBottom: number, tuning: ShotTuning = SHOT_TUNING): ShotPlan {
  const from = petX(moves, now, home, bounds, wander);
  const to = clamp(target.x - PET_SIZE / 2, bounds.min, bounds.max);
  const distance = Math.abs(to - from);
  const dur = distance < 4 ? 0 : clamp(distance / MOVE_SPEED, MOVE_MIN_MS, MOVE_MAX_MS);
  moves.push({ t: now, from, to: distance < 4 ? from : to, dur });
  const fireAt = now + dur + AIM_MS;
  const start = muzzle(distance < 4 ? from : to, fieldHeight, petBottom);
  const flight = clamp(Math.hypot(target.x - start.x, target.y - start.y) / tuning.bulletSpeed, tuning.flightMinMs, tuning.flightMaxMs);
  const impactAt = fireAt + flight;
  const bullets = clamp(Math.round(tuning.bullets), 2, 3);
  const breakAt = impactAt + (bullets - 1) * tuning.bulletGapMs + CRACK_MS;
  return { createdAt: now, fireAt, impactAt, breakAt, doneAt: breakAt + SHATTER_MS, target, flight, bullets, gap: tuning.bulletGapMs };
}

/** How the word looks while it is shot: `glow` 0..1 (a soft pulse while locked on, a flash at each bullet that hits,
 * bright while it cracks), `crack` 0..1 (the cracks spreading after the last hit), `scale`, a small `shake` (px), and
 * `visible` (false once it has broken). */
export function targetLook(plan: ShotPlan, t: number, reduceMotion = false): { glow: number; crack: number; scale: number; shake: number; visible: boolean } {
  if (t >= plan.breakAt) return { glow: 0, crack: 1, scale: 1, shake: 0, visible: false };
  const lastHit = plan.impactAt + (plan.bullets - 1) * plan.gap;
  if (t >= lastHit) {
    // Held there while the server confirms the answer: fully cracked until it breaks.
    const k = Math.min(1, (t - lastHit) / CRACK_MS);
    // The last bullet's flash stays on while it cracks.
    return { glow: 0.92 + 0.08 * k, crack: k, scale: 1.05 + 0.04 * k, shake: reduceMotion ? 0 : Math.sin(k * Math.PI * 8) * 1.6 * k, visible: true };
  }
  let flash = 0;
  for (let i = 0; i < plan.bullets; i++) {
    const since = t - (plan.impactAt + i * plan.gap);
    if (since >= 0 && since < FLASH_MS) flash = Math.max(flash, 1 - since / FLASH_MS);
  }
  const hit = t >= plan.impactAt;
  // Locked on: a soft, slow pulse until the bullets arrive; brighter once the first one has hit.
  const lock = 0.18 + 0.12 * Math.sin(((t - plan.createdAt) / 260) * Math.PI);
  return { glow: Math.max(lock, hit ? 0.35 + 0.6 * flash : 0), crack: 0, scale: 1 + 0.05 * flash, shake: 0, visible: true };
}

/** Bullet `i` of a shot at time `t` (null before it leaves or once it has arrived), flying from `origin` (the pet's
 * muzzle when it fired) to `target`: where the word is at `t`, so the bullet chases a word that keeps falling and
 * reaches it exactly at the end of its flight. Slightly spread, so two or three small bullets read as a burst. */
export function bulletAt(plan: ShotPlan, i: number, t: number, origin: Point, target: Point = plan.target): (Point & { angle: number }) | null {
  if (i >= plan.bullets) return null;
  const leave = plan.fireAt + i * plan.gap;
  if (t < leave || t >= leave + plan.flight) return null;
  const k = (t - leave) / plan.flight;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const len = Math.hypot(dx, dy) || 1;
  const side = (i - (plan.bullets - 1) / 2) * SPREAD * (1 - k); // spread at the muzzle, together at the target
  return { x: origin.x + dx * k - (dy / len) * side, y: origin.y + dy * k + (dx / len) * side, angle: Math.atan2(dy, dx) };
}

/** Lean toward the target while aiming and firing (degrees), back to upright after. */
export function leanAt(plan: ShotPlan, t: number, petCenterX: number): number {
  if (t < plan.fireAt - AIM_MS || t > plan.fireAt + (plan.bullets - 1) * plan.gap + 120) return 0;
  return clamp((plan.target.x - petCenterX) / 12, -8, 8);
}

/** The pieces of a broken word: `count` fragments of its tile flying out from the centre, spinning, falling a little and
 * fading. */
export function shardsAt(plan: ShotPlan, t: number, count = 8): { x: number; y: number; rotate: number; opacity: number; size: number }[] {
  const since = t - plan.breakAt;
  if (since < 0 || since > SHATTER_MS) return [];
  const k = since / SHATTER_MS;
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count + (i % 2 ? 0.35 : 0);
    const reach = (i % 3 === 0 ? 54 : 40) * (1 - (1 - k) ** 3);
    return { x: plan.target.x + Math.cos(angle) * reach, y: plan.target.y + Math.sin(angle) * reach * 0.7 + 36 * k * k,
      rotate: (i % 2 ? 1 : -1) * 260 * k, opacity: k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4, size: i % 3 === 0 ? 9 : 6 };
  });
}

/** The glowing specks of light a broken word turns into: they burst out fast, slow down, drift up a little and twinkle
 * out, each at its own pace. */
export function sparksAt(plan: ShotPlan, t: number, count = 10): { x: number; y: number; opacity: number; scale: number }[] {
  const since = t - plan.breakAt;
  if (since < 0 || since > SHATTER_MS) return [];
  return Array.from({ length: count }, (_, i) => {
    const life = SHATTER_MS * (0.65 + (0.35 * ((i * 7) % 10)) / 10);
    const k = Math.min(1, since / life);
    const angle = (2 * Math.PI * (i + 0.5)) / count + (i % 3) * 0.2;
    const reach = (28 + ((i * 13) % 5) * 9) * (1 - (1 - k) ** 3);
    return { x: plan.target.x + Math.cos(angle) * reach, y: plan.target.y + Math.sin(angle) * reach - 14 * k,
      opacity: k >= 1 ? 0 : k < 0.15 ? k / 0.15 : 1 - ((k - 0.15) / 0.85) ** 1.5, scale: 1.3 - 0.8 * k };
  });
}

const easeOutBack = (k: number) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;

/** Opacity, scale and lift of a meaning shown at a broken word, `age` ms after it appeared (gone after BURST_MS): it pops
 * in with a little overshoot, stays, then floats up and fades. */
export function burstLook(age: number, reduceMotion: boolean): { opacity: number; rise: number; scale: number } {
  if (age < BURST_POP_MS) {
    const k = age / BURST_POP_MS;
    return { opacity: Math.min(1, k * 2.5), rise: reduceMotion ? 0 : 10 * (1 - k), scale: reduceMotion ? 1 : 0.55 + 0.45 * easeOutBack(k) };
  }
  if (age <= BURST_HOLD_MS) return { opacity: 1, rise: 0, scale: 1 };
  const k = Math.min(1, (age - BURST_HOLD_MS) / BURST_FADE_MS);
  return { opacity: 1 - k, rise: reduceMotion ? 0 : -22 * k, scale: 1 };
}

// ------------------------------------------------------------------------------------------------- the pet's body
// The pet is drawn by its sprite strips (idle: breath, blinks, ears and tail; walk; dash); these give its whole body the
// actions of the game on top, as one pose per frame: squash and stretch, a lift off the ground, a tilt and a step back.
// Pure functions of the effect clock, like the rest of this file.

export type Pose = { sx: number; sy: number; lift: number; tilt: number; back: number };
export const REST_POSE: Pose = { sx: 1, sy: 1, lift: 0, tilt: 0, back: 0 };
/** Anticipation: the pet crouches this long before it fires. It overlaps the end of its dart (it lands into the
 * crouch), so it never delays the shot. */
export const ANTICIPATE_MS = 140;
/** The release (it springs up as it fires, pushed back a little by the shot) and the wobble it settles with. */
export const RELEASE_MS = 90;
export const SETTLE_MS = 260;
/** The happy hop when the word it shot breaks. */
export const HOP_MS = 420;

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (k: number) => 1 - (1 - k) ** 3;

/** The pet's pose for one shot at `t`, or null when the shot does not move it. Crouch → release (stretch, recoil) →
 * a damped settle (follow-through) → a hop when the word breaks. */
export function shotPoseAt(plan: ShotPlan, t: number): Pose | null {
  const crouchFrom = plan.fireAt - ANTICIPATE_MS;
  if (t >= crouchFrom && t < plan.fireAt) {
    const k = easeOut((t - crouchFrom) / ANTICIPATE_MS);
    return { sx: mix(1, 1.08, k), sy: mix(1, 0.86, k), lift: 0, tilt: 0, back: 0 };
  }
  if (t >= plan.fireAt && t < plan.fireAt + RELEASE_MS) {
    const k = easeOut((t - plan.fireAt) / RELEASE_MS);
    return { sx: mix(1.08, 0.94, k), sy: mix(0.86, 1.1, k), lift: 3 * k, tilt: 0, back: 4 * Math.sin(Math.PI * k) };
  }
  const settled = plan.fireAt + RELEASE_MS;
  if (t >= settled && t < settled + SETTLE_MS) {
    const k = (t - settled) / SETTLE_MS;
    const wobble = Math.exp(-4 * k) * Math.cos(3 * Math.PI * k);
    return { sx: 1 - 0.06 * wobble, sy: 1 + 0.1 * wobble, lift: 3 * (1 - k) * Math.max(0, wobble), tilt: 0, back: 0 };
  }
  if (t >= plan.breakAt && t < plan.breakAt + HOP_MS) return hopAt((t - plan.breakAt) / HOP_MS);
  return null;
}

/** A small jump of joy (0..1 through it): squat, up in an arc with a little turn, squash on landing. */
export function hopAt(k: number): Pose {
  if (k < 0.15) { const q = k / 0.15; return { sx: mix(1, 1.06, q), sy: mix(1, 0.9, q), lift: 0, tilt: 0, back: 0 }; }
  if (k < 0.85) {
    const q = (k - 0.15) / 0.7;
    return { sx: mix(0.96, 1, q), sy: mix(1.08, 1, q), lift: 16 * Math.sin(Math.PI * q), tilt: 6 * Math.sin(2 * Math.PI * q), back: 0 };
  }
  const q = (k - 0.85) / 0.15;
  return { sx: mix(1.05, 1, q), sy: mix(0.93, 1, q), lift: 0, tilt: 0, back: 0 };
}

/** "Chưa đúng": a startled little hop back with the head tilted, then back to its spot. Gentle (no fall, no frown). */
export function startleAt(since: number | null, t: number): Pose | null {
  if (since === null || t < since || t >= since + WIGGLE_MS) return null;
  const k = (t - since) / WIGGLE_MS;
  const up = k < 0.45 ? Math.sin((Math.PI * k) / 0.45) : 0;
  const away = k < 0.3 ? easeOut(k / 0.3) : 1 - easeSine((k - 0.3) / 0.7);
  return { sx: 1 - 0.04 * up, sy: 1 + 0.06 * up, lift: 5 * up, tilt: -8 * away, back: 7 * away };
}

/** Now and then, while it stands still, the pet tilts its head a little: on an irregular beat (never in step with its
 * idle strip), for TILT_MS. */
const TILT_EVERY = [4300, 6100, 5200, 7400];
const TILT_MS = 900;
export function idleTiltAt(t: number): number {
  const loop = TILT_EVERY.reduce((a, b) => a + b, 0);
  let at = ((t % loop) + loop) % loop;
  for (let i = 0; i < TILT_EVERY.length; i++) {
    if (at < TILT_EVERY[i]) {
      const into = at - (TILT_EVERY[i] - TILT_MS);
      return into < 0 ? 0 : (i % 2 ? -5 : 5) * Math.sin(Math.PI * (into / TILT_MS));
    }
    at -= TILT_EVERY[i];
  }
  return 0;
}

/** Combines the poses acting at once (a shot and a startle, say): the strongest of each part. */
export function combinePoses(poses: (Pose | null)[]): Pose {
  const out = { ...REST_POSE };
  for (const p of poses) {
    if (!p) continue;
    if (Math.abs(p.sx - 1) > Math.abs(out.sx - 1)) out.sx = p.sx;
    if (Math.abs(p.sy - 1) > Math.abs(out.sy - 1)) out.sy = p.sy;
    if (p.lift > out.lift) out.lift = p.lift;
    if (Math.abs(p.tilt) > Math.abs(out.tilt)) out.tilt = p.tilt;
    if (Math.abs(p.back) > Math.abs(out.back)) out.back = p.back;
  }
  return out;
}

/** Sparks of joy around the pet's head while it hops after a word breaks: `count` specks rising and twinkling out
 * (positions relative to the top centre of the pet). */
export const JOY = 4;
export function joyAt(plan: ShotPlan, t: number, count = JOY): { x: number; y: number; opacity: number; scale: number }[] {
  const since = t - plan.breakAt;
  const life = HOP_MS + 160;
  if (since < 0 || since >= life) return [];
  const k = since / life;
  return Array.from({ length: count }, (_, i) => {
    const side = i - (count - 1) / 2;
    return { x: side * 14 + side * 10 * k, y: -8 - 34 * easeOut(k) - (i % 2) * 6, opacity: k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8,
      scale: 0.6 + 0.6 * Math.sin(Math.PI * k) };
  });
}

// ------------------------------------------------------------------------------------------------- bullets and impacts

/** The glowing trail behind bullet `i`: where it was TRAIL_STEP_MS, 2 × and 3 × earlier in its flight (never behind the
 * muzzle), fading out. */
export const TRAIL = 3;
export const TRAIL_STEP_MS = 18;
export function trailAt(plan: ShotPlan, i: number, t: number, origin: Point, target: Point = plan.target): ({ x: number; y: number; opacity: number } | null)[] {
  const leave = plan.fireAt + i * plan.gap;
  return Array.from({ length: TRAIL }, (_, j) => {
    const at = t - (j + 1) * TRAIL_STEP_MS;
    if (t >= leave + plan.flight || at < leave) return null;
    const b = bulletAt(plan, i, at, origin, target);
    return b ? { x: b.x, y: b.y, opacity: 0.55 * (1 - j / TRAIL) } : null;
  });
}

/** A rock (or word) that reached the ground: a flash, a ring of dust spreading along the ground and a few pebbles
 * thrown up and falling back (gravity), all gone after LANDING_MS. `shake`: how far the field jolts down (px). */
export const LANDING_MS = 560;
export const PEBBLES = 5;
export function landingAt(since: number): { ring: number; flash: number; dust: number; shake: number;
  pebbles: { x: number; y: number; opacity: number }[] } | null {
  if (since < 0 || since >= LANDING_MS) return null;
  const k = since / LANDING_MS;
  const flash = since < 120 ? 1 - since / 120 : 0;
  const shake = since < 220 ? 3 * Math.exp(-since / 60) * Math.cos(since / 22) : 0;
  const pebbles = Array.from({ length: PEBBLES }, (_, i) => {
    const vx = (i - (PEBBLES - 1) / 2) * 0.09; // px per ms, sideways
    const vy = -(0.32 + (i % 2) * 0.1); // px per ms, up
    const g = 0.0018; // px per ms², down
    return { x: vx * since, y: Math.min(0, vy * since + 0.5 * g * since * since), opacity: 1 - k };
  });
  return { ring: easeOut(k), flash, dust: k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75, shake, pebbles };
}

// ------------------------------------------------------------------------------------------------- walking in step

/** The distance one full loop of the walk (or dash) strip covers: the pet's feet stay planted when its strip is driven
 * by the distance it walked (frame = distance / STRIDE_PX × frames) instead of a clock. */
export const STRIDE_PX = PET_SIZE * 0.8;

// ------------------------------------------------------------------------------------------------- weak devices

/** Lite mode (the decorative extras left out) turns on when the game loop's average frame (ms) is slower than
 * LITE_ON_MS, and off again only below LITE_OFF_MS, so it never flickers between the two. Checked every
 * LITE_CHECK_FRAMES frames. */
export const LITE_ON_MS = 26;
export const LITE_OFF_MS = 19;
export const LITE_CHECK_FRAMES = 30;
export const nextLite = (lite: boolean, frameMs: number) => (lite ? frameMs > LITE_OFF_MS : frameMs > LITE_ON_MS);
