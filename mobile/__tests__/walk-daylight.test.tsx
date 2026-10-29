import React from 'react';
import { AccessibilityInfo, AppState, StyleSheet } from 'react-native';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { hoursOf, lightAt, moonAt, sunAt, useDaylight } from '../src/components/daylight';
import { WalkLandscape } from '../src/screens/main/WalkLandscape';

// Counts how often the pet is mounted: the light changing must not restart its walk.
const mockPetMounts = jest.fn();
jest.mock('../src/components/PetArt', () => {
  const actual = jest.requireActual('../src/components/PetArt');
  const R = jest.requireActual('react');
  return { ...actual, PetArt: (props: any) => { R.useEffect(() => { mockPetMounts(); }, []); return R.createElement(actual.PetArt, props); } };
});

const at = (h: number, m = 0, s = 0, day = 28) => new Date(2026, 9, day, h, m, s);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const colorStep = (a: string, b: string) => Math.max(...rgb(a).map((v, i) => Math.abs(v - rgb(b)[i])));
const skyColors = (h: number) => { const l = lightAt(h); return [...l.sky, l.horizon, ...l.hills, l.meadow, ...l.trees, ...l.path, l.front]; };

describe('the sun and moon arcs', () => {
  test('rises on the left at 05:00, is highest at 12:00 and sets on the right at 18:00', () => {
    expect(sunAt(5)).toEqual({ x: 0, altitude: 0 });
    expect(sunAt(12).x).toBeCloseTo(0.5);
    expect(sunAt(12).altitude).toBeCloseTo(1);
    expect(sunAt(18).x).toBeCloseTo(1);
    expect(sunAt(18).altitude).toBeCloseTo(0);
    expect(sunAt(8.5).altitude).toBeGreaterThan(0.6);
    expect(sunAt(8.5).altitude).toBeLessThan(sunAt(11).altitude);
    for (const h of [0, 3, 4.5, 18.5, 21, 23.99]) expect(sunAt(h).altitude).toBeLessThan(0);
  });

  test('the sun times can be configured', () => {
    const times = { sunrise: 6.5, noon: 12.5, sunset: 18.5 };
    expect(sunAt(6.5, times).altitude).toBeCloseTo(0);
    expect(sunAt(12.5, times).altitude).toBeCloseTo(1);
    expect(sunAt(18.5, times).x).toBeCloseTo(1);
  });

  test('the moon is up at night, down by day', () => {
    expect(moonAt(0).altitude).toBeGreaterThan(0.5);
    expect(moonAt(12).altitude).toBeLessThan(0);
    expect(moonAt(18.2).x).toBeLessThan(0.1); // rising on the left as the sun sets on the right
  });

  test('positions and colours change continuously: no jumps from one second to the next, across midnight too', () => {
    let worstSun = 0; let worstColor = 0;
    for (let s = 0; s <= 2 * 86_400; s += 30) {
      const [h0, h1] = [(s / 3600) % 24, ((s + 30) / 3600) % 24];
      const [a, b] = [sunAt(h0), sunAt(h1)];
      if (a.altitude > -0.45 || b.altitude > -0.45) worstSun = Math.max(worstSun, Math.abs(a.x - b.x), Math.abs(a.altitude - b.altitude));
      const [ca, cb] = [skyColors(h0), skyColors(h1)];
      worstColor = Math.max(worstColor, ...ca.map((c, i) => colorStep(c, cb[i])));
    }
    expect(worstSun).toBeLessThan(0.003);
    expect(worstColor).toBeLessThanOrEqual(2);
    expect(lightAt(23.99999)).toEqual(lightAt(0));
  });
});

describe('the sky through the day', () => {
  const [r, g, b] = [0, 1, 2];
  test('violet-blue before dawn, pink-orange at sunrise, blue at noon, golden-orange at sunset, deep blue at night', () => {
    const top = (h: number) => rgb(lightAt(h).sky[1]);
    expect(top(4.25)[b] > top(4.25)[g] && top(4.25)[r] > top(4.25)[g]).toBe(true);
    expect(top(5.25)[r] > top(5.25)[b] && top(5.25)[r] > 200).toBe(true);
    expect(top(12)[b] > top(12)[r]).toBe(true);
    expect(top(17.75)[r] > top(17.75)[g] && top(17.75)[g] > top(17.75)[b]).toBe(true);
    expect(Math.max(...top(0))).toBeLessThan(120);
  });

  test('the stars and moon come out at night and fade as it gets light', () => {
    expect(lightAt(0).stars).toBe(1);
    expect(lightAt(0).moonOpacity).toBe(1);
    expect(lightAt(4.6).stars).toBeLessThan(1);
    expect(lightAt(4.6).stars).toBeGreaterThan(0);
    expect(lightAt(12).stars).toBe(0);
    expect(lightAt(19).stars).toBeGreaterThan(0);
  });
});

