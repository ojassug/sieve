import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { escapeGlob, parseTestFiles, TEST_FILES_ENV, testFilesFromEnv } from '../lib/test-files.ts';

const repo = join(import.meta.dirname, '..', '..');
const vitestBin = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

/** Runs `vitest list --filesOnly` and returns the files it would run, relative to `root`, sorted. */
function vitestList(root: string, args: readonly string[], env: Record<string, string> = {}): string[] {
  const out = join(mkdtempSync(join(tmpdir(), 'sieve-list-')), 'list.json');
  try {
    // Leave the parent run's VITEST* variables behind, so the child is a fresh, top-level Vitest.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
    execFileSync(process.execPath, [vitestBin, 'list', '--filesOnly', `--json=${out}`, '--root', root, ...args], {
      cwd: root,
      env: { ...inherited, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const listed = JSON.parse(readFileSync(out, 'utf8')) as { file: string }[];
    return listed.map(({ file }) => relative(root, file).replaceAll('\\', '/')).sort();
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
}

describe('parseTestFiles', () => {
  it('reads a JSON array of repository-relative paths', () => {
    expect(parseTestFiles('["packages/core/test/a.test.ts","scripts/test/b.test.ts"]')).toEqual([
      'packages/core/test/a.test.ts',
      'scripts/test/b.test.ts',
    ]);
  });

  it.each([
    ['not JSON', '{', /not valid JSON/],
    ['not an array', '{"files":[]}', /a JSON array/],
    ['an empty array', '[]', /lists no files/],
    ['a non-string entry', '["a.test.ts",1]', /\[1\]: must be a non-empty string/],
    ['an empty entry', '[""]', /\[0\]: must be a non-empty string/],
    ['an absolute POSIX path', '["/abs/a.test.ts"]', /\[0\]: .*repository-relative/],
    ['a drive path', '["C:/abs/a.test.ts"]', /\[0\]: .*repository-relative/],
    ['a backslash', '["packages\\\\a.test.ts"]', /\[0\]: .*backslash/],
    ['a parent segment', '["packages/../a.test.ts"]', /\[0\]: .*'\.' or '\.\.'/],
    ['a dot segment', '["./a.test.ts"]', /\[0\]: .*'\.' or '\.\.'/],
    ['an empty segment', '["packages//a.test.ts"]', /\[0\]: .*empty segment/],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseTestFiles(text)).toThrow(message);
  });
});

describe('escapeGlob', () => {
  it('leaves an ordinary path alone', () => {
    expect(escapeGlob('packages/core/test/graph/graph.test.ts')).toBe('packages/core/test/graph/graph.test.ts');
  });

  it('escapes every character that glob syntax gives a meaning', () => {
    expect(escapeGlob('a/(b)[c]{d}*?|!+@.test.ts')).toBe('a/\\(b\\)\\[c\\]\\{d\\}\\*\\?\\|\\!\\+\\@.test.ts');
  });
});

describe('testFilesFromEnv', () => {
  it(`is null when ${TEST_FILES_ENV} is unset or empty, so the configured include applies`, () => {
    expect(testFilesFromEnv({}, repo)).toBeNull();
    expect(testFilesFromEnv({ [TEST_FILES_ENV]: '' }, repo)).toBeNull();
  });

  it('turns each listed file into a glob that matches only that file', () => {
    expect(testFilesFromEnv({ [TEST_FILES_ENV]: '["scripts/test/dco.test.ts"]' }, repo)).toEqual(['scripts/test/dco.test.ts']);
  });

  it('fails loudly when a listed file does not exist, rather than running fewer files', () => {
    expect(() => testFilesFromEnv({ [TEST_FILES_ENV]: '["scripts/test/dco.test.ts","scripts/test/gone.test.ts"]' }, repo)).toThrow(
      /scripts\/test\/gone\.test\.ts.*not a file/,
    );
  });

  it('fails loudly when a listed path is a directory', () => {
    expect(() => testFilesFromEnv({ [TEST_FILES_ENV]: '["scripts/test"]' }, repo)).toThrow(/scripts\/test.*not a file/);
  });

  it(`names ${TEST_FILES_ENV} in a parse error`, () => {
    expect(() => testFilesFromEnv({ [TEST_FILES_ENV]: '[1]' }, repo)).toThrow(new RegExp(TEST_FILES_ENV));
  });
});

describe('Vitest runs exactly the listed files', () => {
  let scratch: string | null = null;

  afterEach(() => {
    if (scratch !== null) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = null;
    }
  });

  it('through this repository’s vitest.config.ts', () => {
    const files = ['packages/core/test/graph/graph.test.ts', 'scripts/test/dco.test.ts'];
    expect(vitestList(repo, [], { [TEST_FILES_ENV]: JSON.stringify(files) })).toEqual(files);
  });

  it('with names that glob syntax would otherwise widen or narrow', () => {
    scratch = mkdtempSync(join(tmpdir(), 'sieve-escape-'));
    // Each listed name has an unlisted twin that the unescaped name, read as a glob, would match.
    const listed = ['a[1].test.ts', 'b(x).test.ts', 'c{d,e}.test.ts', '!f.test.ts', 'g+(h).test.ts', 'i@(j).test.ts', 'sub dir/k.test.ts'];
    const twins = ['a1.test.ts', 'bx.test.ts', 'cd.test.ts', 'ce.test.ts', 'f.test.ts', 'gh.test.ts', 'ghh.test.ts', 'ij.test.ts'];
    if (process.platform !== 'win32') {
      // Not valid in Windows file names.
      listed.push('l*.test.ts', 'm?.test.ts', 'n|o.test.ts');
      twins.push('lx.test.ts', 'mx.test.ts', 'n.test.ts', 'o.test.ts');
    }
    for (const name of [...listed, ...twins]) {
      mkdirSync(dirname(join(scratch, name)), { recursive: true });
      writeFileSync(join(scratch, name), '');
    }
    const include = testFilesFromEnv({ [TEST_FILES_ENV]: JSON.stringify(listed) }, scratch);
    writeFileSync(join(scratch, 'vitest.config.mjs'), `export default { test: { include: ${JSON.stringify(include)}, exclude: [] } };\n`);

    expect(vitestList(scratch, ['--config', join(scratch, 'vitest.config.mjs')])).toEqual([...listed].sort());
  });
});
