import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { escapeGlob, globToRegExp, matchGlobs } from '../../src/resolve/glob.ts';
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

describe('matchGlobs', () => {
  const files = ['src/a.ts', 'src/_b.ts', 'src/c.js', 'lib/d.ts'];
  it('keeps files that match an include and no exclude, in input order', () => {
    expect(matchGlobs(files, ['src/*.ts', '!src/_*', 'lib/**'])).toEqual(['src/a.ts', 'lib/d.ts']);
  });
  it('matches nothing without an include', () => {
    expect(matchGlobs(files, ['!src/_*'])).toEqual([]);
  });
});

// A literal path as a glob of this dialect, which has no escape character: special characters
// become one-character classes or a one-option brace.
describe('escapeGlob', () => {
  it.each([
    ['src/fixtures', 'src/fixtures'],
    ['app/[slug]', 'app/[[]slug]'],
    ['a*/b?', 'a[*]/b[?]'],
    ['{x,y}', '{{}x,y}'],
    ['!neg', '[!]neg'],
  ])('%s → %s', (path, glob) => {
    expect(escapeGlob(path)).toBe(glob);
  });

  it('matches only the path itself, and with /** everything below it', () => {
    expect(matchGlobs(['app/[slug]/page.ts', 'app/s/page.ts', 'app/[slug]x/page.ts'], [`${escapeGlob('app/[slug]')}/**`])).toEqual(['app/[slug]/page.ts']);
  });

  const segment = fc.stringMatching(/^[ab*?[\]{},!.\\ -]{1,4}$/);
  const path = fc.array(segment, { minLength: 1, maxLength: 3 }).map((segments) => segments.join('/'));

  it('matches exactly the path it escapes (property)', () => {
    fc.assert(
      fc.property(path, path, (p, q) => {
        expect(globToRegExp(escapeGlob(p)).test(p), p).toBe(true);
        expect(globToRegExp(escapeGlob(p)).test(q), `${p} against ${q}`).toBe(p === q);
      }),
      { numRuns: 2000 },
    );
  });

  it('with /** includes exactly the path and what is below it, never as an exclude (property)', () => {
    fc.assert(
      fc.property(path, path, (p, q) => {
        expect(matchGlobs([q], [`${escapeGlob(p)}/**`]), `${p} against ${q}`).toEqual(q === p || q.startsWith(`${p}/`) ? [q] : []);
      }),
      { numRuns: 2000 },
    );
  });
});
