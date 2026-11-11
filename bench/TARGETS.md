# Pre-registered targets

**Registered 2026-11-11, before any measurement.**
- Targets are not edited after the first measurement. A change goes into the dated Amendments section below with its reason.
- Results are always reported against the original targets, including misses.

## Definitions
- **Flaky failure:** a failure that does not reproduce in at least one of 3 reruns at the same commit and environment.
- **Faulty change:** a commit or PR whose full suite has at least one non-flaky failure. Ground truth comes from re-executing the full suite and, to get enough faulty changes, from mutants seeded into changed functions.
- **Change-level miss rate:** the share of faulty changes where SIEVE's selection includes none of the failing tests.
- **Test-level recall:** the share of failing tests that SIEVE's selection includes.
- **Savings:** Σ duration of skipped test files ÷ Σ duration of all test files, per run. Reported as the median over runs, per repo and pooled.
- **Escape (production):** a skipped test that would have failed non-flakily. It is measured by shadow mode, audit sampling (Clopper–Pearson 95% upper bound) and nightly full runs. Definitions are in [../docs/architecture.md](../docs/architecture.md) §3.10.

## Targets
| ID | Metric | Target | Measured in | First milestone |
|---|---|---|---|---|
| T1 | Median test-minutes saved at ≤1% change-level miss rate (safe mode) | ≥ 50% | Replay corpus, per repo and pooled | M4 |
| T2 | Selection latency, CLI start to plan available in CI | p95 ≤ 5 s (server side ≤ 1.5 s at 10k files) | Dogfood + synthetic 1k/10k/100k-file repos | M3 (local), M5 (server) |
| T3 | Quarantine precision against rerun ground truth | ≥ 0.9 (recall reported) | JS corpus reruns; IDoFT/FlaPy Python after M8 | M7 |
| T4 | Ingest throughput on a laptop | ≥ 10k results/s sustained | Streaming parse + COPY benchmark | M6 |
| T5 | Cross-tenant access under isolation fuzzing | 0 leaks in ≥ 10⁵ generated requests per release | API, DB and WebSocket fuzzers | M8 |
| T6 | Static graph build, 10k-file TS repo | < 30 s cold, < 3 s incremental | Golden-graph repos | M1 |
| T7 | Record-mode overhead vs plain run (Vitest, Jest) | ≤ 25% wall time | Dogfood + 3 OSS repos | M2 |
| T8 | CI failures caused by SIEVE itself under chaos (server down, timeouts, 5xx) | 0 | Chaos suite | M5 |

## Kill criterion
- **K1 (end of M4, 2027-01-24):** if replay shows less than 30% median savings at ≤1% change-level miss rate on at least 5 repos, SIEVE pivots to a flake-ledger-first product. See [../docs/roadmap.md](../docs/roadmap.md) §2.

## Protocol
- **Corpus.**
  - At least 8 repos (at least 5 for the kill gate) with at least 200 historical commits or PRs each, re-executed in pinned containers.
  - Selection criteria go in `bench/CORPUS.md` (week 1).
  - Manifests are frozen and hashed; the engine is pinned (dist hash, `dirty` flag).
- **Baselines.**
  - run-all;
  - `vitest related`;
  - `vitest --changed` with `experimental.recordDependencies`;
  - `jest --findRelatedTests`;
  - a filename heuristic;
  - coverage-only plus "tracked files run all" (Datadog-like);
  - SIEVE static-only, dynamic-only and union.
- **Refusal rules.** No number is reported if:
  - the corpus hash mismatches;
  - a sample is empty;
  - a stage is unattributed;
  - row counts don't match the expected files × commits.
- **Timing** runs separately from correctness.
- **Publication.** Every published claim links to a reproducible run (manifest, engine hash, raw results).

## Amendments
None.
