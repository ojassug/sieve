import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/canonical-json.ts';
import { DECLARED, STATIC } from '../../src/graph/graph.ts';
import { buildStaticMap, isLexed, isModule, listingHash, type SieveMap, type StaticInput } from '../../src/graph/static.ts';
import { fakeRepo, type FakeRepo } from './fake-repo.ts';

const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'app' },
    'node_modules/lodash': { version: '4.17.21', integrity: 'sha512-L', dependencies: { dep: '^1', gone: '^1' } },
    'node_modules/dep': { version: '1.0.0', integrity: 'sha512-D' },
  },
});

function build(repo: FakeRepo, options: Partial<StaticInput> = {}): SieveMap {
  const tests = repo.vfs.files().filter((path) => /\.test\.[jt]s$/.test(path));
  return buildStaticMap({ objectFormat: 'sha1', index: repo.index, vfs: repo.vfs, sources: repo.sources, tests, ...options });
}

const edgesFrom = (map: SieveMap, from: string) => map.edges[from] ?? {};

describe('module files', () => {
  it.each([
    ['src/a.ts', true, true],
    ['src/a.tsx', true, true],
    ['src/a.mts', true, true],
    ['src/a.cjs', true, true],
    ['src/a.jsx', true, true],
    ['src/a.d.ts', true, false],
    ['src/a.d.mts', true, false],
    ['src/styles.d.css.ts', true, false],
    ['src/a.json', false, false],
    ['src/a.md', false, false],
  ])('%s: module %s, lexed %s', (path, module, lexed) => {
    expect(isModule(path)).toBe(module);
    expect(isLexed(path)).toBe(lexed);
  });
});

