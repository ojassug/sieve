import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ImportKind } from '../../src/lex/ts.ts';
import { matchGlobs } from '../../src/resolve/glob.ts';
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

// `new URL(spec, import.meta.url)`: an asset next to the module, or a directory whose files the
// code may read. A directory depends on everything below it, as a glob, so files that appear count.
describe('new URL(…, import.meta.url)', () => {
  const resolver = new Resolver(
    new MemoryVfs(
      {
        'src/a.ts': '',
        'src/logo.svg': '',
        'src/fixtures/one.json': '',
        'src/fixtures/deep/two.json': '',
        'app/[slug]/page.ts': '',
        'app/s/page.ts': '',
        'real/data.json': '',
        'top.ts': '',
      },
      { 'aliases/data.json': '../real/data.json', 'links/dir': '../real', 'links/up': '../../outside' },
    ),
  );
  const url = (from: string, specifier: string) => resolver.resolve({ from, specifier, kind: 'url' });

  it('resolves a file to that file', () => {
    expect(url('src/a.ts', './logo.svg')).toMatchObject({ kind: 'file', targets: ['src/logo.svg'], globs: [] });
  });

  it('resolves a directory to every file below it, recorded as a glob', () => {
    const files = ['src/fixtures/deep/two.json', 'src/fixtures/one.json'];
    for (const specifier of ['./fixtures/', './fixtures', 'fixtures/']) {
      const result = url('src/a.ts', specifier);
      expect(result, specifier).toMatchObject({ kind: 'file', targets: files, globs: [{ key: 'src/fixtures/**', matches: files, patterns: ['src/fixtures/**'] }] });
      expect(result.dirs, specifier).toContain('src/fixtures');
      expect(result.reason, specifier).toBeUndefined();
    }
  });

  it("resolves '.' to the module's own directory, itself included", () => {
    expect(url('src/a.ts', '.').targets).toEqual(['src/a.ts', 'src/fixtures/deep/two.json', 'src/fixtures/one.json', 'src/logo.svg']);
  });

  it('resolves the repository root to every file', () => {
    const small = new Resolver(new MemoryVfs({ 'a/b/c.ts': '', 'd.json': '' }));
    const result = small.resolve({ from: 'a/b/c.ts', specifier: '../..', kind: 'url' });
    expect(result).toMatchObject({ kind: 'file', targets: ['a/b/c.ts', 'd.json'], globs: [{ key: '**', matches: ['a/b/c.ts', 'd.json'], patterns: ['**'] }] });
  });

  it('escapes glob characters in the directory name', () => {
    expect(url('app/[slug]/page.ts', '.')).toMatchObject({ targets: ['app/[slug]/page.ts'], globs: [{ key: 'app/[[]slug]/**', patterns: ['app/[[]slug]/**'] }] });
  });

  it('follows a symlink below the directory to the file it names', () => {
    expect(url('top.ts', './aliases/').targets).toEqual(['aliases/data.json', 'real/data.json']);
  });

  it('leaves a directory unresolved when a symlink below it leads to a directory or out of the repository', () => {
    expect(url('top.ts', './links/')).toMatchObject({ kind: 'unresolved', reason: 'symlinked directory', targets: [] });
    expect(url('top.ts', '.')).toMatchObject({ kind: 'unresolved', targets: [] });
  });

  it('leaves a missing path, a path outside the repository and a symlinked directory unresolved', () => {
    expect(url('src/a.ts', './nowhere/')).toMatchObject({ kind: 'unresolved', reason: 'not found', absent: ['src/nowhere'], dirs: ['src/nowhere'] });
    expect(url('top.ts', '..')).toMatchObject({ kind: 'unresolved', reason: 'outside repository' });
    expect(url('top.ts', './links/dir/')).toMatchObject({ kind: 'unresolved', reason: 'symlinked directory' });
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
  const SPECIFIERS = ['./x', './x.js', '../x', '../x.ts', './index', '..', '.', '../b', '../../x', '/x', './util', '../x/util', './x/index', '../..', '../x/', './util/'];
  const IMPORTER = 'a/b/f.ts';

  const covered = (result: Resolution, path: string): boolean =>
    result.targets.includes(path) ||
    result.absent.includes(path) ||
    result.configs.includes(path) ||
    result.dirs.some((dir) => path === dir || path.startsWith(`${dir}/`) || dir.startsWith(`${path}/`)) ||
    result.globs.some((glob) => glob.patterns !== undefined && matchGlobs([path], glob.patterns).length > 0);

  const resolveAs = (files: string[], specifier: string, kind: ImportKind): Resolution =>
    new Resolver(new MemoryVfs(Object.fromEntries([...files, IMPORTER].map((f) => [f, ''])))).resolve({
      from: IMPORTER,
      specifier,
      kind,
      patterns: null,
    });

  // Paths that cannot coexist with the file set (a file where a directory is needed) are skipped.
  const coexists = (files: string[], path: string) =>
    !files.some((f) => f.startsWith(`${path}/`) || path.startsWith(`${f}/`)) && path !== IMPORTER && !IMPORTER.startsWith(`${path}/`);

  it.each(['static', 'url'] as const)('adding or removing unrecorded files never changes a %s resolution', (kind) => {
    fc.assert(
      fc.property(fc.subarray(UNIVERSE, { maxLength: 12 }), fc.constantFrom(...SPECIFIERS), (picked, specifier) => {
        const files = picked.filter((path, _i, all) => all.every((other) => other === path || !other.startsWith(`${path}/`)) && coexists([], path));
        const resolve = (set: string[]) => resolveAs(set, specifier, kind);
        const before = resolve(files);
        for (const extra of UNIVERSE) {
          if (!files.includes(extra) && coexists(files, extra) && !covered(before, extra)) {
            const after = resolve([...files, extra]);
            expect({ kind: after.kind, targets: after.targets }, `adding ${extra}`).toEqual({ kind: before.kind, targets: before.targets });
          }
        }
        for (const gone of files) {
          if (!before.targets.includes(gone) && !before.configs.includes(gone) && !covered(before, gone)) {
            const after = resolve(files.filter((f) => f !== gone));
            expect({ kind: after.kind, targets: after.targets }, `removing ${gone}`).toEqual({ kind: before.kind, targets: before.targets });
          }
        }
      }),
      { numRuns: 400 },
    );
  });
});

// A file's own config dependencies: the tsconfig chain that governs it and the nearest
// package.json, whose `type` decides how Node loads it.
describe('fileConfigs', () => {
  it('records the tsconfig chain, the nearest package.json and every miss on the way up', () => {
    const resolver = new Resolver(
      new MemoryVfs({
        'package.json': '{}',
        'a/tsconfig.json': '{ "extends": "../tsconfig.base" }',
        'tsconfig.base.json': '{}',
        'a/b/f.ts': '',
      }),
    );
    expect(resolver.fileConfigs('a/b/f.ts')).toEqual({
      configs: ['a/tsconfig.json', 'package.json', 'tsconfig.base.json'],
      absent: ['a/b/package.json', 'a/b/tsconfig.json', 'a/package.json', 'tsconfig.base'],
    });
  });

  it('stops at the nearest package.json, even one without a type field', () => {
    const resolver = new Resolver(new MemoryVfs({ 'package.json': '{"type":"module"}', 'a/package.json': '{}', 'a/f.js': '' }));
    expect(resolver.fileConfigs('a/f.js')).toEqual({ configs: ['a/package.json'], absent: ['a/tsconfig.json', 'tsconfig.json'] });
  });

  it('records the root package.json and tsconfig.json as absent when nothing exists', () => {
    expect(new Resolver(new MemoryVfs({ 'f.ts': '' })).fileConfigs('f.ts')).toEqual({ configs: [], absent: ['package.json', 'tsconfig.json'] });
  });

  // Soundness, as for resolve(): the result may only depend on what it recorded.
  describe('evidence completeness (property)', () => {
    const DIRS = ['', 'a', 'a/b'];
    const NAMES = ['package.json', 'tsconfig.json', 'tsconfig.base.json', 'base', 'base.json', 'x.ts'];
    const UNIVERSE = DIRS.flatMap((dir) => NAMES.map((name) => (dir === '' ? name : `${dir}/${name}`)));
    const CONTENTS = ['{}', '{"extends":"./tsconfig.base.json"}', '{"extends":"../tsconfig.json"}', '{"extends":"./base"}', '{"extends":"../base.json"}', '{"extends":["./base.json","../tsconfig.base.json"]}', '{"extends":"@tsconfig/node22"}', 'not json'];
    const IMPORTER = 'a/b/f.ts';
    const configsOf = (files: Record<string, string>) => new Resolver(new MemoryVfs({ ...files, [IMPORTER]: '' })).fileConfigs(IMPORTER);

    it('adding, removing or editing an unrecorded file never changes the result', () => {
      fc.assert(
        fc.property(fc.dictionary(fc.constantFrom(...UNIVERSE), fc.constantFrom(...CONTENTS), { maxKeys: 10 }), fc.constantFrom(...CONTENTS), (files, other) => {
          const before = configsOf(files);
          const recorded = new Set([...before.configs, ...before.absent]);
          for (const path of UNIVERSE) {
            if (!recorded.has(path)) {
              const changed = path in files ? Object.fromEntries(Object.entries(files).filter(([p]) => p !== path)) : { ...files, [path]: other };
              expect(configsOf(changed), `toggling ${path}`).toEqual(before);
            }
            if (path in files && !before.configs.includes(path)) {
              expect(configsOf({ ...files, [path]: other }), `editing ${path}`).toEqual(before);
            }
          }
        }),
        { numRuns: 400 },
      );
    });
  });
});
