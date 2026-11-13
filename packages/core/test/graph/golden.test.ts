// The golden map (ADR-0009, DECISIONS 28). The static map of a snapshot is a function of the tree,
// the config and the engine only (ADR-0003), so this fixture's map has the same bytes on every
// machine. CI runs this file on Ubuntu and on Windows: that is the cross-OS check.
//
// A change to the pinned hash is reviewed like a snapshot. It comes with a new ENGINE id, or with a
// DECISIONS entry saying why maps from the older builder stay safe to plan from (DECISIONS 26).
// That is why the engine id and the hash are pinned side by side.
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/canonical-json.ts';
import { DECLARED, STATIC } from '../../src/graph/graph.ts';
import { parseMap } from '../../src/graph/map.ts';
import { buildStaticMap, ENGINE } from '../../src/graph/static.ts';
import { fakeRepo } from './fake-repo.ts';

const GOLDEN = {
  engine: 'sieve-static-2',
  sha256: '7ec52403a273beb096dd9715de49e55b826de8bb20f36fcaaec9361b015c7fb7',
} as const;

const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'golden', workspaces: ['packages/*'] },
    'node_modules/lodash': { version: '4.17.21', integrity: 'sha512-L', dependencies: { dep: '^1', gone: '^1' } },
    'node_modules/dep': { version: '1.0.0', integrity: 'sha512-D' },
    'node_modules/lib': { resolved: 'packages/lib', link: true },
    'packages/lib': { name: 'lib', version: '1.0.0' },
  },
});

// Every string is written with explicit escapes, so no editor or checkout setting can change a byte.
// The two non-ASCII names sort differently by UTF-16 code unit (the map's order) and by code point.
const FACE = '\u{1F600}';
const TILDE = '～';

const repo = fakeRepo({
  '.env.test': 'A=1\n',
  'package.json': '{"name":"golden","type":"module","workspaces":["packages/*"]}\n',
  'package-lock.json': LOCK,
  'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}\n',
  'vitest.config.ts': 'export default {};\n',
  'bin/run.js': { mode: '100755', content: '#!/usr/bin/env node\n' },
  'fixtures/payments/one.json': '{"amount":1}\n',
  'packages/lib/package.json': '{"name":"lib","main":"index.js"}\n',
  'packages/lib/index.js': 'module.exports = 1;\n',
  'src/a.ts': "import { b } from './b';\nimport _ from 'lodash';\nimport { util } from '@/util';\nimport type { T } from './types';\nimport lib from 'lib';\n",
  'src/b.ts': 'export const b = 1;\n',
  'src/util.ts': 'export const util = 1;\n',
  'src/types.d.ts': 'export type T = 1;\n',
  'src/pages.ts': "export const pages = import.meta.glob('./pages/*.ts');\n",
  'src/pages/home.ts': 'export default 1;\n',
  'src/assets.ts': "export const data = new URL('./data/', import.meta.url);\n",
  'src/data/x.json': '1\n',
  'src/dynamic.ts': 'export const load = (name: string) => import(name);\n',
  'src/absent.ts': "import 'not-installed';\n",
  'src/link.ts': { mode: '120000', content: 'b.ts' },
  [`src/${FACE}.ts`]: `import './${TILDE}';\n`,
  [`src/${TILDE}.ts`]: 'export {};\n',
  'test/a.test.ts': "import '../src/a';\n",
  'test/pages.test.ts': "import '../src/pages';\nimport '../src/assets';\n",
  'test/payments.test.ts': "import '../src/dynamic';\nimport '../src/absent';\n",
  'test/unicode.test.ts': `import '../src/${FACE}';\nimport '../src/link';\n`,
});

const map = buildStaticMap({
  objectFormat: 'sha1',
  index: repo.index,
  vfs: repo.vfs,
  sources: repo.sources,
  tests: repo.vfs.files().filter((path) => path.endsWith('.test.ts')),
  global: ['package.json', '.env*', '**/vitest.config.*'],
  declared: [{ match: 'fixtures/payments/**', affects: 'test/payments.test.ts' }],
  config: '5c0ffee5c0ffee5c0ffee5c0ffee5c0ffee5c0ff',
});
const text = canonicalJson(map);

describe('the golden map', () => {
  it('holds only the node kinds that a tree, a config and an engine can give', () => {
    const kinds: Record<string, number> = {};
    for (const key of Object.keys(map.nodes)) {
      const kind = key.slice(0, key.indexOf(':'));
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    expect(kinds).toEqual({ d: 18, f: 183, g: 5, p: 6, u: 2 });
  });

  it('covers an uncertain file, absent paths and both provenances, so the hash pins each', () => {
    expect(Object.keys(map.uncertain)).toEqual(['u:src/absent.ts', 'u:src/dynamic.ts']);
    expect(map.nodes['f:src/b.js']).toBeNull();
    expect(map.nodes['p:npm:node_modules/gone']).toBeNull();
    const provenances = new Set(Object.values(map.edges).flatMap((out) => Object.values(out)));
    expect([...provenances].sort()).toEqual([STATIC, DECLARED]);
  });

  it('has the pinned bytes, whatever machine built it', () => {
    expect({ engine: ENGINE, sha256: createHash('sha256').update(text).digest('hex') }).toEqual(GOLDEN);
  });

  it('reads back to the same bytes', () => {
    expect(canonicalJson(parseMap(text))).toBe(text);
  });
});
