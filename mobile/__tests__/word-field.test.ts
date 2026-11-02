import { boxesTouch, FIELD, FieldEvent, WordField, WordSpec, WordState } from '../src/screens/learning/games/wordField';

/** The falling-word engine on its own: the spawn manager, movement, collisions and each word's states. */

const W = 390, H = 520, FRAME = 16;
const HEIGHT = 120;
const spec = (id: string, over: Partial<WordSpec<null>> = {}): WordSpec<null> =>
  ({ id, word: id, acceptedAnswers: [id], width: 112, height: HEIGHT, travelMs: 24000, data: null, ...over });
const field = (width = W, height = H) => {
  const f = new WordField<null>();
  f.resize(width, height);
  return f;
};
const steps = (f: WordField<null>, ms: number, each?: () => void) => {
  for (let t = 0; t < ms; t += FRAME) { f.step(FRAME); each?.(); }
};
const BLOCKING: WordState[] = ['FALLING', 'LOCKED', 'HIT', 'MISSED'];
/** Every pair of words that occupy their box: never touching. */
const expectApart = (f: WordField<null>) => {
  const shown = f.all().filter((w) => BLOCKING.includes(w.state));
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      if (boxesTouch(shown[i], shown[j])) throw new Error(`${shown[i].id} and ${shown[j].id} overlap at ${f.time} ms`);
    }
  }
};
/** A tiny seeded random generator: the long runs are the same every time. */
const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

describe('one word', () => {
  it('comes in at the top once, keeps its id and x, and falls smoothly by speed × frame time', () => {
    const f = field();
    const events: FieldEvent[] = [];
    f.subscribe((e) => events.push(e));
    f.sync([spec('cat')]);
    const cat = f.get('cat')!;
    expect(cat.state).toBe('FALLING');
    expect(cat.y).toBe(FIELD.spawnY);
    expect(events).toEqual([{ type: 'spawned', id: 'cat' }]);
    const x = cat.x;
    const ground = H - FIELD.groundInset - HEIGHT;
    expect(cat.speed).toBeCloseTo(ground / 24000, 9);
    let last = cat.y;
    steps(f, 5000, () => {
      expect(cat.x).toBe(x);
      expect(cat.y - last).toBeCloseTo(cat.speed * FRAME, 9); // every frame the same step: no jerk, no jump
      last = cat.y;
    });
    expect(f.get('cat')).toBe(cat); // the same object all along: never re-created
  });

  it('lands at its fall time, once, and is then MISSED (never earlier than the server accepts)', () => {
    const f = field();
    const landed: string[] = [];
    f.subscribe((e) => { if (e.type === 'landed') landed.push(e.id); });
    f.sync([spec('cat', { travelMs: 6000 })]);
    steps(f, 5900);
    expect(f.state('cat')).toBe('FALLING');
    steps(f, 200);
    expect(f.state('cat')).toBe('MISSED');
    steps(f, 2000);
    expect(landed).toEqual(['cat']);
    expect(f.isAnswerable('cat')).toBe(false); // a landed word can't be shot any more
    expect(f.lock('cat')).toBeNull();
  });

  it('never moves more than one capped frame, even after the app was frozen for seconds', () => {
    const f = field();
    f.sync([spec('cat')]);
    const cat = f.get('cat')!;
    f.step(FRAME);
    const before = cat.y;
    f.step(8000); // the first frame back in the foreground
    expect(cat.y - before).toBeCloseTo(cat.speed * FIELD.maxDtMs, 9);
    f.step(Number.NaN);
    f.step(-50);
    expect(cat.y - before).toBeCloseTo(cat.speed * FIELD.maxDtMs, 9);
    expect(f.stats.teleports).toBe(0);
  });

  it('does nothing before the field is measured', () => {
    const f = new WordField<null>();
    f.sync([spec('cat')]);
    f.step(FRAME);
    expect(f.state('cat')).toBe('SPAWNING'); // waiting for a size, not placed at 0,0 of nothing
    f.resize(W, H);
    expect(f.state('cat')).toBe('FALLING');
    expect(f.get('cat')!.y).toBe(FIELD.spawnY);
  });
});

