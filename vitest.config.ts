import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'scripts/test/**/*.test.ts',
    ],
    // Fixture repositories contain files named *.test.ts that are data, not tests.
    exclude: [...configDefaults.exclude, '**/fixtures/**'],
    setupFiles: ['./vitest.setup.ts'],
    // Many tests drive real git processes. The slowest, publish's "retries until the attempts run
    // out", starts about 40 of them: 3.5 s on a Windows laptop, and past the 5 s default on the
    // hosted Windows runner, which runs that file about 1.5 times slower. 20 s leaves room for both.
    testTimeout: 20_000,
  },
});
