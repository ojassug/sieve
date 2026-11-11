// A real HTTP server on 127.0.0.1 standing in for api.github.com in tests.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  /** Objects are sent as JSON; Uint8Array as raw bytes. */
  readonly body?: unknown;
}

export type Handler = (url: URL, headers: IncomingHttpHeaders) => FakeResponse;

export interface FakeGitHub {
  readonly baseUrl: string;
  readonly requests: { path: string; headers: IncomingHttpHeaders }[];
  route(pathname: string, handler: Handler): void;
  close(): Promise<void>;
}

export async function startFakeGitHub(): Promise<FakeGitHub> {
  const routes = new Map<string, Handler>();
  const requests: FakeGitHub['requests'] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake.invalid');
    requests.push({ path: url.pathname + url.search, headers: req.headers });
    const handler = routes.get(url.pathname);
    const reply: FakeResponse = handler ? handler(url, req.headers) : { status: 404, body: { message: 'Not Found' } };
    const isBytes = reply.body instanceof Uint8Array;
    const payload = isBytes ? reply.body : Buffer.from(JSON.stringify(reply.body ?? {}));
    res.writeHead(reply.status ?? 200, {
      'content-type': isBytes ? 'application/zip' : 'application/json',
      ...reply.headers,
    });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    route: (pathname, handler) => routes.set(pathname, handler),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}

/** A clock whose sleep advances time instantly and records each wait. */
export function fakeClock(start = Date.parse('2026-11-11T03:17:00Z')): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let time = start;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: (ms) => {
      sleeps.push(ms);
      time += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}
