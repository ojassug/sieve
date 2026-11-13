import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

import { testFilesFromEnv } from './scripts/lib/test-files.ts';

// A CI shard of the sieve workflow sets SIEVE_TEST_FILES to its exact file list (scripts/lib/test-files.ts).
const listed = testFilesFromEnv(process.env, fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  test: {
    include: listed ?? [
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'scripts/test/**/*.test.ts',
    ],
    // Fixture repositories contain files named *.test.ts that are data, not tests. A shard's list
    // is exact, so nothing may exclude a file from it.
    exclude: listed === null ? [...configDefaults.exclude, '**/fixtures/**'] : [],
    setupFiles: ['./vitest.setup.ts'],
    // Many tests drive real git processes. The slowest, publish's "retries until the attempts run
    // out", starts about 40 of them: 3.5 s on a Windows laptop, and past the 5 s default on the
    // hosted Windows runner, which runs that file about 1.5 times slower. 20 s leaves room for both.
    testTimeout: 20_000,
  },
});
