import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Turn } from '../src/learning/types';
import { Playfield, wordSpec, type Burst, type Shot } from '../src/screens/learning/games/Playfield';
import { WordField } from '../src/screens/learning/games/wordField';
import {
  bulletAt, BULLETS, BURST_HOLD_MS, BURST_POP_MS, SHOT_TUNING, BURST_MS, burstLook, CRACK_MS, HOLD_MS, Move, muzzle, PET_SIZE, petBounds, petMoving,
  petX, planShot, shardsAt, sparksAt, targetLook, ANTICIPATE_MS, combinePoses, HOP_MS, idleTiltAt, LANDING_MS, landingAt, RELEASE_MS, SETTLE_MS,
  shotPoseAt, startleAt, STRIDE_PX, TRAIL, trailAt, WIGGLE_MS, LITE_OFF_MS, LITE_ON_MS, nextLite,
} from '../src/screens/learning/games/shooterFx';

const W = 390, H = 420, BOTTOM = 10;
const bounds = petBounds(W);
const home = (bounds.min + bounds.max) / 2;

describe('the shooting pet (pure)', () => {
  it('walks under the target in a short glide, never teleporting or leaving the field', () => {
    const moves: Move[] = [];
    const plan = planShot(moves, 1000, { x: 360, y: 80 }, home, bounds, true, H, BOTTOM);
    expect(plan.fireAt - 1000).toBeLessThanOrEqual(330); // moving never delays the answer much
    let last = petX(moves, 1000, home, bounds, true);
    for (let t = 1000; t <= plan.doneAt + 6000; t += 16) {
      const x = petX(moves, t, home, bounds, true);
      expect(x).toBeGreaterThanOrEqual(bounds.min);
      expect(x).toBeLessThanOrEqual(bounds.max);
      expect(Math.abs(x - last)).toBeLessThan(40); // one frame: a glide, not a jump
      last = x;
    }
    expect(petX(moves, plan.fireAt, home, bounds, true)).toBe(bounds.max); // as close under the word as the field allows
    expect(petMoving(moves, 1050)).toEqual({ moving: true, facing: 1 });
    expect(petMoving(moves, plan.fireAt).moving).toBe(false); // stopped to aim and fire
    expect(petX(moves, plan.fireAt + HOLD_MS - 50, home, bounds, true)).toBe(bounds.max); // a short rest, then it drifts on
  });

  it('fires two or three small bullets from the pet itself to the target', () => {
    const moves: Move[] = [];
    const target = { x: 120, y: 60 };
    const plan = planShot(moves, 0, target, home, bounds, false, H, BOTTOM);
    const origin = muzzle(petX(moves, plan.fireAt, home, bounds, false), H, BOTTOM);
    expect(BULLETS).toBeGreaterThanOrEqual(2);
    expect(BULLETS).toBeLessThanOrEqual(3);
    expect(origin.y).toBeGreaterThan(H - BOTTOM - PET_SIZE); // from the pet's head at the bottom, not mid-screen
    expect(origin.x).toBeCloseTo(target.x, 0); // it walked under the word first
    expect(bulletAt(plan, 0, plan.fireAt - 1, origin)).toBeNull();
    const start = bulletAt(plan, 0, plan.fireAt, origin)!;
    expect(start.y).toBeCloseTo(origin.y, 0);
    const near = bulletAt(plan, 0, plan.impactAt - 1, origin)!;
    expect(Math.hypot(near.x - target.x, near.y - target.y)).toBeLessThan(6);
    expect(bulletAt(plan, 0, plan.impactAt, origin)).toBeNull(); // arrived: the word breaks
  });

  it('spaces the bullets 120–180 ms apart and flies them 500–800 ms by distance, with tunable speed', () => {
    expect(SHOT_TUNING.bulletGapMs).toBeGreaterThanOrEqual(120);
    expect(SHOT_TUNING.bulletGapMs).toBeLessThanOrEqual(180);
    const near = planShot([], 0, { x: home + PET_SIZE / 2, y: H - 120 }, home, bounds, false, H, BOTTOM);
    const far = planShot([], 0, { x: 20, y: 10 }, home, bounds, false, H, BOTTOM);
    for (const plan of [near, far]) {
      expect(plan.flight).toBeGreaterThanOrEqual(500);
      expect(plan.flight).toBeLessThanOrEqual(800);
      expect(plan.gap).toBe(SHOT_TUNING.bulletGapMs);
    }
    expect(far.flight).toBeGreaterThan(near.flight);
    // Slower bullets: the first one leaves the pet at fireAt, the next ones one gap after the other.
    const origin = muzzle(petX([], 0, home, bounds, false), H, BOTTOM);
    expect(bulletAt(near, 1, near.fireAt + near.gap - 1, origin)).toBeNull();
    expect(bulletAt(near, 1, near.fireAt + near.gap, origin)).not.toBeNull();
    const quick = planShot([], 0, { x: 20, y: 10 }, home, bounds, false, H, BOTTOM, { ...SHOT_TUNING, bulletSpeed: 5, flightMinMs: 200, bullets: 2 });
    expect(quick.flight).toBe(200);
    expect(quick.bullets).toBe(2);
  });

  it('keeps where the pet was in the past when a new shot comes in', () => {
    const moves: Move[] = [];
    planShot(moves, 0, { x: 50, y: 60 }, home, bounds, true, H, BOTTOM);
    const before = [0, 60, 120, 300].map((t) => petX(moves, t, home, bounds, true));
    planShot(moves, 400, { x: 340, y: 60 }, home, bounds, true, H, BOTTOM);
    expect([0, 60, 120, 300].map((t) => petX(moves, t, home, bounds, true))).toEqual(before);
  });

  it('idles in place with reduced motion and shows a meaning for about 1–1.5 s before fading', () => {
    expect(petX([], 0, home, bounds, false)).toBe(petX([], 4000, home, bounds, false));
    expect(petX([], 0, home, bounds, true)).not.toBe(petX([], 1300, home, bounds, true));
    expect(BURST_HOLD_MS).toBeGreaterThanOrEqual(1000);
    expect(BURST_HOLD_MS).toBeLessThanOrEqual(1500);
    expect(burstLook(BURST_HOLD_MS, false).opacity).toBe(1);
    expect(burstLook(BURST_HOLD_MS + 250, false).opacity).toBeCloseTo(0.5);
    expect(burstLook(BURST_MS, false).opacity).toBe(0);
  });

  it('the meaning pops in with a small overshoot, then rests at its size (no pop with reduced motion)', () => {
    expect(burstLook(0, false).scale).toBeLessThan(0.7);
    const sizes = Array.from({ length: 33 }, (_, i) => burstLook((i * BURST_POP_MS) / 32, false).scale);
    expect(Math.max(...sizes)).toBeGreaterThan(1); // overshoot
    expect(burstLook(BURST_POP_MS, false).scale).toBe(1);
    expect(burstLook(0, true).scale).toBe(1);
  });

  it('the shot word glows softly while locked on, flashes at each bullet, cracks after the last one, then breaks into light', () => {
    const plan = planShot([], 0, { x: 120, y: 60 }, home, bounds, false, H, BOTTOM);
    const lastHit = plan.impactAt + (plan.bullets - 1) * plan.gap;
    expect(plan.breakAt).toBe(lastHit + CRACK_MS);
    const locked = targetLook(plan, plan.fireAt);
    expect(locked.visible).toBe(true);
    expect(locked.glow).toBeGreaterThan(0);
    expect(locked.glow).toBeLessThan(0.4);
    expect(locked.crack).toBe(0);
    for (let i = 0; i < plan.bullets; i++) {
      const at = plan.impactAt + i * plan.gap;
      expect(targetLook(plan, at).glow).toBeGreaterThan(0.9); // a flash at each hit
      expect(targetLook(plan, at).scale).toBeGreaterThan(1);
    }
    expect(targetLook(plan, lastHit + CRACK_MS / 2).crack).toBeCloseTo(0.5);
    expect(targetLook(plan, plan.breakAt).visible).toBe(false);
    // Nothing flies out before it breaks; then fragments and specks of light, gone by doneAt.
    expect(shardsAt(plan, plan.breakAt - 1)).toHaveLength(0);
    expect(sparksAt(plan, plan.breakAt - 1)).toHaveLength(0);
    expect(shardsAt(plan, plan.breakAt + 100).length).toBeGreaterThan(0);
    const specks = sparksAt(plan, plan.breakAt + 100);
    expect(specks.length).toBeGreaterThanOrEqual(8);
    expect(specks.some((s) => s.opacity > 0.5)).toBe(true);
    expect(sparksAt(plan, plan.doneAt + 1)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------ on the play field
const word = (id: string, en: string, position: number, travel = 0): Turn => ({
  turn_id: id, position, kind: 'word_spelling', skill_label: 'Gõ từ', prompt: { word: en, letters: [en.length] }, hints_shown: [], hints_total: 1,
  attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: travel,
});
const APPLE = word('turn-apple', 'apple', 0); // comes in on the left, away from where the pet starts (the middle)
const shotAt = (): Shot => ({ id: APPLE.turn_id, turn: APPLE, aimed: false, word: { en: 'apple', vi: 'quả táo', phonetic: null } });
/** An engine the size of the test field holding `turns` (as the game does), each one on screen. */
function engine(turns: Turn[], width = W, height = H) {
  const f = new WordField<Turn>();
  f.resize(width, height);
  f.sync(turns.map((t) => wordSpec(t, 'words', width)));
  return f;
}
/** "apple" on screen, falling; `shoot()` answers it right as the game does: LOCKED, and its shot given at once. */
function appleField(width = W) {
  const f = engine([APPLE], width);
  return Object.assign(f, { shoot: () => act(() => { expect(f.lock(APPLE.turn_id)).not.toBeNull(); }) });
}

function Field({ field, turns = [], shots, bursts = [], running = true, onImpact = jest.fn(), onShotDone = jest.fn(), onBurstDone = jest.fn(), wrongKey = 0,
  reduceMotion = false }: {
  field?: WordField<Turn>; turns?: Turn[]; shots: Shot[]; bursts?: Burst[]; running?: boolean; onImpact?: jest.Mock; onShotDone?: jest.Mock; onBurstDone?: jest.Mock;
  wrongKey?: number; reduceMotion?: boolean;
}) {
  return <Playfield variant="words" turns={turns} progress={() => 0.3} selectedId={null} onSelect={() => {}} petId="fox" petLevel={2} reduceMotion={reduceMotion}
    flash={null} bursts={bursts} running={running} shots={shots} onImpact={onImpact} onShotDone={onShotDone} onBurstDone={onBurstDone} wrongKey={wrongKey}
    sound field={field} />;
}
const layout = (width = W, height = H) =>
  fireEvent(screen.getByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
const petLeft = () => (StyleSheet.flatten(screen.getByTestId('shooter-pet').props.style).transform as any[])[0].translateX as number;
/** Bullets in flight (each shot keeps its bullets mounted, shown only while they fly). */
const flying = () => screen.queryAllByTestId('bullet', { includeHiddenElements: true }).filter((b) => StyleSheet.flatten(b.props.style).opacity > 0).length;
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
/** A falling word's box as drawn: it moves by transform only. */
const boxOf = (label: string) => {
  const style = StyleSheet.flatten(screen.getByLabelText(label).props.style);
  const moved = Object.assign({}, ...(style.transform ?? [])) as { translateX: number; translateY: number };
  return { left: moved.translateX, top: moved.translateY, width: style.width as number, height: style.height as number };
};
const top = (el: { props: { style?: any } }) => StyleSheet.flatten(el.props.style).top as number;

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('the shooting pet on the play field', () => {
  it('keeps the answered word on screen, walks and fires, then breaks it once (with sounds) and lets the next effects run', () => {
    const onImpact = jest.fn(), onShotDone = jest.fn();
    const player = require('expo-audio').useAudioPlayer();
    player.play.mockClear();
    const field = appleField();
    render(<Field field={field} turns={[APPLE]} shots={[]} running={false} />);
    layout();
    const idle = petLeft();
    field.shoot();
    screen.rerender(<Field field={field} shots={[shotAt()]} onImpact={onImpact} onShotDone={onShotDone} />);
    expect(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true })).toBeTruthy(); // not removed at once: it waits for the bullet
    ms(120);
    expect(petLeft()).not.toBe(idle); // the pet itself moves along the bottom, not just its animation
    ms(280);
    expect(flying()).toBeGreaterThan(0);
    ms(150);
    // The bullets take their time (500–800 ms): the word only breaks when they have reached it.
    expect(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true })).toBeTruthy();
    expect(onImpact).not.toHaveBeenCalled();
    ms(1050); // from the top of the field the bullets fly further (up to 800 ms)
    expect(field.state(APPLE.turn_id)).toBe('DESTROYING'); // LOCKED → HIT (a bullet reached it) → DESTROYING (it broke)
    expect(onImpact).toHaveBeenCalledTimes(1); // every bullet hit, it cracked, then broke
    const style = StyleSheet.flatten(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true }).props.style);
    expect(style.opacity).toBe(0); // broken into pieces
    expect(player.play).toHaveBeenCalledTimes(2); // the shot and the break
    ms(1500);
    expect(onImpact).toHaveBeenCalledTimes(1); // broken and counted once
    expect(onShotDone).toHaveBeenCalledWith('turn-apple');
    expect(field.get(APPLE.turn_id)).toBeUndefined(); // REMOVED: nothing of it is left in the engine
  });

  it('pausing stops the pet, the bullets and the fading meaning together', () => {
    const onImpact = jest.fn(), onBurstDone = jest.fn();
    const burst: Burst = { id: 'b1', position: 0, progress: 0.2, title: 'quả táo', sub: 'apple', tone: 'hit' };
    const field = appleField();
    render(<Field field={field} turns={[APPLE]} shots={[]} running={false} />);
    layout();
    field.shoot();
    screen.rerender(<Field field={field} shots={[shotAt()]} bursts={[burst]} onImpact={onImpact} onBurstDone={onBurstDone} />);
    ms(600); // the fire pet's attack has wound up: the bullets are on their way
    screen.rerender(<Field field={field} shots={[shotAt()]} bursts={[burst]} onImpact={onImpact} onBurstDone={onBurstDone} running={false} />);
    const frozen = petLeft();
    const bullets = flying();
    ms(5000);
    expect(petLeft()).toBe(frozen);
    expect(bullets).toBeGreaterThan(0);
    expect(flying()).toBe(bullets);
    expect(onImpact).not.toHaveBeenCalled();
    expect(onBurstDone).not.toHaveBeenCalled();
    expect(screen.getByText('quả táo')).toBeTruthy();
    screen.rerender(<Field field={field} shots={[shotAt()]} bursts={[burst]} onImpact={onImpact} onBurstDone={onBurstDone} />);
    ms(1300);
    expect(onImpact).toHaveBeenCalledTimes(1);
    ms(BURST_MS);
    expect(onBurstDone).toHaveBeenCalledWith('b1');
  });

  it('stays inside the field while idling, and with reduced motion does not drift', () => {
    render(<Field shots={[]} />);
    layout();
    for (let i = 0; i < 30; i++) {
      ms(300);
      expect(petLeft()).toBeGreaterThanOrEqual(bounds.min);
      expect(petLeft()).toBeLessThanOrEqual(bounds.max);
    }
    screen.unmount();
    render(<Field shots={[]} reduceMotion />);
    layout();
    const still = petLeft();
    ms(4000);
    expect(petLeft()).toBe(still);
  });

  it('the pet shoots several words in a row: each one breaks once, in turn', () => {
    const [a, b, c] = [word('a', 'cat', 0), word('b', 'dog', 1), word('c', 'owl', 2)];
    const field = engine([a, b, c]);
    const onImpact = jest.fn();
    const shots: Shot[] = [];
    const view = () => <Field field={field} turns={[a, b, c].filter((t) => !shots.some((s) => s.id === t.turn_id))} shots={[...shots]} onImpact={onImpact} />;
    render(view());
    layout();
    for (const t of [a, b, c]) {
      act(() => { field.lock(t.turn_id); });
      shots.push({ id: t.turn_id, turn: t, aimed: false, word: null });
      screen.rerender(view());
      ms(120);
    }
    ms(3000);
    expect(onImpact.mock.calls.map(([s]) => s.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

// ------------------------------------------------------------------------------------------------ the falling words
describe('falling words on the play field', () => {
  const answer = (value = '') => ({ value, onChange: () => {}, editable: true });
  type Opts = { field?: WordField<Turn>; selectedId?: string | null; value?: string; running?: boolean; shots?: Shot[]; onImpact?: jest.Mock;
    onShotDone?: jest.Mock };
  const sky = (turns: Turn[], { field, selectedId = null, value = '', running = true, shots = [], onImpact, onShotDone }: Opts = {}) => (
    <Playfield variant="words" turns={turns} progress={() => 0} selectedId={selectedId} onSelect={() => {}} petId="fox" petLevel={2} reduceMotion
      flash={null} running={running} shots={shots} answer={answer(value)} field={field} onImpact={onImpact} onShotDone={onShotDone} />
  );
  const overlap = (a: { left: number; top: number; width: number; height: number }, b: typeof a) =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

  it('words come in at the top, each in its own box (long and short), and are drawn apart while they fall', () => {
    const turns = [word('t1', 'elephant', 0, 24), word('t2', 'dog', 1, 20), word('t3', 'cat', 2, 30)];
    render(sky(turns, { selectedId: 't1' }));
    layout();
    const labels = ['Từ đang nhắm: elephant', 'Từ: dog'];
    expect(boxOf(labels[0]).width).toBeGreaterThan(boxOf(labels[1]).width); // the long word's box is wider
    for (let i = 0; i < 40; i++) {
      ms(250);
      const boxes = [...labels, ...(screen.queryByLabelText('Từ: cat') ? ['Từ: cat'] : [])].map(boxOf);
      for (let j = 0; j < boxes.length; j++) for (let k = j + 1; k < boxes.length; k++) expect(overlap(boxes[j], boxes[k])).toBe(false);
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(8);
        expect(b.left + b.width).toBeLessThanOrEqual(W - 8);
      }
    }
  });

  it('typing re-renders the aimed word only: no word moves, jumps or is remounted, and their boxes never change size', () => {
    const field = engine([]);
    const turns = [word('a', 'cat', 0, 24), word('b', 'dog', 1, 24)];
    render(sky(turns, { field, selectedId: 'a', running: false }));
    layout();
    const dog = screen.getByLabelText('Từ: dog');
    const before = { cat: boxOf('Từ đang nhắm: cat'), dog: boxOf('Từ: dog') };
    for (const value of ['c', 'ca', 'cx', '', 'do']) {
      screen.rerender(sky(turns, { field, selectedId: 'a', value, running: false }));
      expect(screen.getByLabelText('Từ: dog')).toBe(dog); // the same element: never remounted
      expect(boxOf('Từ đang nhắm: cat')).toEqual(before.cat);
      expect(boxOf('Từ: dog')).toEqual(before.dog);
    }
    // Aiming the other word changes nothing about where or how big either one is.
    screen.rerender(sky(turns, { field, selectedId: 'b', running: false }));
    expect(boxOf('Từ: cat')).toEqual(before.cat);
    expect(boxOf('Từ đang nhắm: dog')).toEqual(before.dog);
  });

  it('keeps falling smoothly while typing: every frame a small step down, never up', () => {
    const field = engine([]);
    const turns = [word('a', 'cat', 0, 12)];
    render(sky(turns, { field, selectedId: 'a' }));
    layout();
    let last = boxOf('Từ đang nhắm: cat').top;
    const steps: number[] = [];
    for (let i = 0; i < 40; i++) {
      screen.rerender(sky(turns, { field, selectedId: 'a', value: 'cat'.slice(0, i % 4) }));
      ms(50);
      const now = boxOf('Từ đang nhắm: cat').top;
      steps.push(now - last);
      last = now;
    }
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...steps)).toBeLessThan(5); // 50 ms of a 12 s fall: a few px, never a jump
    expect(last).toBeGreaterThan(0);
  });

  it('the keyboard opening and closing never moves a word', () => {
    const field = engine([]);
    const turns = [word('a', 'cat', 0, 24), word('b', 'dog', 1, 24)];
    render(sky(turns, { field, selectedId: 'a' }));
    layout(W, 600);
    ms(3000);
    screen.rerender(sky(turns, { field, selectedId: 'a', running: false }));
    const before = [boxOf('Từ đang nhắm: cat'), boxOf('Từ: dog')];
    layout(W, 330); // the keyboard opens: the field is shorter
    expect([boxOf('Từ đang nhắm: cat'), boxOf('Từ: dog')]).toEqual(before);
    layout(W, 600); // and closes
    expect([boxOf('Từ đang nhắm: cat'), boxOf('Từ: dog')]).toEqual(before);
    expect(field.stats.teleports).toBe(0);
  });

  it('paused, nothing moves; going on, it continues from there without a jump', () => {
    const field = engine([]);
    const turns = [word('a', 'cat', 0, 24)];
    render(sky(turns, { field, selectedId: 'a' }));
    layout();
    ms(2000);
    screen.rerender(sky(turns, { field, selectedId: 'a', running: false }));
    const paused = boxOf('Từ đang nhắm: cat').top;
    ms(10000); // in the background, a call, the pause menu...
    expect(boxOf('Từ đang nhắm: cat').top).toBe(paused);
    screen.rerender(sky(turns, { field, selectedId: 'a' }));
    ms(100);
    const after = boxOf('Từ đang nhắm: cat').top;
    expect(after).toBeGreaterThan(paused);
    expect(after - paused).toBeLessThan(5); // 100 ms of fall, not the 10 s it was paused
  });

  it('a shot word stops where it was answered: the bullets hit it there and it breaks there, counted once, while the others fall on', () => {
    const onImpact = jest.fn();
    const [apple, orange] = [word('turn-apple', 'apple', 0, 24), word('other', 'orange', 1, 24)];
    const field = engine([]);
    render(sky([apple, orange], { field, selectedId: 'other', onImpact }));
    layout();
    ms(1000);
    let stopped = { x: 0, y: 0, width: 0, height: 0 };
    act(() => { stopped = field.lock('turn-apple')!; });
    const shot: Shot = { id: 'turn-apple', turn: apple, aimed: false, word: null };
    screen.rerender(sky([orange], { field, selectedId: 'other', shots: [shot], onImpact }));
    const shotTops = [top(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true }))];
    const otherTops = [boxOf('Từ đang nhắm: orange').top];
    for (let i = 0; i < 30 && !onImpact.mock.calls.length; i++) {
      ms(60);
      const held = screen.queryByTestId('shot-turn-apple', { includeHiddenElements: true });
      if (held) shotTops.push(top(held));
      otherTops.push(boxOf('Từ đang nhắm: orange').top);
    }
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(new Set(shotTops)).toEqual(new Set([stopped.y])); // it never moved while the bullets flew
    for (let i = 1; i < otherTops.length; i++) expect(otherTops[i]).toBeGreaterThanOrEqual(otherTops[i - 1]);
    expect(otherTops[otherTops.length - 1]).toBeGreaterThan(otherTops[0]); // the other word kept falling
    const at = onImpact.mock.calls[0][1] as { x: number; y: number };
    expect(Math.abs(at.y - (stopped.y + 40))).toBeLessThan(1); // broken where it stopped (about the middle of its tile)
    ms(1500);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it('a word answered right just above the ground stops there and breaks there', () => {
    const onImpact = jest.fn(), onShotDone = jest.fn();
    const low = { ...APPLE, travel_seconds: 10, on_screen_ms: 9500 }; // a reopened game: it was about to land
    const field = engine([low]);
    const stopped = field.lock(low.turn_id)!;
    expect(stopped.y).toBeGreaterThan(H * 0.5);
    const shot: Shot = { ...shotAt(), turn: low };
    render(<Field field={field} shots={[shot]} onImpact={onImpact} onShotDone={onShotDone} />);
    layout();
    ms(1600); // with the fire pet's wind-up
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(top(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true }))).toBe(stopped.y);
    expect(Math.abs((onImpact.mock.calls[0][1] as { y: number }).y - (stopped.y + 40))).toBeLessThan(2);
    ms(1500);
    expect(onShotDone).toHaveBeenCalledWith('turn-apple');
  });

  it('a new word comes in at the top, beside a word being shot: never on it, nor where it was', () => {
    const field = engine([]);
    render(sky([APPLE], { field, running: false }));
    layout();
    act(() => { field.lock(APPLE.turn_id); });
    screen.rerender(sky([], { field, running: false, shots: [shotAt()] }));
    const shot = StyleSheet.flatten(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true }).props.style);
    screen.rerender(sky([word('next', 'pear', 0)], { field, running: false, shots: [shotAt()] }));
    const next = boxOf('Từ: pear');
    expect(next.top).toBe(0);
    expect(next.left).not.toBe(shot.left);
    expect(overlap(next, { ...shot, height: next.height } as any)).toBe(false);
  });

  it('a falling word waits above a word being shot in its column (one column), never on it, never up, then falls on', () => {
    const narrow = 200;
    const field = new WordField<Turn>();
    const [held, fall] = [word('held', 'apple', 0, 30), word('fall', 'orange', 0, 30)];
    field.resize(narrow, H);
    field.sync([wordSpec(held, 'words', narrow)]);
    for (let i = 0; i < 350; i++) field.step(64); // "held" is low enough for another word above it
    field.sync([wordSpec(held, 'words', narrow), wordSpec(fall, 'words', narrow)]);
    expect(field.state('fall')).toBe('FALLING');
    const heldAt = field.lock('held')!;
    const shot: Shot = { id: 'held', turn: held, aimed: false, word: null };
    render(sky([fall], { field, selectedId: 'fall', shots: [shot] }));
    layout(narrow, H);
    const tops: number[] = [];
    for (let i = 0; i < 40; i++) {
      ms(200);
      tops.push(boxOf('Từ đang nhắm: orange').top);
      expect(tops[tops.length - 1] + 120).toBeLessThanOrEqual(heldAt.y); // never over the word being shot
    }
    // The shot word breaks and is gone: the falling one goes on down from where it waited.
    act(() => { field.destroy('held'); field.remove('held'); });
    screen.rerender(sky([fall], { field, selectedId: 'fall' }));
    for (let i = 0; i < 10; i++) { ms(200); tops.push(boxOf('Từ đang nhắm: orange').top); }
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
    expect(tops[tops.length - 1]).toBeGreaterThan(tops[0]);
    expect(field.stats.overlaps).toBe(0);
  });

  it('a word shot before the server confirmed it waits, cracked and glowing, and breaks only once confirmed', () => {
    const onImpact = jest.fn();
    const field = appleField();
    const pending: Shot = { ...shotAt(), confirmed: false };
    render(<Field field={field} turns={[APPLE]} shots={[]} running={false} />);
    layout();
    field.shoot();
    screen.rerender(<Field field={field} shots={[pending]} onImpact={onImpact} />);
    ms(4000); // every bullet has long hit
    expect(onImpact).not.toHaveBeenCalled();
    expect(field.state(APPLE.turn_id)).toBe('HIT');
    const style = () => StyleSheet.flatten(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true }).props.style);
    expect(style().opacity).toBe(1);
    screen.rerender(<Field field={field} shots={[{ ...pending, confirmed: true }]} onImpact={onImpact} />);
    ms(100);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(style().opacity).toBe(0);
  });

  it('has no "Bắn": the answer field keeps the focus, and the next aimed word takes it without a tap', () => {
    const focus = require('react-native/jest/MockNativeMethods').default?.focus ?? require('react-native/jest/MockNativeMethods').focus;
    const [a, b] = [word('a', 'cat', 0), word('b', 'dog', 1)];
    render(sky([a, b], { selectedId: 'a', value: 'ca' }));
    layout();
    expect(screen.queryByRole('button', { name: 'Bắn' })).toBeNull();
    focus.mockClear();
    screen.rerender(sky([b], { selectedId: 'b', value: 'ca' })); // "cat" was hit: "dog" is aimed next, in falling order
    expect(focus).toHaveBeenCalled();
  });

  it('leaving the game stops everything: no frame loop, animation or timer keeps running', () => {
    const field = engine([]);
    render(sky([word('a', 'cat', 0, 24), word('b', 'dog', 1, 24)], { field, selectedId: 'a' }));
    layout();
    ms(500);
    screen.unmount();
    const frames = field.stats.frames;
    ms(2000);
    expect(field.stats.frames).toBe(frames);
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ natural motion
describe('the shooter moves like a living thing (pure)', () => {
  it('strolls with a gentle start and stop: slow at each end of a leg, quicker in the middle, never a jump', () => {
    const speed = (t: number) => Math.abs(petX([], t + 16, home, bounds, true) - petX([], t, home, bounds, true));
    const start = speed(0);
    const middle = Math.max(...Array.from({ length: 60 }, (_, i) => speed(i * 50)));
    expect(start).toBeLessThan(middle / 4); // it sets off slowly
    expect(middle).toBeLessThan(3); // a stroll, about 0.08 px per ms at its quickest
  });

  it('crouches before it fires, springs up as it does, settles, then hops for joy when the word breaks', () => {
    const plan = planShot([], 1000, { x: 300, y: 60 }, home, bounds, false, H, BOTTOM);
    expect(plan.fireAt - 1000).toBeLessThanOrEqual(330); // the crouch overlaps the dart: no later shot
    const crouch = shotPoseAt(plan, plan.fireAt - 10)!;
    expect(crouch.sy).toBeLessThan(0.9); // anticipation: squashed down
    expect(crouch.sx).toBeGreaterThan(1);
    const release = shotPoseAt(plan, plan.fireAt + RELEASE_MS - 5)!;
    expect(release.sy).toBeGreaterThan(1.05); // stretched as it fires
    const settle = Array.from({ length: 20 }, (_, i) => shotPoseAt(plan, plan.fireAt + RELEASE_MS + i * (SETTLE_MS / 20))!.sy);
    expect(Math.min(...settle)).toBeLessThan(1); // follow-through: it wobbles past rest…
    expect(Math.abs(shotPoseAt(plan, plan.fireAt + RELEASE_MS + SETTLE_MS - 5)!.sy - 1)).toBeLessThan(0.02); // …and comes to rest
    const hop = Math.max(...Array.from({ length: 20 }, (_, i) => shotPoseAt(plan, plan.breakAt + (i * HOP_MS) / 20)?.lift ?? 0));
    expect(hop).toBeGreaterThan(10);
    expect(shotPoseAt(plan, plan.breakAt + HOP_MS + 1)).toBeNull(); // back to its idle strip
    // A pose never distorts the pet much: its drawing, legs and proportions stay as drawn.
    for (let t = plan.fireAt - ANTICIPATE_MS; t < plan.breakAt + HOP_MS; t += 8) {
      const p = shotPoseAt(plan, t);
      if (!p) continue;
      expect(Math.abs(p.sx - 1)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(p.sy - 1)).toBeLessThanOrEqual(0.15);
    }
  });

  it('a wrong answer startles it a little (a hop back, a tilt), gently and briefly; with no wrong answer nothing', () => {
    expect(startleAt(null, 100)).toBeNull();
    const poses = Array.from({ length: 30 }, (_, i) => startleAt(0, (i * WIGGLE_MS) / 30)!);
    expect(Math.max(...poses.map((p) => p.back))).toBeGreaterThan(4);
    expect(Math.max(...poses.map((p) => Math.abs(p.tilt)))).toBeLessThanOrEqual(8);
    expect(startleAt(0, WIGGLE_MS)).toBeNull(); // over in well under half a second
    expect(WIGGLE_MS).toBeLessThanOrEqual(500);
    expect(combinePoses([null, { sx: 1, sy: 1.1, lift: 2, tilt: -3, back: 0 }, { sx: 0.9, sy: 1, lift: 5, tilt: 1, back: -4 }]))
      .toEqual({ sx: 0.9, sy: 1.1, lift: 5, tilt: -3, back: -4 });
  });

  it('tilts its head now and then while standing, off the beat of its idle strip, never far', () => {
    const tilts = Array.from({ length: 2000 }, (_, i) => idleTiltAt(i * 20));
    expect(Math.max(...tilts.map(Math.abs))).toBeLessThanOrEqual(5);
    expect(tilts.filter((v) => v !== 0).length / tilts.length).toBeLessThan(0.3); // mostly still
    const starts = tilts.map((v, i) => (v !== 0 && i > 0 && tilts[i - 1] === 0 ? i * 20 : null)).filter((v): v is number => v !== null);
    const gaps = starts.slice(1).map((v, i) => v - starts[i]);
    expect(new Set(gaps).size).toBeGreaterThan(1); // an irregular beat
  });

  it('each bullet leaves a short trail on its own path, behind it, only while it flies', () => {
    const plan = planShot([], 0, { x: 120, y: 60 }, home, bounds, false, H, BOTTOM);
    const origin = muzzle(petX([], plan.fireAt, home, bounds, false), H, BOTTOM);
    expect(trailAt(plan, 0, plan.fireAt + 5, origin).every((p) => p === null)).toBe(true); // nothing behind the muzzle
    const mid = plan.fireAt + plan.flight / 2;
    const head = bulletAt(plan, 0, mid, origin)!;
    const trail = trailAt(plan, 0, mid, origin);
    expect(trail).toHaveLength(TRAIL);
    trail.forEach((p, j) => {
      expect(p).not.toBeNull();
      expect(Math.hypot(p!.x - origin.x, p!.y - origin.y)).toBeLessThan(Math.hypot(head.x - origin.x, head.y - origin.y)); // behind it
      if (j) expect(p!.opacity).toBeLessThan(trail[j - 1]!.opacity); // fading
    });
    expect(trailAt(plan, 0, plan.impactAt, origin).every((p) => p === null)).toBe(true);
  });

  it('a rock landing throws pebbles up that fall back (gravity), jolts the ground briefly, and is all gone after a moment', () => {
    const early = landingAt(80)!;
    const peak = landingAt(200)!;
    const late = landingAt(LANDING_MS - 10)!;
    const outer = (l: typeof early) => l.pebbles[0];
    expect(outer(early).y).toBeLessThan(0); // thrown up
    expect(outer(late).y).toBeGreaterThan(outer(peak).y); // and falling back
    expect(Math.abs(outer(late).x)).toBeGreaterThan(Math.abs(outer(early).x)); // flying apart
    expect(Math.abs(landingAt(10)!.shake)).toBeGreaterThan(1);
    expect(landingAt(300)!.shake).toBe(0);
    expect(landingAt(LANDING_MS)).toBeNull();
    expect(late.pebbles.every((p) => p.opacity < 0.05)).toBe(true);
  });

  it('leaves out the decorative extras on a slow device, and brings them back only once it is clearly quick again', () => {
    expect(nextLite(false, 16.7)).toBe(false); // 60 fps
    expect(nextLite(false, LITE_ON_MS + 1)).toBe(true); // slower than about 38 fps
    expect(nextLite(true, (LITE_ON_MS + LITE_OFF_MS) / 2)).toBe(true); // in between: it stays as it is (no flicker)
    expect(nextLite(false, (LITE_ON_MS + LITE_OFF_MS) / 2)).toBe(false);
    expect(nextLite(true, LITE_OFF_MS - 1)).toBe(false);
  });

  it('walks in step: its strip follows the ground covered, one loop a stride', () => {
    expect(STRIDE_PX).toBeGreaterThan(PET_SIZE * 0.5);
    expect(STRIDE_PX).toBeLessThan(PET_SIZE * 1.2);
  });
});

describe('the play field reacts like a world', () => {
  it('a word reaching the ground lands with a burst of dust, once', () => {
    const quick = word('turn-quick', 'quick', 0, 1);
    const field = engine([quick]);
    render(<Field field={field} turns={[quick]} shots={[]} />);
    layout();
    expect(screen.queryAllByTestId('landing', { includeHiddenElements: true })).toHaveLength(0);
    ms(3000);
    expect(screen.queryAllByTestId('landing', { includeHiddenElements: true })).toHaveLength(1);
    ms(2000);
    expect(screen.queryAllByTestId('landing', { includeHiddenElements: true })).toHaveLength(1); // its slot stays, faded out
  });

  it('nothing lands with a burst under reduced motion', () => {
    const quick = word('turn-quick', 'quick', 0, 1);
    const field = engine([quick]);
    render(<Field field={field} turns={[quick]} shots={[]} reduceMotion />);
    layout();
    ms(3000);
    expect(screen.queryAllByTestId('landing', { includeHiddenElements: true })).toHaveLength(0);
  });
});
