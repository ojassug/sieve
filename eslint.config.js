import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/fixtures/**', 'eslint.config.js'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Hot loops over typed arrays index with `!` under noUncheckedIndexedAccess.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `const { omitted: _x, ...rest } = value` is the idiom for dropping a key.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // A map and a static plan are functions of the tree, the config and the engine only (ADR-0003,
    // DECISIONS 28): what builds or reads them must not look at the machine it runs on.
    files: ['packages/core/src/{graph,lex,lockfile,resolve,select}/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'process', message: 'The map must not depend on the machine that builds it (DECISIONS 28).' }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:os', message: 'The map must not depend on the machine that builds it (DECISIONS 28).' },
            { name: 'node:process', message: 'The map must not depend on the machine that builds it (DECISIONS 28).' },
          ],
          patterns: [{ regex: 'environment\\.ts$', message: 'Environment components belong to records, not to the map (ADR-0005, DECISIONS 28).' }],
        },
      ],
    },
  },
]);
