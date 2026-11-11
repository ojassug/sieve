# SIEVE threat model and adversarial review

- **Status:** approved 2026-11-11.
- **Related:**
  - [architecture.md](architecture.md) (§3 algorithms, §7 verification);
  - ADRs [0011](adr/0011-tenancy-rls.md) (tenancy), [0012](adr/0012-ci-auth-and-trust-lanes.md) (CI auth and trust lanes), [0010](adr/0010-hashing.md) (hashing).

---

## 1. Security model

### 1.1 Tenancy ([ADR-0011](adr/0011-tenancy-rls.md))
- Shared schema with `ENABLE` and **`FORCE ROW LEVEL SECURITY`** on every tenant table. Owners otherwise bypass RLS, and superusers and BYPASSRLS roles always do (verified, PostgreSQL docs).
- Policy `tenant_id = current_setting('sieve.tenant_id')::uuid`.
- The app role has no BYPASSRLS; migrations run as the owner role.
- Every request and job runs in a transaction with `SET LOCAL`. With no policy, RLS defaults to deny (verified).
- **Covert channels:** unique, PK and FK checks bypass RLS (verified). So uniqueness is tenant-scoped everywhere, except the router-only `routing_installations` table, whose errors are uniform 404s.
- Object keys and in-memory caches are keyed by (tenant, repo, hash).
- **WebSocket:** authenticate on connect and authorize each subscription through an RLS-backed query. NOTIFY carries ids only, and the gateway re-reads each event under the subscriber's tenant.

### 1.2 Authentication and secrets
- **UI login:** GitHub OAuth (App user-to-server), plus a local admin (scrypt via node:crypto) for air-gapped installs. Sessions use HttpOnly Secure SameSite=Lax cookies with CSRF tokens.
- **CI:**
  - GitHub Actions OIDC JWT, verified via JWKS with an audience bound to the server. Claims include repository_id, repository_owner_id, ref, event_name and job_workflow_ref (verified as present). Matched against `oidc_trust` rules.
  - Alternatively repo-scoped API tokens, hashed at rest, with an identifiable prefix for secret scanning.
- **At rest:** the App private key, webhook secret and OAuth secret come from env or secret files. Stored tokens use AES-256-GCM envelope encryption with a KEK from env. Installation tokens (1 h) live in memory only.
- **Audit log** records logins, token creation and revocation, settings, quarantine overrides, forced runs, manual skips and exports.

### 1.3 Trust lanes and map poisoning ([ADR-0012](adr/0012-ci-auth-and-trust-lanes.md))
- **Trusted lanes** are default-branch pushes and schedules, `merge_group`, `workflow_dispatch` by writers, and same-repo PRs whose `author_association` is OWNER, MEMBER or COLLABORATOR.
- **Untrusted lanes** are fork PRs, first-time contributors and unknown actors.
- Untrusted records **never** become skip evidence or flake observations outside their own PR. Otherwise a fork could fabricate passes to force future skips, or flips to get a test quarantined and its real failure ignored.
- **Fork PR flow:**
  - Fork runs get a read-only token and no secrets (verified); secondary sources say OIDC is also withheld.
  - On opted-in public repos they may run an anonymous read-only plan (rate-limited); otherwise they run everything.
  - Results go to an artifact. The App's `workflow_run` handler, which is privileged by design (verified), downloads it into the untrusted lane.
  - The fork's code never runs in a privileged context.

### 1.4 Source never leaves the runner
- **Default.** The CLI computes static edges and coverage mapping locally and uploads paths, blob OIDs, edges, test names, outcomes and durations. **No file contents are ever uploaded.** Failure messages and stacks are truncated and pass through redaction regexes (tokens, keys) before upload.
- **Strict privacy mode.** Paths and test names are replaced by HMAC-SHA256(tenant salt, value). The server and UI show hashes, while the CLI, which has the source, renders human-readable why-paths and proofs into the job summary. The trade-off is server-side explainability for privacy, and both are documented.

### 1.5 Threat summary
| Threat | Mitigation |
|---|---|
| Spoofed webhooks or uploads | HMAC, OIDC audience binding, token scopes per repo |
| Map or ledger poisoning | Trust lanes; proofs name the record's lane |
| Cross-tenant read (API, DB, blob, cache, socket) | RLS + FORCE, tenant-scoped keys, per-subscription authorization, isolation fuzzer ([architecture.md](architecture.md) §7.4) |
| Repo transfer carrying data across tenants | Immutable forge ids; transfer detaches the repo |
| Secret leakage in failure output | Redaction, length caps, strict mode |
| Supply chain | Zero-dep CLI, npm provenance, signed image (cosign optional) |
| DoS via uploads | Size caps, streaming parse, per-tenant quotas, 503 + Retry-After (the CLI degrades to run-all) |

---

## 2. Adversarial review: attacking the draft and what changed

