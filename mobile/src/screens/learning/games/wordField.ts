/**
 * The falling-word engine (Bắn từ tiếng Anh, Bắn thiên thạch): every word on the field, where it is, how it moves and
 * what has happened to it. Plain TypeScript, no React: the play field steps it once per animation frame and copies the
 * positions into each word's own Animated values, so nothing re-renders while words fall.
 *
 * Rules it keeps:
 * - Coordinates are pixels in the field's own frame (top-left of the field). A word's x is chosen once, when it comes
 *   in, and never changes; its y only ever grows. Nothing is recomputed from the field's height, so the keyboard opening
 *   or closing never moves a word (the ground moves; each word keeps the moment it lands).
 * - A new word comes in at the top, only where it can never touch another word (spawn manager, `place`): its box (its
 *   real width and height, answer boxes included) is clear of every word, with a gap, and when it shares a column with a
 *   slower word below, the gap is wide enough that it can't catch that word up before it lands. With no such place it
 *   waits in the queue (SPAWNING) and is tried again every frame, in order: it is never forced in.
 * - A falling word never enters the box of a word below it in its column (a word being shot stops where it is): it
 *   waits just above it and falls on once there is room.
 *
 * States: SPAWNING (queued, not on screen) → FALLING → LOCKED (answered right: stopped where it was, being shot) → HIT
 * (a bullet reached it) → DESTROYING (it broke: pieces and its meaning) → REMOVED. FALLING → MISSED (it reached the
 * ground) → REMOVED. LOCKED/HIT → FALLING when a shot is withdrawn (the server did not count it).
 */

export type WordState = 'SPAWNING' | 'FALLING' | 'LOCKED' | 'HIT' | 'DESTROYING' | 'REMOVED' | 'MISSED';

export type WordSpec<T> = {
  id: string;
  /** What is shown (the English word, or the Vietnamese meaning on a meteor). */
  word: string;
  acceptedAnswers: readonly string[];
  /** The word's real box: its tile and its answer boxes. */
  width: number;
  height: number;
  /** Time to fall from the top to the ground (ms). 0: it drifts down, stops part way and waits (never missed). */
  travelMs: number;
  /** How far it had already fallen (0..1): only used for the words open when the game is (re)opened. */
  startProgress?: number;
  data: T;
};

export type FallingWord<T> = {
  readonly id: string;
  word: string;
  acceptedAnswers: readonly string[];
  x: number;
  y: number;
  width: number;
  height: number;
  /** px per ms of play time. */
  speed: number;
  /** Engine time it came on screen (ms). */
  spawnTime: number;
  state: WordState;
  travelMs: number;
  /** Where it stops: the ground (it lands there) or, a word that only drifts in, part way down. */
  stopY: number;
  lands: boolean;
  /** It is never reported landed before this (the server refuses a miss before half its fall time). */
  earliestLand: number;
  startProgress: number;
  /** It had to wait in the queue at least once. */
  waited: boolean;
  data: T;
};

export type FieldEventType = 'spawned' | 'landed' | 'locked' | 'unlocked' | 'hit' | 'destroying' | 'removed' | 'resized';
export type FieldEvent = { type: FieldEventType; id: string };
export type WordRect = { x: number; y: number; width: number; height: number };

export const FIELD = {
  /** Side margin and the least space kept between two words, sideways and up/down. */
  margin: 8,
  gap: 8,
  /** Under a landed word: the ground strip and a little air. */
  groundInset: 24,
  /** Where every new word comes in (its top): the top of the field. */
  spawnY: 0,
  /** Preferred columns: as wide as the smallest word. */
  laneWidth: 112,
  /** One step never covers more than this (a frame after the app was frozen, a long garbage collection). */
  maxDtMs: 64,
  /** How long a word being shot (or one on the ground) is expected to stay in its column. */
  lockHoldMs: 2000,
  missHoldMs: 1500,
  /** Words that drift in (no fall time): they cover `practiceStop` of the way in `practiceMs`, then wait. */
  practiceMs: 30000,
  practiceStop: 0.8,
  /** The server accepts a miss once this share of the fall time has passed. */
  minMissShare: 0.5,
} as const;

