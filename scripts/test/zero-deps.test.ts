import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkRepo, findViolations } from '../lib/zero-deps.ts';

describe('findViolations', () => {
  it('accepts a manifest without dependency fields', () => {
    expect(findViolations({ name: 'x' }, false)).toEqual([]);
  });

  it('accepts empty dependency objects', () => {
    expect(findViolations({ dependencies: {}, optionalDependencies: {} }, false)).toEqual([]);
  });

  it('rejects runtime dependencies and names them', () => {
    expect(findViolations({ dependencies: { left: '1.0.0', pad: '2.0.0' } }, false)).toEqual([
      'dependencies must be empty (found: left, pad)',
    ]);
  });

  it('rejects optional dependencies', () => {
    expect(findViolations({ optionalDependencies: { fsevents: '2.3.3' } }, true)).toEqual([
      'optionalDependencies must be empty (found: fsevents)',
    ]);
  });

  it.each([
    ['bundleDependencies', ['x']],
    ['bundledDependencies', true],
  ])('rejects %s', (field, value) => {
    expect(findViolations({ [field]: value }, false)).toEqual([`${field} must be absent or empty`]);
  });

  it('accepts an empty bundleDependencies list', () => {
    expect(findViolations({ bundleDependencies: [] }, false)).toEqual([]);
  });

  it('allows peer dependencies only when the policy does', () => {
    const manifest = { peerDependencies: { vitest: '>=3' } };
    expect(findViolations(manifest, true)).toEqual([]);
    expect(findViolations(manifest, false)).toEqual(['peerDependencies are only allowed in runner plugins (found: vitest)']);
  });

  it('rejects a malformed dependency field', () => {
    expect(findViolations({ dependencies: 'lodash' }, false)).toEqual(['dependencies must be an object']);
  });
});

describe('checkRepo', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function repoWith(manifests: Record<string, object>): string {
    const root = mkdtempSync(join(tmpdir(), 'sieve-zero-deps-'));
    roots.push(root);
    for (const [dir, manifest] of Object.entries(manifests)) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'package.json'), JSON.stringify(manifest));
    }
    return root;
  }

  it('reports violations per package and a missing manifest', () => {
    const root = repoWith({
      'packages/core': { dependencies: { chalk: '5.0.0' } },
      'packages/cli': {},
      'packages/vitest': { peerDependencies: { vitest: '*' } },
    });
    expect(checkRepo(root)).toEqual([
      'packages/core: dependencies must be empty (found: chalk)',
      'packages/jest: package.json is missing',
    ]);
  });
});
