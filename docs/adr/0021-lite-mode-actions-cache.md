# ADR-0021: Lite mode via `actions/cache`

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §5.4, [roadmap.md](../roadmap.md) M3

## Context
The selection engine ships before the server (selection-first sequencing, M1–M4). Teams with small repos may never want a server.

## Decision
- On the default branch, `sieve record` runs and `actions/cache/save` stores `.sieve/map` under key `sieve-map-<sha>`.
- PR runs restore the latest map with `restore-keys: sieve-map-` and run `sieve plan --map .sieve/map`. That computes Δ, the reverse BFS, proofs and shards locally.
- Lite mode has no flake ledger, ingest or UI.

## Alternatives considered
- **Store maps in git refs (`refs/sieve/*`):** not chosen for v1. Needs write access and adds refs to the repository, but works on any forge, so it stays a possible later option.
- **The Actions artifacts API:** rejected. Downloading across runs needs API calls and tokens.

## Consequences
- Usable selection by M3 with zero infrastructure.
- The trust model depends on the cache scoping rules, meaning which branches can read and write which caches. They are verified in M3 before Lite mode is allowed to enforce skips.
