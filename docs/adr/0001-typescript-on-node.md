# ADR-0001: TypeScript on Node end to end

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §2, [ADR-0002](0002-zero-dependency-cli.md)

## Context
SIEVE is built by one developer over 6 months at about 25 commits/week. TokenDamper (TypeScript, zero runtime dependencies) supplies reusable parts: state-machine lexers, multi-source BFS, a knapsack DP, decay ledgers, HTML reporting and a corpus benchmark harness.

The hot paths are:
- listing and hashing in the CLI (git already computes blob OIDs; SIEVE hashes the rest with SHA-256);
- reverse BFS over CSR graphs;
- coverage post-processing;
- streaming XML parsing at ingest (target ≥10k results/s).

The same selector must run in two places: in the CLI (Lite mode, `sieve verify`) and in the server.

## Decision
- TypeScript on Node for the CLI, runner plugins, server, workers and UI build.
- CLI engines `^20.19.0 || ^22.13.0 || >=24` (the same as TokenDamper). The server image uses Node 24 LTS.
- CPU-heavy selection runs in `worker_threads` over typed-array CSR graphs.
- A WASM module is allowed only for a hot path that profiling shows misses its target, and only with a pure-TypeScript fallback.

## Alternatives considered
- **Go server + TypeScript CLI:** rejected. Two toolchains, and the selector would be written twice.
- **Rust core via napi:** rejected. Per-platform native prebuilds break the zero-dependency CLI and add a cross-compile matrix.
- **Bun or Deno:** rejected. Not preinstalled on CI runners, and runner plugins must live in the npm ecosystem.

## Consequences
- One language and one test stack (Vitest), and one selector module shared by CLI and server.
- Performance has to be measured (targets T2 and T6 in [TARGETS.md](../../bench/TARGETS.md)), not assumed.
- The learning stretch comes from databases, queues, tenancy, streaming and UI rather than from a new language.
