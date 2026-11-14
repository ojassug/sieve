import { runAll, type Selection } from '@trommel/core';
import { describe, expect, it } from 'vitest';

import { buildReport, githubOutputs, splitShards, summaryOf, UNPROVEN } from '../src/report.ts';

const L1 = 'L1: pkgs/p/data.json was modified and is not in the graph';
const selection: Selection = {
  tests: ['pkgs/p/t/p.test.ts', 't/a.test.ts', 't/b.test.ts', 't/c.test.ts', 't/d.test.ts', 't/e.test.ts', 't/new.test.ts'],
  changed: ['f:src/b.ts'],
  uncertain: ['u:src/x.ts'],
  escalations: [{ level: 'L1', scope: 'pkgs/p', cause: 'pkgs/p/data.json was modified and is not in the graph' }],
  affected: [{ test: 't/a.test.ts', path: ['f:t/a.test.ts', 'f:src/a.ts', 'f:src/b.ts'] }, { test: 't/b.test.ts', path: ['f:t/b.test.ts', 'f:src/x.ts', 'u:src/x.ts'] }],
  forced: [
    { test: 'pkgs/p/t/p.test.ts', reason: L1, path: ['f:pkgs/p/t/p.test.ts'] },
    { test: 't/e.test.ts', reason: L1, path: ['f:t/e.test.ts', 'f:src/e.ts', 'f:pkgs/p/index.ts'] },
    { test: 't/new.test.ts', reason: 'new test file' },
  ],
  wouldSkip: ['t/c.test.ts', 't/d.test.ts'],
  ignored: ['README.md', 'bench/graph.ts'],
};
const report = buildReport({
  selection,
  base: { map: '.trommel/map/map.json', rootTree: 'a'.repeat(40) },
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
    expect(report.wouldRun).toBe(5);
    expect(UNPROVEN).toBe('unproven static reachability');
  });

  it('carries what inputs.ignore exempted', () => {
    expect(report.ignored).toEqual(['README.md', 'bench/graph.ts']);
  });

  it('splits the run set into shards round-robin, deterministically', () => {
    expect(report.shards).toEqual([
      ['pkgs/p/t/p.test.ts', 't/b.test.ts', 't/d.test.ts', 't/new.test.ts'],
      ['t/a.test.ts', 't/c.test.ts', 't/e.test.ts'],
    ]);
    expect(splitShards(['a', 'b'], 8)).toEqual([['a'], ['b']]);
    expect(splitShards([], 4)).toEqual([]);
  });
});

describe('githubOutputs', () => {
  it('writes the matrix as one line of JSON, and the count of test files to run', () => {
    expect(githubOutputs(report)).toBe(
      'matrix={"include":[{"files":["pkgs/p/t/p.test.ts","t/b.test.ts","t/d.test.ts","t/new.test.ts"],"shard":1},{"files":["t/a.test.ts","t/c.test.ts","t/e.test.ts"],"shard":2}]}\ncount=7\n',
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
    expect(summary).toContain('Ran all 7 test files (shadow mode).');
    expect(summary).toContain('would have run 5 and skipped 2');
    expect(summary).toContain(UNPROVEN);
  });

  it('shows how an L1 escalation reached a test in another package', () => {
    expect(summary).toContain(`- \`t/e.test.ts\`: ${L1}, through \`src/e.ts\` → \`pkgs/p/index.ts\``);
    expect(summary).toContain(`- \`pkgs/p/t/p.test.ts\`: ${L1}\n`);
  });

  it('lists the unmapped inputs that inputs.ignore exempted', () => {
    expect(summary).toContain('<details><summary>Ignored by inputs.ignore (2)</summary>');
    expect(summary).toContain('- `README.md`\n- `bench/graph.ts`');
  });

  it('shows why-paths from the test to the change', () => {
    expect(summary).toContain('`t/a.test.ts` → `src/a.ts` → `src/b.ts` (changed)');
    expect(summary).toContain('`t/b.test.ts` → `src/x.ts` → uncertain: line 3: ./gone is unresolved (not found)');
  });

  it('lists escalations with their causes, and projects Trommel does not plan', () => {
    expect(summary).toContain('L1 (`pkgs/p`): pkgs/p/data.json was modified and is not in the graph');
    expect(summary).toContain('`t/new.test.ts`: new test file');
    expect(summary).toContain('Not planned by Trommel: e2e');
  });

  it('says so when it fell back to running everything', () => {
    const fallback = buildReport({ selection: runAll(['t/a.test.ts'], 'no map at .trommel/map/map.json'), base: null, head: { rev: 'HEAD', rootTree: 'b'.repeat(40) }, notPlanned: [], shards: 1, fallback: 'no map at .trommel/map/map.json' });
    expect(summaryOf(fallback)).toContain('Trommel could not use a map (no map at .trommel/map/map.json), so it ran all 1 test files.');
  });
});
