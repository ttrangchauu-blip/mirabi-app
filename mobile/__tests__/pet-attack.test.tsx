import fs from 'fs';
import path from 'path';
import React from 'react';
import { Animated, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { markSheetsLoaded, PetArt } from '../src/components/PetArt';
import { ForestQuest } from '../src/games/ForestQuest';
import { useRig } from '../src/games/engine/rig';
import { KingdomQuest } from '../src/games/quests/KingdomQuest';
import { SpaceQuest } from '../src/games/quests/SpaceQuest';
import type { Turn } from '../src/learning/types';
import { PETS } from '../src/pets';
import { ACTION_WINDOW, ATTACK_RELEASE_FRAME, attackWindupMs, hasSprite, petSprite, SPRITE_LAYOUT } from '../src/petSprites';
import { Playfield } from '../src/screens/learning/games/Playfield';
import { BULLETS, bulletAt, muzzle, petBounds, petDrift, petX, planShot, shotPoseAt, strikeProgress } from '../src/screens/learning/games/shooterFx';
import { WordField } from '../src/screens/learning/games/wordField';

const mockSound = jest.fn();
jest.mock('../src/games/engine/sfx', () => ({ ...jest.requireActual('../src/games/engine/sfx'), useSfx: () => mockSound }));

const stagesOf = (king: string) => ['Lv0_Trung_Pet', 'Lv1_So_Sinh', 'Lv2_Phat_Trien', 'Lv3_Nang_Cao', 'Lv4_Truong_Thanh', 'Lv5_Dai_Than', king];
/** The pets with a drawn attack: id, assets folder, its levels. */
const DRAWN = [['cat', 'mist', stagesOf('Lv6_Vua_Suong')], ['fox', 'fire', stagesOf('Lv6_Vua_Lua')]] as const;
const DRAWN_IDS = DRAWN.map(([id]) => id);
const { cols, cycleMs } = SPRITE_LAYOUT.attack;
const WINDUP = attackWindupMs('cat', 3);
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
/** Every stage's strip counts as loaded, as useGameAssets leaves them before a game starts. */
const preload = () => DRAWN_IDS.forEach((id) => markSheetsLoaded([0, 1, 2, 3, 4, 5, 6].map((stage) => petSprite(id, stage, 'attack')!)));

/** The attack strip's image in what is drawn, if any. */
const attackImage = () => screen.UNSAFE_root.findAllByType(Image).find((image: any) => /_Attack/.test(JSON.stringify(image.props.source)));
const attackSheet = () => JSON.stringify(attackImage()?.props.source ?? null);
const styleOf = (node: any) => StyleSheet.flatten(node.props.style) ?? {};
/** A style's value, or what an Animated value in it stands at now. */
const now = (v: any) => (v?.__getValue ? v.__getValue() : v);
/** How visible a node is: its own opacity and that of everything around it. */
function visibility(node: any) {
  let shown = 1;
  for (let n = node; n; n = n.parent) shown *= now(styleOf(n).opacity) ?? 1;
  return shown;
}
/** Which frame of its strip an image is on. */
function frameOf(image: any, windowSize: number) {
  const { transform } = styleOf(image);
  return -now((transform as any[])[0].translateX) / windowSize;
}
const windowOf = (size: number) => size + 2 * Math.round((size * (ACTION_WINDOW.attack - 1)) / 2);

beforeEach(() => { mockSound.mockClear(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// First in the file: nothing has marked this sheet as loaded yet.
it('keeps the idle until the sheet has loaded, rather than a pet that vanishes', () => {
  render(<PetArt pet="cat" size={66} stage={3} strike={new Animated.Value(0.5)} />);
  expect(visibility(attackImage())).toBe(0);
  act(() => { fireEvent(attackImage()!, 'load'); });
  expect(visibility(attackImage())).toBe(1);
});

describe('the strips', () => {
  it('has one for each level of the mist and fire pets, named after it, and none for the other elements', () => {
    for (const [id, folder, stages] of DRAWN) stages.forEach((name, stage) => {
      expect(JSON.stringify(petSprite(id, stage, 'attack'))).toContain(`${folder}/attack/${name}_Attack`);
      expect(attackWindupMs(id, stage)).toBe((cycleMs * ATTACK_RELEASE_FRAME) / cols);
    });
    for (const pet of PETS.filter((p) => !(DRAWN_IDS as readonly string[]).includes(p.id))) for (let stage = 0; stage <= 6; stage++) {
      expect(hasSprite(pet.id, stage, 'attack')).toBe(false);
      expect(attackWindupMs(pet.id, stage)).toBe(0);
    }
    expect(attackWindupMs('cat', 3, true)).toBe(0); // "reduce motion": it stays still and fires at once
    expect(attackWindupMs('fox', 3, true)).toBe(0);
  });

  it('is 8 frames in a row, within what phones draw, with clear edges so no frame shows a sliver of the next', () => {
    const { PNG } = require('pngjs');
    for (const [, folder, stages] of DRAWN) for (const name of stages) {
      const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, `../assets/pets/${folder}/attack/${name}_Attack.png`)));
      expect([png.width, png.height]).toEqual([2048, 256]);
      const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
      let onEdges = 0;
      for (let frame = 0; frame < 8; frame++) for (let i = 0; i < 256; i++) {
        const x0 = frame * 256;
        onEdges += alpha(x0, i) + alpha(x0 + 255, i) + alpha(x0 + i, 0) + alpha(x0 + i, 255);
      }
      expect(onEdges).toBe(0);
    }
  });
});

describe('PetArt', () => {
  beforeEach(preload);

  it.each(DRAWN_IDS)('draws the strip of the level %s is at, and of the new one when it levels up', (id) => {
    const strike = new Animated.Value(0);
    const { rerender } = render(<PetArt pet={id} size={66} stage={2} strike={strike} />);
    expect(attackSheet()).toMatch(/Lv2_Phat_Trien_Attack/);
    rerender(<PetArt pet={id} size={66} stage={3} strike={strike} />);
    expect(attackSheet()).toMatch(/Lv3_Nang_Cao_Attack/);
  });

  it('draws the fire pet its own strip at every level, not the mist pet\'s', () => {
    const strike = new Animated.Value(0);
    for (let stage = 0; stage <= 6; stage++) {
      const { unmount } = render(<PetArt pet="fox" size={66} stage={stage} strike={strike} />);
      expect(attackSheet()).toContain('fire/attack/');
      unmount();
    }
  });

  it('leaves everything else as it was: other elements, and pets out of a game', () => {
    const strike = new Animated.Value(0);
    for (const pet of ['turtle', 'penguin', 'bunny', 'dolphin']) {
      const { unmount } = render(<PetArt pet={pet} size={66} stage={3} strike={strike} />);
      expect(attackImage()).toBeUndefined();
      unmount();
    }
    render(<PetArt pet="cat" size={66} stage={3} />);
    expect(attackImage()).toBeUndefined();
  });

  it.each(DRAWN_IDS)('%s plays every frame in order over the idle, then is back to the idle', (id) => {
    const strike = new Animated.Value(0);
    markSheetsLoaded([petSprite(id, 3, 'idle')!]);
    render(<PetArt pet={id} size={66} stage={3} strike={strike} />);
    const idle = () => screen.UNSAFE_root.findAllByType(Image).find((image: any) => /_Idle/.test(JSON.stringify(image.props.source)))!;
    expect(visibility(attackImage())).toBe(0); // at rest: on stage, unseen, so the first attack starts at once
    expect(visibility(idle())).toBe(1);
    for (let frame = 0; frame < cols; frame++) {
      act(() => { strike.setValue((frame + 0.5) / cols); });
      expect(frameOf(attackImage(), windowOf(66))).toBe(frame);
      expect(visibility(attackImage())).toBe(1);
      expect(visibility(idle())).toBe(0); // only one pet at a time
    }
    act(() => { strike.setValue(1); });
    expect(visibility(attackImage())).toBe(0);
    expect(visibility(idle())).toBe(1);
  });

  it('sits on the same centre and bottom edge as the idle, in a frame large enough for the lunge', () => {
    render(<PetArt pet="cat" size={66} stage={3} strike={new Animated.Value(0)} />);
    let layer: any = attackImage();
    while (styleOf(layer).position !== 'absolute' || styleOf(layer).bottom !== 0) layer = layer.parent;
    expect(styleOf(layer).left).toBe((66 - windowOf(66)) / 2);
    expect(Number.isInteger(styleOf(layer).left)).toBe(true);
  });
});

describe('the rig', () => {
  type RigProps = Parameters<typeof useRig>[0];
  function played(props: RigProps) {
    let rig!: ReturnType<typeof useRig>;
    const Host = () => { rig = useRig(props); return null; };
    render(<Host />);
    return rig;
  }
  const number = (v: Animated.Value) => (v as any).__getValue() as number;

  it('plays a drawn attack through the strip, moving and stretching nothing on top of it, then reports its end', () => {
    const rig = played({ attackStrip: true, idle: false });
    const done = jest.fn();
    act(() => { rig.play('attack', done); });
    const looks: any[] = [];
    for (let t = 0; t < cycleMs; t += 90) { ms(90); looks.push(StyleSheet.flatten(rig.style as any).transform); }
    expect(number(rig.strike)).toBeGreaterThan(0.9);
    for (const transform of looks) {
      const v = Object.assign({}, ...transform.map((part: any) => Object.fromEntries(Object.entries(part).map(([k, x]: any) => [k, x.__getValue ? x.__getValue() : x]))));
      expect(v.translateX).toBe(0);
      expect(v.scaleX).toBe(1);
      expect(v.scaleY).toBe(1);
    }
    ms(60);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('goes back to rest when stopped halfway', () => {
    const rig = played({ attackStrip: true, idle: false });
    act(() => { rig.play('attack'); });
    ms(cycleMs / 2);
    expect(number(rig.strike)).toBeGreaterThan(0.3);
    act(() => { rig.stop(); });
    expect(number(rig.strike)).toBe(0);
  });

  it('keeps the lunge of a pet with no strip', () => {
    const rig = played({ idle: false });
    act(() => { rig.play('attack'); });
    ms(200);
    expect(number(rig.strike)).toBe(0);
    const x = (StyleSheet.flatten(rig.style as any).transform as any[])[0].translateX;
    expect(x.__getValue()).not.toBe(0);
  });
});

describe('a shot with a drawn attack (pure)', () => {
  const H = 420, BOTTOM = 14, bounds = petBounds(390), home = 167;
  const attack = { windupMs: WINDUP, totalMs: cycleMs };

  it('winds up once the pet has stopped and fires as it lunges, frame 3 of the strip', () => {
    const moves: any[] = [];
    const plan = planShot(moves, 1000, { x: 360, y: 80 }, home, bounds, false, H, BOTTOM, undefined, attack);
    const arrived = 1000 + moves[0].dur;
    expect(plan.strikeAt).toBe(arrived);
    expect(plan.fireAt).toBe(arrived + WINDUP);
    expect(strikeProgress(plan, plan.fireAt) * cols).toBeCloseTo(ATTACK_RELEASE_FRAME);
    expect(strikeProgress(plan, arrived - 1)).toBe(0);
    expect(strikeProgress(plan, arrived + cycleMs)).toBe(0); // back to its idle
  });

  it('has every bullet leave while the attack is playing, and no bullet before the lunge', () => {
    const plan = planShot([], 0, { x: 200, y: 80 }, home, bounds, false, H, BOTTOM, undefined, attack);
    const origin = muzzle(home, H, BOTTOM);
    expect(bulletAt(plan, 0, plan.fireAt - 1, origin)).toBeNull();
    expect(bulletAt(plan, 0, plan.fireAt, origin)).not.toBeNull();
    const last = plan.fireAt + (BULLETS - 1) * plan.gap;
    expect(strikeProgress(plan, last)).toBeGreaterThan(0);
    expect(plan.impactAt).toBeGreaterThan(plan.fireAt);
  });

  it('adds no stretching of its own until the hop of joy when the word breaks', () => {
    const plan = planShot([], 0, { x: 200, y: 80 }, home, bounds, false, H, BOTTOM, undefined, attack);
    for (let t = 0; t < plan.breakAt; t += 8) expect(shotPoseAt(plan, t)).toBeNull();
    expect(shotPoseAt(plan, plan.breakAt + 100)!.lift).toBeGreaterThan(0);
  });

  it('stands still until the attack is over, then strolls again (its feet never slide)', () => {
    const moves: any[] = [];
    const plan = planShot(moves, 0, { x: 300, y: 80 }, home, bounds, true, H, BOTTOM, undefined, attack);
    const end = plan.strikeAt! + cycleMs;
    const there = petX(moves, plan.strikeAt!, home, bounds, true);
    for (let t = plan.strikeAt!; t < end; t += 16) {
      expect(petX(moves, t, home, bounds, true)).toBe(there);
      expect(petDrift(moves, t - 60, home, bounds, true)).toBeNull();
    }
    expect(petX(moves, end + 2000, home, bounds, true)).not.toBe(there);
  });

  it('faces the word it shoots', () => {
    expect(planShot([], 0, { x: 360, y: 80 }, home, bounds, false, H, BOTTOM, undefined, attack).facing).toBe(1);
    expect(planShot([], 0, { x: 20, y: 80 }, home, bounds, false, H, BOTTOM, undefined, attack).facing).toBe(-1);
  });

  it('changes nothing for a pet with no strip', () => {
    const moves: any[] = [];
    const plan = planShot(moves, 0, { x: 200, y: 80 }, home, bounds, false, H, BOTTOM);
    expect(plan.strikeAt).toBeNull();
    expect(moves[0].hold).toBeUndefined();
    expect(strikeProgress(plan, plan.fireAt)).toBe(0);
    expect(shotPoseAt(plan, plan.fireAt - 10)!.sy).toBeLessThan(1); // its own crouch
  });
});

describe('in the falling-word games', () => {
  beforeEach(preload);
  const APPLE: Turn = { turn_id: 'turn-apple', position: 0, kind: 'word_spelling', skill_label: 'Gõ từ', prompt: { word: 'apple', letters: [5] },
    hints_shown: [], hints_total: 1, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 };
  const field = (words: WordField<Turn>, petId: string, shots: boolean, reduceMotion = false) => (
    <Playfield variant="words" turns={shots ? [] : [APPLE]} field={words} progress={() => 0.3} selectedId={null} onSelect={() => {}} petId={petId} petLevel={3} reduceMotion={reduceMotion}
      flash={null} running onImpact={jest.fn()} onShotDone={jest.fn()} onBurstDone={jest.fn()} wrongKey={0}
      shots={shots ? [{ id: APPLE.turn_id, turn: APPLE, aimed: false, word: { en: 'apple', vi: 'quả táo', phonetic: null } }] : []} />
  );
  function shoot(petId: string, reduceMotion = false) {
    const words = new WordField<Turn>();
    render(field(words, petId, false, reduceMotion));
    fireEvent(screen.getByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
    act(() => { words.lock(APPLE.turn_id); });
    screen.rerender(field(words, petId, true, reduceMotion));
  }
  const bulletsOut = () => screen.queryAllByTestId('bullet').filter((b) => StyleSheet.flatten(b.props.style).opacity > 0).length;

  it.each(DRAWN_IDS)('%s strikes, its first bullet leaves on the lunge frame, and it is back to idle before the word breaks', (id) => {
    shoot(id);
    const frames: number[] = [];
    let firstBullet: number | null = null;
    let shownLast = 0;
    for (let i = 0; i < 90; i++) {
      ms(16);
      const image = attackImage();
      if (visibility(image) > 0) { frames.push(frameOf(image, windowOf(56))); shownLast = i; }
      if (firstBullet === null && bulletsOut()) firstBullet = frames[frames.length - 1];
    }
    expect(firstBullet).toBe(ATTACK_RELEASE_FRAME);
    expect([...new Set(frames)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // all of them, in order
    expect(visibility(attackImage())).toBe(0); // and it is over
    expect(shownLast).toBeLessThan(89);
  });

  it('a pet of another element fires as before, with no strip', () => {
    shoot('turtle');
    ms(16 * 25);
    expect(attackImage()).toBeUndefined();
    expect(bulletsOut()).toBeGreaterThan(0);
  });

  it.each(DRAWN_IDS)('with reduced motion %s stays still and fires at once', (id) => {
    shoot(id, true);
    ms(16 * 25);
    expect(bulletsOut()).toBeGreaterThan(0);
  });
});

describe('in the other games with an attack', () => {
  beforeEach(preload);

  const soundAt = (cue: string, until: number) => {
    let at: number | null = null;
    for (let t = 0; t < until && at === null; t += 10) {
      if (mockSound.mock.calls.some(([c]) => c === cue)) at = t;
      ms(10);
    }
    return at;
  };
  const shown = () => { const image = attackImage(); return image ? visibility(image) : 0; };

  const kingdom = (petId: string, done: number) => <KingdomQuest done={done} total={6} wrongKey={0} petId={petId} petLevel={3} reduceMotion={false} running />;
  it.each(DRAWN_IDS)('Math Battle: %s plays the strip for every spell and the hit lands after the lunge', (id) => {
    const { rerender } = render(kingdom(id, 0));
    ms(1200);
    expect(shown()).toBe(0);
    rerender(kingdom(id, 1));
    ms(100);
    expect(shown()).toBe(1); // a plain spell, no skill yet
    expect(screen.queryByText('−1')).toBeNull();
    const hitAt = 100 + (soundAt('hit', 1000) ?? NaN);
    expect(hitAt).toBeGreaterThan(WINDUP);
    expect(hitAt).toBeLessThan(cycleMs);
    expect(screen.getByText('−1')).toBeTruthy();
    ms(cycleMs);
    expect(shown()).toBe(0); // back to idle
  });

  it('Math Battle: a pet of another element still casts, its strike as quick as before', () => {
    const { rerender } = render(kingdom('turtle', 0));
    ms(1200);
    rerender(kingdom('turtle', 1));
    expect(attackImage()).toBeUndefined();
    expect(soundAt('hit', 1000)).toBeLessThan(WINDUP + 150);
  });

  const forest = (petId: string, done: number) => <ForestQuest quest="rescue" done={done} total={6} wrongKey={0} petId={petId} petLevel={3} reduceMotion={false} running />;
  it.each(DRAWN_IDS)('the forest rescue: the vine breaks on the strike of %s, not before', (id) => {
    const { rerender } = render(forest(id, 0));
    rerender(forest(id, 1));
    expect(mockSound).not.toHaveBeenCalledWith('hit');
    const at = soundAt('hit', 1000);
    expect(at).toBeGreaterThanOrEqual(WINDUP - 20);
    expect(at).toBeLessThanOrEqual(WINDUP + 20);
    expect(shown()).toBe(1);
    ms(cycleMs);
    expect(shown()).toBe(0);
  });

  it('the forest rescue: a pet of another element breaks it at once', () => {
    const { rerender } = render(forest('turtle', 0));
    rerender(forest('turtle', 1));
    expect(mockSound).toHaveBeenCalledWith('hit');
    expect(attackImage()).toBeUndefined();
  });

  const space = (petId: string, done: number) => <SpaceQuest done={done} total={6} wrongKey={0} petId={petId} petLevel={3} reduceMotion={false} running />;
  it.each(DRAWN_IDS)('Space Adventure: the laser leaves on the lunge of %s', (id) => {
    const { rerender } = render(space(id, 0));
    rerender(space(id, 1));
    expect(mockSound).not.toHaveBeenCalledWith('shot');
    expect(shown()).toBeLessThanOrEqual(1);
    const at = soundAt('shot', 1000);
    expect(at).toBeGreaterThanOrEqual(WINDUP - 20);
    expect(at).toBeLessThanOrEqual(WINDUP + 20);
  });

  it('Space Adventure: a pet of another element fires at once', () => {
    const { rerender } = render(space('turtle', 0));
    rerender(space('turtle', 1));
    expect(mockSound).toHaveBeenCalledWith('shot');
    expect(attackImage()).toBeUndefined();
  });
});