describe('the spawn manager', () => {
  it('puts words side by side in free columns, sized by their real width (long and short words)', () => {
    const f = field();
    f.sync([spec('a'), spec('b'), spec('c')]);
    expect(f.all().map((w) => w.state)).toEqual(['FALLING', 'FALLING', 'FALLING']); // three short words fit in a row
    const g = field();
    // A long word takes the room of two short ones: 8 + 112 + 8 + 192 + 8 + 112 + 8 > 390, so the third waits.
    g.sync([spec('a'), spec('elephant', { width: 192 }), spec('c')]);
    expect(g.all().map((w) => w.state)).toEqual(['FALLING', 'FALLING', 'SPAWNING']);
    for (const w of g.drawn()) {
      expect(w.y).toBe(FIELD.spawnY);
      expect(w.x).toBeGreaterThanOrEqual(FIELD.margin);
      expect(w.x + w.width).toBeLessThanOrEqual(W - FIELD.margin);
    }
    expectApart(g);
    expect(g.drawn().map((w) => w.id)).not.toContain('c'); // never forced in
    expect(g.stats.spawnRejected).toBe(1);
    const f2 = g;
    // It comes in, at the top, as soon as a column has room below it.
    let spawnedAt = -1;
    steps(f2, 30000, () => { if (spawnedAt < 0 && f2.state('c') === 'FALLING') spawnedAt = f2.time; expectApart(f2); });
    expect(spawnedAt).toBeGreaterThan(0);
    expect(f2.stats.spawnRejected).toBe(1); // counted once, however many frames it waited
    expect(f2.stats.spawnRetries).toBeGreaterThan(1);
  });

  it('a column is reused only once the word in it is far enough down, so they never touch', () => {
    const f = field(150, H); // one column
    f.sync([spec('a')]);
    f.sync([spec('a'), spec('b')]);
    expect(f.state('b')).toBe('SPAWNING');
    let placed = false;
    steps(f, 20000, () => {
      if (!placed && f.state('b') === 'FALLING') {
        placed = true;
        const [a, b] = [f.get('a')!, f.get('b')!];
        expect(b.y).toBe(FIELD.spawnY);
        expect(a.y).toBeGreaterThanOrEqual(b.y + b.height + FIELD.gap); // below it, with a gap
      }
      expectApart(f);
    });
    expect(placed).toBe(true);
  });

  it('never puts a faster word above a slower one it would catch up before that one lands', () => {
    const f = field(150, 900); // one column, a tall field
    f.sync([spec('slow', { travelMs: 40000 })]);
    steps(f, 12000); // "slow" is well down the field: room for another word above it by size alone
    const slow = f.get('slow')!;
    expect(slow.y).toBeGreaterThan(HEIGHT + FIELD.gap);
    f.sync([spec('slow', { travelMs: 40000 }), spec('fast', { travelMs: 4000 })]);
    expect(f.state('fast')).toBe('SPAWNING'); // it would catch "slow" up: it waits
    // The same word at the same speed fits right away.
    const g = field(150, 900);
    g.sync([spec('slow', { travelMs: 40000 })]);
    steps(g, 12000);
    g.sync([spec('slow', { travelMs: 40000 }), spec('same', { travelMs: 40000 })]);
    expect(g.state('same')).toBe('FALLING');
    // Once "slow" has landed and gone, "fast" comes in; at no time do they touch.
    steps(f, 40000, () => {
      expectApart(f);
      if (f.state('slow') === 'MISSED') f.remove('slow');
    });
    expect(f.get('fast')?.state ?? 'REMOVED').not.toBe('SPAWNING');
  });

  it('a wide field sends the faster word to another column instead of making it wait', () => {
    const f = field();
    f.sync([spec('slow', { travelMs: 40000 })]);
    steps(f, 12000);
    f.sync([spec('slow', { travelMs: 40000 }), spec('fast', { travelMs: 4000 })]);
    const [slow, fast] = [f.get('slow')!, f.get('fast')!];
    expect(fast.state).toBe('FALLING');
    expect(fast.x + fast.width + FIELD.gap <= slow.x || slow.x + slow.width + FIELD.gap <= fast.x).toBe(true);
  });

  it('a queue never grows past what was asked for, and keeps its order', () => {
    const f = field(150, H);
    f.sync([spec('a'), spec('b'), spec('c')]);
    expect(f.queued()).toBe(2);
    f.sync([spec('a'), spec('b'), spec('c')]); // the same words again: nothing new
    expect(f.queued()).toBe(2);
    const order: string[] = [];
    f.subscribe((e) => { if (e.type === 'spawned') order.push(e.id); });
    steps(f, 60000, () => { for (const id of f.landed()) f.remove(id); });
    expect(order).toEqual(['b', 'c']);
  });
});

