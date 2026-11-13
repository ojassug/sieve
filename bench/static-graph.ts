#!/usr/bin/env node
// Static graph build time and map size against T6 (10,000-file TS repo: < 30 s cold), plus the
// plan's time from that map. Correctness lives in the test suite; this only measures.
//
//   node bench/static-graph.ts                synthetic 10,000-file TS monorepo (git fast-import)
//   node bench/static-graph.ts <repo> [rev]   an existing repository at rev (default HEAD)
//
// "CLI cold" is `sieve graph --out` in a fresh Node process, which is what CI runs; the stage
// timings come from one more in-process build. Prints canonical JSON; record results under
// bench/results/.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildStaticMap,
  canonicalJson,
  canonicalJsonPretty,
  GitVfs,
  isLexed,
  lsTree,
  mapGraph,
  parseMap,
  readBlobs,
  readObjectFormat,
  selectStatic,
  TreeIndex,
} from '@sieve-ci/core';

import { DEFAULT_GLOBAL } from '../packages/cli/src/config.ts';

const CLI = join(import.meta.dirname, '..', 'packages', 'cli', 'src', 'main.ts');
const repoArg = process.argv[2];
const revArg = process.argv[3] ?? 'HEAD';

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, ...(input === undefined ? {} : { input }) }).trim();
}

/** About 4 KB of ordinary TypeScript around the imports: comments, strings, templates, regexes. */
function body(seed: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 12; i++) {
    parts.push(
      `/** Helper ${i} of module ${seed}: formats a value for display. */`,
      `export function helper${i}(value: string, limit = ${i + 1}): string {`,
      `  const pattern = /^[a-z]+\\/(\\d+)$/i; // not an import: 'import x from "y"'`,
      `  const label = \`item \${value.slice(0, limit)} of ${seed}\`;`,
      `  return pattern.test(value) ? label : value.replace(/\\s+/g, ' ') + "${i}";`,
      '}',
    );
  }
  return `${parts.join('\n')}\n`;
}

/**
 * 20 workspace packages × 25 modules: 19 source files and 1 test file per module, 10,000 files in
 * all, plus manifests, a tsconfig and an npm lockfile. Each source file imports three siblings
 * (extensionless, so every import probes), one file in another module, another workspace package
 * and lodash; each test imports its module's first file. A second commit changes one file.
 */
function syntheticRepo(): { dir: string; base: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sieve-bench-graph-'));
  git(dir, ['init', '-q', '-b', 'main']);
  const files = new Map<string, string>();
  files.set('package.json', JSON.stringify({ name: 'bench', private: true, workspaces: ['packages/*'] }));
  files.set('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, module: 'nodenext' } }));
  const lock: Record<string, unknown> = { '': { name: 'bench' }, 'node_modules/lodash': { version: '4.17.21', integrity: 'sha512-lodash' } };
  for (let p = 0; p < 20; p++) {
    files.set(`packages/p${p}/package.json`, JSON.stringify({ name: `@bench/p${p}`, main: 'src/m0/f0.ts' }));
    lock[`node_modules/@bench/p${p}`] = { resolved: `packages/p${p}`, link: true };
    for (let m = 0; m < 25; m++) {
      for (let f = 0; f < 19; f++) {
        const imports = [
          `import { helper0 as a } from './f${(f + 1) % 19}';`,
          `import { helper1 as b } from './f${(f + 7) % 19}';`,
          `import { helper2 as c } from './f${(f + 13) % 19}';`,
          `import { helper3 as d } from '../m${(m + 1) % 25}/f${f}';`,
          `import { helper4 as e } from '@bench/p${(p + 1) % 20}';`,
          "import _ from 'lodash';",
          "import type { Options } from './types';",
        ];
        files.set(`packages/p${p}/src/m${m}/f${f}.ts`, `${imports.join('\n')}\n${body(p * 1000 + m * 19 + f)}`);
      }
      files.set(`packages/p${p}/test/m${m}.test.ts`, `import { helper0 } from '../src/m${m}/f0';\n${body(m)}`);
    }
  }
  files.set('package-lock.json', JSON.stringify({ name: 'bench', lockfileVersion: 3, packages: lock }));

  const lines: string[] = [];
  let mark = 0;
  const marks = new Map<string, number>();
  for (const [path, content] of files) {
    marks.set(path, ++mark);
    lines.push('blob', `mark :${mark}`, `data ${Buffer.byteLength(content)}`, content);
  }
  const commit = (ref: string, from: number | null, changes: string[]) => {
    lines.push(`commit ${ref}`, `mark :${++mark}`, 'committer B <b@example.com> 1763251200 +0000', 'data 1', 'c', ...(from === null ? [] : [`from :${from}`]), ...changes);
    return mark;
  };
  const base = commit('refs/heads/main', null, [...marks].map(([path, m]) => `M 100644 :${m} ${path}`));
  const changed = `${files.get('packages/p3/src/m4/f5.ts')!}\nexport const changed = 1;\n`;
  lines.push('blob', `mark :${++mark}`, `data ${Buffer.byteLength(changed)}`, changed);
  commit('refs/heads/one', base, [`M 100644 :${mark} packages/p3/src/m4/f5.ts`]);
  git(dir, ['fast-import', '--quiet'], `${lines.join('\n')}\n`);
  return { dir, base: 'main', head: 'one' };
}

const round = (ms: number) => Math.round(ms);
async function time<T>(run: () => Promise<T> | T): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await run();
  return { ms: round(performance.now() - start), result };
}

