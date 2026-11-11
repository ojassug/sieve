#!/usr/bin/env node
// Graph build and reverse-BFS timing at architecture §3.3 scale (100k nodes, 1M edges).
//   node bench/graph.ts [nodes] [edgesPerNode]
import { cpus, platform, release } from 'node:os';

import { canonicalJsonPretty, GraphBuilder, reverseReach, STATIC } from '@sieve-ci/core';

const nodes = Number(process.argv[2] ?? 100_000);
const perNode = Number(process.argv[3] ?? 10);
// Deterministic pseudo-random edges (xorshift), mostly pointing "down" like an import DAG.
let state = 0x9e3779b9;
const next = (): number => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
};
const name = (i: number) => `src/m${String(i).padStart(6, '0')}.ts`;

let start = performance.now();
const builder = new GraphBuilder();
for (let i = 0; i < nodes; i++) {
  for (let e = 0; e < perNode; e++) {
    builder.addEdge(name(i), name(Math.floor(next() * nodes)), STATIC);
  }
}
const graph = builder.build();
const buildMs = performance.now() - start;

const timings: { changed: number; reached: number; ms: number }[] = [];
for (const changed of [1, 10, 100]) {
  const seeds = Array.from({ length: changed }, () => Math.floor(next() * nodes));
  const samples: number[] = [];
  let reached = 0;
  for (let run = 0; run < 7; run++) {
    start = performance.now();
    reached = reverseReach(graph, seeds).order.length;
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  timings.push({ changed, reached, ms: Math.round(samples[3]! * 10) / 10 });
}
process.stdout.write(
  canonicalJsonPretty({
    benchmark: 'graph',
    nodes: graph.nodeCount,
    edges: graph.edgeCount,
    buildMs: Math.round(buildMs),
    reverseReachMedian: timings,
    environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown' },
  }),
);
