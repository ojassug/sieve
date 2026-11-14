// Minimal GitHub REST client for the collector: pagination, retries, rate limits, request budgets.

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(status: number, url: string, body: string) {
    super(`GET ${url} returned ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** The run's request or time budget is spent; the caller saves what it has and stops. */
export class BudgetExhausted extends Error {}

/** One repository's share of the run is spent; other repositories may carry on. */
export class ShareExhausted extends Error {}

export interface ClientOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly userAgent?: string;
  /** Retries after the first attempt for 5xx and network errors (default 4). */
  readonly maxRetries?: number;
  /** API requests this client may send (default unlimited). */
  readonly maxRequests?: number;
  /** Epoch ms after which the client refuses to wait for a rate-limit reset. */
  readonly deadline?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

type Query = Record<string, string | number>;

interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
}

export class GitHubClient {
  /** API requests sent so far, retries included. */
  requests = 0;
  private remaining: number | null = null;
  private resetAtMs = 0;
  private shareLimit: number | null = null;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly maxRetries: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly options: ClientOptions;

  constructor(options: ClientOptions) {
    this.options = options;
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.maxRetries = options.maxRetries ?? 4;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${options.token}`,
      'user-agent': options.userAgent ?? 'trommel-corpus-collector',
      'x-github-api-version': '2022-11-28',
    };
  }

  /** Refuse requests once `requests` reaches `limit` (throwing ShareExhausted) until cleared with null. */
  setShareLimit(limit: number | null): void {
    this.shareLimit = limit;
  }

  async getJson(path: string, query?: Query): Promise<unknown> {
    const response = await this.api(this.url(path, query), 'follow');
    return JSON.parse(new TextDecoder().decode(response.bytes));
  }

  /** Yields each page's items, following `Link: rel="next"`. `key` names the array in object responses. */
  async *pages<T>(path: string, query: Query, key?: string): AsyncGenerator<T[]> {
    let next: string | null = this.url(path, query);
    while (next !== null) {
      const response = await this.api(next, 'follow');
      const body = JSON.parse(new TextDecoder().decode(response.bytes)) as Record<string, unknown> | unknown[];
      const items = key === undefined ? body : (body as Record<string, unknown>)[key];
      if (!Array.isArray(items)) {
        throw new Error(`expected an array${key === undefined ? '' : ` at "${key}"`} from ${next}`);
      }
      yield items as T[];
      next = nextLink(response.headers.get('link'));
    }
  }

  /** The artifact archive. The API answers with a redirect to blob storage, which must not see the token. */
  async getArtifactZip(repo: string, artifactId: number): Promise<Uint8Array> {
    const url = this.url(`/repos/${repo}/actions/artifacts/${artifactId}/zip`);
    const redirect = await this.api(url, 'manual');
    const location = redirect.headers.get('location');
    if (redirect.status !== 302 || location === null) {
      throw new HttpError(redirect.status, url, 'expected a redirect to the archive');
    }
    for (let attempt = 0; ; attempt++) {
      const blob = await fetch(location).catch((error: unknown) => error);
      if (blob instanceof Response && blob.ok) {
        return new Uint8Array(await blob.arrayBuffer());
      }
      if (attempt >= this.maxRetries) {
        throw blob instanceof Response ? new HttpError(blob.status, 'artifact blob', await blob.text()) : blob;
      }
      await this.sleep(1000 * 2 ** attempt);
    }
  }

  private url(path: string, query?: Query): string {
    const url = new URL(path.startsWith('http') ? path : this.baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  private async api(url: string, redirect: 'follow' | 'manual'): Promise<RawResponse> {
    for (let attempt = 0; ; attempt++) {
      await this.waitForBudget();
      this.requests++;
      const response = await fetch(url, { headers: this.headers, redirect }).catch((error: unknown) => error);
      if (!(response instanceof Response)) {
        if (attempt >= this.maxRetries) {
          throw response;
        }
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      this.trackRateLimit(response.headers);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const { status } = response;
      if (status < 400) {
        return { status, headers: response.headers, bytes };
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? Number.NaN);
      if ((status === 403 || status === 429) && attempt < this.maxRetries) {
        if (Number.isFinite(retryAfter)) {
          await this.waitFor(retryAfter * 1000, 'secondary rate limit');
          continue;
        }
        if (this.remaining === 0) {
          continue; // waitForBudget sleeps until the reset
        }
      }
      if (status >= 500 && attempt < this.maxRetries) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new HttpError(status, url, new TextDecoder().decode(bytes));
    }
  }

  private trackRateLimit(headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    if (remaining !== null && reset !== null) {
      this.remaining = Number(remaining);
      this.resetAtMs = Number(reset) * 1000;
    }
  }

  private async waitForBudget(): Promise<void> {
    const { maxRequests, deadline } = this.options;
    if (maxRequests !== undefined && this.requests >= maxRequests) {
      throw new BudgetExhausted(`request budget of ${maxRequests} spent`);
    }
    if (deadline !== undefined && this.now() >= deadline) {
      throw new BudgetExhausted('time budget spent');
    }
    if (this.shareLimit !== null && this.requests >= this.shareLimit) {
      throw new ShareExhausted('repository share spent');
    }
    if (this.remaining === 0 && this.now() < this.resetAtMs) {
      await this.waitFor(this.resetAtMs - this.now() + 1000, 'rate limit reset');
      this.remaining = null;
    }
  }

  private async waitFor(ms: number, reason: string): Promise<void> {
    const { deadline } = this.options;
    if (deadline !== undefined && this.now() + ms > deadline) {
      throw new BudgetExhausted(`${reason} in ${Math.ceil(ms / 1000)} s falls after the deadline`);
    }
    await this.sleep(ms);
  }
}

function nextLink(link: string | null): string | null {
  for (const part of (link ?? '').split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part);
    if (match) {
      return match[1]!;
    }
  }
  return null;
}