const synthetic = repoArg === undefined ? syntheticRepo() : null;
const dir = repoArg ?? synthetic!.dir;
const rev = synthetic === null ? revArg : synthetic.base;
const out = mkdtempSync(join(tmpdir(), 'sieve-bench-map-'));

try {
  // 1. The CLI, cold, in a fresh process: what CI pays.
  const cli = await time(() => spawnSync(process.execPath, [CLI, 'graph', '--rev', rev, '--out', join(out, 'map.json')], { cwd: dir, encoding: 'utf8' }));
  if (cli.result.status !== 0) {
    throw new Error(`sieve graph failed: ${cli.result.stderr}`);
  }
  const mapBytes = statSync(join(out, 'map.json')).size;

  // 2. The same build in stages, in this process.
  const objectFormat = await readObjectFormat(dir);
  const listing = await time(() => lsTree(dir, rev));
  const index = TreeIndex.build(listing.result);
  const vfs = await time(() => GitVfs.load(dir, index));
  const files = vfs.result.files();
  const lexed = files.filter(isLexed);
  const blobs = await time(() => readBlobs(dir, lexed.map((path) => vfs.result.oid(path)!)));
  const sources = new Map(lexed.map((path) => [path, blobs.result.get(vfs.result.oid(path)!)!]));
  const sourceBytes = [...sources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  const map = parseMap(readFileSync(join(out, 'map.json'), 'utf8'));
  const tests = [...map.tests];
  const build = await time(() => buildStaticMap({ objectFormat, index, vfs: vfs.result, sources, tests, global: DEFAULT_GLOBAL }));
  const serialize = await time(() => canonicalJson(build.result));
  const edges = Object.values(map.edges).reduce((sum, edgesOut) => sum + Object.keys(edgesOut).length, 0);

  // 3. The plan from that map: read, validate, build the CSR graph, diff and select.
  let plan: Record<string, number> | null = null;
  const headRev = synthetic?.head ?? null;
  if (headRev !== null) {
    const parse = await time(() => parseMap(serialize.result));
    const graph = await time(() => mapGraph(parse.result));
    const head = TreeIndex.build(await lsTree(dir, headRev));
    const headVfs = await GitVfs.load(dir, head);
    const select = await time(() => selectStatic(parse.result, { objectFormat, index: head, vfs: headVfs, tests, config: null }, {}));
    plan = { parseMs: parse.ms, graphMs: graph.ms, selectMs: select.ms, affected: select.result.affected.length, graphNodes: graph.result.nodeCount };
  }

  const report = {
    benchmark: 'static-graph',
    repo: synthetic === null ? `${repoArg!} @ ${rev}` : 'synthetic: 20 packages x 25 modules x (19 sources + 1 test)',
    files: files.length,
    lexedFiles: lexed.length,
    sourceMB: Math.round((sourceBytes / 1e6) * 10) / 10,
    tests: tests.length,
    nodes: Object.keys(map.nodes).length,
    edges,
    uncertainFiles: Object.keys(map.uncertain).length,
    mapBytes,
    cliColdMs: cli.ms,
    stagesMs: { lsTree: listing.ms, gitVfsLoad: vfs.ms, readBlobs: blobs.ms, buildStaticMap: build.ms, serialize: serialize.ms },
    plan,
    environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown', git: git(dir, ['--version']) },
  };
  process.stdout.write(canonicalJsonPretty(report));
} finally {
  rmSync(out, { recursive: true, force: true });
  if (synthetic !== null) {
    rmSync(synthetic.dir, { recursive: true, force: true });
  }
}
