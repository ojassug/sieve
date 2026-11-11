# ADR-0004: The test file is the selection unit

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §3.12

## Context
- Vitest defaults to `pool: forks` and `isolate: true` ([pool](https://vitest.dev/config/pool), [isolate](https://vitest.dev/config/isolate)).
- Jest runs each test file with its own module registry.
- Filtering individual test cases changes the order and the setup sharing inside a file.
- In Python, 59% of flaky tests are order-dependent ([FlaPy, arXiv 2101.09077](https://arxiv.org/abs/2101.09077)).

## Decision
- SIEVE selects **test files** for JS/TS and **test modules** for pytest.
- Test cases are tracked individually for the flake ledger, durations and identity, but are not selected individually in v1.
- Runner plugins apply the plan's exact file list. There are no command-line substring filters.

## Alternatives considered
- **Case-level selection (`-t` filters):** rejected for v1. More savings in big files, but order-dependence risk and runner-specific filter semantics.
- **Package-level selection:** rejected. Too coarse for TypeScript repos.

## Consequences
- Budget mode and savings are computed at file granularity.
- Configs with `isolate: false` get a warning, and the affected worker group is treated as one unit.
- Case-level selection can be revisited after launch, using order-dependence data from the ledger.
