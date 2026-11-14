import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GitHubClient } from '../src/github.ts';
import type { CollectorState } from '../src/plan.ts';
import { runCollection, type CorpusConfig } from '../src/run.ts';
import { fakeClock, startFakeGitHub, type FakeGitHub } from './fake-github.ts';

describe('runCollection', () => {
  let gh: FakeGitHub;
  let out: string;

  beforeEach(async () => {
    gh = await startFakeGitHub();
    out = mkdtempSync(join(tmpdir(), 'trommel-run-'));
    const runsOfB = [
      { id: 7, run_attempt: 1, status: 'completed', created_at: '2026-11-08T05:00:00Z', check_suite_id: 70 },
      { id: 9, run_attempt: 1, status: 'completed', created_at: '2026-11-10T05:00:00Z', check_suite_id: 90 },
    ];
    gh.route('/repos/o/b/actions/workflows/ci.yml/runs', (url) => {
      const [from, to] = url.searchParams.get('created')!.split('..') as [string, string];
      const inRange = runsOfB.filter((run) => run.created_at >= from && run.created_at <= to);
      return { body: { total_count: inRange.length, workflow_runs: inRange } };
    });
    gh.route('/repos/o/a/actions/workflows/ci.yml/runs', () => ({ status: 500, body: { message: 'boom' } }));
    gh.route('/repos/o/c/actions/workflows/ci.yml/runs', () => ({ body: { total_count: 0, workflow_runs: [] } }));
    for (const run of runsOfB) {
      gh.route(`/repos/o/b/actions/runs/${run.id}/attempts/1/jobs`, () => ({ body: { total_count: 1, jobs: [{ id: run.id * 100 }] } }));
      gh.route(`/repos/o/b/check-suites/${run.check_suite_id}/check-runs`, () => ({ body: { total_count: 0, check_runs: [] } }));
      gh.route(`/repos/o/b/actions/runs/${run.id}/artifacts`, () => ({ body: { total_count: 0, artifacts: [] } }));
    }
  });

  afterEach(async () => {
    await gh.close();
    rmSync(out, { recursive: true, force: true });
  });

  const config: CorpusConfig = {
    version: 1,
    repos: [
      { repo: 'o/a', workflows: ['ci.yml'], mirror: false, tier: 2, why: 'always fails' },
      { repo: 'o/b', workflows: ['ci.yml'], mirror: false, tier: 1, why: 'healthy' },
    ],
  };

  function run(state: CollectorState, maxRequests?: number, repoShare = 1000, repos: CorpusConfig = config) {
    const clock = fakeClock();
    const client = new GitHubClient({
      token: 't',
      baseUrl: gh.baseUrl,
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 0,
      ...(maxRequests === undefined ? {} : { maxRequests }),
    });
    return runCollection({
      config: repos,
      state,
      client,
      outDir: out,
      today: '2026-11-11',
      recentDays: 1,
      horizonDays: 3,
      maxMirrorBytes: 1000,
      repoShare,
      collector: { ref: 'abc123', configSha256: 'cfg' },
    });
  }

  it('collects tier 1 first, isolates a failing repo, marks backfill days complete and hashes every file', async () => {
    const state: CollectorState = { startedOn: '2026-11-11', repos: {} };
    const manifest = await run(state);

    expect(manifest.items.map((item) => `${item.kind} ${item.day} ${item.repo} ${item.status}`)).toEqual([
      'backfill 2026-11-08 o/b complete',
      'backfill 2026-11-08 o/a error',
      'backfill 2026-11-09 o/b complete',
      'backfill 2026-11-09 o/a error',
      'recent 2026-11-10 o/b complete',
      'recent 2026-11-10 o/a error',
    ]);
    // o/b: a listing per day, plus jobs, check runs and artifacts for each of its two runs.
    expect(manifest.requestsByRepo).toEqual({ 'o/a': 3, 'o/b': 9 });
    expect(manifest.stoppedEarly).toBeNull();
    expect(manifest.pending).toBe(0);
    expect(manifest.coverage).toEqual({ 'o/a': { complete: 0, days: 2 }, 'o/b': { complete: 2, days: 2 } });
    expect(state.repos['o/b']!.days).toEqual({ '2026-11-08': 'complete', '2026-11-09': 'complete' });
    // Runs of completed days are pruned; the recent day's run stays so its later attempts are noticed.
    expect(Object.keys(state.repos['o/b']!.runs)).toEqual(['9']);

    const runsFile = join(out, 'raw', 'o__b', 'runs.ndjson');
    const bytes = readFileSync(runsFile);
    expect(manifest.files).toContainEqual({
      path: 'raw/o__b/runs.ndjson',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  it('caps a repository at its share, lets the others finish, then spends what is left on it', async () => {
    const twoHealthy: CorpusConfig = {
      version: 1,
      repos: [
        { repo: 'o/b', workflows: ['ci.yml'], mirror: false, tier: 1, why: 'busy' },
        { repo: 'o/c', workflows: ['ci.yml'], mirror: false, tier: 1, why: 'quiet' },
      ],
    };
    const state: CollectorState = { startedOn: '2026-11-11', repos: {} };
    const manifest = await run(state, undefined, 3, twoHealthy);

    // o/b's first day needs 4 requests: its share of 3 runs out, and o/c goes next.
    expect(gh.requests[3]!.path.startsWith("/repos/o/c/")).toBe(true);
    expect(manifest.items.map((item) => `${item.day} ${item.repo} ${item.status}`)).toEqual([
      '2026-11-08 o/b complete',
      '2026-11-08 o/c complete',
      '2026-11-09 o/b complete',
      '2026-11-09 o/c complete',
      '2026-11-10 o/b complete',
      '2026-11-10 o/c complete',
    ]);
    expect(manifest.requestsByRepo).toEqual({ 'o/b': 12, 'o/c': 3 });
    expect(manifest.options.repoShare).toBe(3);
    expect(manifest.pending).toBe(0);
  });

  it('stops cleanly when the request budget runs out and reports what is left', async () => {
    const state: CollectorState = { startedOn: '2026-11-11', repos: {} };
    const manifest = await run(state, 3);

    expect(manifest.stoppedEarly).toMatch(/request budget/);
    expect(manifest.pending).toBeGreaterThan(0);
    expect(manifest.items.at(-1)!.status).toBe('stopped');
  });
});
