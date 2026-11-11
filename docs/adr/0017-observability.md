# ADR-0017: Observability

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [ADR-0007](0007-postgres-job-queue.md)

## Context
Self-hosters need standard telemetry. Anthropic's 2026-09-14 post stresses instrumenting services so problems can be diagnosed incrementally, and checking that jobs in equal jobs out.

## Decision
- The server uses OpenTelemetry for traces, metrics and logs, with OTLP export optional.
- It exposes Prometheus-format `/metrics`, plus `/healthz` and `/readyz`.
- **Key SLIs:**
  - selection latency (p50, p95);
  - queue depth and lag per job kind;
  - enqueue vs dequeue rates;
  - ingest rows per second;
  - map-build time;
  - escapes;
  - webhook processing delay.
- The CLI writes a local JSON timing trace and annotates the CI run whenever it degrades to run-all.
- Tenant ids in telemetry are hashed. Payloads never go into spans.

## Alternatives considered
- **Vendor-specific SDKs:** rejected. Not self-host friendly.
- **Logs only:** rejected. No latency distributions or queue lag.

## Consequences
- OpenTelemetry packages are server-side dependencies only; the CLI stays zero-dependency.
- Example dashboards ship with the docs.
