import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BudgetExhausted, GitHubClient, HttpError, ShareExhausted } from '../src/github.ts';
import { fakeClock, startFakeGitHub, type FakeGitHub } from './fake-github.ts';

describe('GitHubClient', () => {
  let gh: FakeGitHub;
  let clock: ReturnType<typeof fakeClock>;
  beforeEach(async () => {
    gh = await startFakeGitHub();
    clock = fakeClock();
  });
  afterEach(async () => {
    await gh.close();
  });

  const client = (extra: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}) =>
    new GitHubClient({ token: 'test-token', baseUrl: gh.baseUrl, now: clock.now, sleep: clock.sleep, ...extra });

  it('follows Link headers and yields every page in order, authenticated', async () => {
    gh.route('/repos/o/r/actions/runs', (url) => {
      const page = Number(url.searchParams.get('page') ?? '1');
      const next = page < 3 ? `<${gh.baseUrl}/repos/o/r/actions/runs?per_page=2&page=${page + 1}>; rel="next"` : '';
      return { headers: next ? { link: next } : {}, body: { total_count: 5, workflow_runs: [{ id: page * 10 }, { id: page * 10 + 1 }].slice(0, page < 3 ? 2 : 1) } };
    });
    const ids: number[] = [];
    for await (const page of client().pages<{ id: number }>('/repos/o/r/actions/runs', { per_page: 2 }, 'workflow_runs')) {
      ids.push(...page.map((run) => run.id));
    }
    expect(ids).toEqual([10, 11, 20, 21, 30]);
    expect(gh.requests).toHaveLength(3);
    expect(gh.requests[0]!.headers.authorization).toBe('Bearer test-token');
    expect(gh.requests[0]!.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('retries server errors with exponential backoff', async () => {
    let calls = 0;
    gh.route('/x', () => (++calls < 3 ? { status: 502, body: { message: 'Bad Gateway' } } : { body: { ok: true } }));
    await expect(client().getJson('/x')).resolves.toEqual({ ok: true });
    expect(clock.sleeps).toEqual([1000, 2000]);
  });

  it('gives up after the retry limit and reports the status', async () => {
    gh.route('/x', () => ({ status: 500, body: {} }));
    await expect(client({ maxRetries: 2 }).getJson('/x')).rejects.toMatchObject({ status: 500 });
    expect(clock.sleeps).toEqual([1000, 2000]);
  });

  it('honours retry-after on a secondary rate limit', async () => {
    let calls = 0;
    gh.route('/x', () => (++calls === 1 ? { status: 403, headers: { 'retry-after': '7' }, body: { message: 'secondary rate limit' } } : { body: { ok: true } }));
    await expect(client().getJson('/x')).resolves.toEqual({ ok: true });
    expect(clock.sleeps).toEqual([7000]);
  });

  it('waits for the reset when the primary limit is used up', async () => {
    const reset = Math.floor(clock.now() / 1000) + 30;
    gh.route('/x', () => ({ headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }, body: { ok: true } }));
    const c = client();
    await c.getJson('/x');
    expect(clock.sleeps).toEqual([]);
    await c.getJson('/x');
    expect(clock.sleeps).toEqual([31_000]);
  });

  it('stops instead of waiting past the deadline', async () => {
    const reset = Math.floor(clock.now() / 1000) + 600;
    gh.route('/x', () => ({ headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }, body: {} }));
    const c = client({ deadline: clock.now() + 60_000 });
    await c.getJson('/x');
    await expect(c.getJson('/x')).rejects.toBeInstanceOf(BudgetExhausted);
    expect(clock.sleeps).toEqual([]);
  });

  it('stops sending requests once the deadline has passed', async () => {
    gh.route('/x', () => ({ body: {} }));
    const c = client({ deadline: clock.now() + 5_000 });
    await c.getJson('/x');
    await clock.sleep(6_000);
    await expect(c.getJson('/x')).rejects.toBeInstanceOf(BudgetExhausted);
    expect(gh.requests).toHaveLength(1);
  });

  it('caps requests at a share limit until it is cleared, apart from the run budget', async () => {
    gh.route('/x', () => ({ body: {} }));
    const c = client({ maxRequests: 4 });
    c.setShareLimit(2);
    await c.getJson('/x');
    await c.getJson('/x');
    const capped: unknown = await c.getJson('/x').catch((e: unknown) => e);
    expect(capped).toBeInstanceOf(ShareExhausted);
    expect(capped).not.toBeInstanceOf(BudgetExhausted);
    c.setShareLimit(null);
    await c.getJson('/x');
    await c.getJson('/x');
    await expect(c.getJson('/x')).rejects.toBeInstanceOf(BudgetExhausted);
    expect(gh.requests).toHaveLength(4);
  });

  it('stops at the request budget', async () => {
    gh.route('/x', () => ({ body: {} }));
    const c = client({ maxRequests: 2 });
    await c.getJson('/x');
    await c.getJson('/x');
    await expect(c.getJson('/x')).rejects.toBeInstanceOf(BudgetExhausted);
    expect(gh.requests).toHaveLength(2);
  });

  it('does not retry a 404', async () => {
    const error: unknown = await client().getJson('/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect(gh.requests).toHaveLength(1);
  });

  it('downloads an artifact through the redirect without sending the token to the blob host', async () => {
    gh.route('/repos/o/r/actions/artifacts/9/zip', () => ({ status: 302, headers: { location: `${gh.baseUrl}/blob/9?sig=abc` } }));
    gh.route('/blob/9', (_url, headers) =>
      headers.authorization === undefined ? { body: new Uint8Array([80, 75, 3, 4]) } : { status: 400, body: { message: 'auth forwarded' } },
    );
    expect(await client().getArtifactZip('o/r', 9)).toEqual(new Uint8Array([80, 75, 3, 4]));
  });
});
