import fs from 'fs';
import path from 'path';
import React from 'react';
import { Animated, Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { markSheetsLoaded, PetArt } from '../src/components/PetArt';
import { useRig } from '../src/games/engine/rig';
import { MapQuest } from '../src/games/quests/MapQuest';
import { TimeQuest } from '../src/games/quests/TimeQuest';
import type { Turn } from '../src/learning/types';
import { PETS } from '../src/pets';
import { ACTION_WINDOW, drawnJumpMs, hasSprite, petSprite, SPRITE_LAYOUT } from '../src/petSprites';
import { Playfield } from '../src/screens/learning/games/Playfield';
import { delayBreak, hopAt, leapProgress, petBounds, petDrift, petX, planShot, shotPoseAt, HOP_MS } from '../src/screens/learning/games/shooterFx';
import { WordField } from '../src/screens/learning/games/wordField';

const stagesOf = (king: string) => ['Lv0_Trung_Pet', 'Lv1_So_Sinh', 'Lv2_Phat_Trien', 'Lv3_Nang_Cao', 'Lv4_Truong_Thanh', 'Lv5_Dai_Than', king];
/** The pets with a drawn jump: id, assets folder, its levels. */
const DRAWN = [['cat', 'mist', stagesOf('Lv6_Vua_Suong')], ['fox', 'fire', stagesOf('Lv6_Vua_Lua')]] as const;
const DRAWN_IDS = DRAWN.map(([id]) => id);
const { cols, rows, cycleMs } = SPRITE_LAYOUT.jump;
const FRAMES = cols * rows;
const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
const preload = () => DRAWN_IDS.forEach((id) => markSheetsLoaded([0, 1, 2, 3, 4, 5, 6].map((stage) => petSprite(id, stage, 'jump')!)));

const jumpImage = () => screen.UNSAFE_root.findAllByType(Image).find((image: any) => /_Jump/.test(JSON.stringify(image.props.source)));
const jumpSheet = () => JSON.stringify(jumpImage()?.props.source ?? null);
const styleOf = (node: any) => StyleSheet.flatten(node.props.style) ?? {};
const now = (v: any) => (v?.__getValue ? v.__getValue() : v);
function visibility(node: any) {
  let shown = 1;
  for (let n = node; n; n = n.parent) shown *= now(styleOf(n).opacity) ?? 1;
  return shown;
}
const windowOf = (size: number) => size + 2 * Math.round((size * (ACTION_WINDOW.jump - 1)) / 2);
/** Which frame of its grid an image is on. */
function frameOf(image: any, windowSize: number) {
  const { transform } = styleOf(image);
  return -now((transform as any[])[0].translateX) / windowSize + (-now((transform as any[])[1].translateY) / windowSize) * cols;
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// First in the file: nothing has marked this sheet as loaded yet.
it('keeps the idle until the sheet has loaded, rather than a pet that vanishes', () => {
  render(<PetArt pet="cat" size={66} stage={3} leap={new Animated.Value(0.5)} />);
  expect(visibility(jumpImage())).toBe(0);
  act(() => { fireEvent(jumpImage()!, 'load'); });
  expect(visibility(jumpImage())).toBe(1);
});

describe('the strips', () => {
  it('has one for each level of the mist and fire pets, named after it, and none for the other elements', () => {
    for (const [id, folder, stages] of DRAWN) stages.forEach((name, stage) => {
      expect(JSON.stringify(petSprite(id, stage, 'jump'))).toContain(`${folder}/jump/${name}_Jump`);
      expect(drawnJumpMs(id, stage)).toBe(cycleMs);
    });
    for (const pet of PETS.filter((p) => !(DRAWN_IDS as readonly string[]).includes(p.id))) for (let stage = 0; stage <= 6; stage++) {
      expect(hasSprite(pet.id, stage, 'jump')).toBe(false);
      expect(drawnJumpMs(pet.id, stage)).toBe(0);
    }
    expect(drawnJumpMs('cat', 3, true)).toBe(0); // "reduce motion": the pet stays on the ground
    expect(drawnJumpMs('fox', 3, true)).toBe(0);
  });

  it('matches its grid, within what phones draw, with clear edges so no frame shows a sliver of the next', () => {
    const { PNG } = require('pngjs');
    for (const [, folder, stages] of DRAWN) for (const name of stages) {
      const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, `../assets/pets/${folder}/jump/${name}_Jump.png`)));
      const cell = png.width / cols;
      expect(png.height).toBe(cell * rows);
      expect(png.width).toBeLessThanOrEqual(2048);
      const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
      let onEdges = 0;
      for (let frame = 0; frame < FRAMES; frame++) for (let i = 0; i < cell; i++) {
        const x0 = (frame % cols) * cell, y0 = Math.floor(frame / cols) * cell;
        onEdges += alpha(x0, y0 + i) + alpha(x0 + cell - 1, y0 + i) + alpha(x0 + i, y0) + alpha(x0 + i, y0 + cell - 1);
      }
      expect(onEdges).toBe(0);
    }
  });

  it('draws a real jump: it rises to a peak in the middle of the strip and lands where it took off', () => {
    const { PNG } = require('pngjs');
    for (const [, folder, stages] of DRAWN) for (const name of stages) {
      const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, `../assets/pets/${folder}/jump/${name}_Jump.png`)));
      const cell = png.width / cols;
      // How low each frame reaches. The fire egg leaves its nest on the ground as it leaps, so for it: how high.
      const fromTop = folder === 'fire' && name === 'Lv0_Trung_Pet';
      const edge = Array.from({ length: FRAMES }, (_, frame) => {
        const x0 = (frame % cols) * cell, y0 = Math.floor(frame / cols) * cell;
        for (let i = 0; i < cell; i++) {
          const y = fromTop ? i : cell - 1 - i;
          for (let x = 0; x < cell; x++) if (png.data[((y0 + y) * png.width + x0 + x) * 4 + 3] > 128) return y / cell;
        }
        return 0;
      });
      const peak = edge.indexOf(Math.min(...edge));
      expect(peak).toBeGreaterThanOrEqual(3);
      expect(peak).toBeLessThanOrEqual(5);
      expect(Math.abs(edge[0] - edge[FRAMES - 1])).toBeLessThan(0.02);
      expect(edge[0] - edge[peak]).toBeGreaterThan(0.05);
    }
  });
});