describe('answered right', () => {
  it('only that word stops, at once and where it was; the others fall on; it is hit and counted once', () => {
    const f = field();
    f.sync([spec('cat'), spec('dog'), spec('fox')]);
    steps(f, 2000);
    const [cat, dog, fox] = ['cat', 'dog', 'fox'].map((id) => f.get(id)!);
    const at = f.lock('dog')!;
    expect(at).toEqual({ x: dog.x, y: dog.y, width: dog.width, height: dog.height });
    expect(f.lock('dog')).toBeNull(); // never twice
    expect(f.isAnswerable('dog')).toBe(false);
    const before = { cat: cat.y, fox: fox.y };
    steps(f, 1500);
    expect(dog.y).toBe(at.y); // stopped
    expect(cat.y).toBeGreaterThan(before.cat); // the others keep falling
    expect(fox.y).toBeGreaterThan(before.fox);
    expect(f.hit('dog')).toBe(true);
    expect(f.hit('dog')).toBe(false);
    expect(f.destroy('dog')).toBe(true); // it breaks: counted now
    expect(f.destroy('dog')).toBe(false); // ...and never again
    expect(f.state('dog')).toBe('DESTROYING');
    expect(f.remove('dog')).toBe(true);
    expect(f.get('dog')).toBeUndefined();
    expect(f.remove('dog')).toBe(false);
  });

  it('a fast word is not let in above a word being shot that it would reach before it breaks', () => {
    const f = field(150, H); // one column
    f.sync([spec('low', { travelMs: 30000 })]);
    steps(f, 15000);
    f.lock('low');
    f.sync([spec('high', { travelMs: 6000 })], new Set(['low']));
    expect(f.state('high')).toBe('SPAWNING');
    f.destroy('low');
    f.remove('low');
    expect(f.state('high')).toBe('FALLING'); // the moment the column is free
  });

  it('a falling word waits just above a word being shot in its column, then falls on', () => {
    const f = field(150, H); // one column
    f.sync([spec('low', { travelMs: 30000 })]);
    steps(f, 15000);
    f.sync([spec('low', { travelMs: 30000 }), spec('high', { travelMs: 30000 })]);
    const [low, high] = [f.get('low')!, f.get('high')!];
    expect(high.state).toBe('FALLING'); // room above it, at the same speed
    f.lock('low'); // answered: it stops, and "high" comes down onto it
    let last = high.y;
    steps(f, 8000, () => {
      expect(high.y + high.height + FIELD.gap).toBeLessThanOrEqual(low.y + 1e-9); // never on it
      expect(high.y).toBeGreaterThanOrEqual(last); // never up
      last = high.y;
    });
    expect(f.stats.yields).toBeGreaterThan(0);
    const waited = high.y;
    f.destroy('low');
    f.remove('low');
    steps(f, 500);
    expect(high.y).toBeGreaterThan(waited); // the word broke: it falls on from where it waited
    expect(f.stats.overlaps).toBe(0);
  });

  it('a shot withdrawn (not counted after all): the word falls on from where it stopped, never jumping', () => {
    const f = field();
    f.sync([spec('cat')]);
    steps(f, 2000);
    const cat = f.get('cat')!;
    const at = f.lock('cat')!;
    steps(f, 1000);
    expect(f.unlock('cat')).toBe(true);
    expect(cat.y).toBe(at.y);
    f.step(FRAME);
    expect(cat.y - at.y).toBeCloseTo(cat.speed * FRAME, 9);
  });
});

