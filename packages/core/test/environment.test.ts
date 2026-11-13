import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { envHash, environment } from '../src/environment.ts';

const proc = { versions: { node: '26.4.1' }, platform: 'linux', arch: 'x64', env: { TZ: 'UTC', EMPTY: '' } } as unknown as Parameters<typeof environment>[1];

describe('environment', () => {
  it('names the runtime by major and minor version, and the platform by OS and architecture', () => {
    expect(environment([], proc)).toEqual({ runtime: 'node 26.4', platform: 'linux-x64' });
  });

  it('adds each tracked variable, null when it is not set', () => {
    expect(environment(['TZ', 'EMPTY', 'UNSET'], proc)).toEqual({ runtime: 'node 26.4', platform: 'linux-x64', 'env/TZ': 'UTC', 'env/EMPTY': '', 'env/UNSET': null });
  });

  it('reads no variable that is not tracked', () => {
    expect(Object.keys(environment([], proc))).toEqual(['runtime', 'platform']);
  });

  it('describes this process by default', () => {
    expect(environment([])['platform']).toBe(`${process.platform}-${process.arch}`);
  });
});

describe('envHash', () => {
  it('is the SHA-256 of the value, so a record never holds the value itself', () => {
    expect(envHash('UTC')).toBe(createHash('sha256').update('UTC').digest('hex'));
  });

  it('tells an empty value from an unset one', () => {
    expect(envHash('')).toMatch(/^[0-9a-f]{64}$/);
    expect(envHash(null)).toBeNull();
  });
});
