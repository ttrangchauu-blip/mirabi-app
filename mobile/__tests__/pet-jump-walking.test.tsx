import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { markSheetsLoaded } from '../src/components/PetArt';
import { MapQuest } from '../src/games/quests/MapQuest';
import { petSprite } from '../src/petSprites';

// Native-driven animations end at once under jest: on the JS clock the walk takes as long as it does on a phone.
jest.mock('../src/games/quests/worlds', () => ({ ...jest.requireActual('../src/games/quests/worlds'), NATIVE: false }));

const ms = (n: number) => act(() => { jest.advanceTimersByTime(n); });
const styleOf = (node: any) => StyleSheet.flatten(node.props.style) ?? {};
const now = (v: any) => (v?.__getValue ? v.__getValue() : v);
function visibility(node: any) {
  let shown = 1;
  for (let n = node; n; n = n.parent) shown *= now(styleOf(n).opacity) ?? 1;
  return shown;
}
const images = (name: RegExp) => screen.UNSAFE_root.findAllByType(Image).filter((image: any) => name.test(JSON.stringify(image.props.source)));
const jumping = () => { const [image] = images(/_Jump/); return image ? visibility(image) === 1 : false; };

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it.each(['cat', 'fox'])('Treasure Explorer: %s, in the air as it sets off again, walks with no jump frames sliding along the ground', (id) => {
  markSheetsLoaded([petSprite(id, 3, 'jump')!]);
  const props = { total: 6, wrongKey: 0, petLevel: 3, reduceMotion: false, running: true };
  const { rerender } = render(<MapQuest {...props} done={0} petId={id} />);
  fireEvent(screen.UNSAFE_root.findAll((n: any) => !!n.props.onLayout)[0], 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 300 } } });
  let done = 0;
  while (!jumping() && done < 6) {
    done++;
    rerender(<MapQuest {...props} done={done} petId={id} />);
    for (let t = 0; t < 1500 && !jumping(); t += 40) ms(40);
    if (!jumping()) ms(2500);
  }
  expect(jumping()).toBe(true);
  rerender(<MapQuest {...props} done={done + 1} petId={id} />);
  let walked = 0;
  for (let t = 0; t < 800; t += 40) {
    ms(40);
    if (!images(/_Walk/).length) continue;
    walked++;
    expect(jumping()).toBe(false);
  }
  expect(walked).toBeGreaterThan(5);
});