describe('removing words', () => {
  it('removing the first, the middle or the last word leaves the others exactly where they were', () => {
    for (const gone of ['a', 'b', 'c']) {
      const f = field();
      f.sync([spec('a'), spec('b'), spec('c')]);
      steps(f, 3000);
      const before = new Map(f.all().map((w) => [w.id, { x: w.x, y: w.y, word: w }]));
      f.sync([spec('a'), spec('b'), spec('c')].filter((s) => s.id !== gone));
      expect(f.get(gone)).toBeUndefined();
      for (const w of f.all()) {
        expect(w).toBe(before.get(w.id)!.word); // the same object: no other word takes its state
        expect({ x: w.x, y: w.y }).toEqual({ x: before.get(w.id)!.x, y: before.get(w.id)!.y });
      }
      // A new word never reuses what the gone one left.
      f.sync([...[spec('a'), spec('b'), spec('c')].filter((s) => s.id !== gone), spec('d')]);
      expect(f.get('d')!.y).toBe(FIELD.spawnY);
      expect(f.get('d')!.spawnTime).toBe(f.time);
    }
  });
});

describe('the keyboard opens and closes', () => {
  it('words keep their place (no rescaling) and land at the same moment as before', () => {
    const f = field(W, 700);
    const landedAt: number[] = [];
    f.subscribe((e) => { if (e.type === 'landed') landedAt.push(f.time); });
    f.sync([spec('cat', { travelMs: 10000 })]);
    steps(f, 2000);
    const cat = f.get('cat')!;
    const y = cat.y;
    f.resize(W, 420); // the keyboard opens: the field is shorter
    expect(cat.y).toBe(y);
    f.resize(W, 560); // and closes a little
    expect(cat.y).toBe(y);
    steps(f, 9000);
    expect(landedAt).toHaveLength(1);
    expect(Math.abs(landedAt[0] - 10000)).toBeLessThanOrEqual(2 * FRAME);
    expect(f.stats.teleports).toBe(0);
  });

  it('only a word that would be under the new ground is lifted onto it', () => {
    const f = field(W, 700);
    f.sync([spec('cat', { travelMs: 10000 })]);
    steps(f, 8000);
    f.resize(W, 300);
    const cat = f.get('cat')!;
    expect(cat.y).toBe(300 - FIELD.groundInset - HEIGHT);
    expect(f.stats.teleports).toBe(1); // counted, so it shows up in the stats
  });
});

describe('a reopened game', () => {
  it('the words open then go on from where they were; every later word comes in at the top', () => {
    const f = field();
    f.sync([spec('old', { startProgress: 0.5 }), spec('older', { startProgress: 0.7 })]);
    const ground = H - FIELD.groundInset - HEIGHT;
    expect(f.get('old')!.y).toBeCloseTo(0.5 * ground, 6);
    expect(f.get('older')!.y).toBeCloseTo(0.7 * ground, 6);
    f.sync([spec('old'), spec('older'), spec('new', { startProgress: 0.5 })]);
    expect(f.get('new')!.y).toBe(FIELD.spawnY); // never appears low on the field
    expectApart(f);
  });

  it('two restored words in the same spot: the second goes beside or higher, never on the first', () => {
    const f = field(150, H);
    f.sync([spec('a', { startProgress: 0.4 }), spec('b', { startProgress: 0.4 })]);
    expectApart(f);
    for (const w of f.drawn()) expect(w.y).toBeLessThanOrEqual(0.4 * (H - FIELD.groundInset - HEIGHT) + 1e-6);
  });
});

describe('drifting words (no fall time)', () => {
  it('drift in, stop part way and wait: never landed; a word above in the column stacks above them', () => {
    const f = field(150, H);
    f.sync([spec('a', { travelMs: 0 })]);
    steps(f, 40000);
    const a = f.get('a')!;
    expect(a.state).toBe('FALLING');
    expect(a.y).toBeCloseTo((H - FIELD.groundInset - HEIGHT) * FIELD.practiceStop, 6);
    expect(f.landed()).toEqual([]);
    f.sync([spec('a', { travelMs: 0 }), spec('b', { travelMs: 0 })]);
    steps(f, 40000, () => expectApart(f));
  });
});