describe('PetArt', () => {
  beforeEach(preload);

  it.each(DRAWN_IDS)('draws the strip of the level %s is at, and of the new one when it levels up', (id) => {
    const leap = new Animated.Value(0);
    const { rerender } = render(<PetArt pet={id} size={66} stage={2} leap={leap} />);
    expect(jumpSheet()).toMatch(/Lv2_Phat_Trien_Jump/);
    rerender(<PetArt pet={id} size={66} stage={3} leap={leap} />);
    expect(jumpSheet()).toMatch(/Lv3_Nang_Cao_Jump/);
  });

  it('draws the fire pet its own strip at every level, not the mist pet\'s', () => {
    const leap = new Animated.Value(0);
    for (let stage = 0; stage <= 6; stage++) {
      const { unmount } = render(<PetArt pet="fox" size={66} stage={stage} leap={leap} />);
      expect(jumpSheet()).toContain('fire/jump/');
      unmount();
    }
  });

  it('leaves everything else as it was: other elements, and pets out of a game', () => {
    const leap = new Animated.Value(0);
    for (const pet of ['turtle', 'penguin', 'bunny', 'dolphin']) {
      const { unmount } = render(<PetArt pet={pet} size={66} stage={3} leap={leap} />);
      expect(jumpImage()).toBeUndefined();
      unmount();
    }
    render(<PetArt pet="cat" size={66} stage={3} />);
    expect(jumpImage()).toBeUndefined();
  });

  it.each(DRAWN_IDS)('%s plays every frame of the grid in order over the idle, then is back to the idle', (id) => {
    const leap = new Animated.Value(0);
    markSheetsLoaded([petSprite(id, 3, 'idle')!]);
    render(<PetArt pet={id} size={66} stage={3} leap={leap} />);
    const idle = () => screen.UNSAFE_root.findAllByType(Image).find((image: any) => /_Idle/.test(JSON.stringify(image.props.source)))!;
    expect(visibility(jumpImage())).toBe(0);
    expect(visibility(idle())).toBe(1);
    for (let frame = 0; frame < FRAMES; frame++) {
      act(() => { leap.setValue((frame + 0.5) / FRAMES); });
      expect(frameOf(jumpImage(), windowOf(66))).toBe(frame);
      expect(visibility(jumpImage())).toBe(1);
      expect(visibility(idle())).toBe(0);
    }
    act(() => { leap.setValue(0); });
    expect(visibility(jumpImage())).toBe(0);
    expect(visibility(idle())).toBe(1);
  });

  it.each(DRAWN_IDS)('%s with an attack as well shows only one at a time, and the strike wins', (id) => {
    const leap = new Animated.Value(0.5), strike = new Animated.Value(0.5);
    markSheetsLoaded([petSprite(id, 3, 'attack')!]);
    render(<PetArt pet={id} size={66} stage={3} leap={leap} strike={strike} />);
    const attack = () => screen.UNSAFE_root.findAllByType(Image).find((image: any) => /_Attack/.test(JSON.stringify(image.props.source)))!;
    expect(visibility(attack())).toBe(1);
    expect(visibility(jumpImage())).toBe(0);
  });
});