### 2.1 Where could a skipped test hide a real regression?
| Hole | Mitigation now in the design |
|---|---|
| Transform-time inputs in the Vite server process (aliases, `import.meta.glob`, plugins, `?raw`) are invisible to worker coverage | Static extraction of glob/asset imports into `g:` and `f:` nodes; runner-exported aliases; runner config and its imports as global nodes |
| Resolution shadowing (a new `util.ts` next to `util.js`; a new `index.ts`) | Probe recording into ⊥ nodes plus `d:` listing nodes |
| Fixtures, snapshots, `readdir`, `existsSync` misses | Worker fs hooks to `f:`, `d:` and ⊥ nodes (Vitest's own recorder skips fs reads, verified) |
| Child processes and worker threads | `autoAttachSubprocess` (Vitest v8 option) or the test is flagged unprovable and always runs |
| Generated or untracked files (codegen, `dist/`) | `generated` rules map outputs to inputs; unmapped means the test always runs |
| Lockfile bumps | Per-package `p:` nodes per install location; unparseable means L3 |
| Global setup, `.env`, runner config | Global nodes hit all tests (L2) |
| Environment drift (Node version, OS, TZ, matrix cell, env vars) | Env fingerprint components; a mismatch means no proof |
| Test file itself changed, or a new test | In its own closure; new tests always run |
| Order dependence (`isolate: false`, pytest) | File or module units; OD tagging; warnings |
| Cached failure masquerading as pass | Only passing trusted records are evidence; known-failing tests always run |
| Record from an untrusted run | Lanes |
| SIEVE bug (resolver, mapper, BFS) | Shadow mode for 4 clean weeks before enforcement; audit sampling; nightly full runs; independent naive verifier (P4); seeded-fault replay; incident workflow freezing the package |
| External services, network, time | Outside assumption A1 by definition. Documented; these tests show up in the flake ledger; nightly runs keep them exercised |

### 2.2 Where could one tenant see another tenant's data?
| Vector | Mitigation |
|---|---|
| A new table without a policy | CI lint: every table has RLS enabled + forced + a policy, or the build fails |
| Pooled connection leaking tenant context | `SET LOCAL` per transaction only; no session-level `SET` anywhere (lint) |
| Owner or superuser bypass | App role without BYPASSRLS; FORCE RLS |
| Unique-constraint or FK covert channels | Tenant-scoped uniqueness; router table isolated |
| Workers processing many tenants | The job carries tenant_id; the worker sets context per job transaction; cross-tenant maintenance (GC, retention) uses a separate audited role |
| Blob dedup or cache confirmation attacks | No cross-tenant dedup; tenant-keyed caches |
| WebSocket topic guessing | Server-side topic resolution plus per-subscription authorization |
| Repo transfer or rename | Forge immutable ids; transfer detaches |
| Error messages revealing existence | Uniform 404 |
| OIDC token from repo A used for repo B | Claim match on repository_id plus owner_id against `oidc_trust` |
| Logs and traces with tenant data | Tenant ids hashed in telemetry; no payloads in spans |

### 2.3 What breaks at 10× scale (Anthropic's guidance: design v0 for 10–20× perceived load)
| Breaks | Mitigation |
|---|---|
| Execution volume | Online sufficient statistics (Beta, SPRT, CUSUM state are O(1) per test), so no history scans. Daily partitions with drop-based retention; rollups; an `ExecutionStore` interface keeps a ClickHouse adapter open for hosted scale only |
| Monorepo maps (100k files, 20k tests) | CSR plus per-package chunking and dedup; reverse BFS from Δ instead of closure enumeration; map LRU; selector in worker threads |
| Webhook storms from agent PR bursts (overnight and weekend spikes) | Fast acknowledge, queue, supersede per PR, coalesce check updates |
| GitHub secondary limits (500 writes/h) | ≤3 writes per run; job summaries |
| Hot tenant starving others | Stride-scheduling fairness and per-tenant quotas |
| Queue bloat or vacuum | Short rows, payload references to blobs, periodic partition rotation of `jobs` if needed |
| WebSocket fan-out | ids-only NOTIFY per API node; Redis pub/sub swap behind an interface if LISTEN saturates |
| Record overhead on huge suites | Record only what trusted lanes already run; nightly full record; function-level (not block-level) coverage |
| GC mark phase | Per-repo bounded GC, two-phase deletes |

### 2.4 The cheapest slice with real value in month 1, given selection-first
- Per the sequencing decision, month 1 has no ingest or UI. Its value is:
  - the **corpus collector**, started in week 1, an asset that decays at 90 days;
  - the **walking skeleton** ([roadmap.md](roadmap.md) §5): shadow-mode `sieve plan` with why-paths in job summaries on the dogfood repo.
- By week 8, **Lite mode** gives enforced selection in CI with no server.
- Accepted trade-off: flake value (the fastest-to-value feature) arrives around week 17. If the M4 kill gate fails, the pivot keeps the CLI, the GitHub integration and the map store.
