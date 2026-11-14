# Architecture decision records

All 21 ADRs below were accepted on 2026-11-11 in the planning session.
- Until implementation starts on 2026-11-16, ADRs may be corrected in place. After that, a change to a decision is a new ADR that supersedes the old one.
- "Decided by Ojas" marks product calls made directly in that session.
- **Corrected in place on 2026-11-13:** ADRs 0003, 0004, 0005, 0009, 0012, 0014 and 0021, after the [foundation review](../research/2026-11-foundation-review.md). Each one's status line names the findings behind its change. [DECISIONS.md](../../DECISIONS.md) entry 27 summarizes what changed and what the code still has to catch up on.
- **Corrected in place on 2026-11-14:** ADRs 0001, 0019 and 0020 lost their schedule and commit figures when the roadmap dropped its dates and commit budgets. No decision changed ([DECISIONS.md](../../DECISIONS.md) entry 31).

| # | Decision |
|---|---|
| [0001](0001-typescript-on-node.md) | TypeScript on Node end to end |
| [0002](0002-zero-dependency-cli.md) | Zero-dependency CLI and runner plugins |
| [0003](0003-file-level-graph-granularity.md) | File-level graph granularity; symbol level as a measured lever |
| [0004](0004-test-file-selection-unit.md) | The test file is the selection unit |
| [0005](0005-closure-equality-safety-criterion.md) | Safety criterion: closure content equality against a trusted passing record |
| [0006](0006-postgres-for-all-storage.md) | Postgres 18 for relational data and test executions |
| [0007](0007-postgres-job-queue.md) | Own Postgres-backed job queue |
| [0008](0008-blob-store-no-minio.md) | Blob store: local volume or S3-compatible, no bundled MinIO |
| [0009](0009-smap-binary-map-format.md) | Custom SMAP binary map format |
| [0010](0010-hashing.md) | Hashing: git blob OIDs, SHA-256, ed25519 |
| [0011](0011-tenancy-rls.md) | Tenancy: shared schema with row-level security |
| [0012](0012-ci-auth-and-trust-lanes.md) | CI authentication and trust lanes |
| [0013](0013-github-integration-pattern.md) | GitHub integration pattern: plan job, dynamic matrix, gate job |
| [0014](0014-flake-decisions-sprt.md) | Flake decisions: SPRT episodes, decayed Beta, hysteresis state machine |
| [0015](0015-frontend-stack.md) | Frontend stack |
| [0016](0016-realtime-transport.md) | Real-time transport: WebSocket + LISTEN/NOTIFY |
| [0017](0017-observability.md) | Observability: OpenTelemetry + Prometheus |
| [0018](0018-license-apache-2.md) | License: Apache-2.0 (decided by Ojas) |
| [0019](0019-forge-scope-github-only.md) | Forge scope: GitHub only in v1 (decided by Ojas) |
| [0020](0020-merge-gate-after-launch.md) | Merge gate after launch; `merge_group` support in v1 (decided by Ojas) |
| [0021](0021-lite-mode-actions-cache.md) | Lite mode via `actions/cache` |
