# ADR-0011: Tenancy — shared schema with row-level security

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [threat-model.md](../threat-model.md) §1.1 and §2.2, [architecture.md](../architecture.md) §4.1

## Context
SIEVE is self-host first, with a hosted beta later. Multi-tenant isolation is both a product requirement and a learning goal.

The PostgreSQL docs ([row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)) say:
- table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is set;
- superusers and BYPASSRLS roles always bypass it;
- RLS with no policy is default-deny;
- referential-integrity checks (unique, primary key, foreign key) bypass RLS and can create covert channels.

## Decision
- Every tenant table carries `tenant_id`, has `ENABLE` + `FORCE ROW LEVEL SECURITY`, and has a policy on `current_setting('sieve.tenant_id')`.
- The application role has no BYPASSRLS.
- Tenant context is set with `SET LOCAL` inside each request or job transaction, which is safe under transaction pooling.
- Uniqueness is tenant-scoped.
- Global routing data (GitHub installation id → tenant) lives in a separate table that only the webhook-router role can read.
- A CI lint asserts RLS on every table, and an isolation fuzzer runs on every release (target T5 in [TARGETS.md](../../bench/TARGETS.md)).

## Alternatives considered
- **Schema per tenant:** rejected. Migrations run N times, and the catalog bloats.
- **Database per tenant:** rejected for v1 (N connection pools). Could be offered later as a dedicated plan.
- **Application-level filtering only:** rejected. One missed `WHERE` clause leaks data.

## Consequences
- Every query path is tested under two tenants.
- Maintenance jobs that cross tenants (GC, retention) use a separate, audited role.
