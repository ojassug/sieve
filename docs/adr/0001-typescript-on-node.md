# ADR-0001: TypeScript on Node end to end

- Status: Accepted (2026-11-11); corrected in place on 2026-11-14: the schedule figures are gone, and the decision is unchanged ([DECISIONS.md](../../DECISIONS.md) entry 31)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §2, [ADR-0002](0002-zero-dependency-cli.md)

## Context
Trommel is built by one developer. Several parts have to be JavaScript or TypeScript whatever else is chosen: the Vitest and Jest plugins run inside those runners, the CLI runs in Node-based CI jobs, and the UI runs in browsers.

The hot paths are:
- listing and hashing in the CLI (git already computes blob OIDs; Trommel hashes the rest with SHA-256);
- reverse BFS over CSR graphs;
- coverage post-processing;
- streaming XML parsing at ingest (target ≥10k results/s).

The same selector must run in two places: in the CLI (Lite mode, `trommel verify`) and in the server.

## Decision
- TypeScript on Node for the CLI, runner plugins, server, workers and UI build.
- CLI engines `>=22`, tested on Node 22, 24 and 26. Node 20 reached end of life on 2026-04-30, and Node 22 does on 2027-04-30, so the floor rises to 24 at launch ([release schedule](https://github.com/nodejs/Release)). The server image uses Node 26 LTS (supported until 2029-04-30).
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
