import { runAll, type Selection } from '@sieve-ci/core';
import { describe, expect, it } from 'vitest';

import { buildReport, githubOutputs, splitShards, summaryOf, UNPROVEN } from '../src/report.ts';

const selection: Selection = {
  tests: ['t/a.test.ts', 't/b.test.ts', 't/c.test.ts', 't/d.test.ts', 't/new.test.ts'],
  changed: ['f:src/b.ts'],
  uncertain: ['u:src/x.ts'],
  escalations: [{ level: 'L1', scope: 'pkgs/p', cause: 'pkgs/p/data.json was modified and is not in the graph' }],
  affected: [{ test: 't/a.test.ts', path: ['f:t/a.test.ts', 'f:src/a.ts', 'f:src/b.ts'] }, { test: 't/b.test.ts', path: ['f:t/b.test.ts', 'f:src/x.ts', 'u:src/x.ts'] }],
  forced: [{ test: 't/new.test.ts', reason: 'new test file' }],
  wouldSkip: ['t/c.test.ts', 't/d.test.ts'],
};
const report = buildReport({
  selection,
  base: { map: '.sieve/map/map.json', rootTree: 'a'.repeat(40) },
  head: { rev: 'HEAD', rootTree: 'b'.repeat(40) },
  uncertainCauses: { 'u:src/x.ts': ['line 3: ./gone is unresolved (not found)'] },
  notPlanned: ['e2e'],
  shards: 2,
});

describe('buildReport', () => {
  it('runs every test in shadow mode and labels every would-skip as unproven', () => {
    expect(report.mode).toBe('shadow');
    expect(report.run).toEqual(selection.tests);
    expect(report.wouldSkip).toEqual([
      { test: 't/c.test.ts', label: UNPROVEN },
      { test: 't/d.test.ts', label: UNPROVEN },
    ]);
    expect(report.wouldRun).toBe(3);
    expect(UNPROVEN).toBe('unproven static reachability');
  });

  it('splits the run set into shards round-robin, deterministically', () => {
    expect(report.shards).toEqual([
      ['t/a.test.ts', 't/c.test.ts', 't/new.test.ts'],
      ['t/b.test.ts', 't/d.test.ts'],
    ]);
    expect(splitShards(['a', 'b'], 8)).toEqual([['a'], ['b']]);
    expect(splitShards([], 4)).toEqual([]);
  });
});

describe('githubOutputs', () => {
  it('writes the matrix as one line of JSON, and the count of test files to run', () => {
    expect(githubOutputs(report)).toBe(
      'matrix={"include":[{"files":["t/a.test.ts","t/c.test.ts","t/new.test.ts"],"shard":1},{"files":["t/b.test.ts","t/d.test.ts"],"shard":2}]}\ncount=5\n',
    );
  });

  it('writes an empty matrix and a zero count when there is nothing to run', () => {
    const empty = buildReport({ selection: runAll([], 'x'), base: null, head: { rev: 'HEAD', rootTree: 'b'.repeat(40) }, notPlanned: [], shards: 1, fallback: 'no map' });
    expect(githubOutputs(empty)).toBe('matrix={"include":[]}\ncount=0\n');
  });
});

describe('summaryOf', () => {
  const summary = summaryOf(report);

  it('says shadow mode ran everything and that the skips are unproven', () => {
    expect(summary).toContain('Ran all 5 test files (shadow mode).');
    expect(summary).toContain('would have run 3 and skipped 2');
    expect(summary).toContain(UNPROVEN);
  });

  it('shows why-paths from the test to the change', () => {
    expect(summary).toContain('`t/a.test.ts` → `src/a.ts` → `src/b.ts` (changed)');
    expect(summary).toContain('`t/b.test.ts` → `src/x.ts` → uncertain: line 3: ./gone is unresolved (not found)');
  });

  it('lists escalations with their causes, and projects SIEVE does not plan', () => {
    expect(summary).toContain('L1 (`pkgs/p`): pkgs/p/data.json was modified and is not in the graph');
    expect(summary).toContain('`t/new.test.ts`: new test file');
    expect(summary).toContain('Not planned by SIEVE: e2e');
  });

  it('says so when it fell back to running everything', () => {
    const fallback = buildReport({ selection: runAll(['t/a.test.ts'], 'no map at .sieve/map/map.json'), base: null, head: { rev: 'HEAD', rootTree: 'b'.repeat(40) }, notPlanned: [], shards: 1, fallback: 'no map at .sieve/map/map.json' });
    expect(summaryOf(fallback)).toContain('SIEVE could not use a map (no map at .sieve/map/map.json), so it ran all 1 test files.');
  });
});
