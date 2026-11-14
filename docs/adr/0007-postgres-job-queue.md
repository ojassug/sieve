# ADR-0007: Own Postgres-backed job queue

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §2.4 and §4.1, [ADR-0006](0006-postgres-for-all-storage.md)

## Context
**Jobs:** ingest, map-build, ledger updates, forge notifications, GC, replay, webhook processing.

**Requirements:**
- transactional enqueue together with data writes;
- at-least-once delivery with idempotent handlers;
- supersede and coalesce per PR head;
- per-tenant fairness;
- a single writer per test for the ledger.

Anthropic's 2026-09-14 post ([link](https://claude.com/blog/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic)) describes a single-writer, in-memory listener that fell behind as CI jobs grew 25×. Their fix was a stateless listener appending to a journal, with a consumer rolling it up, and "jobs in equals jobs out" as the health signal.

## Decision
- A `jobs` table dequeued with `FOR UPDATE SKIP LOCKED`.
- **Transactional outbox:** the job is inserted in the same transaction as the data it refers to.
- **Visibility timeout** via `locked_until`, plus a reaper that returns expired jobs.
- **Supersede:** a `dedup_key` partial unique index (pending jobs only), with `ON CONFLICT … DO UPDATE`.
- **Fairness:** stride scheduling. Each enqueue sets a per-tenant virtual time, and dequeue orders by it.
- Ledger jobs are partitioned by hash(test), so each test has exactly one writer.
- LISTEN/NOTIFY wakeups, plus metrics for enqueue rate, dequeue rate and lag per job kind.

## Alternatives considered
- **graphile-worker:** MIT-licensed, about 15.6k jobs/s unbatched and about 183k batched on an i9-14900K ([performance](https://worker.graphile.org/docs/performance)). A strong reference design, but fairness and supersede would still be custom.
- **pg-boss:** similar trade-off.
- **Redis Streams or NATS JetStream:** another service in compose.

## Consequences
- About 500 lines of queue code Trommel must get right. Crash-injection property tests check that no effect is lost or duplicated.
- Throughput headroom is orders of magnitude above what Trommel needs.
- A swap to an external queue stays possible behind the queue interface.
