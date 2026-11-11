# ADR-0016: Real-time transport

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §2.4, [threat-model.md](../threat-model.md) §1.1

## Context
Live run views and plan updates stream to browsers. Postgres NOTIFY ([docs](https://www.postgresql.org/docs/current/sql-notify.html)):
- payloads must be shorter than 8000 bytes in the default configuration;
- the notification queue holds 8 GB;
- delivery happens only when the sending transaction commits.

## Decision
- Browsers connect over WebSocket (the `ws` library on the server).
- Events are written to an `events` outbox table and announced with NOTIFY, carrying only the event id.
- Each API node holds one direct, unpooled LISTEN connection. It re-reads each event under the subscriber's tenant context and pushes it to authorized subscriptions only.
- Server-Sent Events are the fallback where a proxy blocks WebSockets.

## Alternatives considered
- **Redis pub/sub:** rejected for v1. Another service.
- **Polling:** rejected. Latency and load.

## Consequences
- No extra service.
- If LISTEN throughput saturates at hosted scale, a Redis implementation slots in behind the same interface.
