import { combineLocal, displayDateTime, localDate, localTime } from '../src/screens/main/taskDateTime';

describe('task date-time local wall clock', () => {
  it('formats and round-trips the selected local date and time without UTC conversion', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Bangkok';
    try {
      const selected = combineLocal('2026-10-25', '19:30');
      expect(localDate(selected)).toBe('2026-10-25');
      expect(localTime(selected)).toBe('19:30');
      expect(displayDateTime(localDate(selected), localTime(selected))).toBe('19:30 25/10/2026');
      expect(selected.toISOString()).not.toContain('2026-10-25T19:30');
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it('keeps all-day tasks date-only in the display', () => {
    expect(displayDateTime('2026-10-25', '')).toBe('25/10/2026');
  });
});
