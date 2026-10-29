import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Turn } from '../src/learning/types';
import { laneLefts, resolveOverlaps } from '../src/screens/learning/games/fieldLayout';
import { Playfield, type Burst, type Shot } from '../src/screens/learning/games/Playfield';
import {
  bulletAt, BULLETS, BURST_HOLD_MS, SHOT_TUNING, BURST_MS, burstLook, HOLD_MS, Move, muzzle, PET_SIZE, petBounds, petMoving, petX, planShot,
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
});

// ------------------------------------------------------------------------------------------------ on the play field
const word = (id: string, en: string, position: number): Turn => ({
  turn_id: id, position, kind: 'word_spelling', skill_label: 'Gõ từ', prompt: { word: en, letters: [en.length] }, hints_shown: [], hints_total: 1,
  attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0,
});
const APPLE = word('turn-apple', 'apple', 0); // the left lane, away from where the pet starts (the middle)
const shotAt = (p = 0.3): Shot => ({ id: APPLE.turn_id, turn: APPLE, progress: p, aimed: false, word: { en: 'apple', vi: 'quả táo', phonetic: null } });

function Field({ shots, bursts = [], running = true, onImpact = jest.fn(), onShotDone = jest.fn(), onBurstDone = jest.fn(), wrongKey = 0, reduceMotion = false }: {
  shots: Shot[]; bursts?: Burst[]; running?: boolean; onImpact?: jest.Mock; onShotDone?: jest.Mock; onBurstDone?: jest.Mock; wrongKey?: number; reduceMotion?: boolean;
}) {
  return <Playfield variant="words" turns={[]} progress={() => 0.3} selectedId={null} onSelect={() => {}} petId="fox" petLevel={2} reduceMotion={reduceMotion}
    flash={null} bursts={bursts} running={running} shots={shots} onImpact={onImpact} onShotDone={onShotDone} onBurstDone={onBurstDone} wrongKey={wrongKey} sound />;
}
const layout = () => fireEvent(screen.getByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: W, height: H } } });
const petLeft = () => (StyleSheet.flatten(screen.getByTestId('shooter-pet').props.style).transform as any[])[0].translateX as number;
/** Bullets in flight (each shot keeps its bullets mounted, shown only while they fly). */
const flying = () => screen.queryAllByTestId('bullet', { includeHiddenElements: true }).filter((b) => StyleSheet.flatten(b.props.style).opacity > 0).length;
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('the shooting pet on the play field', () => {
  it('holds the answered word, walks and fires, then breaks it once (with sounds) and lets the next effects run', () => {
    const onImpact = jest.fn(), onShotDone = jest.fn();
    const player = require('expo-audio').useAudioPlayer();
    player.play.mockClear();
    render(<Field shots={[]} />);
    layout();
    const idle = petLeft();
    screen.rerender(<Field shots={[shotAt()]} onImpact={onImpact} onShotDone={onShotDone} />);
    expect(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true })).toBeTruthy(); // not removed at once: it waits for the bullet
    ms(120);
    expect(petLeft()).not.toBe(idle); // the pet itself moves along the bottom, not just its animation
    ms(280);
    expect(flying()).toBeGreaterThan(0);
    ms(150);
    // The bullets take their time (500–800 ms): the word only breaks when the first one reaches it.
    expect(screen.getByTestId('shot-turn-apple', { includeHiddenElements: true })).toBeTruthy();
    expect(onImpact).not.toHaveBeenCalled();
    ms(650);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('shot-turn-apple', { includeHiddenElements: true })).toBeNull(); // broken into pieces
    expect(player.play).toHaveBeenCalledTimes(2); // the shot and the break
    ms(1500);
    expect(onImpact).toHaveBeenCalledTimes(1); // broken and counted once
    expect(onShotDone).toHaveBeenCalledWith('turn-apple');
  });

  it('pausing stops the pet, the bullets and the fading meaning together', () => {
    const onImpact = jest.fn(), onBurstDone = jest.fn();
    const burst: Burst = { id: 'b1', position: 0, progress: 0.2, title: 'quả táo', sub: 'apple', tone: 'hit' };
    render(<Field shots={[]} />);
    layout();
    screen.rerender(<Field shots={[shotAt()]} bursts={[burst]} onImpact={onImpact} onBurstDone={onBurstDone} />);
    ms(300); // the bullets are on their way
    screen.rerender(<Field shots={[shotAt()]} bursts={[burst]} onImpact={onImpact} onBurstDone={onBurstDone} running={false} />);
    const frozen = petLeft();
    const bullets = flying();
    ms(5000);
    expect(petLeft()).toBe(frozen);
    expect(bullets).toBeGreaterThan(0);
    expect(flying()).toBe(bullets);
    expect(onImpact).not.toHaveBeenCalled();
    expect(onBurstDone).not.toHaveBeenCalled();
    expect(screen.getByText('quả táo')).toBeTruthy();
    screen.rerender(<Field shots={[shotAt()]} bursts={[burst]} onImpact={onImpact} onBurstDone={onBurstDone} />);
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
});

