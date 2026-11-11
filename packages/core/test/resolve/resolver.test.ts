import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ImportKind } from '../../src/lex/ts.ts';
import { exportsTargets, MemoryVfs, Resolver, type Resolution } from '../../src/resolve/resolver.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'resolve');

interface Case {
  from: string;
  specifier: string | null;
  kind?: ImportKind;
  patterns?: string[] | null;
  expect: {
    kind: Resolution['kind'];
    targets: string[];
    packageName?: string;
    reason?: string;
    absentIncludes?: string[];
    absentExcludes?: string[];
    dirsIncludes?: string[];
    configsIncludes?: string[];
    globs?: { key: string; matches: string[] }[];
  };
}

function loadRepo(name: string): MemoryVfs {
  const dir = join(FIXTURES, name);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const full = join(entry.parentPath, entry.name);
    const path = relative(dir, full).split(sep).join('/');
    if (entry.isFile() && path !== '_expected.json' && path !== '_symlinks.json') {
      files[path] = readFileSync(full, 'utf8');
    }
  }
  const symlinksPath = join(dir, '_symlinks.json');
  const symlinks = readdirSync(dir).includes('_symlinks.json') ? (JSON.parse(readFileSync(symlinksPath, 'utf8')) as Record<string, string>) : {};
  return new MemoryVfs(files, symlinks);
}

describe('resolver fixture repositories', () => {
  const repos = readdirSync(FIXTURES);
  it('has the five fixture repositories', () => {
    expect(repos.sort()).toEqual(['misc', 'relative', 'tsconfig-paths', 'workspaces-npm', 'workspaces-pnpm']);
  });

  for (const repo of repos) {
    const cases = JSON.parse(readFileSync(join(FIXTURES, repo, '_expected.json'), 'utf8')) as Case[];
    describe(repo, () => {
      const resolver = new Resolver(loadRepo(repo));
      it.each(cases.map((c) => [`${c.kind ?? 'static'} ${String(c.specifier ?? c.patterns)} from ${c.from}`, c] as const))('%s', (_label, c) => {
        const result = resolver.resolve({ from: c.from, specifier: c.specifier, kind: c.kind ?? 'static', patterns: c.patterns ?? null });
        const e = c.expect;
        expect(result.kind).toBe(e.kind);
        expect(result.targets).toEqual(e.targets);
        if (e.packageName !== undefined) expect(result.packageName).toBe(e.packageName);
        if (e.reason !== undefined) expect(result.reason).toBe(e.reason);
        for (const path of e.absentIncludes ?? []) expect(result.absent).toContain(path);
        for (const path of e.absentExcludes ?? []) expect(result.absent).not.toContain(path);
        for (const path of e.dirsIncludes ?? []) expect(result.dirs).toContain(path);
        for (const path of e.configsIncludes ?? []) expect(result.configs).toContain(path);
        if (e.globs !== undefined) expect(result.globs).toEqual(e.globs);
      });
    });
  }
});

describe('probe recording', () => {
  it('records every candidate of an extensionless relative import', () => {
    const resolver = new Resolver(new MemoryVfs({ 'src/a.ts': '', 'src/util.ts': '' }));
    const result = resolver.resolve({ from: 'src/a.ts', specifier: './util', kind: 'static', patterns: null });
    expect(result.targets).toEqual(['src/util.ts']);
    expect(result.absent).toEqual(
      ['', '.cjs', '.cts', '.js', '.json', '.jsx', '.mjs', '.mts', '.tsx'].map((ext) => `src/util${ext}`).sort(),
    );
    expect(result.dirs).toEqual(['src/util']);
  });
});

describe('exportsTargets', () => {
  it.each([
    ['string sugar', './index.js', '.', ['./index.js']],
    ['array fallbacks are a union', ['./a.js', './b.js'], '.', ['./a.js', './b.js']],
    ['conditions are a union, types excluded', { '.': { types: './i.d.ts', node: { import: './n.mjs', require: './n.cjs' }, default: './d.js' } }, '.', ['./n.mjs', './n.cjs', './d.js']],
    ['the most specific pattern wins', { './features/*.js': './src/*.js', './features/private-internal/*': null }, './features/private-internal/x', []],
    ['a pattern substitutes every star', { './x/*': { import: './esm/*.mjs', require: './cjs/*.cjs' } }, './x/a/b', ['./esm/a/b.mjs', './cjs/a/b.cjs']],
  ] as const)('%s', (_name, exports, subpath, expected) => {
    expect(exportsTargets(exports, subpath)).toEqual(expected);
  });

  it('returns null when nothing matches', () => {
    expect(exportsTargets({ '.': './i.js' }, './other')).toBeNull();
  });
});

// The resolver's soundness: a result may only depend on what it recorded. Adding a file that is
// not a probed path, a config, or under a probed directory, or removing a file that is not a
// target or config, must leave the result unchanged.
describe('evidence completeness (property)', () => {
  const DIRS = ['', 'a', 'a/b', 'a/x'];
  const NAMES = ['x', 'index', 'util'];
  const EXTS = ['', '.ts', '.js', '.json', '.mjs'];
  const UNIVERSE = DIRS.flatMap((dir) => NAMES.flatMap((name) => EXTS.map((ext) => (dir === '' ? `${name}${ext}` : `${dir}/${name}${ext}`)))).filter(
    (path) => !DIRS.includes(path),
  );
  const SPECIFIERS = ['./x', './x.js', '../x', '../x.ts', './index', '..', '.', '../b', '../../x', '/x', './util', '../x/util', './x/index'];
  const IMPORTER = 'a/b/f.ts';

  const covered = (result: Resolution, path: string): boolean =>
    result.targets.includes(path) ||
    result.absent.includes(path) ||
    result.configs.includes(path) ||
    result.dirs.some((dir) => path === dir || path.startsWith(`${dir}/`) || dir.startsWith(`${path}/`));

  const resolve = (files: string[], specifier: string): Resolution =>
    new Resolver(new MemoryVfs(Object.fromEntries([...files, IMPORTER].map((f) => [f, ''])))).resolve({
      from: IMPORTER,
      specifier,
      kind: 'static',
      patterns: null,
    });

  // Paths that cannot coexist with the file set (a file where a directory is needed) are skipped.
  const coexists = (files: string[], path: string) =>
    !files.some((f) => f.startsWith(`${path}/`) || path.startsWith(`${f}/`)) && path !== IMPORTER && !IMPORTER.startsWith(`${path}/`);

  it('adding or removing unrecorded files never changes a resolution', () => {
    fc.assert(
      fc.property(fc.subarray(UNIVERSE, { maxLength: 12 }), fc.constantFrom(...SPECIFIERS), (picked, specifier) => {
        const files = picked.filter((path, _i, all) => all.every((other) => other === path || !other.startsWith(`${path}/`)) && coexists([], path));
        const before = resolve(files, specifier);
        for (const extra of UNIVERSE) {
          if (!files.includes(extra) && coexists(files, extra) && !covered(before, extra)) {
            const after = resolve([...files, extra], specifier);
            expect({ kind: after.kind, targets: after.targets }, `adding ${extra}`).toEqual({ kind: before.kind, targets: before.targets });
          }
        }
        for (const gone of files) {
          if (!before.targets.includes(gone) && !before.configs.includes(gone) && !covered(before, gone)) {
            const after = resolve(files.filter((f) => f !== gone), specifier);
            expect({ kind: after.kind, targets: after.targets }, `removing ${gone}`).toEqual({ kind: before.kind, targets: before.targets });
          }
        }
      }),
      { numRuns: 400 },
    );
  });
});
