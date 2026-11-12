import { describe, expect, it } from 'vitest';

import { planWork } from '../src/plan.ts';

describe('planWork', () => {
  const options = { today: '2026-11-11', recentDays: 2, horizonDays: 5 };

  it('backfills the oldest missing days first, then re-collects the recent window', () => {
    const state = { startedOn: '2026-11-11', repos: { 'a/a': { days: { '2026-11-07': 'complete' as const }, runs: {} } } };
    expect(planWork(['a/a', 'b/b'], state, options)).toEqual([
      { repo: 'a/a', day: '2026-11-06', kind: 'backfill' },
      { repo: 'b/b', day: '2026-11-06', kind: 'backfill' },
      { repo: 'b/b', day: '2026-11-07', kind: 'backfill' },
      { repo: 'a/a', day: '2026-11-08', kind: 'backfill' },
      { repo: 'b/b', day: '2026-11-08', kind: 'backfill' },
      { repo: 'a/a', day: '2026-11-09', kind: 'recent' },
      { repo: 'b/b', day: '2026-11-09', kind: 'recent' },
      { repo: 'a/a', day: '2026-11-10', kind: 'recent' },
      { repo: 'b/b', day: '2026-11-10', kind: 'recent' },
    ]);
  });

  it('never re-collects a completed backfill day', () => {
    const complete = { '2026-11-06': 'complete' as const, '2026-11-07': 'complete' as const, '2026-11-08': 'complete' as const };
    const state = { startedOn: '2026-11-01', repos: { 'a/a': { days: complete, runs: {} } } };
    expect(planWork(['a/a'], state, options).map((item) => item.kind)).toEqual(['recent', 'recent']);
  });
});