// ------------------------------------------------------------------------------------------------ no overlapping words
const overlap = (a: { left: number; top: number; width: number; height: number }, b: typeof a) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('falling words never overlap', () => {
  it('moves a word sideways to a free lane, or just above or below when the field is too narrow', () => {
    const lanes = laneLefts(W, 112).map((l) => l + 56);
    const field = { width: W, height: H };
    // Two words in the same spot: the second goes to the other lane, at the same height.
    const a = { id: 'a', left: 8, top: 100, width: 112, height: 118 };
    const b = { id: 'b', left: 20, top: 120, width: 112, height: 118 };
    const side = resolveOverlaps([], [a, b], lanes, field);
    expect(side.get('b')!.top).toBe(120);
    expect(overlap({ ...a, ...side.get('a')! }, { ...b, ...side.get('b')! })).toBe(false);
    // A wide aimed word fills the row: the other one moves just clear of it, up or down.
    const wide = { id: 'wide', left: 8, top: 150, width: W - 16, height: 150 };
    const other = { id: 'other', left: 270, top: 180, width: 112, height: 118 };
    const stacked = resolveOverlaps([], [wide, other], lanes, field);
    expect(overlap({ ...wide, ...stacked.get('wide')! }, { ...other, ...stacked.get('other')! })).toBe(false);
    // A word held for a shot never moves; the falling one makes room.
    const held = { id: 'held', left: 136, top: 60, width: 112, height: 100 };
    const falling = { id: 'f', left: 136, top: 80, width: 112, height: 118 };
    const around = resolveOverlaps([held], [falling], lanes, field);
    expect(overlap(held, { ...falling, ...around.get('f')! })).toBe(false);
  });

  it('on the play field: the aimed word, the other words and a held word are all drawn apart', () => {
    const turns = [word('t1', 'elephant', 0), word('t2', 'dog', 1), word('t3', 'cat', 2)];
    const answer = { value: '', onChange: () => {}, editable: true };
    const field = (shots: Shot[] = []) => (
      <Playfield variant="words" turns={turns} progress={(t) => (t.turn_id === 't3' ? 0.42 : 0.4)} selectedId="t1" onSelect={() => {}} petId="fox" petLevel={2}
        reduceMotion flash={null} running shots={shots} answer={answer} />
    );
    render(field());
    layout();
    screen.rerender(field());
    const box = (label: string) => {
      const style = StyleSheet.flatten(screen.getByLabelText(label).props.style);
      return { left: style.left, top: style.top, width: style.width, height: label.includes('nhắm') ? 150 : 118 };
    };
    const boxes = [box('Từ đang nhắm: elephant'), box('Từ: dog'), box('Từ: cat')];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    for (const b of boxes) {
      expect(b.left).toBeGreaterThanOrEqual(8);
      expect(b.left + b.width).toBeLessThanOrEqual(W - 8);
    }
  });
});

describe('after a shot', () => {
  it('a falling word never jumps back up: it waits above a held word, then falls on', () => {
    const narrow = 200; // one lane: no room beside, so it has to wait
    const held = word('held', 'apple', 0);
    const fall = word('fall', 'orange', 0);
    const answer = { value: '', onChange: () => {}, editable: true };
    const field = (p: number, shots: Shot[]) => (
      <Playfield variant="words" turns={[fall]} progress={() => p} selectedId="fall" onSelect={() => {}} petId="fox" petLevel={2}
        reduceMotion flash={null} running={false} shots={shots} answer={answer} />
    );
    const shot: Shot = { id: 'held', turn: held, progress: 0.7, aimed: false, word: null };
    render(field(0.1, [shot]));
    fireEvent(screen.getByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: narrow, height: H } } });
    const heldBox = StyleSheet.flatten(screen.getByTestId('shot-held', { includeHiddenElements: true }).props.style);
    const tops: number[] = [];
    const topNow = () => StyleSheet.flatten(screen.getByLabelText('Từ đang nhắm: orange').props.style).top as number;
    for (let p = 0.1; p <= 0.9; p += 0.05) {
      screen.rerender(field(p, [shot]));
      tops.push(topNow());
      expect(topNow() + 150).toBeLessThanOrEqual(heldBox.top + 1); // never over the held word: it waits above it
    }
    // The held word breaks: the falling one goes on down from where it waited, never up.
    for (let p = 0.9; p <= 1; p += 0.02) { screen.rerender(field(p, [])); tops.push(topNow()); }
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
    expect(tops[tops.length - 1]).toBeGreaterThan(tops[0]);
  });

  it('has no "Bắn": the answer field keeps the focus, and the next aimed word takes it without a tap', () => {
    const focus = require('react-native/jest/MockNativeMethods').default?.focus ?? require('react-native/jest/MockNativeMethods').focus;
    const [a, b] = [word('a', 'cat', 0), word('b', 'dog', 1)];
    const field = (turns: Turn[], selectedId: string) => (
      <Playfield variant="words" turns={turns} progress={() => 0.3} selectedId={selectedId} onSelect={() => {}} petId="fox" petLevel={2}
        reduceMotion flash={null} running answer={{ value: 'ca', onChange: () => {}, editable: true }} />
    );
    render(field([a, b], 'a'));
    layout();
    expect(screen.queryByRole('button', { name: 'Bắn' })).toBeNull();
    focus.mockClear();
    screen.rerender(field([b], 'b')); // "cat" was hit: "dog" is aimed next, in falling order
    expect(focus).toHaveBeenCalled();
  });
});
