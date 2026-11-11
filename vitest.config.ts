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
  },
});
