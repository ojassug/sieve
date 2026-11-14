# Benchmarks

- **Targets.** Pre-registered targets are in [TARGETS.md](TARGETS.md). Corpus selection is in [CORPUS.md](CORPUS.md).
- **Separate runs.** Timing scripts run apart from the test suite, so correctness tests never depend on how fast a machine is.
- **Recording.** Each script prints canonical JSON, and results are committed under [results/](results/) with the date and platform in the file name.

## Snapshot path: `node bench/ls-tree.ts [repo]`

This times what `trommel plan` does before any graph work:
- list the head tree with `git ls-tree -r -t -z`;
- parse the listing as a stream;
- index it by directory;
- run the Merkle descent against a base snapshot.

Without an argument, the script builds a synthetic repository with `git fast-import`: 20 packages × 25 modules × 20 files, which is 10,000 files in 541 trees. It then adds two commits on top, one changing 1 file and one changing 100 files.

| Date | Platform | Files | `git ls-tree` alone | `lsTree` (spawn + parse) | Index | Diff, 1 file | Diff, 100 files |
|---|---|---|---|---|---|---|---|
| 2026-11-11 | Windows 11, Ryzen AI 7 350, Node 26.4, git 2.55 | 10,000 | 31.5 ms | 57.6 ms | 3.0 ms | 0.0 ms | 0.4 ms |

All times are medians of 15 runs; the raw output is in [results/2026-11-11-ls-tree-win32.json](results/2026-11-11-ls-tree-win32.json).
- Architecture §3.1 expected about 100 ms for the CLI's listing at 10,000 files.
- `lsTree` also runs `git rev-parse` for the root tree id and parses the stream. Together those add about 26 ms over `git ls-tree` alone.

## Import lexer: `node bench/lex.ts [dir …]`

This times `lexImports` over every `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` and `.tsx` file under the given directories. The default is `node_modules`, which is already installed, so nothing is downloaded. Our own workspace links are skipped.

The script also counts the files the lexer marks **uncertain**. Every uncertain file costs precision, because its owning package escalates to L1. Real third-party code is a check that the uncertainty is not spurious.

| Date | Platform | Files | MB | Throughput | Imports found | Non-literal | Uncertain files |
|---|---|---|---|---|---|---|---|
| 2026-11-11 | Windows 11, Ryzen AI 7 350, Node 26.4 | 2,699 | 43.7 | 32–34 MB/s | 6,862 | 60 | 0 |

The raw output is in [results/2026-11-11-lex-win32.json](results/2026-11-11-lex-win32.json).
- The first run flagged 2 files in Vite and Vitest `.d.ts` output. Both contain method signatures named `import`, such as `import<T>(id: string): Promise<T>`. The fix and its fixture are `signatures.d.ts`.

## Graph: `node bench/graph.ts [nodes] [edgesPerNode]`

This builds a graph of deterministic pseudo-random edges, then times the multi-source reverse BFS (median of 7 runs) for 1, 10 and 100 changed nodes. The default is 100,000 nodes with 10 edges each, the scale in architecture §3.3.

| Date | Platform | Nodes | Edges | Build | Reverse BFS (all 100,000 nodes reached) |
|---|---|---|---|---|---|
| 2026-11-11 | Windows 11, Ryzen AI 7 350, Node 26.4 | 100,000 | 999,950 | 1.6 s | 7.6–8.5 ms |

The raw output is in [results/2026-11-11-graph-win32.json](results/2026-11-11-graph-win32.json).
- A random graph reaches every node, so these timings are the worst case for the BFS.
- The build merges edges through a `Map` and sorts its keys. In M3 the build will be replaced by decoding the stored map.

## Static graph: `node bench/static-graph.ts [repo [rev]]`

This times what `trommel graph` and `trommel plan` do, against T6 (a 10,000-file TypeScript repository in under 30 s cold).
- **CLI cold** is `trommel graph --out` in a fresh Node process: listing, blob reads, lexing, resolution, the map, serialization and the write. That is what CI pays.
- **Stages** come from one more build in the same process: `lsTree`, `GitVfs.load` (config blobs), `readBlobs` (every source), `buildStaticMap` (lexing, resolution and edges) and canonical JSON.
- **Plan** (synthetic repository only) times `parseMap`, the CSR build and `selectStatic` against a head commit that changes one file.

Without an argument, the script builds a synthetic npm-workspaces monorepo with `git fast-import`: 20 packages × 25 modules × (19 sources + 1 test), 10,000 module files of about 4 KB each.
- Each source file imports three siblings (extensionless, so every import probes), a file in the next module, the next workspace package and lodash, and has an `import type`.
- Its body mixes comments, strings, templates and regexes, as real code does.
- The imports chain every module and package together, so one change reaches all 500 tests: the worst case for the plan.

| Date | Repository | Files | Source MB | Nodes | Edges | Map | CLI cold | `buildStaticMap` | Plan: parse + select |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-12 | synthetic | 10,023 | 42.1 | 106,390 | 684,501 | 26.7 MB | **2.5 s** | 2.5 s | 0.2 s + 0.57 s |
| 2026-11-12 | Trommel at day 9 | 222 | 0.4 | 1,457 | 2,739 | 0.26 MB | 0.36 s | 0.06 s | — |
| 2026-11-12 | honojs/hono at `f6fbaf02` (4.13.18) | 585 | 3.0 | 3,288 | 13,543 | 0.64 MB | 0.44 s | 0.10 s | — |

All on Windows 11, Ryzen AI 7 350, Node 26.4 and git 2.55. The raw output is in [results/2026-11-12-static-graph-win32.json](results/2026-11-12-static-graph-win32.json), [results/2026-11-12-static-graph-trommel-win32.json](results/2026-11-12-static-graph-trommel-win32.json) and [results/2026-11-12-static-graph-hono-win32.json](results/2026-11-12-static-graph-hono-win32.json).
- **hono** was cloned with `--filter=blob:none`. At HEAD every blob is local. Building an older revision fetched its missing blobs one by one and took 18.7 s, which is network time, not Trommel's.
- **T6 is met:** 2.5 s cold against 30 s, and against the 10 s goal. Incremental builds (under 3 s) are not measured yet; extraction is not cached across runs.
- **Probe edges dominate,** as DECISIONS 17 expected: about 10 edges per extensionless import. They make the JSON map 26.7 MB at 10,000 files. SMAP v0 (still to do in M1) and per-directory probe groups are the levers.
- **The plan** takes about 0.8 s on this map: 0.2 s to parse the JSON, then 0.57 s to select, of which rebuilding the CSR arrays is 0.46 s (timed separately as `graphMs`). M3's target is a plan p95 under 1 s at 10,000 files; SMAP decoding replaces both the parse and the rebuild.
