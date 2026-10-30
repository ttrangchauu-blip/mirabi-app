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
export const SHATTER_MS = 450;
/** The meaning shown where a word broke: plainly for a moment, then fading out. */
export const BURST_HOLD_MS = 1200;
export const BURST_FADE_MS = 500;
export const BURST_MS = BURST_HOLD_MS + BURST_FADE_MS;
/** Idle: a stroll across the whole field and back (px per ms), resting a moment at each side before turning round. */
const STROLL_SPEED = 0.05;
const STROLL_REST_MS = 700;
/** "Chưa đúng": a small shake of the pet, no shot. */
export const WIGGLE_MS = 320;

export type Bounds = { min: number; max: number };
export type Move = { t: number; from: number; to: number; dur: number };
export type Point = { x: number; y: number };
/** One shot at a word that was answered: when the pet fires, when the first bullet breaks it, when the pieces are gone.
 * `target` is where the word was when the shot was decided; the play field sets it to where the word was hit once the
 * first bullet reaches it (the word keeps falling meanwhile, and the bullets follow it). */
export type ShotPlan = { createdAt: number; fireAt: number; impactAt: number; doneAt: number; target: Point; flight: number;
  bullets: number; gap: number };

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

/** Where a pet that set off from `x0` `since` ms ago is on its stroll: first to the farther side, then side to side. */
function strollX(x0: number, since: number, { min, max }: Bounds): number {
  const span = max - min;
  if (span <= 0) return x0;
  let atMax = max - x0 >= x0 - min; // heading for the right side first
  const first = (atMax ? max - x0 : x0 - min) / STROLL_SPEED;
  if (since < first) return x0 + (atMax ? 1 : -1) * since * STROLL_SPEED;
  const leg = span / STROLL_SPEED;
  let t = (since - first) % (2 * (STROLL_REST_MS + leg));
  for (let i = 0; i < 2; i++) {
    if (t < STROLL_REST_MS) return atMax ? max : min;
    t -= STROLL_REST_MS;
    if (t < leg) return atMax ? max - t * STROLL_SPEED : min + t * STROLL_SPEED;
    t -= leg;
    atMax = !atMax;
  }
  return atMax ? max : min;
}

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

/** A small "no" shake after a wrong answer, added to the pet's position. */
export const wiggleAt = (since: number | null, t: number) => {
  if (since === null || t < since || t > since + WIGGLE_MS) return 0;
  const k = (t - since) / WIGGLE_MS;
  return 5 * Math.sin(k * Math.PI * 6) * (1 - k);
};

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
  return { createdAt: now, fireAt, impactAt, doneAt: impactAt + (bullets - 1) * tuning.bulletGapMs + SHATTER_MS, target, flight,
    bullets, gap: tuning.bulletGapMs };
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

/** The pieces of a broken word: `count` small shards flying out from the centre, falling a little and fading. */
export function shardsAt(plan: ShotPlan, t: number, count = 8): { x: number; y: number; rotate: number; opacity: number; size: number }[] {
  const since = t - plan.impactAt;
  if (since < 0 || since > SHATTER_MS) return [];
  const k = since / SHATTER_MS;
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count + (i % 2 ? 0.35 : 0);
    const reach = (i % 3 === 0 ? 46 : 34) * (1 - (1 - k) ** 2);
    return { x: plan.target.x + Math.cos(angle) * reach, y: plan.target.y + Math.sin(angle) * reach + 30 * k * k,
      rotate: (i % 2 ? 1 : -1) * 220 * k, opacity: 1 - k, size: i % 3 === 0 ? 9 : 6 };
  });
}

/** Opacity and lift of a meaning shown at a broken word, `age` ms after it appeared (gone after BURST_MS). */
export function burstLook(age: number, reduceMotion: boolean): { opacity: number; rise: number } {
  if (age <= BURST_HOLD_MS) return { opacity: 1, rise: 0 };
  const k = Math.min(1, (age - BURST_HOLD_MS) / BURST_FADE_MS);
  return { opacity: 1 - k, rise: reduceMotion ? 0 : -18 * k };
}
