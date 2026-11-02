import fs from 'fs';
import path from 'path';
import React from 'react';
import { AccessibilityInfo, Animated, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import { markSheetsLoaded, PetArt } from '../src/components/PetArt';
import { usePetCheer, useRig } from '../src/games/engine/rig';
import { KingdomQuest } from '../src/games/quests/KingdomQuest';
import { LabQuest } from '../src/games/quests/LabQuest';
import { SpaceQuest } from '../src/games/quests/SpaceQuest';
import type { Turn } from '../src/learning/types';
import { PETS } from '../src/pets';
import { ACTION_WINDOW, drawnActions, drawnCelebrateMs, hasSprite, petSprite, SPRITE_LAYOUT } from '../src/petSprites';
import { GateChoice, WordBridge } from '../src/screens/learning/games/ChoiceGames';
import { Playfield } from '../src/screens/learning/games/Playfield';
import { cheerProgress, delayBreak, leapProgress, petBounds, petX, planShot } from '../src/screens/learning/games/shooterFx';
import { WordField } from '../src/screens/learning/games/wordField';
import { ResultScreen } from '../src/screens/learning/ResultScreen';
import { mockServer } from '../test/mockServer';

const stagesOf = (king: string) => ['Lv0_Trung_Pet', 'Lv1_So_Sinh', 'Lv2_Phat_Trien', 'Lv3_Nang_Cao', 'Lv4_Truong_Thanh', 'Lv5_Dai_Than', king];
/** The pets with a drawn celebration: id, assets folder, its levels. */
const DRAWN = [['cat', 'mist', stagesOf('Lv6_Vua_Suong')], ['fox', 'fire', stagesOf('Lv6_Vua_Lua')]] as const;
const DRAWN_IDS = DRAWN.map(([id]) => id);
const { cols, rows, cycleMs } = SPRITE_LAYOUT.celebrate;
const JUMP = SPRITE_LAYOUT.jump.cycleMs;
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
const preload = () => DRAWN_IDS.forEach((id) => markSheetsLoaded([0, 1, 2, 3, 4, 5, 6].flatMap((stage) => [petSprite(id, stage, 'celebrate')!, petSprite(id, stage, 'jump')!, petSprite(id, stage, 'attack')!])));

const imageOf = (name: string) => screen.UNSAFE_root.findAllByType(Image).find((image: any) => new RegExp(`_${name}`).test(JSON.stringify(image.props.source)));
const cheerImage = () => imageOf('Celebrate');
const styleOf = (node: any) => StyleSheet.flatten(node.props.style) ?? {};
const now = (v: any) => (v?.__getValue ? v.__getValue() : v);
function visibility(node: any) {
  let shown = 1;
  for (let n = node; n; n = n.parent) shown *= now(styleOf(n).opacity) ?? 1;
  return shown;
}
const shown = (name = 'Celebrate') => { const image = imageOf(name); return image ? visibility(image) : 0; };
const windowOf = (size: number) => size + 2 * Math.round((size * (ACTION_WINDOW.celebrate - 1)) / 2);
const frameOf = (image: any, windowSize: number) => -now((styleOf(image).transform as any[])[0].translateX) / windowSize;
const number = (v: Animated.Value) => (v as any).__getValue() as number;

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// First in the file: nothing has marked this sheet as loaded yet.
it('keeps the idle until the sheet has loaded, rather than a pet that vanishes', () => {
  render(<PetArt pet="cat" size={66} stage={3} cheer={new Animated.Value(0.5)} />);
  expect(visibility(cheerImage())).toBe(0);
  act(() => { fireEvent(cheerImage()!, 'load'); });
  expect(visibility(cheerImage())).toBe(1);
});

describe('the strips', () => {
  it('has one for each level of the mist and fire pets, named after it, and none for the other elements', () => {
    for (const [id, folder, stages] of DRAWN) stages.forEach((name, stage) => {
      expect(JSON.stringify(petSprite(id, stage, 'celebrate'))).toContain(`${folder}/celebrate/${name}_Celebrate`);
      expect(drawnCelebrateMs(id, stage)).toBe(cycleMs);
      expect(drawnActions(id, stage)).toEqual({ attackStrip: true, jumpStrip: true, celebrateStrip: true });
    });
    for (const pet of PETS.filter((p) => !(DRAWN_IDS as readonly string[]).includes(p.id))) for (let stage = 0; stage <= 6; stage++) {
      expect(hasSprite(pet.id, stage, 'celebrate')).toBe(false);
      expect(drawnCelebrateMs(pet.id, stage)).toBe(0);
      expect(drawnActions(pet.id, stage)).toEqual({ attackStrip: false, jumpStrip: false, celebrateStrip: false });
    }
    expect(drawnCelebrateMs('cat', 3, true)).toBe(0); // "reduce motion": the pet stays still
    expect(drawnCelebrateMs('fox', 3, true)).toBe(0);
  });

  it('matches its grid, within what phones draw, with clear edges so no frame shows a sliver of the next', () => {
    const { PNG } = require('pngjs');
    for (const [, folder, stages] of DRAWN) for (const name of stages) {
      const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, `../assets/pets/${folder}/celebrate/${name}_Celebrate.png`)));
      const cell = png.width / cols;
      expect(png.height).toBe(cell * rows);
      expect(png.width).toBeLessThanOrEqual(2048);
      const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
      let onEdges = 0;
      for (let frame = 0; frame < cols; frame++) for (let i = 0; i < cell; i++) {
        const x0 = frame * cell;
        onEdges += alpha(x0, i) + alpha(x0 + cell - 1, i) + alpha(x0 + i, 0) + alpha(x0 + i, cell - 1);
      }
      expect(onEdges).toBe(0);
    }
  });
});

