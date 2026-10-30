import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { PetArt } from '../src/components/PetArt';
import { hasSprite, moveActivity } from '../src/petSprites';
import type { Turn } from '../src/learning/types';
import { Playfield } from '../src/screens/learning/games/Playfield';

/** The sheet a PetArt draws (the moving strip, not the still placeholder under it). */
function sheetOf(ui: React.ReactElement) {
  const { UNSAFE_getAllByType } = render(ui);
  const sources = UNSAFE_getAllByType(Image).map((image) => JSON.stringify(image.props.source));
  return sources[sources.length - 1];
}

test('a pet with drawn move strips darts each way with its own strip, at every stage', () => {
  for (const pet of ['cat', 'fox', 'penguin', 'bunny', 'dolphin']) for (let stage = 0; stage <= 6; stage++) {
    expect(hasSprite(pet, stage, moveActivity(1))).toBe(true);
    expect(hasSprite(pet, stage, moveActivity(-1))).toBe(true);
    expect(sheetOf(<PetArt pet={pet} size={56} stage={stage} moving={1} />)).toMatch(/Move_Right/);
    expect(sheetOf(<PetArt pet={pet} size={56} stage={stage} moving={-1} />)).toMatch(/Move_Left/);
  }
});

describe('in the word shooter', () => {
  const APPLE: Turn = { turn_id: 'turn-apple', position: 0, kind: 'word_spelling', skill_label: 'Gõ từ', prompt: { word: 'apple', letters: [5] },
    hints_shown: [], hints_total: 1, attempts: 0, wrong_attempts: 0, practice: false, travel_seconds: 0 };
  const field = (petId: string, shots: boolean) => (
    <Playfield variant="words" turns={[]} progress={() => 0.3} selectedId={null} onSelect={() => {}} petId={petId} petLevel={3} reduceMotion={false}
      flash={null} running onImpact={jest.fn()} onShotDone={jest.fn()} onBurstDone={jest.fn()} wrongKey={0}
      shots={shots ? [{ id: APPLE.turn_id, turn: APPLE, aimed: false, word: { en: 'apple', vi: 'quả táo', phonetic: null } }] : []} />
  );
  const start = (petId: string) => {
    render(field(petId, false));
    fireEvent(screen.getByLabelText('Bầu trời từ vựng'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } });
  };
  /** The strip the shooting pet draws now, and whether it is mirrored (-1). */
  const drawn = () => {
    const pet = screen.getByTestId('shooter-pet');
    const images = within(pet).UNSAFE_getAllByType(Image).map((image) => JSON.stringify(image.props.source));
    const flip = (StyleSheet.flatten((pet.children[0] as any).props.style)?.transform as any[] | undefined)?.[0]?.scaleX;
    return { sheet: images[images.length - 1], flip };
  };
  /** The pet heads for a word in the left lane (it starts in the middle); what it draws a moment later. */
  function dartLeft(petId: string) {
    start(petId);
    screen.rerender(field(petId, true));
    act(() => { jest.advanceTimersByTime(60); });
    return drawn();
  }
  /** Every strip (and mirroring) drawn over two rounds of the idle drift, no shots. */
  function drift(petId: string) {
    start(petId);
    const seen: { sheet: string; flip: number }[] = [];
    for (let i = 0; i < 70; i++) { act(() => { jest.advanceTimersByTime(150); }); seen.push(drawn()); }
    return seen;
  }
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('runs the mist pet with its drawn left strip, not a mirrored walk', () => {
    const { sheet, flip } = dartLeft('cat');
    expect(sheet).toMatch(/mist\/move\/Lv3_Nang_Cao_Move_Left/);
    expect(flip).toBe(1);
  });

  it('strolls the mist pet through its idle drift facing the way it goes, both ways, and stands at the turns', () => {
    const seen = drift('cat');
    expect(seen.some((s) => /Move_Left/.test(s.sheet))).toBe(true);
    expect(seen.some((s) => /Move_Right/.test(s.sheet))).toBe(true);
    expect(seen.some((s) => /_Idle/.test(s.sheet))).toBe(true);
    expect(seen.every((s) => s.flip === 1)).toBe(true);
  });

  it('strolls from one side of the field to the other', () => {
    start('cat');
    const xs: number[] = [];
    const left = () => (StyleSheet.flatten(screen.getByTestId('shooter-pet').props.style).transform as any[])[0].translateX as number;
    for (let i = 0; i < 120; i++) { act(() => { jest.advanceTimersByTime(150); }); xs.push(left()); }
    // 390 px wide, 56 px pet, 8 px margins: it reaches both sides.
    expect(Math.min(...xs)).toBeLessThanOrEqual(9);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(390 - 56 - 9);
  });
});

test('a pet stands idle when it stops', () => {
  expect(sheetOf(<PetArt pet="cat" size={56} stage={3} />)).toMatch(/_Idle/);
});