describe('long runs', () => {
  /**
   * Plays the field the way the game does: a new word every `every` ms while fewer than `max` are open and none is
   * waiting for room; words answered at random (stopped, hit, broken, gone), the others land and are removed shortly
   * after. Every frame: no two boxes touch, no word moves up, sideways or more than one capped frame.
   */
  function play(seed: number, { seconds, max, every, answer, width = W, height = H }: { seconds: number; max: number; every: number; answer: number;
    width?: number; height?: number }) {
    const rng = seeded(seed);
    const f = field(width, height);
    let open: WordSpec<null>[] = [];
    const shot = new Map<string, number>();
    const landedAt = new Map<string, number>();
    const seen = new Map<string, { x: number; y: number }>();
    let seq = 0;
    let lastSpawn = -Infinity;
    const spawnYs: number[] = [];
    f.subscribe((e) => { if (e.type === 'spawned') spawnYs.push(f.get(e.id)!.y); });
    for (let t = 0; t < seconds * 1000; t += FRAME) {
      if (open.length < max && f.queued() === 0 && t - lastSpawn >= every) {
        const letters = 3 + Math.floor(rng() * 9); // short and long words
        open = [...open, spec(`w${seq++}`, { width: Math.min(220, Math.max(112, letters * 22 + 16)), travelMs: 6000 + Math.floor(rng() * 20000),
          height: rng() < 0.5 ? 120 : 146 })];
        lastSpawn = t;
        f.sync(open, new Set(shot.keys()));
      }
      f.step(FRAME);
      for (const w of f.all()) {
        if (w.state === 'FALLING' && rng() < answer) { f.lock(w.id); shot.set(w.id, t); open = open.filter((s) => s.id !== w.id); f.sync(open, new Set(shot.keys())); }
        const since = t - (shot.get(w.id) ?? t);
        if (w.state === 'LOCKED' && since > 600) f.hit(w.id);
        if (w.state === 'HIT' && since > 1200) f.destroy(w.id);
        if (w.state === 'DESTROYING' && since > 1900) { f.remove(w.id); shot.delete(w.id); }
        if (w.state === 'MISSED') {
          if (!landedAt.has(w.id)) landedAt.set(w.id, t);
          else if (t - landedAt.get(w.id)! > 300) { open = open.filter((s) => s.id !== w.id); f.sync(open, new Set(shot.keys())); }
        }
      }
      expectApart(f);
      for (const w of f.all()) {
        if (w.state === 'SPAWNING') continue;
        const was = seen.get(w.id);
        if (was) {
          expect(w.x).toBe(was.x);
          expect(w.y).toBeGreaterThanOrEqual(was.y);
          expect(w.y - was.y).toBeLessThanOrEqual(w.speed * FIELD.maxDtMs + 1e-6);
        }
        seen.set(w.id, { x: w.x, y: w.y });
      }
    }
    return { f, spawned: seq, spawnYs };
  }

  it('3–5 words at once, long and short, fast and slow, answered or landing: never overlapping, never jumping', () => {
    for (const [seed, max] of [[1, 3], [2, 4], [3, 5]]) {
      const { f, spawnYs } = play(seed, { seconds: 240, max, every: 1200, answer: 0.002 });
      expect(f.stats.overlaps).toBe(0);
      expect(f.stats.teleports).toBe(0);
      expect(spawnYs.length).toBeGreaterThan(20);
      expect(spawnYs.every((y) => y === FIELD.spawnY)).toBe(true); // every word came in at the top
    }
  });

  it('a crowded narrow field queues words instead of forcing them in, and nothing piles up over many rounds', () => {
    const { f, spawned } = play(7, { seconds: 600, max: 5, every: 300, answer: 0.004, width: 260 });
    expect(spawned).toBeGreaterThan(100);
    expect(f.stats.spawnRejected).toBeGreaterThan(0);
    expect(f.stats.overlaps).toBe(0);
    expect(f.all().length).toBeLessThanOrEqual(5 + 3); // the open words and a few still breaking: no leak
  });

  it('the field shrinking and growing (keyboard) mid-game never makes words overlap or jump', () => {
    const rng = seeded(11);
    const f = field(W, 700);
    let open: WordSpec<null>[] = [];
    for (let t = 0, seq = 0; t < 120000; t += FRAME) {
      if (t % 2000 === 0 && open.length < 4 && f.queued() === 0) { open = [...open, spec(`k${seq++}`, { travelMs: 8000 + Math.floor(rng() * 16000) })]; f.sync(open); }
      if (t % 7000 === 0) f.resize(W, rng() < 0.5 ? 460 : 700);
      f.step(FRAME);
      for (const id of f.landed()) { open = open.filter((s) => s.id !== id); f.sync(open); }
      expectApart(f);
    }
    expect(f.stats.overlaps).toBe(0);
  });
});