describe('the rig', () => {
  function played(props: Parameters<typeof useRig>[0]) {
    let rig!: ReturnType<typeof useRig>;
    const Host = () => { rig = useRig(props); return null; };
    render(<Host />);
    return rig;
  }
  const number = (v: Animated.Value) => (v as any).__getValue() as number;
  const lift = (rig: ReturnType<typeof useRig>) => (StyleSheet.flatten(rig.style as any).transform as any[])[1].translateY.__getValue();

  it('plays a drawn jump through the strip, lifting nothing on top of it, then rests and reports its end', () => {
    const rig = played({ jumpStrip: true, idle: false });
    const done = jest.fn();
    act(() => { rig.play('jump', done); });
    for (let t = 0; t < cycleMs - 40; t += 40) {
      ms(40);
      expect(number(rig.leap)).toBeGreaterThan(0);
      expect(lift(rig)).toBe(0);
    }
    ms(100);
    expect(number(rig.leap)).toBe(0); // back to idle
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('jumps twice in a celebration, resting in between', () => {
    const rig = played({ jumpStrip: true, idle: false });
    const seen: number[] = [];
    act(() => { rig.play('celebrate'); });
    for (let t = 0; t < 2 * cycleMs + 600; t += 20) { ms(20); seen.push(number(rig.leap)); }
    const starts = seen.filter((v, i) => v > 0 && !seen[i - 1]).length;
    expect(starts).toBe(2);
    expect(seen[seen.length - 1]).toBe(0);
  });

  it('goes back to rest when stopped halfway', () => {
    const rig = played({ jumpStrip: true, idle: false });
    act(() => { rig.play('jump'); });
    ms(cycleMs / 2);
    expect(number(rig.leap)).toBeGreaterThan(0.3);
    act(() => { rig.stop(); });
    expect(number(rig.leap)).toBe(0);
  });

  it('keeps the hop of a pet with no strip', () => {
    const rig = played({ idle: false });
    act(() => { rig.play('jump'); });
    ms(200);
    expect(number(rig.leap)).toBe(0);
    expect(lift(rig)).toBeLessThan(0);
  });
});

describe('the jump of joy in the falling-word games (pure)', () => {
  const H = 420, BOTTOM = 14, bounds = petBounds(390), home = 167;
  const plan = (moves: any[] = []) => planShot(moves, 0, { x: 300, y: 80 }, home, bounds, true, H, BOTTOM, undefined, null, cycleMs);

  it('leaps as the word breaks instead of hopping, and is over after the strip', () => {
    const p = plan();
    expect(leapProgress(p, p.breakAt - 1)).toBe(0);
    expect(leapProgress(p, p.breakAt)).toBe(0);
    expect(leapProgress(p, p.breakAt + cycleMs / 2)).toBeCloseTo(0.5);
    expect(leapProgress(p, p.breakAt + cycleMs)).toBe(0);
    for (let t = p.breakAt; t < p.breakAt + HOP_MS; t += 16) expect(shotPoseAt(p, t)).toBeNull();
  });

  it('stands still until it has landed, then strolls again (its feet never slide)', () => {
    const moves: any[] = [];
    const p = plan(moves);
    const there = petX(moves, p.breakAt, home, bounds, true);
    for (let t = p.breakAt; t < p.breakAt + cycleMs; t += 16) {
      expect(petX(moves, t, home, bounds, true)).toBe(there);
      expect(petDrift(moves, t - 60, home, bounds, true)).toBeNull();
    }
    expect(petX(moves, p.breakAt + cycleMs + 3000, home, bounds, true)).not.toBe(there);
  });

  it('still stands for it when the word waits for the server', () => {
    const moves: any[] = [];
    const p = plan(moves);
    const there = petX(moves, p.breakAt, home, bounds, true);
    const before = p.breakAt;
    delayBreak(p, 1500);
    expect(p.breakAt).toBe(before + 1500);
    for (let t = before; t < p.breakAt + cycleMs; t += 32) expect(petX(moves, t, home, bounds, true)).toBe(there);
  });

  it('changes nothing for a pet with no strip', () => {
    const moves: any[] = [];
    const p = planShot(moves, 0, { x: 300, y: 80 }, home, bounds, false, H, BOTTOM);
    expect(p.jumpMs).toBe(0);
    expect(moves[0].hold).toBeUndefined();
    expect(leapProgress(p, p.breakAt + 100)).toBe(0);
    expect(shotPoseAt(p, p.breakAt + 100)).toEqual(hopAt(100 / HOP_MS));
  });
});

describe('in the games', () => {
  beforeEach(preload);
  const shown = () => { const image = jumpImage(); return image ? visibility(image) : 0; };

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

  it.each(DRAWN_IDS)('Bắn từ: %s attacks, then plays its jump, every frame in order, then is back to idle', (id) => {
    shoot(id);
    const frames: number[] = [];
    for (let i = 0; i < 200; i++) {
      ms(16);
      if (shown() > 0) frames.push(frameOf(jumpImage(), windowOf(56)));
    }
    expect([...new Set(frames)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shown()).toBe(0);
  });

  it('Bắn từ: a pet of another element has no jump strip', () => {
    shoot('turtle');
    ms(1600);
    expect(jumpImage()).toBeUndefined();
  });

  const props = { total: 6, wrongKey: 0, petLevel: 3, reduceMotion: false, running: true };
  it.each(DRAWN_IDS)('Time Traveler: %s digs with its drawn jump', (id) => {
    const { rerender } = render(<TimeQuest {...props} done={0} petId={id} />);
    expect(shown()).toBe(0);
    rerender(<TimeQuest {...props} done={1} petId={id} />);
    ms(cycleMs / 2);
    expect(shown()).toBe(1);
    ms(cycleMs);
    expect(shown()).toBe(0);
  });

  it('Time Traveler: a pet of another element keeps its hop', () => {
    const { rerender } = render(<TimeQuest {...props} done={0} petId="turtle" />);
    rerender(<TimeQuest {...props} done={1} petId="turtle" />);
    ms(cycleMs / 2);
    expect(jumpImage()).toBeUndefined();
  });

  it.each(DRAWN_IDS)('Treasure Explorer: a place reached is cheered with the drawn jump of %s', (id) => {
    const { rerender } = render(<MapQuest {...props} done={0} petId={id} />);
    fireEvent(screen.UNSAFE_root.findAll((n: any) => !!n.props.onLayout)[0], 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
    let done = 0;
    let jumped = false;
    while (!jumped && done < 6) {
      done++;
      rerender(<MapQuest {...props} done={done} petId={id} />);
      for (let t = 0; t < 1500 && !jumped; t += 40) { ms(40); jumped = shown() === 1; }
      ms(2500);
    }
    expect(jumped).toBe(true);
  });
});
