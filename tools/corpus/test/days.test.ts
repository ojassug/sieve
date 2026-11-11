import { describe, expect, it } from 'vitest';

import { addDays, dayBounds, daysInRange, splitRange } from '../src/days.ts';

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects anything that is not a YYYY-MM-DD day', () => {
    expect(() => addDays('2026-11-1', 1)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 0)).toThrow(RangeError);
  });
});

describe('daysInRange', () => {
  it('lists every day from start to end inclusive, ascending', () => {
    expect(daysInRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('is empty when the range is reversed', () => {
    expect(daysInRange('2026-03-02', '2026-03-01')).toEqual([]);
  });
});

describe('dayBounds', () => {
  it('covers the whole UTC day to the second', () => {
    expect(dayBounds('2026-11-10')).toEqual(['2026-11-10T00:00:00Z', '2026-11-10T23:59:59Z']);
  });
});

describe('splitRange', () => {
  it('splits into two adjacent halves that cover the range exactly', () => {
    expect(splitRange('2026-11-10T00:00:00Z', '2026-11-10T23:59:59Z')).toEqual([
      ['2026-11-10T00:00:00Z', '2026-11-10T11:59:59Z'],
      ['2026-11-10T12:00:00Z', '2026-11-10T23:59:59Z'],
    ]);
  });

  it('splits a two-second range into single seconds', () => {
    expect(splitRange('2026-11-10T00:00:00Z', '2026-11-10T00:00:01Z')).toEqual([
      ['2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'],
      ['2026-11-10T00:00:01Z', '2026-11-10T00:00:01Z'],
    ]);
  });

  it('refuses to split a single second', () => {
    expect(() => splitRange('2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z')).toThrow(RangeError);
  });
});
