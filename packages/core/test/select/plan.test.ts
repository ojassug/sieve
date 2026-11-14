import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildStaticMap, fileHash, isLexed, readLockfile, type SieveMap, type StaticInput } from '../../src/graph/static.ts';
import { dialectOf, lexImportsFromBytes } from '../../src/lex/ts.ts';
import { matchGlobs } from '../../src/resolve/glob.ts';
import { Resolver } from '../../src/resolve/resolver.ts';
import { selectStatic, type HeadState, type PlanRules, type Selection } from '../../src/select/plan.ts';
import { fakeRepo, type FakeRepo } from '../graph/fake-repo.ts';

type Files = Record<string, string>;
const isTest = (path: string) => /\.test\.[jt]s$/.test(path);

function mapOf(repo: FakeRepo, options: Partial<StaticInput> = {}): SieveMap {
  return buildStaticMap({ objectFormat: 'sha1', index: repo.index, vfs: repo.vfs, sources: repo.sources, tests: repo.vfs.files().filter(isTest), ...options });
}

function headOf(repo: FakeRepo, options: Partial<HeadState> = {}): HeadState {
  return { objectFormat: 'sha1', index: repo.index, vfs: repo.vfs, tests: repo.vfs.files().filter(isTest), config: null, ...options };
}

function plan(base: Files, head: Files, rules: PlanRules = {}, mapOptions: Partial<StaticInput> = {}, headOptions: Partial<HeadState> = {}): Selection {
  return selectStatic(mapOf(fakeRepo(base), mapOptions), headOf(fakeRepo(head), headOptions), rules);
}

const selected = (selection: Selection) => [...selection.affected.map((a) => a.test), ...selection.forced.map((f) => f.test)].sort();