describe('useDaylight', () => {
  let appStateListener: ((state: string) => void) | undefined;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener: any) => {
      appStateListener = listener;
      return { remove: jest.fn() } as any;
    });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('starts at the current time, not at dawn, and follows the real clock', () => {
    let clock = at(14, 30);
    const { result } = renderHook(() => useDaylight({ now: () => clock }));
    expect(result.current.hours).toBeCloseTo(14.5);
    clock = at(14, 30, 36);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(result.current.hours).toBeCloseTo(14.51);
  });

  test('pauses in the background, then glides to the new time on return', () => {
    let clock = at(8, 0);
    const { result } = renderHook(() => useDaylight({ now: () => clock }));
    act(() => { appStateListener?.('background'); });
    clock = at(20, 0);
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(result.current.hours).toBeCloseTo(8); // nothing ran while away

    act(() => { appStateListener?.('active'); });
    expect(result.current.period).toBe('night');
    expect(result.current.hours).toBeCloseTo(8, 1); // starting to glide, not snapped
    act(() => { jest.advanceTimersByTime(700); });
    expect(result.current.hours).toBeGreaterThan(9);
    expect(result.current.hours).toBeLessThan(19);
    act(() => { jest.advanceTimersByTime(1500); });
    expect(result.current.hours).toBeCloseTo(20);
  });

  test('glides the short way round midnight and snaps with reduce motion', () => {
    let clock = at(23, 0);
    const { result, rerender } = renderHook(({ smooth }: { smooth: boolean }) => useDaylight({ now: () => clock, smooth }), { initialProps: { smooth: true } });
    clock = at(1, 0, 0, 29);
    act(() => { jest.advanceTimersByTime(2700); });
    const h = result.current.hours;
    expect(h > 23 || h < 1).toBe(true); // via midnight, never back through the day
    act(() => { jest.advanceTimersByTime(2000); });
    expect(result.current.hours).toBeCloseTo(1);

    rerender({ smooth: false });
    clock = at(13, 0, 0, 29);
    act(() => { jest.advanceTimersByTime(2000); });
    expect(result.current.hours).toBeCloseTo(13);
  });

  test('the development preview plays a whole day quickly from the current time', () => {
    const clock = at(6, 0);
    const { result } = renderHook(() => useDaylight({ now: () => clock, previewDayMs: 24_000 }));
    act(() => { jest.advanceTimersByTime(6000); });
    expect(result.current.hours).toBeCloseTo(12, 0);
    act(() => { jest.advanceTimersByTime(18_000); });
    expect(result.current.hours > 23.5 || result.current.hours < 6.5).toBe(true);
  });

  test('hoursOf reads the local time to the second', () => {
    expect(hoursOf(at(17, 45, 36))).toBeCloseTo(17.76);
  });
});

describe('WalkLandscape daylight', () => {
  let clock: Date;
  let appStateListener: ((state: string) => void) | undefined;
  beforeEach(() => {
    jest.useFakeTimers();
    mockPetMounts.mockClear();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener: any) => {
      appStateListener = listener;
      return { remove: jest.fn() } as any;
    });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });

  async function renderScene() {
    render(<WalkLandscape pet="fox" level={2} now={() => clock} />);
    fireEvent(screen.getByLabelText(/Pet đang đi dạo/), 'layout', { nativeEvent: { layout: { width: 340 } } });
    await act(async () => {});
  }
  /** The sun's centre in the scene. */
  const sunCentre = () => {
    const [{ translateX }, { translateY }] = StyleSheet.flatten(screen.getByTestId('walk-sun').props.style).transform;
    return { x: translateX + 36, y: translateY + 36 };
  };

  test('at noon the sun is high in the middle; no moon or stars', async () => {
    clock = at(12, 0);
    await renderScene();
    expect(sunCentre().x).toBeCloseTo(170, 0);
    expect(sunCentre().y).toBeCloseTo(22, 0);
    expect(screen.queryByTestId('walk-moon')).toBeNull();
    expect(screen.queryByTestId('walk-stars')).toBeNull();
  });

  test('at dawn the sun sits on the left horizon, half behind the hills; at dusk on the right', async () => {
    clock = at(5, 0);
    await renderScene();
    expect(sunCentre().x).toBeLessThan(40);
    expect(sunCentre().y).toBeCloseTo(80, 0);
    expect(screen.getByTestId('walk-stars')).toBeTruthy(); // the last stars, fading
  });

  test('at night the sun is gone and the moon and stars are out', async () => {
    clock = at(23, 0);
    await renderScene();
    expect(screen.queryByTestId('walk-sun')).toBeNull();
    expect(screen.getByTestId('walk-moon')).toBeTruthy();
    expect(screen.getByTestId('walk-stars')).toBeTruthy();
  });

  test('the sun moves a little at a time while the pet keeps walking, and glides after a return to the app', async () => {
    clock = at(17, 59, 58);
    await renderScene();
    const before = sunCentre();
    clock = at(18, 0, 1);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getByTestId('walk-scene-night')).toBeTruthy();
    expect(Math.abs(sunCentre().x - before.x)).toBeLessThan(0.5);
    expect(Math.abs(sunCentre().y - before.y)).toBeLessThan(0.5);

    clock = at(9, 0, 0, 29); // the next morning
    await act(async () => { appStateListener?.('background'); });
    await act(async () => { appStateListener?.('active'); });
    expect(screen.getByTestId('walk-scene-morning')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(sunCentre().x).toBeCloseTo(340 * (0.07 + 0.86 * sunAt(9).x), 0);
    expect(mockPetMounts).toHaveBeenCalledTimes(1);
  });
});
