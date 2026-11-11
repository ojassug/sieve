# SIEVE roadmap

- **Status:** approved 2026-11-11.
- **Plan:** selection-first, 10 milestones, about 640 commits, 26 weeks at about 25 commits/week, starting Mon 2026-11-16.
- **Related:** [architecture.md](architecture.md), [../bench/TARGETS.md](../bench/TARGETS.md), [adr/](adr/README.md).

## 1. Milestones
| # | Weeks (dates) | Milestone | Exit criteria | Commits |
|---|---|---|---|---|
| M1 | 1–3 (Nov 16 – Dec 6) | **Snapshots + static graph engine.** `core/git` (`ls-tree -z`, object format, dir OIDs, Merkle descent); node model; TS/JS import lexer (port of TokenDamper's TS state machine); resolver (relative, extension, index, tsconfig paths and extends, exports and imports, workspaces, probes); npm, pnpm and yarn lockfile → `p:` nodes; SMAP v0; `sieve graph/diff/explain`; walking skeleton; **corpus collector live in week 1** | Golden graphs for 6 repos reviewed; 10k-file graph <30 s cold, <3 s incremental; P10 green; byte-identical SMAP across OSes | 70 |
| M2 | 4–5 (Dec 7 – Dec 20) | **Dynamic recording.** Vitest custom coverage provider (per-file V8 via `onAfterSuiteRun`) + worker fs hooks + subprocess detection; Jest reporter (`TestResult.v8Coverage`) + setup hooks; script-URL → node mapper (repo, `p:`, virtual flagged); shard-order-independent record merge; `sieve record`; overhead study (binary vs count mode); cross-check against `recordDependencies` | Per-file deps on the dogfood fork + 3 OSS repos; merge deterministic under shard permutations; every unmapped script flagged; T7 measured | 55 |
| M3 | 6–8 (Dec 21 – Jan 10) | **Safe selector + GitHub + Lite mode.** Union assembly, map validity, reverse BFS + why-paths, escalation L0–L3, lanes, audit sampling, ratio-rule ordering, LPT, proofs + independent verifier, `plan/run/gate/verify/explain`, plan-file filtering in plugins, Action + reusable workflow, `actions/cache` map store, shadow summaries | P1–P8 green; ≥10k mutants with 0 unsafe skips; dogfood PRs run shadow mode; local plan p95 <1 s at 10k files | 70 |
| M4 | 9–10 (Jan 11 – Jan 24) | **Replay harness + kill gate.** Containerized re-execution, mutant seeding, rerun flake labels, all baselines, HTML report (TokenDamper reporter lineage), `TARGETS.md` committed first | Report on ≥5 (goal 8) repos × ≥200 commits. **Decision gate on Jan 24, 2027**: continue, or pivot (§2) | 55 |
| M5 | 11–13 (Jan 25 – Feb 14) | **Server core.** Schema + migrations with RLS/FORCE from day 1; queue (SKIP LOCKED, outbox, supersede, stride fairness, visibility timeout); blob store + CAS + map-build + GC; select protocol v1; uploads with idempotency; OIDC/JWKS + tokens; CLI degraded mode; compose; OTel basics | Compose up → dogfood selects against the server; chaos v0 (killing the server mid-select gives run-all, exit 0); RLS lint in CI; queue crash-injection tests | 70 |
| M6 | 14–16 (Feb 15 – Mar 7) | **Ingest + GitHub App.** Own streaming XML tokenizer + JUnit dialect fixtures (Vitest, jest-junit, Playwright, pytest xunit1/2) + Vitest/Jest JSON; identity + rename links; daily partitions + COPY + rollups; App manifest flow, webhooks (HMAC, dedup, out-of-order), check runs (≤3 writes), job summaries, `workflow_run` fork pull-ingest, `merge_group`, reconciler | T4 met; P11 + chaos suite green; App live on the dogfood org; fork flow proven on a test fork | 70 |
| M7 | 17–19 (Mar 8 – Mar 28) | **Flake ledger + quarantine + durations + budget mode.** Classes v1 → v2 (closure fingerprint); SPRT episodes + decayed Beta + FSM; quarantine exit semantics; Suspect-only retry; CUSUM + attribution; p_i scoring; knapsack (TokenDamper DP/greedy) + deferred sets; audit estimator; savings_daily | T3 met on JS rerun ground truth; P9 green; **enforcement turned on for dogfood after 4 clean shadow weeks** | 70 |
| M8 | 20–21 (Mar 29 – Apr 11) | **pytest + tenancy hardening.** `sieve-pytest` (sys.monitoring first-hit tracer with `DISABLE` and `restart_events` per test on 3.12+; coverage.py `ctrace` contexts fallback; audit-hook `open` tracking; conftest and plugin deps; OD-aware module units); Python lexer/resolver. Orgs, roles, GitHub login, local admin, audit log, isolation fuzzer, quotas, token encryption | pytest within targets on ≥2 Python replay repos; T5 met | 55 |
| M9 | 22–24 (Apr 12 – May 2) | **Real-time UI.** Live run view (WebSocket, LPT Gantt); impact explorer (Sigma.js + elkjs why-paths + animated reverse-BFS frontier, SeamCraft-style); proofs browser; flake heatmap + per-test SPRT LLR timeline; savings ledger with escape-rate bands; duration alarms; settings and onboarding | ≥2 of 3 non-author users complete install → selection → read a quarantine explanation unaided in ≤30 min; 10k nodes ≥30 FPS on a mid-range laptop; accessibility audit ≥90 | 75 |
| M10 | 25–26 (May 3 – May 16) | **Launch.** Public benchmark report vs `TARGETS.md` (passes and misses reported); docs site; upgrade and backup docs; opt-in telemetry; optional Helm; hosted invite-only beta (public repos); final name and trademark check; Show HN | All targets reported honestly; fresh-VM install <15 min | 50 |
| | | **Total** | | **640** |

Target IDs (T1–T8) and property IDs (P1–P11) are defined in [../bench/TARGETS.md](../bench/TARGETS.md) and [architecture.md](architecture.md) §7.1.

## 2. Cut list, contingency, pivot
- **Cut list if behind (in order):** Helm → hosted beta → sticky PR comments → budget mode → pytest (moves to post-launch).
- **Contingency:** if M4 shows barrel blowup costs ≥10 points of savings, symbol-level refinement ([architecture.md](architecture.md) §3.11) replaces M8's pytest work, and pytest moves after launch.
- **Pivot (M4 kill):** M5–M7 are re-planned as ingest + flake ledger + UI first. The CLI, GitHub integration and map store carry over.

## 3. Post-launch backlog
- M11 symbol-level precision.
- M12 own merge gate: speculative batches + binary-search bisection with flake posteriors; Uber SubmitQueue as prior art.
- GitLab CI native, then Forgejo/Gitea.
- Go package-level selection (`go list -json -deps -test`; Go's test cache already keys on files and env consulted).
- C++ via `deep` tree-sitter (SeamCraft).
- Playwright selection.
- ClickHouse `ExecutionStore` for hosted scale.

## 4. First two weeks in detail (Nov 16 – Nov 29, 2026; about 50 commits)
| Day | Work | Done when |
|---|---|---|
| 0 (done 2026-11-11) | Repo docs written: architecture, threat model, roadmap, ADRs, targets, research copy. **You** create a GitHub org for dogfood (merge queue needs org-owned repos; Claude can't create accounts or orgs). Forking TokenDamper into it needs your go-ahead, and the original is never modified | Docs committed on `main` |
| 1 | Monorepo skeleton: `packages/{core,cli,vitest,jest}`, `tools/{corpus,replay,toyrepo}`, `bench/`; tsconfig, vitest, eslint (TokenDamper conventions); `LICENSE` (Apache-2.0); CI workflow; `DECISIONS.md` log started | CI green on an empty test |
| 1–2 | **Corpus collector** (scheduled workflow in a public repo): daily snapshots of workflow runs, JUnit artifacts and check runs for the candidate repos ([architecture.md](architecture.md) §9, item 8); `bench/CORPUS.md` selection criteria | First daily manifest committed |
| 2–3 | `core/git`: streaming `ls-tree -r -z` parser, object-format detection, dir OIDs, merge-join diff + Merkle descent; P10 | Descent equals naive on 10k random trees |
| 3–4 | `core/lex/ts`: import/export/require/dynamic-import/glob extractor ported from the `ts-validator.ts` state machine; golden fixtures (template literals, regex literals, comments, type-only imports) | 100% fixture pass; benchmark MB/s recorded |
| 5 | `core/graph`: interning, CSR, directed multi-source reverse BFS with parent pointers (from `computeAllDistances`, made directed); P1/P3 | Properties green |
| 6–7 | `core/resolve/ts`: relative, extension order, index, tsconfig paths/extends, package exports/imports conditions, workspaces; probe → ⊥/`d:` nodes | Resolver fixture repos pass |
| 8 | `core/lockfile/npm` (v3) → `p:` nodes; pnpm/yarn stubs return "unparseable → L3" | Lockfile diff yields changed packages |
| 9 | CLI v0: zero-dep arg parser, config loader, `sieve graph`, `sieve diff`, `sieve plan --static --shadow --map` | Runs on the dogfood fork locally |
| 10 | **Walking skeleton in CI** on the dogfood fork: plan job → matrix → shards (running all files in shadow) → gate; job summary with would-skip and why-paths; map via `actions/cache` | Green PR with shadow summary; run-all when the map is missing |

## 5. Walking skeleton (selection-first)
- **The slice:** `git ls-tree` listing → Merkle diff against the last default-branch snapshot (in `actions/cache`) → static import graph (lexer + basic resolver) → directed reverse BFS → plan JSON with why-paths → GitHub plan job → dynamic matrix → shards → aggregator gate → job summary.
- **Done** = it runs on every dogfood PR in shadow mode, is deterministic, and falls back to run-all with no map.
- Later milestones deepen each component (dynamic edges, proofs, server) without changing the slice's shape.
