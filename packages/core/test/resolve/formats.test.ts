import { describe, expect, it } from 'vitest';

import { globToRegExp } from '../../src/resolve/glob.ts';
import { parseJsonc } from '../../src/resolve/jsonc.ts';
import { parsePnpmWorkspace } from '../../src/resolve/yaml.ts';

describe('parseJsonc', () => {
  it('accepts comments and trailing commas as tsconfig does', () => {
    const text = `{
      // line comment
      "compilerOptions": { /* block */ "baseUrl": ".", "paths": { "@/*": ["src/*",], }, },
    }`;
    expect(parseJsonc(text)).toEqual({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } });
  });

  it('leaves comment-like text inside strings alone', () => {
    expect(parseJsonc('{"a": "http://x/*y*/", "b": "say \\"//\\"", }')).toEqual({ a: 'http://x/*y*/', b: 'say "//"' });
  });

  it('accepts a byte-order mark', () => {
    expect(parseJsonc('\uFEFF{"a": 1}')).toEqual({ a: 1 });
  });

  it.each(['{"a": }', '{"a": 1 /* unterminated', '{"a": "unterminated}'])('rejects %s', (text) => {
    expect(() => parseJsonc(text)).toThrow();
  });
});

describe('parsePnpmWorkspace', () => {
  it('reads the packages list in block style with quotes, comments and other keys', () => {
    const text = [
      '# workspace',
      'packages:',
      "  - 'apps/*'",
      '  - "libs/**" # trailing comment',
      '  - tools/cli',
      "  - '!**/test-fixtures/**'",
      'catalog:',
      '  react: ^19.0.0',
      '',
    ].join('\n');
    expect(parsePnpmWorkspace(text)).toEqual(['apps/*', 'libs/**', 'tools/cli', '!**/test-fixtures/**']);
  });

  it('reads the flow style', () => {
    expect(parsePnpmWorkspace("packages: ['a/*', \"b\"]\n")).toEqual(['a/*', 'b']);
  });

  it('returns an empty list when there is no packages key', () => {
    expect(parsePnpmWorkspace('catalog:\n  x: 1\n')).toEqual([]);
  });

  it('rejects structures it does not understand instead of guessing', () => {
    expect(() => parsePnpmWorkspace('packages:\n  foo: bar\n')).toThrow(/pnpm-workspace/);
    expect(() => parsePnpmWorkspace('packages: &anchor\n  - a\n')).toThrow(/pnpm-workspace/);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['packages/*', 'packages/core', true],
    ['packages/*', 'packages/core/deep', false],
    ['libs/**', 'libs', true],
    ['libs/**', 'libs/a/b/c', true],
    ['**/test/**', 'src/test/x.ts', true],
    ['**/test/**', 'test/x.ts', true],
    ['src/*.{ts,tsx}', 'src/a.tsx', true],
    ['src/*.{ts,tsx}', 'src/a.js', false],
    ['src/?.ts', 'src/a.ts', true],
    ['src/?.ts', 'src/ab.ts', false],
    ['src/[ab].ts', 'src/b.ts', true],
    ['a.b/*', 'a.b/c', true],
    ['a.b/*', 'aXb/c', false],
    ['*.ts', '.hidden.ts', true],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});
