#!/usr/bin/env node
// Timing for the snapshot path of `trommel plan` (architecture §3.1, roadmap open item "measure
// git ls-tree at 10k files"). Correctness lives in the test suite; this only measures.
//
//   node bench/ls-tree.ts            synthetic 10,000-file repo built with git fast-import
//   node bench/ls-tree.ts <repo>     an existing repository (HEAD and HEAD~1)
//
// Prints canonical JSON. Record results under bench/results/.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJsonPretty, lsTree, merkleDiff, TreeIndex } from '@trommel/core';

const RUNS = 15;
const repoArg = process.argv[2];

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, ...(input === undefined ? {} : { input }) }).trim();
}

/** 20 packages × 25 modules × 20 files = 10,000 files, then two follow-up commits. */
function syntheticRepo(): { dir: string; base: string; oneFile: string; hundredFiles: string } {
  const dir = mkdtempSync(join(tmpdir(), 'trommel-bench-'));
  git(dir, ['init', '-q', '-b', 'main']);
  const paths: string[] = [];
  for (let p = 0; p < 20; p++) {
    for (let m = 0; m < 25; m++) {
      for (let f = 0; f < 20; f++) {
        paths.push(`packages/p${p}/src/m${m}/f${f}.ts`);
      }
    }
  }
  const lines: string[] = [];
  const blob = (mark: number, content: string) => lines.push('blob', `mark :${mark}`, `data ${Buffer.byteLength(content)}`, content);
  paths.forEach((path, i) => blob(i + 1, `export const v${i} = ${i};\n`));
  const commit = (ref: string, mark: number, from: number | null, changes: string[]) =>
    lines.push(`commit ${ref}`, `mark :${mark}`, 'committer B <b@example.com> 1763251200 +0000', 'data 1', 'c', ...(from === null ? [] : [`from :${from}`]), ...changes);
  commit('refs/heads/main', 20_001, null, paths.map((path, i) => `M 100644 :${i + 1} ${path}`));
  blob(20_002, 'export const changed = 1;\n');
  commit('refs/heads/one', 20_003, 20_001, [`M 100644 :20002 ${paths[4_321]!}`]);
  commit('refs/heads/hundred', 20_004, 20_001, paths.filter((_, i) => i % 100 === 7).map((path) => `M 100644 :20002 ${path}`));
  git(dir, ['fast-import', '--quiet'], `${lines.join('\n')}\n`);
  return { dir, base: 'main', oneFile: 'one', hundredFiles: 'hundred' };
}

async function time<T>(label: string, run: () => Promise<T> | T): Promise<{ label: string; minMs: number; medianMs: number; p90Ms: number; result: T }> {
  const samples: number[] = [];
  let result!: T;
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    result = await run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const round = (ms: number) => Math.round(ms * 10) / 10;
  return { label, minMs: round(samples[0]!), medianMs: round(samples[Math.floor(RUNS / 2)]!), p90Ms: round(samples[Math.floor(RUNS * 0.9)]!), result };
}

const synthetic = repoArg === undefined ? syntheticRepo() : null;
const dir = repoArg ?? synthetic!.dir;
const [base, oneFile, hundredFiles] = synthetic === null ? ['HEAD~1', 'HEAD', 'HEAD'] : [synthetic.base, synthetic.oneFile, synthetic.hundredFiles];

try {
  const rawLsTree = await time('git ls-tree -r -t -z (process only)', () => git(dir, ['ls-tree', '-r', '-t', '-z', '--full-tree', base]).length);
  const snapshot = await time('lsTree: spawn + streaming parse', () => lsTree(dir, base));
  const index = await time('TreeIndex.build', () => TreeIndex.build(snapshot.result));
  const headOne = TreeIndex.build(await lsTree(dir, oneFile));
  const headHundred = TreeIndex.build(await lsTree(dir, hundredFiles));
  const diffOne = await time('merkleDiff, 1 file changed', () => merkleDiff(index.result, headOne).files.length);
  const diffHundred = await time('merkleDiff, 100 files changed', () => merkleDiff(index.result, headHundred).files.length);

  const files = snapshot.result.entries.filter((entry) => entry.type !== 'tree').length;
  const trees = snapshot.result.entries.length - files;
  const report = {
    benchmark: 'ls-tree',
    repo: synthetic === null ? repoArg : 'synthetic: 20 packages x 25 modules x 20 files',
    files,
    trees,
    runs: RUNS,
    environment: { node: process.version, git: git(dir, ['--version']), os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown' },
    timings: [rawLsTree, snapshot, index, diffOne, diffHundred].map(({ label, minMs, medianMs, p90Ms }) => ({ label, minMs, medianMs, p90Ms })),
    changedFiles: { oneFile: diffOne.result, hundredFiles: diffHundred.result },
  };
  process.stdout.write(canonicalJsonPretty(report));
} finally {
  if (synthetic !== null) {
    rmSync(synthetic.dir, { recursive: true, force: true });
  }
}
