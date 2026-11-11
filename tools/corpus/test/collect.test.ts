import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectDay } from '../src/collect.ts';
import { GitHubClient } from '../src/github.ts';
import type { RepoState } from '../src/plan.ts';
import { DEFAULT_RULES } from '../src/select.ts';
import { FileSink } from '../src/sink.ts';
import { fakeClock, startFakeGitHub, type FakeGitHub } from './fake-github.ts';

interface FakeRun {
  id: number;
  run_attempt: number;
  status: string;
  created_at: string;
  check_suite_id: number;
}

// GitHub caps filtered run listings at 1,000 results; the fake caps at 2 to exercise the split.
const RESULT_CAP = 2;

describe('collectDay', () => {
  let gh: FakeGitHub;
  let out: string;
  let runs: FakeRun[];

  beforeEach(async () => {
    gh = await startFakeGitHub();
    out = mkdtempSync(join(tmpdir(), 'sieve-corpus-'));
    runs = [
      { id: 101, run_attempt: 1, status: 'completed', created_at: '2026-11-10T01:00:00Z', check_suite_id: 1001 },
      { id: 102, run_attempt: 2, status: 'completed', created_at: '2026-11-10T13:00:00Z', check_suite_id: 1002 },
      { id: 103, run_attempt: 1, status: 'in_progress', created_at: '2026-11-10T20:00:00Z', check_suite_id: 1003 },
      { id: 99, run_attempt: 1, status: 'completed', created_at: '2026-11-09T23:59:59Z', check_suite_id: 999 },
    ];
    gh.route('/repos/o/r/actions/workflows/ci.yml/runs', (url) => {
      const [from, to] = url.searchParams.get('created')!.split('..') as [string, string];
      const inRange = runs.filter((run) => run.created_at >= from && run.created_at <= to);
      const page = Number(url.searchParams.get('page'));
      // Like GitHub, report the true total but return no more than the cap.
      const capped = inRange.slice(0, RESULT_CAP);
      return { body: { total_count: inRange.length, workflow_runs: capped.slice((page - 1) * 100, page * 100) } };
    });
    gh.route('/repos/o/r/actions/runs/102/attempts/1', () => ({ body: { ...runs[1], run_attempt: 1, conclusion: 'failure' } }));
    for (const [run, attempt, jobIds] of [[101, 1, [1, 2]], [101, 2, [5]], [102, 1, [3]], [102, 2, [4]]] as const) {
      gh.route(`/repos/o/r/actions/runs/${run}/attempts/${attempt}/jobs`, () => ({
        body: { total_count: jobIds.length, jobs: jobIds.map((id) => ({ id, run_id: run, run_attempt: attempt })) },
      }));
    }
    for (const suite of [1001, 1002]) {
      gh.route(`/repos/o/r/check-suites/${suite}/check-runs`, () => ({ body: { total_count: 1, check_runs: [{ id: suite * 10 }] } }));
    }
    gh.route('/repos/o/r/actions/runs/101/artifacts', () => ({
      body: {
        total_count: 2,
        artifacts: [
          { id: 501, name: 'junit-shard-1', size_in_bytes: 4, expired: false },
          { id: 502, name: 'dist', size_in_bytes: 10, expired: false },
        ],
      },
    }));
    gh.route('/repos/o/r/actions/runs/102/artifacts', () => ({
      body: { total_count: 1, artifacts: [{ id: 503, name: 'test-results', size_in_bytes: 4, expired: true }] },
    }));
    gh.route('/repos/o/r/actions/artifacts/501/zip', () => ({ status: 302, headers: { location: `${gh.baseUrl}/blob/501` } }));
    gh.route('/blob/501', () => ({ body: new Uint8Array([80, 75, 5, 6]) }));
  });

  afterEach(async () => {
    await gh.close();
    rmSync(out, { recursive: true, force: true });
  });

  const config = { repo: 'o/r', workflows: ['ci.yml'], mirror: true, tier: 1 as const, why: 'test' };
  const lines = (stream: string): Record<string, unknown>[] =>
    readFileSync(join(out, 'raw', 'o__r', `${stream}.ndjson`), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  async function collect(state: RepoState) {
    const clock = fakeClock();
    const client = new GitHubClient({ token: 't', baseUrl: gh.baseUrl, now: clock.now, sleep: clock.sleep });
    return collectDay(client, config, '2026-11-10', state, new FileSink(out), { rules: DEFAULT_RULES, maxResults: RESULT_CAP });
  }

  it('records every attempt, job, check run and artifact of the completed runs, and mirrors test reports', async () => {
    const state: RepoState = { days: {}, runs: {} };
    const counts = await collect(state);

    expect(lines('runs').map((run) => [run['id'], run['run_attempt']])).toEqual([[101, 1], [102, 1], [102, 2]]);
    expect(lines('jobs').map((job) => job['id'])).toEqual([1, 2, 3, 4]);
    expect(lines('check-runs').map((check) => check['id'])).toEqual([10010, 10020]);
    expect(lines('artifacts').map((artifact) => artifact['id'])).toEqual([501, 502, 503]);
    expect(readFileSync(join(out, 'artifacts', 'o__r', '501.zip'))).toEqual(Buffer.from([80, 75, 5, 6]));
    expect(state.runs).toEqual({
      '101': { attempt: 1, day: '2026-11-10', mirrored: [501] },
      '102': { attempt: 2, day: '2026-11-10', mirrored: [] },
    });
    expect(counts).toEqual({ runs: 2, inProgress: 1, attempts: 3, jobs: 4, checkRuns: 2, artifacts: 3, mirrored: 1, mirroredBytes: 4, mirrorSkipped: 0, missingWorkflows: [] });
  });

  it('fetches only what changed on a later pass: a new attempt, and no artifact twice', async () => {
    const state: RepoState = { days: {}, runs: {} };
    await collect(state);
    rmSync(join(out, 'raw'), { recursive: true });

    runs[0] = { ...runs[0]!, run_attempt: 2 };
    const counts = await collect(state);

    expect(lines('runs').map((run) => [run['id'], run['run_attempt']])).toEqual([[101, 2]]);
    expect(lines('jobs').map((job) => job['id'])).toEqual([5]);
    expect(lines('check-runs').map((check) => check['id'])).toEqual([10010]);
    expect(lines('artifacts').map((artifact) => artifact['id'])).toEqual([501, 502]);
    expect(counts.mirrored).toBe(0);
    expect(state.runs['101']).toEqual({ attempt: 2, day: '2026-11-10', mirrored: [501] });
  });

  it('stops mirroring once the byte budget is spent but keeps the metadata', async () => {
    const clock = fakeClock();
    const client = new GitHubClient({ token: 't', baseUrl: gh.baseUrl, now: clock.now, sleep: clock.sleep });
    const tight = { remainingBytes: 3 };
    const state: RepoState = { days: {}, runs: {} };
    const counts = await collectDay(client, config, '2026-11-10', state, new FileSink(out), {
      rules: DEFAULT_RULES,
      maxResults: RESULT_CAP,
      mirrorBudget: tight,
    });
    expect(counts.mirrored).toBe(0);
    expect(counts.mirrorSkipped).toBe(1);
    expect(lines('artifacts').map((artifact) => artifact['id'])).toEqual([501, 502, 503]);
    expect(state.runs['101']!.mirrored).toEqual([]);

    const exact = { remainingBytes: 4 };
    const later = await collectDay(client, config, '2026-11-10', { days: {}, runs: {} }, new FileSink(out), {
      rules: DEFAULT_RULES,
      maxResults: RESULT_CAP,
      mirrorBudget: exact,
    });
    expect(later.mirrored).toBe(1);
    expect(exact.remainingBytes).toBe(0);
  });

  it('notes a configured workflow that does not exist instead of failing the day', async () => {
    const state: RepoState = { days: {}, runs: {} };
    const clock = fakeClock();
    const client = new GitHubClient({ token: 't', baseUrl: gh.baseUrl, now: clock.now, sleep: clock.sleep });
    const counts = await collectDay(client, { ...config, workflows: ['gone.yml'] }, '2026-11-10', state, new FileSink(out), {
      rules: DEFAULT_RULES,
    });
    expect(counts.missingWorkflows).toEqual(['gone.yml']);
    expect(counts.runs).toBe(0);
  });
});
