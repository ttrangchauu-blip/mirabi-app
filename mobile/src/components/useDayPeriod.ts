import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Parts of the day by the device's local clock: sáng 05:00–10:59, trưa 11:00–14:59, chiều 15:00–17:59, tối 18:00–04:59. */
export type DayPeriod = 'morning' | 'noon' | 'afternoon' | 'night';

/** The local hours each period starts at, in order through the day. */
const STARTS: [number, DayPeriod][] = [[5, 'morning'], [11, 'noon'], [15, 'afternoon'], [18, 'night']];

export function periodAt(date: Date): DayPeriod {
  return periodAtHour(date.getHours());
}

/** The period a local hour (0–23) belongs to. */
export function periodAtHour(hour: number): DayPeriod {
  let period: DayPeriod = 'night'; // 00:00–04:59 belongs to the evening before
  for (const [start, p] of STARTS) if (hour >= start) period = p;
  return period;
}

/** Milliseconds until the next period starts, by the local calendar (so a 23- or 25-hour DST day is handled). */
export function msUntilNextPeriod(date: Date) {
  const hour = date.getHours();
  const next = STARTS.find(([start]) => start > hour);
  const at = next
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), next[0])
    : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, STARTS[0][0]);
  return Math.max(0, at.getTime() - date.getTime());
}

/** Re-checks at least this often while the screen is open: catches a time zone or clock change made in Settings. */
const RECHECK_MS = 60_000;

/** The current part of the day; follows the clock across period boundaries, time zone changes and returns to the app. */
export function useDayPeriod(now: () => Date = () => new Date()) {
  const [period, setPeriod] = useState<DayPeriod>(() => periodAt(now()));
  useEffect(() => {
    let boundary: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const date = now();
      setPeriod(periodAt(date));
      if (boundary) clearTimeout(boundary);
      boundary = setTimeout(check, msUntilNextPeriod(date) + 500); // a little past the hour, never just before it
    };
    check();
    const recheck = setInterval(check, RECHECK_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { if (boundary) clearTimeout(boundary); clearInterval(recheck); sub.remove(); };
    // `now` is a clock for tests; a new function each render must not restart the timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return period;
}