export type FieldStats = {
  frames: number;
  /** Words that came on screen, and those that had to wait for room first. */
  spawned: number;
  spawnRejected: number;
  /** Placement attempts that found no room (every frame a word waits). */
  spawnRetries: number;
  /** Frames where a falling word waited above the word below it. */
  yields: number;
  /** Two words' boxes touching: never expected. Counted per pair per frame. */
  overlaps: number;
  /** A word moved more than one capped frame of fall allows (only a shrinking field can do that: it is clamped up). */
  teleports: number;
  maxStepPx: number;
  /** Smoothed frame time (ms), measured by whoever runs the loop. */
  frameMs: number;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** The words that occupy their box (drawn, or being shot and not broken yet). */
const BLOCKING: ReadonlySet<WordState> = new Set<WordState>(['FALLING', 'LOCKED', 'HIT', 'MISSED']);

/** Lanes spread over the whole width (left edges of `laneWidth`-wide lanes), at least one. */
export function laneLefts(width: number, laneWidth: number, margin: number = FIELD.margin, gap: number = FIELD.gap): number[] {
  const count = Math.max(1, Math.floor((width - 2 * margin + gap) / (laneWidth + gap)));
  if (count === 1) return [Math.max(margin, (width - laneWidth) / 2)];
  const pitch = (width - 2 * margin - laneWidth) / (count - 1);
  return Array.from({ length: count }, (_, i) => margin + i * pitch);
}

export const boxesTouch = (a: WordRect, b: WordRect, gap = 0) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const sideBySide = (a: { x: number; width: number }, b: { x: number; width: number }, gap: number) =>
  !(a.x < b.x + b.width + gap && b.x < a.x + a.width + gap);

export class WordField<T = unknown> {
  /** In insertion order: the SPAWNING ones are the queue, tried first come first served. */
  private words = new Map<string, FallingWord<T>>();
  private width = 0;
  private height = 0;
  private seeded = false;
  private spawnSeq = 0;
  private listeners = new Set<(event: FieldEvent) => void>();
  /** Play time (ms): only advances in `step`. */
  time = 0;
  /** Bumped on every event (not on movement): what React re-renders on. */
  version = 0;
  readonly stats: FieldStats = { frames: 0, spawned: 0, spawnRejected: 0, spawnRetries: 0, yields: 0, overlaps: 0, teleports: 0, maxStepPx: 0, frameMs: 0 };

  // ---------------------------------------------------------------------------------------------- subscriptions
  subscribe = (listener: (event: FieldEvent) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getVersion = () => this.version;
  private emit(type: FieldEventType, id: string) {
    this.version += 1;
    for (const listener of [...this.listeners]) listener({ type, id });
  }

  // ---------------------------------------------------------------------------------------------- queries
  get(id: string): FallingWord<T> | undefined { return this.words.get(id); }
  state(id: string): WordState | undefined { return this.words.get(id)?.state; }
  all(): FallingWord<T>[] { return [...this.words.values()]; }
  /** On screen and falling (or on the ground): the word layer draws these. */
  drawn(): FallingWord<T>[] { return this.all().filter((w) => w.state === 'FALLING' || w.state === 'MISSED'); }
  /** Can be aimed at, typed and shot. */
  isAnswerable(id: string) { return this.words.get(id)?.state === 'FALLING'; }
  landed(): string[] { return this.all().filter((w) => w.state === 'MISSED').map((w) => w.id); }
  queued(): number { return this.all().filter((w) => w.state === 'SPAWNING').length; }
  active(): number { return this.all().filter((w) => w.state !== 'SPAWNING').length; }
  rect(id: string): WordRect | null {
    const w = this.words.get(id);
    return w && w.state !== 'SPAWNING' ? { x: w.x, y: w.y, width: w.width, height: w.height } : null;
  }
  /** 0 at the top, 1 on the ground (a word that only drifts in stops short of 1). */
  progress(id: string): number {
    const w = this.words.get(id);
    if (!w || w.state === 'SPAWNING') return 0;
    const ground = this.groundFor(w);
    return ground > 0 ? w.y / ground : 0;
  }
  size() { return { width: this.width, height: this.height }; }

  /** The top a word of this height has when it lands. */
  groundFor(w: { height: number }) { return Math.max(0, this.height - FIELD.groundInset - w.height); }
  private stopFor(w: { height: number; travelMs: number }) {
    const ground = this.groundFor(w);
    return w.travelMs > 0 ? ground : ground * FIELD.practiceStop;
  }

  // ---------------------------------------------------------------------------------------------- the field
  /** The field was measured (or the keyboard changed it). Every word keeps its place and the moment it lands; only a
   * word that would be under the new ground is lifted onto it. */
  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    for (const w of this.words.values()) {
      if (w.state === 'SPAWNING' || w.state === 'DESTROYING' || w.state === 'REMOVED') continue;
      w.x = clamp(w.x, FIELD.margin, Math.max(FIELD.margin, width - w.width - FIELD.margin));
      if (w.state !== 'FALLING' && w.state !== 'MISSED') continue; // a word being shot stays exactly where it stopped
      const stop = this.stopFor(w);
      const remaining = w.speed > 0 ? Math.max(0, (w.stopY - w.y) / w.speed) : 0;
      if (w.y > stop) { w.y = stop; this.stats.teleports += 1; }
      w.stopY = stop;
      if (w.state === 'FALLING') w.speed = remaining > 0 ? (stop - w.y) / remaining : this.speedFor(w, stop);
    }
    this.emit('resized', '');
    this.trySpawn();
  }

  /**
   * The words that should be on the field (`specs`, in the order they were opened) and the ones still being shot
   * (`keep`). New ones join the queue and come in as soon as there is room; gone ones are removed. A word keeps its
   * place, id and state: only what it shows is refreshed.
   */
  sync(specs: readonly WordSpec<T>[], keep: ReadonlySet<string> = new Set()) {
    const present = new Set(specs.map((s) => s.id));
    for (const w of [...this.words.values()]) if (!present.has(w.id) && !keep.has(w.id)) this.remove(w.id);
    // The words open when the game (re)opens go on from where they were (lowest first); every later one comes in at the top.
    const restore = !this.seeded && specs.length > 0;
    if (specs.length) this.seeded = true;
    const fresh = specs.filter((s) => !this.words.has(s.id));
    if (restore) fresh.sort((a, b) => (b.startProgress ?? 0) - (a.startProgress ?? 0));
    for (const spec of specs) {
      const w = this.words.get(spec.id);
      if (!w) continue;
      w.data = spec.data;
      w.word = spec.word;
      w.acceptedAnswers = spec.acceptedAnswers;
      if (w.state === 'SPAWNING') { w.width = spec.width; w.height = spec.height; w.travelMs = spec.travelMs; }
    }
    for (const spec of fresh) {
      this.words.set(spec.id, {
        id: spec.id, word: spec.word, acceptedAnswers: spec.acceptedAnswers, x: 0, y: 0, width: spec.width, height: spec.height, speed: 0,
        spawnTime: 0, state: 'SPAWNING', travelMs: spec.travelMs, stopY: 0, lands: spec.travelMs > 0, earliestLand: 0,
        startProgress: restore ? clamp(spec.startProgress ?? 0, 0, 0.95) : 0, waited: false, data: spec.data,
      });
    }
    this.trySpawn();
  }

  // ---------------------------------------------------------------------------------------------- the state machine
  /** Answered right: it stops where it is, now. Only a falling word can be locked, once (null otherwise). */
  lock(id: string): WordRect | null {
    const w = this.words.get(id);
    if (!w || w.state !== 'FALLING') return null;
    w.state = 'LOCKED';
    this.emit('locked', id);
    return { x: w.x, y: w.y, width: w.width, height: w.height };
  }
  /** The shot is withdrawn (not counted after all): it falls on from where it stopped. */
  unlock(id: string): boolean {
    const w = this.words.get(id);
    if (!w || (w.state !== 'LOCKED' && w.state !== 'HIT')) return false;
    w.state = 'FALLING';
    this.emit('unlocked', id);
    return true;
  }
  /** The first bullet reached it. */
  hit(id: string): boolean {
    const w = this.words.get(id);
    if (!w || w.state !== 'LOCKED') return false;
    w.state = 'HIT';
    this.emit('hit', id);
    return true;
  }
  /** It breaks (it counts now): true once only, so a word is never counted twice. */
  destroy(id: string): boolean {
    const w = this.words.get(id);
    if (!w || (w.state !== 'LOCKED' && w.state !== 'HIT')) return false;
    w.state = 'DESTROYING';
    this.emit('destroying', id);
    return true;
  }
  /** Gone: its effects are over, or the server closed it. */
  remove(id: string): boolean {
    const w = this.words.get(id);
    if (!w) return false;
    w.state = 'REMOVED';
    this.words.delete(id);
    this.emit('removed', id);
    this.trySpawn();
    return true;
  }

  // ---------------------------------------------------------------------------------------------- one frame
  /** Moves every falling word by its speed × `dtMs` (capped), lowest first, never into the word below it; reports the
   * words that land; brings in queued words that now have room. */
  step(dtMs: number) {
    if (this.width <= 0 || this.height <= 0) return;
    const dt = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, FIELD.maxDtMs);
    this.time += dt;
    this.stats.frames += 1;
    const movers = this.all().filter((w) => w.state === 'FALLING').sort((a, b) => b.y - a.y);
    const landed: string[] = [];
    for (const w of movers) {
      const free = Math.min(w.y + w.speed * dt, w.stopY);
      let next = free;
      for (const b of this.words.values()) {
        if (b === w || !BLOCKING.has(b.state) || b.y <= w.y || sideBySide(w, b, FIELD.gap)) continue;
        next = Math.min(next, b.y - w.height - FIELD.gap);
      }
      next = Math.max(w.y, next); // never up
      if (next < free - 1e-6) this.stats.yields += 1;
      const moved = next - w.y;
      if (moved > this.stats.maxStepPx) this.stats.maxStepPx = moved;
      if (moved > w.speed * FIELD.maxDtMs + 0.5) this.stats.teleports += 1;
      w.y = next;
      if (w.lands && w.y >= w.stopY - 0.01 && this.time >= w.earliestLand) {
        w.state = 'MISSED';
        landed.push(w.id);
      }
    }
    for (const id of landed) this.emit('landed', id);
    this.trySpawn();
    this.countOverlaps();
  }

  private countOverlaps() {
    const shown = this.all().filter((w) => BLOCKING.has(w.state));
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) if (boxesTouch(shown[i], shown[j])) this.stats.overlaps += 1;
    }
  }

  // ---------------------------------------------------------------------------------------------- the spawn manager
  private speedFor(w: { travelMs: number; height: number }, stop: number) {
    const fall = Math.max(0, stop - FIELD.spawnY);
    return w.travelMs > 0 ? fall / w.travelMs : fall / FIELD.practiceMs;
  }

  /** How long `b` stays where it is in its column, from now (ms). */
  private holdTime(b: FallingWord<T>): number {
    if (b.state === 'LOCKED' || b.state === 'HIT') return FIELD.lockHoldMs;
    if (b.state === 'MISSED') return FIELD.missHoldMs;
    if (!b.lands) return Infinity; // it drifts in and waits there
    return (b.speed > 0 ? Math.max(0, b.stopY - b.y) / b.speed : 0) + FIELD.missHoldMs;
  }
  private movingSpeed(b: FallingWord<T>) { return b.state === 'FALLING' && b.y < b.stopY ? b.speed : 0; }

  /** Whether a word of `w`'s size, falling at `speed`, can be at (x, y) now without ever touching another word. */
  private safeAt(w: FallingWord<T>, x: number, y: number, speed: number, others: FallingWord<T>[]) {
    const gap = FIELD.gap;
    for (const b of others) {
      if (sideBySide({ x, width: w.width }, b, gap)) continue; // another column: they can never meet
      if (y < b.y + b.height + gap && b.y < y + w.height + gap) return false;
      // Same column: the one above must not catch the one below up while that one is still there.
      const below = b.y > y;
      const clearance = below ? b.y - (y + w.height + gap) : y - (b.y + b.height + gap);
      const closing = below ? speed - this.movingSpeed(b) : this.movingSpeed(b) - speed;
      const hold = below ? this.holdTime(b) : (w.travelMs > 0 ? Math.max(0, this.stopFor(w) - y) / Math.max(speed, 1e-9) : Infinity);
      if (closing > 1e-9 && clearance < closing * hold) return false;
    }
    return true;
  }

  /** The place for a queued word, or null when there is none yet. */
  private place(w: FallingWord<T>): { x: number; y: number; speed: number; stop: number } | null {
    const margin = FIELD.margin;
    const maxX = Math.max(margin, this.width - w.width - margin);
    const others = this.all().filter((b) => b !== w && BLOCKING.has(b.state));
    const lanes = laneLefts(this.width, FIELD.laneWidth).map((l) => clamp(l + (FIELD.laneWidth - w.width) / 2, margin, maxX));
    const xs = [...new Set([...lanes, margin, maxX,
      ...others.flatMap((b) => [b.x - w.width - FIELD.gap, b.x + b.width + FIELD.gap]).map((x) => clamp(x, margin, maxX))])];
    const stop = this.stopFor(w);
    const speed = this.speedFor(w, stop);
    // A new word: the top. A word open when the game reopened: where it was, or higher up if that is taken.
    const natural = Math.min(stop, w.startProgress * this.groundFor(w));
    const ys = natural > 0 ? [natural, ...Array.from({ length: 8 }, (_, i) => natural * (1 - (i + 1) / 8))] : [FIELD.spawnY];
    const preferred = lanes[this.spawnSeq % lanes.length];
    for (const y of ys) {
      let best: { x: number; clearance: number } | null = null;
      for (const x of xs) {
        if (!this.safeAt(w, x, y, speed, others)) continue;
        // The clearest column first (nothing below it at all is best), then the next lane in turn.
        let clearance = Infinity;
        for (const b of others) if (b.y > y && !sideBySide({ x, width: w.width }, b, FIELD.gap)) clearance = Math.min(clearance, b.y - y);
        if (!best || clearance > best.clearance || (clearance === best.clearance && Math.abs(x - preferred) < Math.abs(best.x - preferred))) {
          best = { x, clearance };
        }
      }
      if (best) return { x: best.x, y, speed, stop };
    }
    return null;
  }

  /** Brings queued words in, first come first served, while there is room. */
  private trySpawn() {
    if (this.width <= 0 || this.height <= 0) return;
    for (const w of this.all()) {
      if (w.state !== 'SPAWNING') continue;
      const spot = this.place(w);
      if (!spot) {
        this.stats.spawnRetries += 1;
        if (!w.waited) { w.waited = true; this.stats.spawnRejected += 1; }
        return; // the ones after it wait their turn
      }
      w.x = spot.x;
      w.y = spot.y;
      w.speed = spot.speed;
      w.stopY = spot.stop;
      w.lands = w.travelMs > 0;
      w.spawnTime = this.time;
      // It already had that much of its fall (a reopened game); the server counts its time the same way.
      w.earliestLand = this.time + w.travelMs * (FIELD.minMissShare - w.startProgress);
      w.state = 'FALLING';
      this.spawnSeq += 1;
      this.stats.spawned += 1;
      this.emit('spawned', w.id);
    }
  }
}
