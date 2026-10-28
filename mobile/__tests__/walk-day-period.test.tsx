import React from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { msUntilNextPeriod, periodAt } from '../src/components/useDayPeriod';
import { WalkLandscape } from '../src/screens/main/WalkLandscape';

// Counts how often the pet is mounted: a period change must not restart its walk.
const mockPetMounts = jest.fn();
jest.mock('../src/components/PetArt', () => {
  const actual = jest.requireActual('../src/components/PetArt');
  const R = jest.requireActual('react');
  return { ...actual, PetArt: (props: any) => { R.useEffect(() => { mockPetMounts(); }, []); return R.createElement(actual.PetArt, props); } };
});

const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 28, h, m, s);
/** Makes local hours read as in `zone`, as after changing the device's time zone (Jest sandboxes process.env.TZ). */
const deviceZone = (zone: string) => {
  const hours = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: zone });
  jest.spyOn(Date.prototype, 'getHours').mockImplementation(function (this: Date) { return Number(hours.format(this)); });
};

describe('periodAt (local time)', () => {
  test.each([
    [0, 0, 'night'], [4, 59, 'night'], [5, 0, 'morning'], [10, 59, 'morning'], [11, 0, 'noon'], [14, 59, 'noon'],
    [15, 0, 'afternoon'], [17, 59, 'afternoon'], [18, 0, 'night'], [23, 59, 'night'],
  ])('%i:%i is %s', (h, m, period) => { expect(periodAt(at(h, m))).toBe(period); });

  test('the next change is the next start hour, or 05:00 tomorrow after 18:00', () => {
    expect(msUntilNextPeriod(at(10, 59, 30))).toBe(30_000);
    expect(msUntilNextPeriod(at(4, 59))).toBe(60_000);
    expect(msUntilNextPeriod(at(17, 0))).toBe(3_600_000);
    expect(msUntilNextPeriod(at(18, 0))).toBe(11 * 3_600_000);
    expect(msUntilNextPeriod(at(0, 0))).toBe(5 * 3_600_000);
  });

  test('follows the device time zone: the same instant is a different period after the zone changes', () => {
    const instant = new Date('2026-10-28T03:30:00Z');
    deviceZone('Asia/Ho_Chi_Minh'); // 10:30
    expect(periodAt(instant)).toBe('morning');
    deviceZone('Asia/Tokyo'); // 12:30
    expect(periodAt(instant)).toBe('noon');
    deviceZone('Europe/Paris'); // 04:30
    expect(periodAt(instant)).toBe('night');
    deviceZone('America/Los_Angeles'); // 20:30 the day before
    expect(periodAt(instant)).toBe('night');
    jest.restoreAllMocks();
  });
});

describe('WalkLandscape', () => {
  let clock: Date;
  let appStateListener: ((state: string) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    mockPetMounts.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener: any) => {
      appStateListener = listener;
      return { remove: jest.fn() } as any;
    });
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });

  function renderScene() {
    render(<WalkLandscape pet="fox" level={2} now={() => clock} />);
    fireEvent(screen.getByLabelText(/Pet đang đi dạo/), 'layout', { nativeEvent: { layout: { width: 340 } } });
  }

  test('changes period on its own at the boundary and when the app comes back, without remounting the pet', async () => {
    clock = at(10, 59, 58);
    renderScene();
    expect(screen.getByTestId('walk-scene-morning')).toBeTruthy();
    expect(screen.getByLabelText('Pet đang đi dạo buổi sáng trên con đường giữa những ngọn đồi')).toBeTruthy();
    expect(mockPetMounts).toHaveBeenCalledTimes(1);

    clock = at(11, 0, 1);
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(screen.getByTestId('walk-scene-noon')).toBeTruthy();

    // Away from the app (timers paused), back in the evening: it updates as soon as the app is active.
    clock = at(19, 30);
    await act(async () => { appStateListener?.('active'); });
    expect(screen.getByTestId('walk-scene-night')).toBeTruthy();
    expect(mockPetMounts).toHaveBeenCalledTimes(1);
  });

  test('a time zone change made while the screen is open shows within a minute, and on return to the app', async () => {
    deviceZone('Asia/Ho_Chi_Minh');
    clock = new Date('2026-10-28T08:30:00Z'); // 15:30 → chiều
    renderScene();
    expect(screen.getByTestId('walk-scene-afternoon')).toBeTruthy();
    deviceZone('Europe/London'); // 08:30 → sáng
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(screen.getByTestId('walk-scene-morning')).toBeTruthy();
    deviceZone('Asia/Tokyo'); // 17:30 → chiều, changed in Settings while the app was in the background
    await act(async () => { appStateListener?.('active'); });
    expect(screen.getByTestId('walk-scene-afternoon')).toBeTruthy();
    expect(mockPetMounts).toHaveBeenCalledTimes(1);
  });

  test('the new sky fades in over the old one, then the old layer is dropped', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    clock = at(17, 59, 59);
    renderScene();
    await act(async () => {});
    expect(screen.UNSAFE_getAllByType(LinearGradient)).toHaveLength(1);

    clock = at(18, 0, 1);
    await act(async () => { jest.advanceTimersByTime(1800); }); // the change at 18:00 (+0.5 s), 300 ms into the fade
    expect(screen.getByTestId('walk-scene-night')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(LinearGradient)).toHaveLength(2); // chiều underneath, tối fading in on top
    await act(async () => { jest.advanceTimersByTime(1500); });
    expect(screen.UNSAFE_getAllByType(LinearGradient)).toHaveLength(1);
    expect(mockPetMounts).toHaveBeenCalledTimes(1);
  });
});