describe('PetArt', () => {
  beforeEach(preload);

  it.each(DRAWN_IDS)('draws the strip of the level %s is at, and of the new one when it levels up', (id) => {
    const cheer = new Animated.Value(0);
    const { rerender } = render(<PetArt pet={id} size={66} stage={2} cheer={cheer} />);
    expect(JSON.stringify(cheerImage()!.props.source)).toMatch(/Lv2_Phat_Trien_Celebrate/);
    rerender(<PetArt pet={id} size={66} stage={3} cheer={cheer} />);
    expect(JSON.stringify(cheerImage()!.props.source)).toMatch(/Lv3_Nang_Cao_Celebrate/);
  });

  it('draws the fire pet its own strip at every level, not the mist pet\'s', () => {
    const cheer = new Animated.Value(0);
    for (let stage = 0; stage <= 6; stage++) {
      const { unmount } = render(<PetArt pet="fox" size={66} stage={stage} cheer={cheer} />);
      expect(JSON.stringify(cheerImage()!.props.source)).toContain('fire/celebrate/');
      unmount();
    }
  });

  it('leaves everything else as it was: other elements, and pets out of a game', () => {
    const cheer = new Animated.Value(0);
    for (const pet of ['turtle', 'penguin', 'bunny', 'dolphin']) {
      const { unmount } = render(<PetArt pet={pet} size={66} stage={3} cheer={cheer} />);
      expect(cheerImage()).toBeUndefined();
      unmount();
    }
    render(<PetArt pet="cat" size={66} stage={3} />);
    expect(cheerImage()).toBeUndefined();
  });

  it.each(DRAWN_IDS)('%s plays every frame in order over the idle, then is back to the idle', (id) => {
    const cheer = new Animated.Value(0);
    markSheetsLoaded([petSprite(id, 3, 'idle')!]);
    render(<PetArt pet={id} size={66} stage={3} cheer={cheer} />);
    const idle = () => imageOf('Idle')!;
    expect(visibility(cheerImage())).toBe(0);
    expect(visibility(idle())).toBe(1);
    for (let frame = 0; frame < cols; frame++) {
      act(() => { cheer.setValue((frame + 0.5) / cols); });
      expect(frameOf(cheerImage(), windowOf(66))).toBe(frame);
      expect(visibility(cheerImage())).toBe(1);
      expect(visibility(idle())).toBe(0);
    }
    act(() => { cheer.setValue(0); });
    expect(visibility(cheerImage())).toBe(0);
    expect(visibility(idle())).toBe(1);
  });

  it.each(DRAWN_IDS)('%s shows one action at a time when several are given', (id) => {
    const cheer = new Animated.Value(0.5), leap = new Animated.Value(0.5);
    render(<PetArt pet={id} size={66} stage={3} cheer={cheer} leap={leap} />);
    expect(visibility(imageOf('Jump'))).toBe(1);
    expect(visibility(cheerImage())).toBe(0);
  });
});