describe('buildStaticMap', () => {
  const repo = fakeRepo({
    'package.json': '{"name":"app"}',
    'package-lock.json': LOCK,
    'tsconfig.json': '{}',
    'src/a.ts': "import { b } from './b';\nimport type { T } from './types';\nimport { type U } from './types2';\nimport _ from 'lodash';\n",
    'src/b.ts': 'export const b = 1;\n',
    'src/types.ts': 'export type T = 1;\n',
    'src/types2.ts': 'export type U = 1;\n',
    'src/decl.d.ts': "import './never-lexed';\n",
    'test/a.test.ts': "import { a } from '../src/a';\n",
    'docs/guide.md': '# guide\n',
  });
  const map = build(repo, { global: ['package.json', '.env*'] });

  it('describes the snapshot', () => {
    expect(map.version).toBe(1);
    expect(map.objectFormat).toBe('sha1');
    expect(map.rootTree).toBe(repo.index.rootOid);
    expect(map.lockfile).toEqual({ kind: 'npm', path: 'package-lock.json' });
    expect(map.tests).toEqual(['test/a.test.ts']);
    expect(map.snapshot.map(([, , path]) => path)).toContain('src');
    expect(map.uncertain).toEqual({});
  });

  it('hashes files by blob id, absent paths as null', () => {
    expect(map.nodes['f:src/b.ts']).toBe(repo.vfs.oid('src/b.ts'));
    expect(map.nodes['f:src/b.js']).toBeNull();
    expect(map.nodes['d:src/b']).toBeNull();
  });

  it('adds every module file as a node, even one nothing imports, and never non-module files', () => {
    expect(map.nodes['f:src/types.ts']).toBe(repo.vfs.oid('src/types.ts'));
    expect(map.nodes['f:src/decl.d.ts']).toBe(repo.vfs.oid('src/decl.d.ts'));
    expect('f:docs/guide.md' in map.nodes).toBe(false);
  });

  it('records every resolution as STATIC edges: targets, absent probes and directories', () => {
    const a = edgesFrom(map, 'f:src/a.ts');
    expect(a['f:src/b.ts']).toBe(STATIC);
    expect(a['f:src/b.js']).toBe(STATIC);
    expect(a['d:src/b']).toBe(STATIC);
    expect(edgesFrom(map, 'f:test/a.test.ts')['f:src/a.ts']).toBe(STATIC);
  });

  it('skips statement-level type imports but keeps inline ones, which still evaluate the module', () => {
    const a = edgesFrom(map, 'f:src/a.ts');
    expect(a['f:src/types.ts']).toBeUndefined();
    expect(a['f:src/types2.ts']).toBe(STATIC);
  });

  it('never lexes declaration files', () => {
    expect(map.edges['f:src/decl.d.ts']).toBeUndefined();
  });

  it("gives every source file edges to its own configs and the misses above them", () => {
    const a = edgesFrom(map, 'f:src/a.ts');
    expect(a['f:tsconfig.json']).toBe(STATIC);
    expect(a['f:package.json']).toBe(STATIC);
    expect(a['f:src/package.json']).toBe(STATIC);
    expect(a['f:src/tsconfig.json']).toBe(STATIC);
  });

  it('maps a bare import to its lockfile location and packages to their dependencies', () => {
    expect(edgesFrom(map, 'f:src/a.ts')['p:npm:node_modules/lodash']).toBe(STATIC);
    expect(map.nodes['p:npm:node_modules/lodash']).toBe('sha512-L');
    expect(edgesFrom(map, 'p:npm:node_modules/lodash')).toEqual({ 'p:npm:node_modules/dep': STATIC, 'p:npm:node_modules/gone': STATIC });
    expect(map.nodes['p:npm:node_modules/gone']).toBeNull();
  });

  it('makes each test depend on the global inputs, as DECLARED edges', () => {
    const test = edgesFrom(map, 'f:test/a.test.ts');
    expect(test['g:inputs.global']).toBe(DECLARED);
    expect(edgesFrom(map, 'g:inputs.global')).toEqual({ 'f:package.json': DECLARED });
    expect(map.globs['g:inputs.global']).toEqual(['package.json', '.env*']);
  });

  it('holds nothing about the machine that built it: every node is a file, listing, glob or package', () => {
    expect(Object.keys(map.nodes).filter((key) => !/^[fdgp]:/.test(key))).toEqual([]);
  });

  it('hashes a directory listing by names and kinds, not contents', () => {
    const edited = fakeRepo({ 'src/a.ts': 'changed', 'src/b.ts': '' });
    const same = fakeRepo({ 'src/a.ts': 'original', 'src/b.ts': '' });
    const symlinked = fakeRepo({ 'src/a.ts': { mode: '120000', content: 'b.ts' }, 'src/b.ts': '' });
    expect(listingHash(edited.index, 'src')).toBe(listingHash(same.index, 'src'));
    expect(listingHash(symlinked.index, 'src')).not.toBe(listingHash(same.index, 'src'));
    expect(listingHash(same.index, 'missing')).toBeNull();
    expect(listingHash(same.index, 'src/a.ts')).toBeNull();
  });
});