const LOCK = (lodash: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/lodash': { version: '4', integrity: lodash }, ...extra } });

const BASE: Files = {
  'package.json': '{"name":"app"}',
  'package-lock.json': LOCK('sha512-1'),
  'src/a.ts': "import { b } from './b';\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/c.ts': "import _ from 'lodash';\n",
  'test/a.test.ts': "import '../src/a';\n",
  'test/c.test.ts': "import '../src/c';\n",
  'test/plain.test.ts': '',
};

describe('selectStatic', () => {
  it('selects nothing when nothing changed', () => {
    const selection = plan(BASE, BASE);
    expect(selection).toMatchObject({ changed: [], escalations: [], affected: [], forced: [] });
    expect(selection.wouldSkip).toEqual(['test/a.test.ts', 'test/c.test.ts', 'test/plain.test.ts']);
  });

  it('selects the tests that reach a changed file, with a why-path from the test to the change', () => {
    const selection = plan(BASE, { ...BASE, 'src/b.ts': 'export const b = 2;\n' });
    expect(selection.changed).toEqual(['f:src/b.ts']);
    expect(selection.affected).toEqual([{ test: 'test/a.test.ts', path: ['f:test/a.test.ts', 'f:src/a.ts', 'f:src/b.ts'] }]);
    expect(selection.wouldSkip).toEqual(['test/c.test.ts', 'test/plain.test.ts']);
  });

  it('counts a mode change as a change', () => {
    const base = fakeRepo(BASE);
    const head = fakeRepo({ ...BASE, 'src/b.ts': { mode: '100755' as const, content: BASE['src/b.ts']! } });
    expect(selectStatic(mapOf(base), headOf(head), {}).changed).toEqual(['f:src/b.ts']);
  });

  it('selects importers of a probe that appears, which may shadow the old target', () => {
    const selection = plan(BASE, { ...BASE, 'src/b/index.ts': '' });
    expect(selection.changed).toContain('d:src/b');
    expect(selected(selection)).toEqual(['test/a.test.ts']);
  });

  it('always selects tests that reach an uncertain file', () => {
    const base = { ...BASE, 'src/b.ts': "import './nowhere';\n" };
    const selection = plan(base, base);
    expect(selection.uncertain).toEqual(['u:src/b.ts']);
    expect(selection.affected).toEqual([{ test: 'test/a.test.ts', path: ['f:test/a.test.ts', 'f:src/a.ts', 'f:src/b.ts', 'u:src/b.ts'] }]);
  });

  it('selects importers of a package whose lockfile entry changed', () => {
    const selection = plan(BASE, { ...BASE, 'package-lock.json': LOCK('sha512-2') });
    expect(selection.changed).toEqual(['p:npm:node_modules/lodash']);
    expect(selection.escalations).toEqual([]);
    expect(selected(selection)).toEqual(['test/c.test.ts']);
  });

  it('selects importers of every copy of a package when a new copy is installed elsewhere', () => {
    const head = { ...BASE, 'package-lock.json': LOCK('sha512-1', { 'node_modules/x/node_modules/lodash': { version: '3', integrity: 'sha512-3' } }) };
    const selection = plan(BASE, head);
    expect(selection.changed).toEqual(['p:npm:node_modules/lodash']);
    expect(selected(selection)).toEqual(['test/c.test.ts']);
  });

  it('selects bare importers when the workspace packages change', () => {
    const base = { ...BASE, 'package.json': '{"name":"app","workspaces":["pkgs/*"]}', 'pkgs/p/package.json': '{"name":"p"}', 'pkgs/p/index.js': '', 'src/a.ts': "import 'p';\n" };
    const selection = plan(base, { ...base, 'pkgs/q/package.json': '{"name":"q"}' });
    expect(selection.changed).toContain('g:workspaces');
    expect(selected(selection)).toContain('test/a.test.ts');
  });

  it('selects importers of a glob when a new file matches it', () => {
    const base = { ...BASE, 'src/a.ts': "import.meta.glob('./pages/*.ts');\n", 'src/pages/x.ts': '' };
    const selection = plan(base, { ...base, 'src/pages/y.ts': '' });
    expect(selection.changed).toContain('g:glob:src/pages/*.ts');
    expect(selected(selection)).toEqual(['test/a.test.ts']);
  });

  describe('a directory named by new URL(…, import.meta.url)', () => {
    const base = { ...BASE, 'src/a.ts': "export const data = new URL('./data/', import.meta.url);\n", 'src/data/x.json': '1', 'src/data/deep/y.json': '1' };

    it('is a dependency, not an uncertainty', () => {
      expect(mapOf(fakeRepo(base)).uncertain).toEqual({});
      expect(selected(plan(base, base))).toEqual([]);
    });

    it('selects its importers when a file below it changes', () => {
      const selection = plan(base, { ...base, 'src/data/deep/y.json': '2' });
      expect(selection.affected).toEqual([{ test: 'test/a.test.ts', path: ['f:test/a.test.ts', 'f:src/a.ts', 'f:src/data/deep/y.json'] }]);
      expect(selection.escalations).toEqual([]);
    });

    it('selects its importers when a file appears below it, which needs no escalation', () => {
      const selection = plan(base, { ...base, 'src/data/z.json': '1' });
      expect(selection.changed).toContain('g:glob:src/data/**');
      expect(selection.escalations).toEqual([]);
      expect(selected(selection)).toEqual(['test/a.test.ts']);
    });

    it('still escalates a new file that no glob in the map matches (L1)', () => {
      const selection = plan(base, { ...base, 'src/other.json': '1' });
      expect(selection.escalations).toEqual([{ level: 'L1', scope: '', cause: 'src/other.json was added and is not in the graph' }]);
    });

    it('selects its importers when it appears, having been missing', () => {
      const missing = { ...BASE, 'src/a.ts': "export const data = new URL('./data/', import.meta.url);\n" };
      const selection = plan(missing, { ...missing, 'src/data/x.json': '1' });
      expect(selection.affected.find((a) => a.test === 'test/a.test.ts')?.path).toEqual(['f:test/a.test.ts', 'f:src/a.ts', 'd:src/data']);
    });
  });

  it('runs new tests, and tests named by alwaysRun', () => {
    const selection = plan(BASE, { ...BASE, 'test/new.test.ts': '' }, { alwaysRun: ['test/plain.*'] });
    expect(selection.forced).toEqual([
      { test: 'test/new.test.ts', reason: 'new test file' },
      { test: 'test/plain.test.ts', reason: 'alwaysRun' },
    ]);
  });

  describe('unmapped inputs (L1, ADR-0005)', () => {
    const WORKSPACES: Files = {
      ...BASE,
      'package.json': '{"name":"app","workspaces":["pkgs/*"]}',
      'pkgs/db/package.json': '{"name":"db","main":"src/index.ts"}',
      'pkgs/db/src/index.ts': 'export const db = 1;\n',
      'pkgs/db/migrations/001.sql': 'create table t ();\n',
      'pkgs/db/test/db.test.ts': "import '../src/index';\n",
      'pkgs/api/package.json': '{"name":"api"}',
      'pkgs/api/src/handler.ts': "import 'db';\n",
      'pkgs/api/test/api.test.ts': "import '../src/handler';\n",
      'pkgs/cli/package.json': '{"name":"cli"}',
      'pkgs/cli/src/main.ts': "import 'api';\n",
      'pkgs/cli/test/cli.test.ts': '',
      'pkgs/cli/test/fixtures/repo/package.json': '{"name":"fixture"}',
      'pkgs/cli/test/fixtures/repo/data.json': '1',
    };

    it('makes every node of the owning package changed, so the escalation follows dependencies into other packages', () => {
      const selection = plan(WORKSPACES, { ...WORKSPACES, 'pkgs/db/migrations/001.sql': 'create table u ();\n' });
      const cause = 'pkgs/db/migrations/001.sql was modified and is not in the graph';
      expect(selection.escalations).toEqual([{ level: 'L1', scope: 'pkgs/db', cause }]);
      expect(selection.forced.map(({ test, reason }) => ({ test, reason }))).toEqual([
        { test: 'pkgs/api/test/api.test.ts', reason: `L1: ${cause}` },
        { test: 'pkgs/db/test/db.test.ts', reason: `L1: ${cause}` },
      ]);
      // The why-path crosses into the escalated package; where it ends there is a tie-break among
      // that package's nodes (a probe directory sorts before the source file).
      const [api, db] = selection.forced;
      expect(api!.path!.slice(0, 2)).toEqual(['f:pkgs/api/test/api.test.ts', 'f:pkgs/api/src/handler.ts']);
      expect(api!.path!.at(-1)).toMatch(/^[fd]:pkgs\/db\//);
      expect(db!.path).toEqual(['f:pkgs/db/test/db.test.ts']);
      expect(selection.wouldSkip).toEqual(['pkgs/cli/test/cli.test.ts', 'test/a.test.ts', 'test/c.test.ts', 'test/plain.test.ts']);
    });

    it('takes the owning package from the workspace members, not from a fixture package.json', () => {
      const selection = plan(WORKSPACES, { ...WORKSPACES, 'pkgs/cli/test/fixtures/repo/data.json': '2' });
      expect(selection.escalations).toEqual([{ level: 'L1', scope: 'pkgs/cli', cause: 'pkgs/cli/test/fixtures/repo/data.json was modified and is not in the graph' }]);
      expect(selected(selection)).toEqual(['pkgs/cli/test/cli.test.ts']);
    });

    it('treats a changed module that no test reaches as an unmapped input', () => {
      const selection = plan(WORKSPACES, { ...WORKSPACES, 'pkgs/cli/src/main.ts': "import 'api';\nimport 'db';\n" });
      const cause = 'pkgs/cli/src/main.ts changed and no test reaches it';
      expect(selection.escalations).toEqual([{ level: 'L1', scope: 'pkgs/cli', cause }]);
      expect(selection.forced).toEqual([{ test: 'pkgs/cli/test/cli.test.ts', reason: `L1: ${cause}`, path: ['f:pkgs/cli/test/cli.test.ts'] }]);
    });

    it('runs everything when the unreached module belongs to the root', () => {
      const base = { ...BASE, 'scripts/seed.ts': '' };
      const selection = plan(base, { ...base, 'scripts/seed.ts': 'export {};\n' });
      expect(selection.escalations).toEqual([{ level: 'L1', scope: '', cause: 'scripts/seed.ts changed and no test reaches it' }]);
      expect(selection.wouldSkip).toEqual([]);
    });

    it('treats a package that no test reaches as an unmapped input when its lockfile entry changes', () => {
      const eslint = (integrity: string) => ({ 'node_modules/eslint': { version: '10', integrity } });
      const selection = plan({ ...BASE, 'package-lock.json': LOCK('sha512-1', eslint('sha512-e1')) }, { ...BASE, 'package-lock.json': LOCK('sha512-1', eslint('sha512-e2')) });
      expect(selection.escalations).toEqual([{ level: 'L1', scope: '', cause: 'p:npm:node_modules/eslint changed and no test reaches it' }]);
      expect(selection.wouldSkip).toEqual([]);
    });

    it('treats a glob that no test reaches as an unmapped input of the root, since its matches can lie anywhere', () => {
      const base = { ...BASE, 'scripts/gen.ts': "import.meta.glob('./templates/*.ts');\n" };
      const selection = plan(base, { ...base, 'scripts/templates/b.ts': '' });
      expect(selection.escalations).toEqual([{ level: 'L1', scope: '', cause: 'g:glob:scripts/templates/*.ts changed and no test reaches it' }]);
    });

    it('lets inputs.ignore cover unreached nodes and files outside the graph, and lists what it ignored', () => {
      const base = { ...BASE, 'scripts/seed.ts': '', 'package-lock.json': LOCK('sha512-1', { 'node_modules/eslint': { integrity: 'sha512-e1' } }) };
      const head = { ...base, 'scripts/seed.ts': 'export {};\n', 'README.md': '# hi', 'package-lock.json': LOCK('sha512-1', { 'node_modules/eslint': { integrity: 'sha512-e2' } }) };
      const selection = plan(base, head, { ignore: ['**/*.md', 'scripts/**', 'node_modules/eslint'] });
      expect(selection.escalations).toEqual([]);
      expect(selection.ignored).toEqual(['README.md', 'node_modules/eslint', 'scripts/seed.ts']);
      expect(selected(selection)).toEqual([]);
    });

    it('does not escalate a deleted test, which reaches itself in the map', () => {
      const head = { ...BASE };
      delete head['test/plain.test.ts'];
      expect(plan(BASE, head).escalations).toEqual([]);
    });

    it('does not count an uncertain file that nothing reaches as a change', () => {
      const base = { ...BASE, 'fixtures/u.ts': "import './nowhere';\n" };
      const selection = plan(base, base);
      expect(selection.uncertain).toEqual(['u:fixtures/u.ts']);
      expect(selection.escalations).toEqual([]);
      expect(selected(selection)).toEqual([]);
    });
  });

  it('seeds every u: node, even one a damaged map lists no causes for', () => {
    const base = { ...BASE, 'src/b.ts': "import './nowhere';\n" };
    const map = mapOf(fakeRepo(base));
    const selection = selectStatic({ ...map, uncertain: {} }, headOf(fakeRepo(base)), {});
    expect(selection.uncertain).toEqual(['u:src/b.ts']);
    expect(selected(selection)).toEqual(['test/a.test.ts']);
  });

  it('ignores changes that match the ignore patterns, and new modules nothing could have loaded', () => {
    const selection = plan(BASE, { ...BASE, 'README.md': '# hi', 'docs/x.txt': 'x', 'src/new.ts': '' }, { ignore: ['**/*.md', 'docs/**'] });
    expect(selection.escalations).toEqual([]);
    expect(selection.ignored).toEqual(['README.md', 'docs/x.txt']);
    expect(selected(selection)).toEqual([]);
  });

  it.each([
    ['the config changed', {}, { config: 'b'.repeat(40) }, 'sieve.config.json changed'],
    ['the object format differs', {}, { objectFormat: 'sha256' as const }, 'the map is for sha1 objects, the repository uses sha256'],
  ])('runs everything when %s (L3)', (_name, mapOptions, headOptions, cause) => {
    const selection = plan(BASE, BASE, {}, { config: 'a'.repeat(40), ...mapOptions }, { config: 'a'.repeat(40), ...headOptions });
    expect(selection.escalations).toEqual([{ level: 'L3', cause }]);
    expect(selection.forced.map((f) => f.test)).toEqual(['test/a.test.ts', 'test/c.test.ts', 'test/plain.test.ts']);
    expect(selection.affected).toEqual([]);
    expect(selection.wouldSkip).toEqual([]);
  });

  it('runs everything when a lockfile it cannot parse changed, but not when it did not', () => {
    const base: Files = { ...BASE, 'pnpm-lock.yaml': 'a: 1\n' };
    delete base['package-lock.json'];
    expect(plan(base, base).escalations).toEqual([]);
    expect(plan(base, { ...base, 'pnpm-lock.yaml': 'a: 2\n' }).escalations).toEqual([{ level: 'L3', cause: 'pnpm-lock.yaml changed and cannot be parsed (pnpm lockfiles are not parsed yet)' }]);
  });

  it('runs everything when the lockfile setup changes', () => {
    const head = { ...BASE, 'yarn.lock': '' };
    expect(plan(BASE, head).escalations).toEqual([
      { level: 'L3', cause: 'package-lock.json, yarn.lock changed and cannot be parsed (more than one lockfile: package-lock.json, yarn.lock)' },
    ]);
    const shrinkwrap: Files = { ...BASE, 'npm-shrinkwrap.json': BASE['package-lock.json']! };
    delete shrinkwrap['package-lock.json'];
    expect(plan(BASE, shrinkwrap).escalations).toEqual([{ level: 'L3', cause: 'the lockfile changed from package-lock.json to npm-shrinkwrap.json' }]);
  });
});

// Soundness of the whole static pipeline (builder, map, Δ and selection) against an oracle that
// shares none of the graph code: what a test loads, found by following resolution targets, the
// configs each file reads, lockfile packages and their dependencies, and the global inputs. If that
// differs between S and H, or anything in it is uncertain, the plan from S's map must select the
// test. Repositories are drawn from a small universe where shadowing probes, tsconfig paths,
// workspaces and nested package copies are common.
describe('static selection soundness (property)', () => {
  const MODULES = ['src/a.ts', 'src/b.ts', 'src/d/index.ts', 'lib/f.mjs', 'test/a.test.ts', 'test/b.test.ts'];
  const TARGETS = ['src/a', 'src/b.js', 'src/b', 'src/d', 'lib/f.mjs', 'data/x.json'];
  const BARE = ['x', 'lodash', 'q', '@/b'];
  const lockfile = (lodash: string, nested: boolean) =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/x': { integrity: 'sha512-x', dependencies: { lodash: '*' } },
        'node_modules/lodash': { integrity: lodash },
        'node_modules/q': { integrity: 'sha512-q' },
        ...(nested ? { 'node_modules/x/node_modules/lodash': { integrity: 'sha512-nested' } } : {}),
      },
    });
  const OTHER: Readonly<Record<string, readonly (string | null)[]>> = {
    'package.json': [null, '{"name":"r"}', '{"name":"r","workspaces":["pkgs/*"]}', '{"name":"r","type":"module","workspaces":["pkgs/*"]}'],
    'src/package.json': [null, '{"type":"commonjs"}'],
    'tsconfig.json': [null, '{}', '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}'],
    'package-lock.json': [null, lockfile('sha512-1', false), lockfile('sha512-2', false), lockfile('sha512-1', true)],
    'pkgs/q/package.json': [null, '{"name":"q","main":"index.js"}', '{"name":"q","main":"other.js"}'],
    'pkgs/q/index.js': [null, ''],
    'src/b.js': [null, ''],
    'src/b/index.ts': [null, ''],
    'data/x.json': [null, '1', '2'],
    '.env.test': [null, 'A=1', 'A=2'],
  };
  const PATHS = [...MODULES, ...Object.keys(OTHER)];

  const relative = (fromDir: string, target: string): string => {
    const from = fromDir.split('/');
    const to = target.split('/');
    let common = 0;
    while (common < from.length && from[common] === to[common]) {
      common++;
    }
    const up = from.slice(common).map(() => '..');
    return [...(up.length === 0 ? ['.'] : up), ...to.slice(common)].join('/');
  };
  /** An import line, written relative to the importing file's directory. */
  const line = fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom(...TARGETS).map((target) => (dir: string) => `import '${relative(dir, target)}';`) },
    { weight: 4, arbitrary: fc.constantFrom(...BARE).map((name) => () => `import '${name}';`) },
    { weight: 1, arbitrary: fc.constant((dir: string) => `import type { T } from '${relative(dir, 'src/b')}';`) },
    { weight: 1, arbitrary: fc.constant((dir: string) => `import.meta.glob('${relative(dir, 'src')}/*.ts');`) },
    { weight: 1, arbitrary: fc.constant(() => 'await import(name);') },
  );
  const module = fc.option(fc.array(line, { maxLength: 3 }), { nil: null, freq: 5 });
  const repo = fc.record({
    ...Object.fromEntries(MODULES.map((path) => [path, module])),
    ...Object.fromEntries(Object.entries(OTHER).map(([path, options]) => [path, fc.constantFrom(...options)])),
  }) as unknown as fc.Arbitrary<Record<string, ((dir: string) => string)[] | string | null>>;

  const materialize = (files: Record<string, ((dir: string) => string)[] | string | null>): Files => {
    const out: Files = {};
    for (const [path, value] of Object.entries(files)) {
      if (value !== null) {
        const dir = path.slice(0, path.lastIndexOf('/'));
        out[path] = typeof value === 'string' ? value : value.map((make) => make(dir)).join('\n');
      }
    }
    // A file cannot also be a directory.
    return Object.fromEntries(Object.entries(out).filter(([path]) => !Object.keys(out).some((other) => other.startsWith(`${path}/`))));
  };

  /** What `test` loads in `repo`, as sorted "kind path hash" lines, and whether any of it is uncertain. */
  const loads = (repo: FakeRepo, test: string, global: readonly string[]): { items: string; uncertain: boolean } => {
    const resolver = new Resolver(repo.vfs);
    const lock = readLockfile(repo.vfs);
    const items = new Set<string>();
    let uncertain = false;
    const file = (path: string) => items.add(`file ${path} ${String(fileHash(repo.index, path))}`);
    const pkg = (location: string): void => {
      if (lock.kind === 'npm' && !items.has(`pkg ${location}`)) {
        items.add(`pkg ${location}`);
        items.add(`pkg ${location} ${lock.lockfile.packages.get(location)!.hash}`);
        lock.lockfile.dependencies(location).resolved.forEach(pkg);
      }
    };
    const queue = [test];
    for (const path of queue) {
      file(path);
      if (!isLexed(path)) {
        continue;
      }
      resolver.fileConfigs(path).configs.forEach(file);
      const lexed = lexImportsFromBytes(repo.sources.get(path)!, dialectOf(path));
      uncertain ||= lexed.uncertain;
      for (const record of lexed.imports.filter((r) => r.typeOnly !== true)) {
        const resolution = resolver.resolve({ from: path, specifier: record.specifier, kind: record.kind, patterns: record.patterns ?? null });
        uncertain ||= resolution.kind === 'unresolved' || resolution.uncertain === true;
        resolution.configs.forEach(file);
        for (const target of resolution.targets.filter((t) => !queue.includes(t))) {
          queue.push(target);
        }
        if (resolution.packageName !== undefined) {
          const location = lock.kind === 'npm' ? lock.lockfile.locate(resolution.packageName, path.slice(0, Math.max(0, path.lastIndexOf('/')))) : null;
          if (location !== null) {
            pkg(location);
          } else if (lock.kind === 'unparseable') {
            lock.paths.forEach(file);
          } else if (resolution.kind === 'external') {
            uncertain = true;
          }
        }
      }
    }
    matchGlobs(repo.vfs.files(), global).forEach(file);
    return { items: [...items].sort().join('\n'), uncertain };
  };

  it('selects every test whose loaded inputs changed or are uncertain', () => {
    fc.assert(
      fc.property(repo, repo, fc.subarray(PATHS, { minLength: 1, maxLength: 2 }), fc.boolean(), (s, other, edited, withGlobal) => {
        const h = Object.fromEntries(PATHS.map((path) => [path, edited.includes(path) ? other[path]! : s[path]!]));
        const global = withGlobal ? ['.env*'] : [];
        const sRepo = fakeRepo(materialize(s));
        const hRepo = fakeRepo(materialize(h));
        const selection = selectStatic(mapOf(sRepo, { global }), headOf(hRepo), {});
        const chosen = new Set(selected(selection));
        const both = sRepo.vfs.files().filter((path) => isTest(path) && hRepo.vfs.files().includes(path));
        for (const test of both) {
          const before = loads(sRepo, test, global);
          if (before.uncertain || before.items !== loads(hRepo, test, global).items) {
            expect(chosen.has(test), `${test} must run`).toBe(true);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });
});
