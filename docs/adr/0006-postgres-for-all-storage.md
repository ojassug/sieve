# ADR-0006: Postgres 18 for relational data and test executions

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §4, [ADR-0007](0007-postgres-job-queue.md), [ADR-0011](0011-tenancy-rls.md)

## Context
Self-hosting must be one image plus one database.

Execution volume can be large. But the flake ledger, durations and savings all use online sufficient statistics, so raw history is needed only for drill-down, replay and recomputation.

## Decision
- Postgres 18 holds everything: tenants, repos, snapshots, plans, ledgers, jobs and events.
- `test_executions` is range-partitioned by day. Retention is 30 days, done by dropping partitions, plus 400-day rollups.
- ids use `uuidv7()`, built into Postgres 18 ([press kit](https://www.postgresql.org/about/press/presskit18)).
- Executions are accessed only through an `ExecutionStore` interface.

## Alternatives considered
- **ClickHouse:** rejected for v1. Excellent analytics, but a heavy second service for a single-box self-host. The official sizing guidance wasn't retrieved; third-party sources cite 32 GB for production. Revisit for the hosted tier.
- **DuckDB embedded:** rejected for the server. Only one process can open a database read-write, and multi-process writers need Quack server mode or DuckLake ([concurrency](https://duckdb.org/docs/2.0/connect/concurrency.html)). Trommel's API and workers are separate processes.
- **TimescaleDB:** rejected. Extension availability and licensing vary across managed Postgres offerings.
- **Parquet files + DuckDB for analytics:** possible later as an export path.

## Consequences
- Compose has one required dependency, and RLS covers all data.
- Trommel needs partition-management code: create partitions ahead, drop them behind.
- A ClickHouse adapter stays possible behind `ExecutionStore` if hosted volume demands it.