describe('the rig', () => {
  function played(props: Parameters<typeof useRig>[0]) {
    let rig!: ReturnType<typeof useRig>;
    const Host = () => { rig = useRig(props); return null; };
    render(<Host />);
    return rig;
  }

  it('cheers through the strip, then rests and reports its end', () => {
    const rig = played({ celebrateStrip: true, idle: false });
    const done = jest.fn();
    act(() => { rig.play('cheer', done); });
    ms(cycleMs / 2);
    expect(number(rig.cheer)).toBeGreaterThan(0.3);
    ms(cycleMs);
    expect(number(rig.cheer)).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('celebrates with a jump and then the strip, turning nothing on top of them', () => {
    const rig = played({ jumpStrip: true, celebrateStrip: true, idle: false });
    const done = jest.fn();
    const rotate = () => (StyleSheet.flatten(rig.style as any).transform as any[])[2].rotate.__getValue();
    act(() => { rig.play('celebrate', done); });
    ms(JUMP / 2);
    expect(number(rig.leap)).toBeGreaterThan(0);
    expect(number(rig.cheer)).toBe(0);
    expect(rotate()).toBe('0deg');
    ms(JUMP / 2 + cycleMs / 2);
    expect(number(rig.leap)).toBe(0);
    expect(number(rig.cheer)).toBeGreaterThan(0);
    expect(rotate()).toBe('0deg');
    expect(done).not.toHaveBeenCalled();
    ms(cycleMs);
    expect(number(rig.cheer)).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('a new action cuts a cheer short', () => {
    const rig = played({ attackStrip: true, celebrateStrip: true, idle: false });
    act(() => { rig.play('cheer'); });
    ms(cycleMs / 2);
    act(() => { rig.play('attack'); });
    expect(number(rig.cheer)).toBe(0);
    ms(100);
    expect(number(rig.strike)).toBeGreaterThan(0);
    expect(number(rig.cheer)).toBe(0);
  });

  it('for a pet with no strip a cheer does nothing, not even to what is playing', () => {
    const rig = played({ idle: false });
    act(() => { rig.play('attack'); });
    ms(200);
    const x = () => (StyleSheet.flatten(rig.style as any).transform as any[])[0].translateX.__getValue();
    const before = x();
    expect(before).not.toBe(0);
    const done = jest.fn();
    act(() => { rig.play('cheer', done); });
    expect(done).toHaveBeenCalledTimes(1);
    expect(x()).toBe(before);
    expect(number(rig.cheer)).toBe(0);
  });

  it('keeps the old celebration of a pet with no strip', () => {
    const rig = played({ idle: false });
    act(() => { rig.play('celebrate'); });
    ms(200);
    const lift = (StyleSheet.flatten(rig.style as any).transform as any[])[1].translateY.__getValue();
    expect(lift).toBeLessThan(0);
    expect(number(rig.cheer)).toBe(0);
  });
});

describe('usePetCheer', () => {
  function Host({ pet, on }: { pet: string; on: boolean }) {
    const cheer = usePetCheer(pet, 3, on);
    return <PetArt pet={pet} size={60} stage={3} cheer={cheer} />;
  }
  beforeEach(preload);

  it.each(DRAWN_IDS)('%s plays once as it turns on, and is back to rest', (id) => {
    const { rerender } = render(<Host pet={id} on={false} />);
    ms(200);
    expect(shown()).toBe(0);
    rerender(<Host pet={id} on />);
    ms(cycleMs / 2);
    expect(shown()).toBe(1);
    ms(cycleMs);
    expect(shown()).toBe(0);
    ms(3000);
    expect(shown()).toBe(0); // once, not over and over
  });
});

describe('after a word breaks (pure)', () => {
  const H = 420, BOTTOM = 14, bounds = petBounds(390), home = 167;
  const plan = (moves: any[] = []) => planShot(moves, 0, { x: 300, y: 80 }, home, bounds, true, H, BOTTOM, undefined, null, JUMP, cycleMs);

  it('celebrates right after the jump of joy, and is over after the strip', () => {
    const p = plan();
    const from = p.breakAt + JUMP;
    expect(leapProgress(p, from - 1)).toBeGreaterThan(0.9);
    expect(cheerProgress(p, from - 1)).toBe(0);
    expect(cheerProgress(p, from + cycleMs / 2)).toBeCloseTo(0.5);
    expect(cheerProgress(p, from + cycleMs)).toBe(0);
  });

  it('stands still until it is over, even when the word waits for the server, then strolls again', () => {
    const moves: any[] = [];
    const p = plan(moves);
    const there = petX(moves, p.breakAt, home, bounds, true);
    delayBreak(p, 1000);
    const end = p.breakAt + JUMP + cycleMs;
    for (let t = p.breakAt - 1000; t < end; t += 32) expect(petX(moves, t, home, bounds, true)).toBe(there);
    expect(petX(moves, end + 3000, home, bounds, true)).not.toBe(there);
  });

  it('changes nothing for a pet with no strip', () => {
    const moves: any[] = [];
    const p = planShot(moves, 0, { x: 300, y: 80 }, home, bounds, false, H, BOTTOM);
    expect(p.cheerMs).toBe(0);
    expect(moves[0].hold).toBeUndefined();
    expect(cheerProgress(p, p.breakAt + 100)).toBe(0);
  });
});

describe('in the games', () => {
  beforeEach(preload);

  const APPLE: Turn = { turn_id: 'turn-apple', position: 0, kind: 'word_spelling', skill_label: 'Gõ từ', prompt: { word: 'apple', letters: [5] },
    hints_shown: [], hints_total: 1, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 };
  const field = (words: WordField<Turn>, petId: string, shots: boolean) => (
    <Playfield variant="words" turns={shots ? [] : [APPLE]} field={words} progress={() => 0.3} selectedId={null} onSelect={() => {}} petId={petId} petLevel={3} reduceMotion={false}
      flash={null} running onImpact={jest.fn()} onShotDone={jest.fn()} onBurstDone={jest.fn()} wrongKey={0}
      shots={shots ? [{ id: APPLE.turn_id, turn: APPLE, aimed: false, word: { en: 'apple', vi: 'quả táo', phonetic: null } }] : []} />
  );
  function shoot(petId: string) {
    const words = new WordField<Turn>();
    render(field(words, petId, false));
    fireEvent(screen.getByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
    act(() => { words.lock(APPLE.turn_id); });
    screen.rerender(field(words, petId, true));
  }

  it.each(DRAWN_IDS)('Bắn từ: %s attacks, jumps, celebrates, every frame in order, and is back to idle', (id) => {
    shoot(id);
    const order: string[] = [];
    const frames: number[] = [];
    for (let i = 0; i < 300; i++) {
      ms(16);
      for (const name of ['Attack', 'Jump', 'Celebrate']) if (shown(name) > 0 && order[order.length - 1] !== name) order.push(name);
      if (shown() > 0) frames.push(frameOf(cheerImage(), windowOf(56)));
    }
    expect(order).toEqual(['Attack', 'Jump', 'Celebrate']);
    expect([...new Set(frames)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shown()).toBe(0);
  });

  it('Bắn từ: a pet of another element has no strip', () => {
    shoot('turtle');
    ms(3000);
    expect(cheerImage()).toBeUndefined();
  });

  const kingdom = (petId: string, done: number) => <KingdomQuest done={done} total={12} wrongKey={0} petId={petId} petLevel={3} reduceMotion={false} running />;
  it.each(DRAWN_IDS)('Math Battle: a right answer that does not defeat the monster is cheered by %s after the hit', (id) => {
    const { rerender } = render(kingdom(id, 0));
    ms(1200);
    rerender(kingdom(id, 1));
    ms(300);
    expect(shown()).toBe(0); // the attack first
    expect(shown('Attack')).toBe(1);
    let cheered = false;
    for (let t = 0; t < 1500 && !cheered; t += 30) { ms(30); cheered = shown() === 1; }
    expect(cheered).toBe(true);
    expect(shown('Attack')).toBe(0);
    ms(cycleMs);
    expect(shown()).toBe(0);
  });

  it('Math Battle: a pet of another element is as before', () => {
    const { rerender } = render(kingdom('turtle', 0));
    ms(1200);
    rerender(kingdom('turtle', 1));
    ms(1500);
    expect(cheerImage()).toBeUndefined();
  });

  it.each(DRAWN_IDS)('Space Adventure: %s cheers in its dome as the asteroid breaks', (id) => {
    const props = { total: 6, wrongKey: 0, petLevel: 3, reduceMotion: false, running: true };
    const { rerender } = render(<SpaceQuest {...props} done={0} petId={id} />);
    rerender(<SpaceQuest {...props} done={1} petId={id} />);
    expect(shown()).toBe(0);
    let cheered = false;
    for (let t = 0; t < 1500 && !cheered; t += 30) { ms(30); cheered = shown() === 1; }
    expect(cheered).toBe(true);
  });

  it.each(DRAWN_IDS)('the lab world: a drop is cheered by %s, the finished potion gets the jump as well', (id) => {
    const props = { total: 2, wrongKey: 0, petLevel: 3, reduceMotion: false, running: true };
    const { rerender } = render(<LabQuest {...props} done={0} petId={id} />);
    rerender(<LabQuest {...props} done={1} petId={id} />);
    let cheered = false;
    for (let t = 0; t < 1500 && !cheered; t += 30) { ms(30); cheered = shown() === 1; }
    expect(cheered).toBe(true);
    ms(2500);
    rerender(<LabQuest {...props} done={2} petId={id} />);
    let jumped = false;
    for (let t = 0; t < 1500 && !jumped; t += 30) { ms(30); jumped = shown('Jump') === 1; }
    expect(jumped).toBe(true);
  });

  describe('the result screen', () => {
    // It waits for the server, long enough for jest.setup's "reduce motion" to take effect.
    beforeEach(() => { jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false); });
    afterEach(() => { jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });
    const result = (status: string) => ({ counts: { first_try: 10 }, items: [], open_review_count: 0,
      session: { id: 5, status, kind: 'lesson', mode: 'practice', game: 'defense', required_count: 10, max_combo: 0, reward: null, end_reason: status,
        lesson: { id: 1, code: 'x', name: 'Bài' }, topic: { id: 1, code: 't', name: 'Chủ đề' }, subject: { id: 1, code: 'math', name: 'Toán' }, catalog: null } });
    const show = async (id: string, status: string) => {
      setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
      mockServer({ 'GET /api/learning/sessions/5/result': { status: 200, body: result(status) } });
      render(<ResultScreen sessionId={5} petId={id} petLevel={3} onReplay={jest.fn()} onReview={jest.fn()} onHome={jest.fn()} onLesson={jest.fn()} onRewards={jest.fn()} reduceMotion={false} />);
      await screen.findByText('Đúng ngay 10/10 câu');
    };

    it.each(DRAWN_IDS)('%s, the stage completed: a jump, then the strip, then its idle', async (id) => {
      await show(id, 'completed');
      const order: string[] = [];
      for (let t = 0; t < 2400; t += 20) {
        ms(20);
        for (const name of ['Jump', 'Celebrate']) if (shown(name) > 0 && order[order.length - 1] !== name) order.push(name);
      }
      expect(order).toEqual(['Jump', 'Celebrate']);
      expect(shown()).toBe(0);
      expect(shown('Jump')).toBe(0);
    });

    it.each(DRAWN_IDS)('%s, the stage not completed: no celebration', async (id) => {
      await show(id, 'abandoned');
      expect(imageOf('Jump')).toBeTruthy(); // on stage, as for a stage completed: it just does not play
      for (let t = 0; t < 2400; t += 40) {
        ms(40);
        expect(shown()).toBe(0);
        expect(shown('Jump')).toBe(0);
      }
    });
  });

  const GATES: Turn = { ...APPLE, kind: 'gate_choice', prompt: { options: [{ id: 'a', text: 'go' }, { id: 'b', text: 'went' }] } } as Turn;
  it.each(DRAWN_IDS)('Chọn đáp án: %s cheers on the right answer, not on a wrong one', (id) => {
    const gate = (result: any) => <GateChoice turn={GATES} onChoose={() => {}} disabled={false} result={result} petId={id} petLevel={3} reduceMotion={false} />;
    const { rerender } = render(gate(null));
    rerender(gate({ chosen: 'b', right: false, correct: ['a'] }));
    ms(200);
    expect(shown()).toBe(0);
    rerender(gate({ chosen: 'a', right: true, correct: ['a'] }));
    ms(200);
    expect(shown()).toBe(1);
    ms(cycleMs);
    expect(shown()).toBe(0);
  });

  const TOKENS: Turn = { ...APPLE, kind: 'bridge_order', prompt: { tokens: [{ id: 'a', text: 'I' }, { id: 'b', text: 'go' }] } } as Turn;
  it.each(DRAWN_IDS)('Sắp xếp câu: %s cheers once solved', (id) => {
    const bridge = (solved: boolean) => <WordBridge turn={TOKENS} onSubmit={() => {}} disabled={false} solved={solved} petId={id} petLevel={3} reduceMotion={false} />;
    const { rerender } = render(bridge(false));
    ms(200);
    expect(shown()).toBe(0);
    rerender(bridge(true));
    ms(200);
    expect(shown()).toBe(1);
  });
});