describe('uncertainty', () => {
  it('turns lexer diagnostics, unresolved imports and packages missing from the lockfile into a u: node', () => {
    const repo = fakeRepo({
      'package-lock.json': LOCK,
      'src/a.ts': "import './missing';\nconst m = await import(name);\nimport 'left-pad';\nimport 'https://x.example/m.js';\n",
      'src/b.ts': "const s = 'unterminated\n",
      'src/c.ts': "import './a';\n",
    });
    const map = build(repo);
    expect(map.uncertain['u:src/a.ts']).toEqual([
      'line 1: ./missing is unresolved (not found)',
      'line 2: a dynamic import with a non-literal specifier is unresolved (non-literal)',
      'line 3: left-pad is not in package-lock.json',
      'line 4: https://x.example/m.js is unresolved (remote module)',
    ]);
    expect(map.uncertain['u:src/b.ts']).toEqual(['line 1: lexer unterminated-string']);
    expect(map.uncertain['u:src/c.ts']).toBeUndefined();
    expect(edgesFrom(map, 'f:src/a.ts')['u:src/a.ts']).toBe(STATIC);
    expect(edgesFrom(map, 'f:src/a.ts')['p:npm:node_modules/left-pad']).toBe(STATIC);
    expect(map.nodes['p:npm:node_modules/left-pad']).toBeNull();
    expect(map.nodes['u:src/a.ts']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks every external import uncertain when there is no lockfile', () => {
    const map = build(fakeRepo({ 'src/a.ts': "import 'lodash';\n" }));
    expect(map.lockfile).toEqual({ kind: 'none' });
    expect(map.uncertain['u:src/a.ts']).toEqual(['line 1: lodash: there is no lockfile']);
  });

  it('makes external imports depend on a lockfile it cannot parse', () => {
    const map = build(fakeRepo({ 'pnpm-lock.yaml': 'lockfileVersion: 9\n', 'src/a.ts': "import 'lodash';\n" }));
    expect(map.lockfile).toEqual({ kind: 'unparseable', paths: ['pnpm-lock.yaml'], reason: 'pnpm lockfiles are not parsed yet' });
    expect(edgesFrom(map, 'f:src/a.ts')['f:pnpm-lock.yaml']).toBe(STATIC);
    expect(map.uncertain).toEqual({});
  });

  it('reports every lockfile when there is more than one', () => {
    const map = build(fakeRepo({ 'package-lock.json': LOCK, 'yarn.lock': '', 'src/a.ts': "import 'lodash';\n" }));
    expect(map.lockfile).toMatchObject({ kind: 'unparseable', paths: ['package-lock.json', 'yarn.lock'] });
    expect(edgesFrom(map, 'f:src/a.ts')).toMatchObject({ 'f:package-lock.json': STATIC, 'f:yarn.lock': STATIC });
  });
});

describe('globs and declared inputs', () => {
  it('records import.meta.glob as a g: node with its patterns', () => {
    const map = build(fakeRepo({ 'src/r.ts': "import.meta.glob(['./pages/*.ts', '!./pages/_*.ts']);\n", 'src/pages/a.ts': '', 'src/pages/_b.ts': '' }));
    const key = 'g:glob:src/pages/*.ts|!src/pages/_*.ts';
    expect(edgesFrom(map, 'f:src/r.ts')[key]).toBe(STATIC);
    expect(edgesFrom(map, 'f:src/r.ts')['f:src/pages/a.ts']).toBe(STATIC);
    expect(map.globs[key]).toEqual(['src/pages/*.ts', '!src/pages/_*.ts']);
  });

  it('makes a bare import depend on the workspaces node', () => {
    const map = build(fakeRepo({ 'package.json': '{"name":"r","workspaces":["pkgs/*"]}', 'pkgs/p/package.json': '{"name":"p"}', 'pkgs/p/index.js': '', 'src/a.ts': "import 'p';\n" }));
    expect(edgesFrom(map, 'f:src/a.ts')['g:workspaces']).toBe(STATIC);
    expect(edgesFrom(map, 'f:src/a.ts')['f:pkgs/p/index.js']).toBe(STATIC);
    expect(edgesFrom(map, 'f:src/a.ts')['f:pkgs/p/package.json']).toBe(STATIC);
    expect('g:workspaces' in map.globs).toBe(false);
  });

  it('connects tests to declared match→affects rules', () => {
    const repo = fakeRepo({ 'fixtures/pay/a.json': '{}', 'test/pay/x.test.ts': '', 'test/other.test.ts': '' });
    const map = build(repo, { declared: [{ match: 'fixtures/pay/**', affects: 'test/pay/**' }] });
    expect(edgesFrom(map, 'f:test/pay/x.test.ts')['g:declared:fixtures/pay/**']).toBe(DECLARED);
    expect(edgesFrom(map, 'f:test/other.test.ts')['g:declared:fixtures/pay/**']).toBeUndefined();
    expect(edgesFrom(map, 'g:declared:fixtures/pay/**')).toEqual({ 'f:fixtures/pay/a.json': DECLARED });
  });
});

describe('determinism', () => {
  it('gives identical bytes whatever order the sources arrive in', () => {
    const files = { 'src/a.ts': "import './b';\nimport './c';\n", 'src/b.ts': "import './c';\n", 'src/c.ts': '', 'a.test.ts': "import './src/a';\n" };
    const repo = fakeRepo(files);
    const reversed = { ...repo, sources: new Map([...repo.sources].reverse()) };
    expect(canonicalJson(build(reversed))).toBe(canonicalJson(build(repo)));
  });

  it('refuses to build without the bytes of a lexed file', () => {
    const repo = fakeRepo({ 'src/a.ts': '' });
    expect(() => build({ ...repo, sources: new Map() })).toThrow(/src\/a\.ts/);
  });
});
