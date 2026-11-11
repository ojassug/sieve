import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { detectLockfile, diffLockfiles, parseNpmLockfile, type NpmLockfile } from '../../src/lockfile/npm.ts';

const V3 = JSON.stringify({
  name: 'root',
  lockfileVersion: 3,
  packages: {
    '': { name: 'root', workspaces: ['packages/*'], dependencies: { lodash: '^4' } },
    'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', integrity: 'sha512-AAA' },
    'node_modules/a': { version: '1.0.0', integrity: 'sha512-BBB', dependencies: { b: '^2', shared: '^1' }, peerDependencies: { react: '*' } },
    'node_modules/a/node_modules/b': { version: '2.0.0', integrity: 'sha512-CCC' },
    'node_modules/b': { version: '1.0.0', integrity: 'sha512-DDD' },
    'node_modules/shared': { version: '1.2.0', integrity: 'sha512-EEE', dev: true },
    'node_modules/@acme/core': { resolved: 'packages/core', link: true },
    'packages/core': { name: '@acme/core', version: '0.0.0', dependencies: { b: '^3' } },
    'packages/core/node_modules/b': { version: '3.0.0', integrity: 'sha512-FFF' },
    'node_modules/gitdep': { version: '0.1.0', resolved: 'git+ssh://git@github.com/x/y.git#abc' },
  },
});

const parse = (text: string): NpmLockfile => {
  const result = parseNpmLockfile(text);
  if (result.kind !== 'npm') {
    throw new Error(`expected npm, got ${result.kind}`);
  }
  return result;
};

describe('parseNpmLockfile', () => {
  it('turns every installed package into a p:npm node keyed by install location', () => {
    const lock = parse(V3);
    expect([...lock.packages.keys()]).toEqual([
      'node_modules/@acme/core',
      'node_modules/a',
      'node_modules/a/node_modules/b',
      'node_modules/b',
      'node_modules/gitdep',
      'node_modules/lodash',
      'node_modules/shared',
      'packages/core/node_modules/b',
    ]);
    expect(lock.packages.get('node_modules/lodash')).toEqual({ location: 'node_modules/lodash', name: 'lodash', hash: 'sha512-AAA' });
    expect(lock.packages.get('node_modules/@acme/core')).toEqual({ location: 'node_modules/@acme/core', name: '@acme/core', hash: 'link:packages/core', link: 'packages/core' });
    expect(lock.packages.get('node_modules/gitdep')!.hash).toBe('0.1.0|git+ssh://git@github.com/x/y.git#abc');
  });

  it('reads the packages map of a v2 lockfile too', () => {
    const v2 = JSON.stringify({ lockfileVersion: 2, packages: { '': {}, 'node_modules/x': { version: '1.0.0', integrity: 'sha512-X' } }, dependencies: {} });
    expect([...parse(v2).packages.keys()]).toEqual(['node_modules/x']);
  });

  it.each([
    ['a v1 lockfile', JSON.stringify({ lockfileVersion: 1, dependencies: {} }), 'lockfileVersion 1 has no packages map'],
    ['invalid JSON', '{ nope', 'invalid JSON'],
    ['a packages map that is not an object', JSON.stringify({ lockfileVersion: 3, packages: [] }), 'no packages map'],
  ])('reports %s as unparseable', (_name, text, reason) => {
    expect(parseNpmLockfile(text)).toEqual({ kind: 'unparseable', format: 'npm', reason });
  });
});

describe('NpmLockfile.locate', () => {
  it('finds the install location Node would load from, walking up from the importer', () => {
    const lock = parse(V3);
    expect(lock.locate('b', 'packages/core/src')).toBe('packages/core/node_modules/b');
    expect(lock.locate('b', 'packages/app/src')).toBe('node_modules/b');
    expect(lock.locate('@acme/core', 'packages/app/src')).toBe('node_modules/@acme/core');
    expect(lock.locate('missing', 'src')).toBeNull();
  });
});

describe('NpmLockfile.dependencies', () => {
  it('resolves a package dependencies, optional and peer dependencies from its own location', () => {
    const lock = parse(V3);
    expect(lock.dependencies('node_modules/a')).toEqual({ resolved: ['node_modules/a/node_modules/b', 'node_modules/shared'], missing: ['react'] });
    expect(lock.dependencies('node_modules/lodash')).toEqual({ resolved: [], missing: [] });
  });
});

describe('diffLockfiles', () => {
  it('lists the install locations that changed, appeared or disappeared', () => {
    const before = parse(V3);
    const changed = JSON.parse(V3) as { packages: Record<string, Record<string, unknown>> };
    changed.packages['node_modules/lodash']!['integrity'] = 'sha512-NEW';
    delete changed.packages['node_modules/shared'];
    changed.packages['node_modules/zod'] = { version: '4.0.0', integrity: 'sha512-ZZZ' };
    expect(diffLockfiles(before, parse(JSON.stringify(changed)))).toEqual({
      added: ['node_modules/zod'],
      changed: ['node_modules/lodash'],
      removed: ['node_modules/shared'],
    });
  });
});

describe('detectLockfile', () => {
  it.each([
    [['package-lock.json'], { kind: 'npm', path: 'package-lock.json' }],
    [['npm-shrinkwrap.json', 'package-lock.json'], { kind: 'npm', path: 'npm-shrinkwrap.json' }],
    [['pnpm-lock.yaml'], { kind: 'unparseable', format: 'pnpm', path: 'pnpm-lock.yaml', reason: 'pnpm lockfiles are not parsed yet' }],
    [['yarn.lock'], { kind: 'unparseable', format: 'yarn', path: 'yarn.lock', reason: 'yarn lockfiles are not parsed yet' }],
    [['bun.lock'], { kind: 'unparseable', format: 'bun', path: 'bun.lock', reason: 'bun lockfiles are not parsed yet' }],
    [['package-lock.json', 'yarn.lock'], { kind: 'unparseable', format: 'unknown', path: 'package-lock.json', reason: 'more than one lockfile: package-lock.json, yarn.lock' }],
    [[], { kind: 'none' }],
  ] as const)('%j', (files, expected) => {
    expect(detectLockfile(new Set(files))).toEqual(expected);
  });
});

describe('the repository’s own lockfile', () => {
  it('parses, with an integrity hash for every registry package', () => {
    const lock = parse(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'package-lock.json'), 'utf8'));
    expect(lock.packages.size).toBeGreaterThan(50);
    expect(lock.locate('vitest', '')).toBe('node_modules/vitest');
    const unhashed = [...lock.packages.values()].filter((p) => p.link === undefined && !p.hash.startsWith('sha'));
    expect(unhashed).toEqual([]);
  });
});
