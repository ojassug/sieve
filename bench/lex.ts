#!/usr/bin/env node
// Lexer throughput, plus a real-world precision check: how many files the lexer marks uncertain.
//
//   node bench/lex.ts [dir ...]     default: node_modules (already installed, nothing downloaded)
//
// Prints canonical JSON. Record results under bench/results/.
import { readdirSync, readFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { extname, join, relative } from 'node:path';

import { canonicalJsonPretty, dialectOf, lexImports } from '@trommel/core';

const RUNS = 5;
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const roots = process.argv.length > 2 ? process.argv.slice(2) : ['node_modules'];

const files: { path: string; source: string; bytes: number }[] = [];
for (const root of roots) {
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    // Skip the workspace links: they point back at this repository, including deliberately broken fixtures.
    if (entry.isFile() && EXTENSIONS.has(extname(entry.name)) && !entry.parentPath.includes('@trommel-ci')) {
      const path = join(entry.parentPath, entry.name);
      const source = readFileSync(path, 'utf8');
      files.push({ path, source, bytes: Buffer.byteLength(source) });
    }
  }
}
files.sort((a, b) => (a.path < b.path ? -1 : 1));
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

const seconds: number[] = [];
let imports = 0;
for (let run = 0; run < RUNS; run++) {
  imports = 0;
  const start = performance.now();
  for (const file of files) {
    imports += lexImports(file.source, dialectOf(file.path)).imports.length;
  }
  seconds.push((performance.now() - start) / 1000);
}
seconds.sort((a, b) => a - b);
const median = seconds[Math.floor(RUNS / 2)]!;

const byCode: Record<string, number> = {};
const uncertain: { path: string; diagnostics: string }[] = [];
let nonLiteral = 0;
for (const file of files) {
  const result = lexImports(file.source, dialectOf(file.path));
  nonLiteral += result.imports.filter((record) => record.specifier === null && record.kind !== 'glob').length;
  if (result.uncertain) {
    uncertain.push({ path: relative('.', file.path).split('\\').join('/'), diagnostics: result.diagnostics.map((d) => `${d.code}@${d.line}`).join(' ') });
    for (const d of result.diagnostics) {
      byCode[d.code] = (byCode[d.code] ?? 0) + 1;
    }
  }
}

process.stdout.write(
  canonicalJsonPretty({
    benchmark: 'lex',
    roots,
    files: files.length,
    megabytes: Math.round((totalBytes / 1e6) * 100) / 100,
    runs: RUNS,
    medianSeconds: Math.round(median * 1000) / 1000,
    megabytesPerSecond: Math.round(totalBytes / 1e6 / median),
    imports,
    nonLiteralImports: nonLiteral,
    uncertainFiles: uncertain.length,
    uncertainShare: Math.round((uncertain.length / Math.max(files.length, 1)) * 10_000) / 100,
    diagnosticsByCode: byCode,
    uncertainSample: uncertain.slice(0, 25),
    environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown' },
  }),
);
