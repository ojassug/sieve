import { describe, expect, it } from 'vitest';

import { shouldMirror } from '../src/select.ts';

describe('shouldMirror', () => {
  const rules = { include: /junit|test[-_ ]?(results?|reports?)/i, exclude: /coverage/i, maxBytes: 1000 };
  const artifact = (name: string, sizeInBytes = 10, expired = false) => ({ name, size_in_bytes: sizeInBytes, expired });

  it.each(['web-frontend-test-reports-shard-3', 'junit', 'test-results-python-3.12', 'Test Results'])('mirrors %s', (name) => {
    expect(shouldMirror(artifact(name), rules)).toBe(true);
  });

  it.each(['dist-files', 'node-coverage-lcov', 'test-results-coverage'])('skips %s', (name) => {
    expect(shouldMirror(artifact(name), rules)).toBe(false);
  });

  it('skips expired artifacts, which can no longer be downloaded', () => {
    expect(shouldMirror(artifact('junit', 10, true), rules)).toBe(false);
  });

  it('skips artifacts over the size cap', () => {
    expect(shouldMirror(artifact('junit', 1000), rules)).toBe(true);
    expect(shouldMirror(artifact('junit', 1001), rules)).toBe(false);
  });
});
