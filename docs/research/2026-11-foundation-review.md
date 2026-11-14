# Foundation review (2026-11-13)

- **Reviewed:** `main` at `86a995e`, with days 1–9 merged. The day-10 workflow was read from branch `m1/d10-skeleton` at `2252cfe`; it is not merged and was not run.
- **For:** Ojas, and whoever implements M2 and later.
- **The date that matters:** ADRs can be corrected in place until 2026-11-16. §3 gives replacement text for seven of them.
- **Nothing in the repository was changed** by the review except this file. Nothing was committed, pushed or installed.

## What happened after the review (2026-11-14)

The rest of this report is as written on 2026-11-13. Read it with these facts in mind.
- **The seven ADR edits of §3 are applied.** Ojas approved them on 2026-11-13. One sentence differs from §3: ADR-0009's consequence about the engine id now also allows a recorded reason why older maps stay safe, to agree with [DECISIONS.md](../../DECISIONS.md) entry 26.
- **The other documents follow.** [architecture.md](../architecture.md), [threat-model.md](../threat-model.md), [roadmap.md](../roadmap.md) §6, [HANDOFF.md](../../HANDOFF.md) §1.1 and §10, and DECISIONS entry 27 carry the corrections. Entry 27 lists where the code still lags.
- **`main` moved while the review was being written.** Day 10 (#13) and the directory-URL fix (#14, DECISIONS 26) merged. `new URL('.', import.meta.url)` is no longer a cause of uncertainty, and a new file that a mapped glob matches no longer escalates. No finding depends on either. The counts for this repository in "What I ran" are those of `86a995e`.
- **Line citations were refreshed** to `main` at `acf76c2`. Only `plan.ts` had moved. Later changes to the code are not reflected in them.
- **Two findings are fixed in code since.** M1, the environment in the static map, by [#16](https://github.com/trommelci/trommel/pull/16) ([DECISIONS.md](../../DECISIONS.md) entry 28). The selector rules of C1 and finding L1, by [#17](https://github.com/trommelci/trommel/pull/17) (entry 29), where Ojas also answered question 3 of §6: a change to a module that no test reaches escalates by default.
- **Everything not in an ADR or fixed is still a recommendation:** findings M6 to M8 and L2 to L7, §4, and the questions in §6 other than question 3.

## How to read this

- **Verified** means I ran it on this machine or read it at the cited line. **Inferred** means it follows from the design or from how a third-party tool works, and nothing here tested it.
- **Severity** describes what happens once skips are enforced, from M3 on. Today every plan is shadow-only and every would-skip is labelled unproven, so nothing below is a live fault in CI.
  - **Critical:** as written, the design skips or never runs a test it should run, in a mainstream setup, and the fix changes a contract that records, maps or plugins will depend on.
  - **High:** the same in a narrower setup, or a contract that is cheap to change now and expensive after M2.
  - **Medium:** incomplete, imprecise or non-deterministic, with a bounded effect or an existing backstop.
  - **Low:** robustness, latent bugs and document drift.
- No finding asks for a redesign. Each is a paragraph in an ADR, a DECISIONS entry or a bounded code change.

## What I ran

| What | Result |
|---|---|
| `npm test` | 395 tests in 28 files pass in 20.9 s, as [HANDOFF.md](../../HANDOFF.md) §1 says |
| `node packages/cli/src/main.ts graph --out …` on this repository, twice | 230 files, 125 lexed; 1,461 nodes, 2,777 edges; 28 tests; 18 uncertain files; 260,624 bytes in about 0.22 s. Both runs give the same bytes |
| A synthetic 10,000-file monorepo of the same shape as `bench/static-graph.ts` | 106,390 nodes, 684,501 edges, 26,691,875 bytes: the recorded numbers exactly. 1.60 MB gzipped. On the plan side: parse 0.39 s, CSR build 0.45 s, select 0.55 s, 556 MB resident |
| A breakdown of both maps by node and edge kind | Findings M3 and M2 |
| A plain binary layout of the synthetic map | 2.20 MB, or 0.33 MB gzipped; the reverse index rebuilt from the forward arrays in 2.7 ms, identical to the built one |
| 12 probes of the selector and resolver | Each builds a base and a head snapshot with the repository's own `fakeRepo` helper and runs the real `buildStaticMap` and `selectStatic`. Each probe's input is given with its finding |
| The installed Vitest 5.1.0 | Its default exclude is `**/node_modules/**` and `**/.git/**`; `recordDependencies`, `autoAttachSubprocess` and `onAfterSuiteRun` exist |
| GitHub documentation, read on 2026-11-13 | Cache scoping and `cache-mode`; job outputs; fork tokens. Quoted in finding M5 and in §5 |

Three limits on these results:
- This worktree has no `node_modules`, so `@trommel/core` resolved to the main checkout. That checkout was clean and at the same commit, so the tests and the CLI ran the committed code.
- Everything ran on Windows 11 with Node 26.4. Statements about other operating systems come from reading the code and from one simulated build (finding M1).
- The probe scripts are not in the repository. They are small enough to rebuild as tests from the inputs given.

---

## 1. Verdict

**The foundation is sound enough to build M2 on, if seven contracts are corrected before records exist.** The central idea holds: a skip is justified by content equality of a recorded closure, not by a commit diff, so the choice of base cannot affect safety. The merged M1 code implements it with care. Snapshots come from git objects only. Absent paths and directory listings are nodes. Whatever cannot be decided runs. I could not make the selector miss a change to anything it had resolved statically. What is not yet right is the boundary of the guarantee. Three paths skip or never run a test that should run, and the planned per-test recording closes none of them: inputs read outside a test's own worker, tests that Trommel's own discovery does not find, and an environment compared in the wrong job. Four more contracts are too loose to build records on: what a record contains, which runs count as evidence, how flake observations are scoped, and what a map's static layer may hold. All seven are cheap to fix this week and expensive after M2 writes its first record.

---

## 2. Findings

### 2.1 Summary

| ID | Severity | Finding | Category |
|---|---|---|---|
| C1 | Critical | Capture completeness has no evidence source for inputs read outside a test's worker or named by string in runner config, and the L1 backstop misses unreached modules and other packages | Correct ADR-0005 in place; fix in code now; new DECISIONS entry at M2 |
| C2 | Critical | A plan is an allowlist built from Trommel's own test discovery, so a test the runner would run but Trommel does not find never runs | Correct ADR-0004 in place; fix in code now; defer the rest to M3 |
| C3 | Critical | The environment is compared in the plan job, not where tests run, and a test can hold only one record | Correct ADR-0005, 0009 and 0021 in place; fix in code now; defer the rest to M3 |
| H1 | High | A record is under-specified: what its closure is, what it stores and what validity compares | Correct ADR-0005 and 0009 in place |
| H2 | High | Runs of unreviewed pull-request code count as shared evidence | Correct ADR-0012 in place; defer to M3 and M5 |
| H3 | High | One pull request can quarantine a test for everyone, and one outage can quarantine many | Correct ADR-0014 in place; defer to M7 |
| H4 | High | Architecture §3.5's narrower `u:` rule is unsound, because modules found only at run time carry no resolution evidence | New DECISIONS entry; defer to M2 |
| M1 | Medium | The static map embeds the builder's OS and Node version, so it is not byte-identical across OSes | Fix in code now |
| M2 | Medium | SMAP: fix the model now, build the container and static layer in M1, add records in M3 | Correct ADR-0009 in place |
| M3 | Medium | Probe evidence is 84% of edges; exact hub nodes remove it at no cost in precision (settles DECISIONS 17) | Fix in code now; new DECISIONS entry |
| M4 | Medium | Provenance is a one-byte mask, not 2 bits (settles DECISIONS 16) | Correct ADR-0009 in place |
| M5 | Medium | Lite mode: forks cannot replace the map, but the trust base is wider than ADR-0021 says | Correct ADR-0021 in place; defer to M3 |
| M6 | Medium | Static extraction drops four kinds of dependency without flagging them | Fix in code now |
| M7 | Medium | K1 cannot be judged as written, and the corpus being collected does not feed it | New DECISIONS entry; amend TARGETS.md before M4 |
| M8 | Medium | `generated` rules cannot work as §3.1 describes, and build outputs decide the savings on most of the corpus | New DECISIONS entry; defer to M3 |
| L1–L7 | Low | Map consistency, glob keys, resolver evidence, job-output size, document drift, `package.json` precision, tracked environment | Fix in code now, or with the milestone named |

### 2.2 The safety model, one input at a time

This table answers the first review question. "Static" is what the merged code does. "Dynamic" is what [architecture.md](../architecture.md) §3.2 plans for M2.

| An outcome can depend on | Static graph | Dynamic record | Backstop | Result |
|---|---|---|---|---|
| A module imported with a literal specifier | Edges to targets | Executed scripts | — | **Caught.** Verified by the 2,000-run property and my probes |
| A file that would shadow that import | Absent (⊥) and `d:` nodes | — | — | **Caught.** Verified |
| A non-literal `import()` or `require` | `u:` node, always a seed | The script, with no probes | — | **Escalated** today. **Missed** if §3.5's narrower rule is adopted (H4) |
| A tracked file read through `fs` in the test's worker | Only `new URL(…, import.meta.url)`, `?raw` and globs | fs hooks: `f:`, `d:`, ⊥ | L1 for a file that is not a node | **Escalated** within the owning package. Caught dynamically if the hooks are complete (inferred) |
| A file read by the runner's main process or at worker start-up: Babel, PostCSS and plugin configs | Conventional names only | None planned | L1 for non-module files only, same package only | **Missed** (C1) |
| A file or package the runner config names by string: `globalSetup`, `transform`, `preset`, `testEnvironment` | No | Aliases only | None for module files | **Missed** (C1) |
| The runner config and what it imports | Conventional names, imports followed | — | L2 through the global hub | **Caught** for conventional names |
| An environment variable | Only those in `env.track`; none by default | None | — | **Missed** unless declared, and compared in the wrong job (C3) |
| Runtime version, OS, architecture | `e:runtime`, `e:platform` of the plan job | The record's environment | — | **Caught** only where plan and tests share one image (C3) |
| Time, randomness, network, external services | Outside assumption A1 | — | Nightly runs, the flake ledger | **Missed by assumption.** Documented. H1 adds a record horizon |
| State shared between test files | The file is the unit; `isolate: false` warns | Untracked reads are flagged | — | **Caught** within a file. State in a database or a fixed path is missed by assumption |
| Generated or untracked files | The import is unresolved, so `u:` | The test always runs unless a `generated` rule covers it | — | **Escalated.** The rule itself is not implementable as written (M8) |
| Snapshot files | No | fs hooks | L1 | **Escalated** statically; caught dynamically |
| An external package that a module imports | `p:` per install location, with package-to-package edges | Scripts under `node_modules` | An unparseable lockfile runs everything when it changes | **Caught** |
| A package loaded by name or implicitly: the runner under globals, presets, transformers | No | Only if it executes in the worker | None | **Missed** (C1, probe 4) |
| The toolchain outside the lockfile: Node patch, package manager, runner image | No | No | `.npmrc`, `.nvmrc` and workflow files are non-module root files, so L1 runs everything | **Escalated** when a tracked file changes. **Missed** when a floating version moves (C3) |
| Which files are tests | Trommel's own globs | — | — | **Missed** (C2) |
| The merge commit against the head | The plan hashes the tree it checked out | — | — | **Caught by construction.** C3 adds a check that each shard runs that tree |
| Workflow files | Non-module file at the root, so L1 runs everything | — | — | **Escalated** |
| `trommel.config.json`, the object format, a non-UTF-8 path | L3 | — | — | **Caught.** Verified |

---

### Critical

#### C1. Capture completeness has no evidence source for three classes of input, and L1 does not reach them

**Claim.** The safety theorem in architecture §3.3 rests on assumption A2: "the union closure contains every input read". The planned dynamic source records what one test file's worker executes and reads (§3.2). Three classes of input are read somewhere else, and nothing records them:
- files the runner reads in its main process or once per worker: Babel, PostCSS, Tailwind and plugin configuration, and `globalSetup`;
- files and packages the runner config names by a string, not an import: Jest's `preset`, `transform`, `testEnvironment` and `globalSetup`, Vitest's `globalSetup`, and setup files with unconventional names;
- anything that reaches tests through a step outside the runner: a seed or code-generation script, a migration, a child process.

L1 is meant to be the net for "a changed file not in V(G_S)". It has two holes. Every module file is a node whether or not anything reaches it ([static.ts:212](../../packages/core/src/graph/static.ts#L212)), so a changed module never escalates. And L1 forces only the tests whose path lies under the owning package ([plan.ts:126](../../packages/core/src/select/plan.ts#L126)), not the tests that depend on that package.

**Evidence.**
- **Verified, probe 1.** `packages/db/migrations/001.sql` is modified. `packages/api/src/handler.ts` imports `db`, and `packages/api/test/api.test.ts` imports the handler. Result: L1 with scope `packages/db`; only `packages/db/test/db.test.ts` is forced; the api test is a would-skip.
- **Verified, probe 2.** `babel.config.js` and `scripts/seed-db.ts` are modified, with the CLI's default global patterns. Result: `changed` lists both files, there is no escalation, and nothing is selected.
- **Verified, probe 4.** The lockfile bumps `jest` and `ts-jest`; `package.json` names `ts-jest` as a preset; the test uses globals. Result: both `p:` nodes change, and nothing is selected.
- **Verified on this repository.** Of 126 module nodes, 63 are reached by no test: 47 fixtures and 16 others. Two of the 16 are `packages/cli/src/cli.ts` and `main.ts`, which `cli.test.ts` runs as a child process. The day-10 branch had to add a hand-written `declared` rule for exactly this (its DECISIONS 25).
- **Verified.** The default global inputs are the root `package.json`, `.env*`, Vite, Vitest and Jest configs, and `vitest.setup.*` and `jest.setup.*` ([config.ts:57](../../packages/cli/src/config.ts#L57)).
- **Inferred.** Worker hooks will not see main-process reads. No recorder exists yet. The basis is §3.2 ("hooks installed in the worker") and [threat-model.md](../threat-model.md) §2.1, whose first row already concedes that the Vite server process is invisible to worker coverage.

**Failure scenario.** A Jest project adds a plugin to `babel.config.js`, which changes the compiled output of every source file. In safe mode Δ is that one file. No test has an edge to it: nothing imports it, and Babel loaded it once per worker, outside any test file's window. Every test with a valid record is skipped. The same happens for `globalSetup: './test/global-setup.ts'`, which is a string in the config and runs in the main process.

**Recommended change.**
1. **ADR-0005** states the scope of A2 and the rules that make it hold (text in §3):
   - Evidence has three scopes: one test file, one worker, one run. Whatever is read outside a test file's own window belongs to every test in that scope, through a hub node as `g:inputs.global` is today.
   - At record time the runner reports its effective configuration: every file and package it names, and the scripts its main process loaded. Today §3.2 asks only for aliases.
   - A changed node that no test reaches is an unmapped input, and escalates like a file outside the graph.
   - L1 seeds the graph: every node of the owning package becomes changed. The escalation then follows dependencies across packages and gets why-paths. It is a superset of today's rule, because each test's own node lies under its package.
2. **Code now**, in `select/plan.ts` and `graph/static.ts`: the two selector rules above, and a declared edge from every test to its runner's package node.
3. **Measure the cost in shadow mode.** On this repository the unreached-module rule would have fired on 14 of the last 70 non-merge commits, and in 4 of them no module that a test reaches changed at all. The 16 files are benchmarks, scripts, CLI entry points and placeholders. `inputs.ignore` should apply to unreached modules, and the summary should always list them.
4. **M2**, as a DECISIONS entry at its start: the recorder's three scopes and the reported-config list.

**Category.** Correct ADR-0005 in place. Fix in code now. New DECISIONS entry at M2.

**Cost if deferred.** M2 records would have no place for worker-scoped or run-scoped evidence, so every one would be discarded when the scope is added. Shadow data from M3 would under-count escapes for exactly these classes. Enforcement would ship with a whole-suite skip on a config edit.

#### C2. A plan is an allowlist built from Trommel's own test discovery

**Claim.** `trommel run` gives the runner "the shard's exact file list" (architecture §5.1), and [ADR-0004](../adr/0004-test-file-selection-unit.md) says plugins "apply the plan's exact file list". The list comes from Trommel's own globs, which approximate the runner's. A test the runner would run and Trommel does not find is in no list. It never runs, in shadow mode or in safe mode. It is in neither the run set nor the would-skip set, so audit sampling and escape accounting never see it.

**Evidence.**
- **Verified.** In shadow mode `run` is Trommel's discovered set ([report.ts:47](../../packages/cli/src/report.ts#L47)).
- **Verified.** Trommel's default exclude adds `**/fixtures/**` ([config.ts:55](../../packages/cli/src/config.ts#L55)). Vitest 5.1's default exclude is `**/node_modules/**` and `**/.git/**` only, read from the installed package. `discoverTests` on `test/fixtures/b.test.ts` and `e2e/fixtures/d.test.tsx` finds neither; Vitest's defaults would run both.
- **Verified.** [DECISIONS.md](../../DECISIONS.md) entry 24 already records a mismatch on hono, whose Vitest projects select tests differently.
- **Verified.** When nothing is discovered, `count` is 0, the test job is skipped, and the day-10 gate passes (`TEST = skipped` and `COUNT = 0`).
- **Inferred.** Jest 30's default `testMatch` also matches `.mjs`, `.cjs`, `.mts` and `.cts` files, which [config.ts:54](../../packages/cli/src/config.ts#L54) does not. Jest is not installed here.

**Failure scenario.** A repository keeps a regression test at `test/fixtures/regression.test.ts`, or selects tests with a Vitest `projects` include that `trommel.config.json` does not mirror. After it adopts the workflow, that file is in no shard. A pull request that breaks it merges green. Nothing reports a skip, because none was planned.

**Recommended change.**
1. **ADR-0004:** the runner, not Trommel, decides what a test file is. A plan selects among the tests Trommel knows. `trommel run` asks the runner for the files it discovers and also runs every discovered file the plan does not mention, each in exactly one shard, assigned by a stable hash.
2. Record runs report the runner's discovered set and the map stores it, so a plan can warn when its own discovery disagrees.
3. A plan that knows no tests runs the project's command unfiltered. It does not emit `count=0`.
4. **Code now:** make default discovery mirror the runner's defaults, and move this repository's `**/fixtures/**` into its own `trommel.config.json`.
5. Until `trommel run` exists, keep the full run in `ci.yml` as a required check (HANDOFF §10, item 2).

**Category.** Correct ADR-0004 in place. Fix in code now (items 3 and 4). Defer items 1 and 2 to M3.

**Cost if deferred.** The first foreign repository silently loses tests. The M4 replay compares Trommel's selection against a full run that the runner discovers by itself, so every undiscovered failing test counts as a miss against K1. Once `trommel-gate` is the only required check, those tests stop gating anything.

#### C3. The environment is compared in the plan job, and a test can hold only one record

**Claim.** A safe skip needs "the env components are equal" (§3.3; ADR-0005, item 2). Neither text says whose environment. The built code and the planned workflow measure it in the plan job. The tests run in other jobs, often on several images. Separately, Lite mode keeps one map per commit and SMAP's test table has one record per test, so records from two environments cannot coexist. The server model is already right on this point: `snapshots` is unique on `(repo_id, tree_oid, env_fp)`.

**Evidence.**
- **Verified.** The plan computes the environment from its own process ([cli.ts:207](../../packages/cli/src/cli.ts#L207)). HANDOFF §11 says so: "`e:runtime` and `e:platform` describe the machine that runs `trommel plan`, not the test shards'".
- **Verified.** This repository's own [ci.yml](../../.github/workflows/ci.yml) runs four cells: Ubuntu on Node 22, 24 and 26, and Windows on Node 22. The workflow in §5.3 has one plan job.
- **Verified in GitHub's documentation.** "You cannot change the contents of an existing cache." So with the key `trommel-map-<sha>`, the first cell to save wins and the others cannot save (inferred from that sentence; not run).
- **Verified.** [ADR-0009](../adr/0009-smap-binary-map-format.md) gives the test table one "record reference, environment fingerprint, closure digest".

**Failure scenarios.**
- `main` is red on Node 22 only: test T fails there and passes on 24 and 26. T's record comes from the Node 26 cell. A pull request does not touch T's closure. The plan job, on Node 26, finds a valid record and an equal environment, so T is skipped in every cell. The Node 22 cell reports green on a test that fails there.
- `setup-node` resolves `22` to a new minor release between the record and the pull request. The plan job is pinned to another version and sees no change. The shard skips T on a record from another runtime, which the design's own rule (runtime major.minor) says has no proof.

**Recommended change.**
1. **ADR-0005:** the environment that must match is that of the job that would run the test, and the check happens in that job.
2. **Plan and `trommel run`, in M3.** The plan gives each shard its run list and a fallback list: the skipped tests assigned to it, each with the environment fingerprint its record needs. `trommel run` computes the shard's real fingerprint, runs every fallback test whose fingerprint differs, and runs everything if the shard's tree is not the planned tree.
3. **Keys.** Records and maps are keyed by environment cell. The SMAP test table allows several records per test. The Lite cache key carries the cell.
4. **Components**, decided at M2: the full runtime version, the runner's name and version, a digest of the runner's effective configuration, and the runner image (`ImageOS`). The configuration digest also stops a record made under one command from matching a run under another (H2).
5. **Code now:** take `e:` nodes out of the static map (M1 explains why they also break determinism).

**Category.** Correct ADR-0005, ADR-0009 and ADR-0021 in place. Fix in code now (item 5). Defer items 2 to 4 to M3.

**Cost if deferred.** The record store, plan protocol v1 and SMAP's test table would be keyed by test alone. Adding the cell later is a schema and protocol break, plus a full re-record.

---

### High

#### H1. A record is under-specified where M2 will harden it

**Claim.** §3.3 defines C(t) as the "forward static closure at S ∪ dynamic deps of R ∪ declared deps", and validity as `hash_S(n) = hash_R(n)` for every n in it. Five things are left open, and M2 will have to pick an answer for each without a specification:
- whether the static imports of a module found only at run time belong to C(t). The reverse search over the union graph includes them. A per-test forward walk written from the definition might not, so the planner and the independent verifier (P4) could disagree;
- how `hash_R(n)` is known for a node that R never listed. It needs R's whole snapshot. Garbage collection keeps the latest 5 snapshots per branch (§4.2), while a record can stay valid for months;
- what an engine upgrade does to old records. A map from another engine is invalid ([map.ts:24](../../packages/core/src/graph/map.ts#L24)); nothing says the same of a record;
- what "stale" means. §3.3 step 4 uses the word and never defines it;
- how the closure digest is framed. §3.6 says "SHA-256 of the sorted (node, hash) pairs" and no more.

**Evidence.** Verified by reading §3.3, §3.6, §3.9, §4.2 and ADR-0009. No record code exists yet, so there is nothing to run.

**Failure scenarios.**
- An engine upgrade teaches the resolver a new edge, f → m, and m changed between R and S. Under "static closure at S", C(t) now contains m, and `hash_R(m)` is unknown. An implementation that reads unknown as equal skips t. One that reads it as different re-runs everything after each release. Neither is specified.
- A record shows that a test loaded `locales/en.ts` through a non-literal import. `en.ts` imports `./strings.json?raw`, a transform-time input that V8 coverage does not see. If C(t) follows static edges only from the test, a change to `strings.json` is skipped.

**Recommended change.** ADR-0005 (text in §3):
- **C_R(t)** is everything reachable from t in the union graph of the snapshot the record ran on: all static and declared edges, plus the dynamic edges of that execution.
- **A record is self-contained.** It stores its closure as (node, hash) pairs, its environment components, the engine and recorder versions, its completeness flags and its time.
- **Validity is base-free.** R is valid at H when every pair has the same hash at H, the environment matches at the executor, the versions match, no flag is set, and R is younger than the horizon. The map, Δ and the reverse search are how the planner computes this. They are not a second definition, and a proof never names S.
- **The digest** is SHA-256 over the canonical JSON of `["trommel-closure-1", [[node, hash], …]]`, with ⊥ as `null`.

**Category.** Correct ADR-0005 in place, with ADR-0009's test table.

**Cost if deferred.** M2 writes records in a shape that M3's validity check, M3's verifier and M7's flake classes each read differently. Changing the digest later resets every record and every v2 flake class.

#### H2. Runs of unreviewed pull-request code count as shared evidence

**Claim.** [ADR-0012](../adr/0012-ci-auth-and-trust-lanes.md) puts same-repository pull requests by owners, members and collaborators in the trusted lane, whose records "become skip evidence or flake observations" for everyone. The code and the workflow that produce those records are the pull request's own, and nobody has reviewed them.

**Evidence.**
- **Verified.** ADR-0012, Decision; threat-model §1.3. `workflow_dispatch` "by writers" has no restriction on the ref.
- **Verified.** `trommel record` uploads "graph segments (trusted lanes)" (§5.1), and extraction results are cached by blob id and extractor version (§3.2). The server never sees file contents, so it cannot check either.
- **Verified by reading.** A changed workflow file is in no test's closure. It escalates L1 at the root, which forces every test to run on that pull request ([plan.ts:100](../../packages/core/src/select/plan.ts#L100)). Probe 1 exercises the same code path with another file.

**Failure scenario, with no bad intent.** A work-in-progress pull request narrows its test command to `-t smoke` in the workflow file to get feedback sooner. L1 forces every test file to run. Each passes in seconds, having run almost nothing, and each record's closure equals `main`'s. Those records are trusted. From then on every pull request skips those tests on the strength of runs that tested nothing. A compromised account can do the same on purpose, or upload forged extraction results for `main`'s blob ids. Neither needs a review.

**Recommended change.** ADR-0012 (text in §3):
- **Shared evidence comes only from runs of reviewed code:** pushes and schedules on the default branch, `workflow_dispatch` on the default branch, and `merge_group`.
- **Every pull-request run is evidence for its own pull request only**, whoever the author is. `author_association` decides whether a pull request can authenticate, not whether it is believed.
- **The server classifies from verified OIDC claims** (`event_name`, `ref`, `job_workflow_ref`), never from what the CLI reports.
- Lite mode gets the same split from GitHub's cache scopes at no cost (M5).

**Category.** Correct ADR-0012 in place. Defer the implementation to M3 (Lite) and M5 (server).

**Cost if deferred.** After M5 the lane columns and the `oidc_trust` rules encode the wider definition. Narrowing it later means re-classifying stored records and telling early users that their skips rested on unreviewed runs.

#### H3. One pull request can quarantine a test for everyone, and one outage can quarantine many

**Claim.** Two flaky failures close together quarantine a test. Observations come from trusted lanes, which include pull requests. Flake state is one row per test. So two rerun-until-green episodes on one branch disable a test for the whole repository.

**Evidence.**
- **Verified by arithmetic** from [ADR-0014](../adr/0014-flake-decisions-sprt.md): the first flaky failure starts the log-likelihood ratio at 2.30, a second adds 2.303, each pass subtracts 0.0182, and the threshold is 4.55. Fail, pass, fail, pass gives 2.303 − 0.018 + 2.303 − 0.018 = 4.57.
- **Verified.** `flake_state` has the key `(tenant_id, test_id)` (§4.1). A quarantined test's failures never fail a build (§3.6).

**Failure scenarios.**
- A pull request adds a race to code under test T. T fails, the rerun passes, the next push fails, the rerun passes. T is now quarantined for everyone, for at least the 7-day cool-off and about 247 clean observations. That pull request merges with the race. So does any other pull request that breaks T outright.
- A registry outage makes 50 tests fail and then pass on retry, in two runs. That is 50 quarantines. The sequential test assumes independent observations, and these are not.

**Recommended change.** ADR-0014 (text in §3):
- An observation counts toward shared state when its inputs are inputs the default branch has had. In v1 that is a default-branch tree; in v2, a closure fingerprint that occurs in an evidence-lane map.
- An observation on content that exists only in a pull request counts for that pull request's own report. It moves shared state only together with a flaky failure from the default branch or from a second pull request. **No single pull request can quarantine a test.**
- When more than a set number of tests flip in one job, the job is an environment incident and adds no per-test observation.
- Note in the ADR that with selection enforced, unaffected tests do not run on pull requests. Detection without reruns then draws on default-branch, nightly, audit and shadow runs. The expected sample numbers in §3.6 assume more.

**Category.** Correct ADR-0014 in place. Defer the implementation to M7.

**Cost if deferred.** No code is affected before M7. The ADR freezes in three days, and the `class_key` and `flake_state` schema lands in M5 and M6 without a field for where an observation came from.

#### H4. Architecture §3.5's narrower `u:` rule is unsound

**Claim.** §3.5 escalates an unresolved or non-literal import only "in a changed file without dynamic coverage". A module found at run time has an edge from the test and nothing else: no absent paths and no listing. A file that would shadow it is invisible. The day-9 rule, every `u:` node is always a seed, is what keeps this safe, and one other line of the selector depends on it.

**Evidence.**
- **Verified.** New module files are exempt from L1, with the comment "A new module nothing loaded at S can only matter through probes and listings already in Δ" ([plan.ts:103](../../packages/core/src/select/plan.ts#L103)). That holds only while every load has probes.
- **Verified, probe 12.** A file that becomes uncertain at the head is selected, because the file itself changed. The day-9 rule has no hole of its own.
- **Inferred.** Vitest resolves modules in the Vite server process, outside worker hooks (threat-model §2.1, first row).

**Failure scenario.** The code is ``await import(`./locales/${lang}`)``, and the record shows that `locales/en.ts` ran. The head adds `locales/en.js`. Vite's default order tries `.js` before `.ts` (DECISIONS 1, gap 4), so the test now loads the new file. The new file is a module, so L1 exempts it. `f:locales/en.ts` is unchanged. With dynamic coverage, §3.5 raises nothing, and the test is skipped.

**Recommended change.**
- Keep the day-9 rule as the default at every milestone: **every `u:` node is a seed.**
- A record may discharge a `u:` node for its own test only when it carries resolution evidence for that importer. The plugin records the (importer, specifier) pairs that non-literal imports produced at run time, and the static resolver turns each into targets and probes as it does for a literal import. Vite's `resolveId` hook and Jest's `resolver` option are the likely extension points (inferred).
- Record in DECISIONS that the exemption at `plan.ts:106` is sound only under this rule, and correct §3.5's first row.

**Category.** New DECISIONS entry. Architecture §3.5 is a living document and needs no ADR. Defer the resolution evidence to M2.

**Cost if deferred.** M3 implements §3.5 as written and ships an unsafe skip for every locale loader and plugin loader.

---

### Medium

#### M1. The static map embeds the builder's OS and Node version

**Claim.** The map holds `e:runtime` and `e:platform`, measured on the machine that ran `trommel graph`. The same tree therefore gives different bytes on Linux and Windows. That breaks M1's exit criterion, "byte-identical SMAP across OSes", by construction.

**Evidence.**
- **Verified.** [static.ts:134](../../packages/core/src/graph/static.ts#L134) and [static.ts:254](../../packages/core/src/graph/static.ts#L254).
- **Verified, probe 10.** One tree built with a `linux-x64` and a `win32-x64` environment gives different bytes. The only node that differs is `e:platform`.
- **Verified.** The only determinism tests compare two builds on one machine ([cli.test.ts:112](../../packages/cli/test/cli.test.ts#L112)). Nothing pins a hash across operating systems.
- **Verified.** `ENGINE` is a hand-written string ([static.ts:21](../../packages/core/src/graph/static.ts#L21)). Nothing fails when the resolver's output changes and the string does not.

**Failure scenario.** A map built by a developer on Windows is used by a Linux plan: every test counts as affected. That direction is safe. The costly direction comes later: content-addressed chunks cannot be shared between environment cells, and after a resolver fix an older CLI's map, with its missing edges, is still accepted, because nobody bumped `ENGINE`.

**Recommended change.**
- Take `e:` nodes out of the static map. They belong to records (C3).
- Add a golden test: the SHA-256 of a fixture repository's map, asserted on every CI operating system.
- Add an engine guard: when that hash changes, the test fails unless `ENGINE` changed too.

**Category.** Fix in code now.

**Cost if deferred.** M1 cannot meet its exit criterion. Once records exist, a stale-engine map becomes a wrong skip, not a wrong would-skip.

#### M2. SMAP: fix the model now, build the container and static layer in M1, add records in M3

**Claim.** The JSON map is the right vehicle through M2. The M1 week-3 plan builds SMAP v0 before its record table can be designed, so the format would be built twice. What has to be fixed now is the logical model. The binary container and the static layer are stable enough to build in week 3. The record layer should arrive as a new section in M3.

**Evidence.**
- **Verified by measurement at 10,000 files.** The JSON map is 26.7 MB, or 1.60 MB gzipped. Parsing takes 0.39 s, the CSR build 0.45 s, selection 0.55 s, and the process holds 556 MB. That is adequate for dogfooding. It does not scale to the 100,000 files in threat-model §2.3: ten times that memory is about 5.6 GB, beyond Node's default heap (inferred; not run at that size).
- **Verified by measurement.** A plain binary layout of the same map is 2.20 MB, or 0.33 MB gzipped: a front-coded key table of 0.44 MB, forward adjacency of 0.88 MB, one provenance byte per edge at 0.68 MB, and hashes at 0.20 MB.
- **Verified by measurement.** The reverse index derived from the forward arrays takes 2.7 ms for 684,501 edges and equals the built one. Storing both directions, as ADR-0009 says, doubles the largest section and leaves open which one to believe when they disagree.
- **Inferred.** "Unchanged packages reuse their chunks across snapshots" (ADR-0009) cannot hold with global sorted ids, because one inserted node shifts every later id. It needs chunk-local ids and an import table, and only the server (M5) needs chunks.

**Recommended change.** ADR-0009 (text in §3) fixes these now:
- **A container** with a section table and per-section versions, so the record layer is an addition and not a new format;
- **three layers**, each with its own content address: the snapshot, the static graph, and the records. The first two are a function of the tree, the config and the engine alone, and carry no timestamp;
- **node identity is the key string.** Numeric ids are positions in one file and never leave it;
- **one order everywhere:** UTF-16 code units, as built, written into the specification with a golden vector that has a path above U+FFFF. The pytest plugin (M8) will otherwise sort by code point, which differs for exactly those paths;
- **forward adjacency only;** the decoder derives the reverse;
- **a SHA-256 trailer.** A map that fails any check is invalid, and the plan runs everything;
- **chunking is defined in M5.**

**Category.** Correct ADR-0009 in place.

**Cost if deferred.** One rebuild of the format in M3, and a sort order that a second implementation can get wrong without any test noticing.

#### M3. Probe evidence is 84% of edges; exact hub nodes remove it (settles DECISIONS 17)

**Claim.** Most of the graph is evidence that many importers share: the candidate paths of one resolved path, and the config files above one directory. Both depend only on that path or directory, never on the importer. Giving each a hub node removes the repetition with no loss of precision.

**Evidence.**
- **Verified by measurement at 10,000 files.** 510,000 edges go to absent files and 67,000 to absent directories: 84.3% of the 684,501. Of 106,390 nodes, 86,802 are absent files and 9,541 absent directories: 90.6%. The edge section is 21.6 MB of the 26.7 MB.
- **Verified on this repository.** 1,890 of 2,777 edges are probes, and 1,003 of 1,461 nodes are absent files. Here the cause is each file's own config chain, since imports carry their extensions.
- **Verified by reading.** The evidence of `resolvePath` depends only on the path ([resolver.ts:253](../../packages/core/src/resolve/resolver.ts#L253)). That of `fileConfigs` depends only on the directory ([resolver.ts:216](../../packages/core/src/resolve/resolver.ts#L216)).
- **Verified by measurement.** Grouping the existing map's probe nodes by directory and stem alone leaves 252,501 edges and 20,710 nodes.
- **Inferred.** Per-directory config chains would remove most of the rest, leaving about 100,000 edges.

**Recommended change.**
- Add two hub kinds: `r:<path>` for one resolved path, and `c:<dir>` for one directory's config chain. An importer keeps one edge per import. The hub holds the edges to the files that exist, and its hash covers which candidates exist.
- A plan finds changed hubs from the added and deleted paths of the snapshot diff, as it does for listings today.
- The soundness property in `plan.test.ts` is the regression test. Its oracle shares no graph code, so it does not care how the builder factors edges.
- Bump `ENGINE`.

**Category.** Fix in code now, together with SMAP v0. A new DECISIONS entry settles entry 17.

**Cost if deferred.** Today the change costs an engine bump. After M2 the node model is inside every record's closure and every closure fingerprint, so it costs a full re-record and resets the v2 flake classes.

#### M4. Provenance is a one-byte mask (settles DECISIONS 16)

**Claim.** ADR-0009's "2-bit edge provenance" cannot hold three independent sources. The code already uses a 3-bit mask. Neither width is worth fixing in the format.

**Evidence.**
- **Verified.** [graph.ts:7](../../packages/core/src/graph/graph.ts#L7) defines the three bits, duplicate edges merge by OR ([graph.ts:44](../../packages/core/src/graph/graph.ts#L44)), and `parseMap` accepts 1 to 7 ([map.ts:66](../../packages/core/src/graph/map.ts#L66)).
- **Verified by reading.** A module that a test both imports statically and executes is static and dynamic at once. That is the common case, not an exception.
- **Verified by reading.** The baselines in [TARGETS.md](../../bench/TARGETS.md) include "Trommel static-only, dynamic-only and union" from one map, so neither source can be dropped.
- **Verified by measurement.** One byte per edge is 0.68 MB of 2.20 MB at 10,000 files before compression, and it is long runs of one value.

**Recommended change.** ADR-0009: provenance is a bitmask per edge, one byte, with bit 0 static, bit 1 dynamic, bit 2 declared, and the rest zero. In the layered format the static layer's edges are static or declared and the record layer's are dynamic by construction, so the byte is mostly an in-memory notion.

**Category.** Correct ADR-0009 in place.

**Cost if deferred.** None in code. The ADR stays wrong after it can no longer be corrected in place.

#### M5. Lite mode: forks cannot replace the map, but the trust base is wider than ADR-0021 says

**Claim.** [ADR-0021](../adr/0021-lite-mode-actions-cache.md) defers its trust model to M3. It can be closed now. GitHub's rules stop a fork or an untrusted author from writing the default branch's cache. What remains is that every workflow on a trusted trigger can write it, and nothing signs the contents.

**Evidence, from GitHub's [dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching), read on 2026-11-13.**
- "When a cache is created by a workflow run triggered on a pull request, the cache is created for the merge ref (`refs/pull/.../merge`). … It cannot be restored by the base branch or other pull requests targeting that base branch."
- The page lists the only triggers that "can create or overwrite caches in the default branch's scope": `push`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build` and `schedule`. Runs on `pull_request_target`, `issue_comment` and `workflow_run` are read-only, unless a workflow declares a write-capable `cache-mode`.
- "Cache contents are not signed or verified." "Anyone who can open a pull request against your repository can read the contents of caches in the base branch."
- "If there are multiple partial matches for a restore key, the action returns the most recently created cache."
- **Verified.** The day-10 workflow saves the map only in a job that runs on pushes to `main`, and the plan uses the restore-only action.

**Failure scenarios.**
- An unrelated workflow that runs on pushes or a schedule on `main` uses a compromised third-party action. It saves `trommel-map-zzz`. Every pull-request plan restores it by prefix until the next push to `main` saves a newer one. In safe mode it can skip anything.
- A repository grants `cache-mode: write` to a `pull_request_target` workflow. The poisoning path that GitHub closed is open again.
- Anyone who can open a pull request can fill the 10 GB quota and evict the map. The plan then runs everything: a cost, not a safety failure.

**Recommended change.** ADR-0021 (text in §3):
- State the trust base: every workflow on a trusted trigger on the default branch, the same trust that dependency caching already asks for.
- The map job is the only one with `cache-mode: write`. The workflow default is `read`.
- The key carries the format version and the environment cell. A pull request restores its base commit's map by exact key first.
- The map names its origin, and a plan runs everything when the origin is not this repository's default branch.
- A pull request's own cache scope carries its pull-request-only evidence (H2).
- Lite proofs are unsigned. `trommel verify` there is a recomputation, not an attestation.
- Lite mode does not enforce skips in a repository that grants cache writes to low-trust triggers.

**Category.** Correct ADR-0021 in place. Defer the implementation to M3.

**Cost if deferred.** The decision to let Lite mode enforce stays blocked on a check that can be answered today, and the cache key ships without a format version or a cell.

#### M6. Static extraction drops four kinds of dependency without flagging them

**Claim.** HANDOFF §2 says nothing unresolvable is ever dropped. Four cases are dropped without a `u:` node or a diagnostic.

**Evidence, all verified by probe.**

| Probe | Input | Result |
|---|---|---|
| 3 | `test/comp.test.ts` imports `src/Comp.vue`, whose script imports `./dep`. `src/dep.ts` changes | No uncertainty; would-skip. A file kind the lexer cannot read is a plain target |
| 5 | `"vendored": "file:./vendor/vendored"`, a link entry in the lockfile. `vendor/vendored/index.js` changes | The importer's only edge is to `p:npm:node_modules/vendored`, whose hash is constant. Would-skip ([npm.ts:84](../../packages/core/src/lockfile/npm.ts#L84)) |
| 6 | Workspace package `lib`, and a registry copy at `packages/app/node_modules/lib` that Node would load. The copy's integrity changes | The importer has edges to the workspace sources only. Would-skip ([resolver.ts:303](../../packages/core/src/resolve/resolver.ts#L303) returns before `packageName` is set) |
| 7 | `const load = createRequire(import.meta.url); load('./x.cjs')`. `x.cjs` changes | No record, no diagnostic; would-skip ([ts.ts:954](../../packages/core/src/lex/ts.ts#L954) matches the identifier `require`) |

**Failure scenario.** Each row is one. From M3 the dynamic record covers the modules that actually run. The static closure remains the only source for transform-time inputs, and the shadow numbers of M1 to M3 count these as would-skips.

**Recommended change.**
- The importer of a file kind that can import and cannot be lexed is uncertain. That covers `.vue`, `.svelte`, `.astro`, `.mdx` and stylesheets.
- Follow a link entry to its directory, as a workspace package is followed.
- When `locate` finds an installed copy nearer than the workspace link, add its `p:` edge.
- A `createRequire(` call whose result is not named `require` yields a non-literal `require` record.

**Category.** Fix in code now.

**Cost if deferred.** Shadow-mode savings are overstated, and the gaps become part of every recorded closure.

#### M7. K1 cannot be judged as written, and the corpus being collected does not feed it

**Claim.** Three separate things stand between today and a defensible decision on 2027-01-24.

**Evidence.**
- **K1 is measured by replay, not from the collector.** Replay re-executes commits from git history, which does not expire. What the collector protects is flake ground truth for T3, and it archives runs, attempts, jobs, check runs and artifact listings ([collect.ts:102](../../tools/corpus/src/collect.ts#L102)), with no logs. [CORPUS.md](../../bench/CORPUS.md) records that the replay candidates upload no JUnit. A job that failed and then passed says a job flaked, not which test. The logs that could say so expire on the same 90-day clock. Verified.
- **K1's statistic is ambiguous.** "Less than 30% median savings at ≤1% change-level miss rate on at least 5 repos" does not say whether the median is per repository or pooled, whether the miss rate is a point estimate or a bound, or how many faulty changes are needed. With zero misses in n faulty changes, the 95% upper bound is about 3/n, so "≤1%" needs about 300. The enforcement gate in §3.10, "4 consecutive weeks with zero shadow escapes", names no count at all. Verified by reading and arithmetic.
- **The inputs to a fair measurement are not in place.** R2, the offline suite time, is "not checked yet for any repository". 24 of the 26 candidates use pnpm or yarn, which the lockfile module reports as unparseable. On hono, 26 of 161 tests always run because imports of `dist/` are unresolved (DECISIONS 24). Verified. The compute needed is roughly 5 repositories × 200 commits × (1 + k mutants) full runs, and is unknown until R2 is timed (inferred).

**Failure scenario.** On January 24 the pooled median is 34% and two repositories are at 12%. Nothing says which reading of K1 applies. Or the savings are low because half of each monorepo's tests always run for want of a `generated` rule, and the kill gate trips on unfinished engineering, not on the thesis.

**Recommended change.**
- **Amend TARGETS.md** before the first T1 measurement; it allows dated amendments. K1 is the pooled median over eligible repositories. The miss constraint is zero misses among at least 300 faulty changes, real or seeded. A repository is eligible when a stated share of its tests is provable, and the unprovable share is reported per repository.
- **Restate the enforcement gate** by the same count, with 4 weeks as a floor.
- **Time R2** for the 15 candidates now. That needs clones, so ask first.
- **Archive the logs of failed attempts** for runs with more than one attempt. That is a download, so ask first.
- **Start the replay container and the run-all and `vitest related` baselines in M2.** They do not depend on the selector.

**Category.** New DECISIONS entry and a TARGETS.md amendment by the owner. The two collection tasks are for now.

**Cost if deferred.** The number on January 24 can be argued either way. Flake ground truth is lost for every day that expires in the meantime.

#### M8. `generated` rules cannot work as §3.1 describes, and build outputs decide the savings on most of the corpus

**Claim.** §3.1 hashes declared untracked files with `git hash-object`. The plan job has a fresh checkout and no build, so those files do not exist when the plan is computed. Only a rule from outputs to inputs can work. That rule matters more than its place in the plan suggests, because workspace packages that import each other's build output are the normal shape of a pnpm monorepo.

**Evidence.**
- **Verified.** The workflow in §5.3 builds nothing in the plan job. The CLI validates `generated` and does not use it (§5.1).
- **Verified.** On hono, a self-import whose `exports` point at `dist/` is unresolved, so its importers are uncertain (DECISIONS 24).
- **Inferred.** The same happens across packages in most of the corpus. No corpus monorepo was built here.

**Failure scenario.** Package A's tests import `@org/b`, which resolves to `packages/b/dist/index.js`. Statically the import is unresolved, so A's tests always run. Dynamically the test reads an untracked file with no rule, so it always runs. Savings for every test that crosses a package are zero.

**Recommended change.**
- Specify `generated` as outputs to inputs only. An output's hash is the digest of its inputs' hashes and of the generator's package nodes. The planner never hashes an output.
- `trommel run` may compare the outputs it finds with a hash taken at record time. A mismatch means the inputs were under-declared: run the test and open an incident.
- When a workspace package's `exports` point at an absent path that a rule covers, the resolver depends on the rule's inputs.
- Build this before M4.

**Category.** New DECISIONS entry. Defer to M3, ahead of M4.

**Cost if deferred.** K1 is measured on single-package repositories only, or it trips for the reason given in M7.

---

### Low

| ID | Claim and evidence | Failure scenario | Recommended change | Category | Cost if deferred |
|---|---|---|---|---|---|
| L1 | `parseMap` checks that every key of `uncertain` is a node, not the reverse ([map.ts:83](../../packages/core/src/graph/map.ts#L83)), and seeds come from `uncertain` ([plan.ts:94](../../packages/core/src/select/plan.ts#L94)). Verified, probe 11 | A map whose `uncertain` was emptied still holds its `u:` node; it is accepted and the test is a would-skip | Seed every node whose key starts with `u:`, and check both directions | Fix in code now | A writer bug or a damaged map becomes a wrong skip without any error |
| L2 | Glob node keys join the patterns with a vertical bar ([resolver.ts:615](../../packages/core/src/resolve/resolver.ts#L615)). Verified, probe 9: `import.meta.glob(['./p/*.ts', './q/*.ts'])` and a single pattern containing a vertical bar share one node, which keeps the first hash and the last pattern list | A file that matches only the first importer's patterns is added; the plan recomputes with the other list and sees no change | Key the node by a digest of the canonical JSON of the pattern list | Fix in code now | Contrived today; permanent once keys are inside records |
| L3 | `Resolver.resolve` records no `package.json` probe for the root that a leading-slash specifier, a root mock or a glob base resolves against ([resolver.ts:198](../../packages/core/src/resolve/resolver.ts#L198)). Verified, probe 8. It is sound today only because the builder adds each file's own config chain ([static.ts:225](../../packages/core/src/graph/static.ts#L225)) | A refactor that moves config edges into hubs (M3) drops the accidental cover | Record the probes in `resolve`, and add a leading-slash case to the evidence property | Fix in code now, with M3 | A latent miss introduced by an optimization |
| L4 | "Outputs can be a maximum of 1 MB per job" (GitHub workflow syntax reference, read 2026-11-13). The M1 matrix carries the file lists ([report.ts:80](../../packages/cli/src/report.ts#L80)). This closes open question 6 of architecture §8.3 | A run-all fallback on a repository with about 15,000 test files overflows the output, exactly when Trommel has degraded | Keep the lists out of the matrix: pass shard numbers, as §5.3 already does, and let `trommel run` read the plan file | Defer to M3 | The fallback breaks on large repositories |
| L5 | Document drift. ADR-0003 and §3.1 list `sm:` nodes; the code has none, and a submodule path is unresolved or L1. §4.2 says "SMAP v1" where the roadmap says v0. §3.5's lockfile row says "everything that reaches any `p:` node"; the code runs everything, which is stricter. Open question 7 of §8.3 can be closed: fork tokens have write permissions reduced to read, and an OIDC token "requires `id-token: write`" (same reference) | None | Correct the documents; reserve the `sm:` kind in SMAP | With the ADR edits | Confusion only |
| L6 | Each file depends on its whole nearest `package.json`, so a version bump reruns everything. Verified on hono (DECISIONS 24); already listed in HANDOFF §11 | Every release commit in a replay history is a run-all | Hash only the fields that affect loading | Fix in code before M4 | Lower measured savings |
| L7 | No environment variable is tracked by default ([config.ts:264](../../packages/cli/src/config.ts#L264)) | A test that depends on `TZ` or `NODE_OPTIONS` is skipped across a change to it | Choose a default list at M2, and have the recorder report which variables each test read as a `trommel doctor` suggestion, not as closure nodes | New DECISIONS entry at M2 | Missed inputs that need no declaration to prevent |

---

## 3. Proposed ADR edits

**Applied on 2026-11-13** (see the note at the top). Each block is the full replacement for the named section. Everything outside the named sections stays as it is.

### ADR-0003: replace the first two bullets of "Decision"

```markdown
- v1 graph nodes are files plus synthetic nodes:
  - directory listings (`d:`);
  - external packages per install location (`p:`);
  - globs and declared sets (`g:`);
  - resolution hubs: `r:` for one resolved path and `c:` for one directory's config chain. A hub stands for the probes that every importer of that path or directory shares, so an importer has one edge per import, not one per probe;
  - submodule gitlinks (`sm:`);
  - absent paths (hash ⊥);
  - uncertain files (`u:`).
- Environment components are not graph nodes. They belong to a record and are compared where the test runs ([ADR-0005](0005-closure-equality-safety-criterion.md)). The static graph of a snapshot is a function of the tree, the config and the engine version only.
- Edges carry their provenance as a bitmask: static, dynamic, declared.
```

Leave out the hub bullet if finding M3 is not accepted.

### ADR-0004: replace the third bullet of "Decision"

```markdown
- Runner plugins apply the plan's file list. There are no command-line substring filters.
- The runner, not Trommel, decides what a test file is. A plan selects among the test files Trommel knows. `trommel run` asks the runner which files it discovers and also runs every discovered file the plan does not mention, each in exactly one shard. A plan that knows no test files runs the project's command unfiltered.
```

### ADR-0005: replace "Decision" and "Consequences"

```markdown
## Decision
**Records.** A record R is one passing execution of test file t. [ADR-0012](0012-ci-auth-and-trust-lanes.md) says which runs make records that others may rely on. A record is self-contained. It stores:
- its closure C_R(t) as (node, hash) pairs: every node reachable from t in the union graph of the snapshot it ran on. That graph has all static and declared edges of the snapshot plus the dynamic edges this execution recorded, and static edges are followed from modules found at run time too;
- the closure digest: SHA-256 over the canonical JSON of `["trommel-closure-1", [[node, hash], …]]`, with ⊥ as `null`;
- its environment components, measured in the process that ran the test;
- the versions of the static engine and of the recorder, and the time of the run;
- completeness flags: anything the recorder saw and could not map, such as a subprocess it could not attach to, an untracked file with no `generated` rule, or a script with no node.

**Capture scope.** Dynamic evidence has three scopes: one test file, one worker, one run. What is read or loaded outside a test file's own window (runner start-up, transform and plugin configuration, global setup, worker bootstrap) belongs to every test in that scope. At record time the runner reports its effective configuration: every file and package it names, not only its aliases.

**Safe skip.** Test t may be skipped at head snapshot H only if a record R of t exists and all of these hold:
1. every (node, hash) pair of C_R(t) has the same hash at H;
2. R's environment components equal those of the job that would run t, checked in that job;
3. R was made by the planner's static engine and recorder versions, has no completeness flag, and is younger than the configured horizon;
4. no escalation below applies to t;
5. t is not in the audit sample.

The planner computes conditions 1 and 4 from a base map M_S and Δ(S, H) by reverse search ([architecture.md](../architecture.md) §3.3). That is one way to compute this definition, not a second definition: S never appears in a proof.

**Escalations that override a record.**
- Every uncertain node (`u:`) counts as changed at every H, unless R carries resolution evidence for that importer.
- A changed file that is not a node, and a changed node that no test reaches, are unmapped inputs. Every node of the owning package then counts as changed.
- Lockfile, config and map problems run everything ([architecture.md](../architecture.md) §3.5).

Every skip emits a proof that `trommel verify` can recheck from R and a checkout of H. A server signs its proofs. In Lite mode proofs are unsigned and no more trustworthy than the map they came from ([ADR-0021](0021-lite-mode-actions-cache.md)). Safe mode never uses predicted probabilities.

**What the guarantee covers.** Under determinism (A1) and capture completeness (A2), a safe skip has the outcome of R. Time, randomness, the network, external services and state shared between test files are outside A1. They are documented, bounded by the record horizon and the nightly full run, and surfaced by the flake ledger.

## Consequences
- Soundness does not depend on which base is chosen; the base affects only precision.
- A record is evidence only for the environment it ran in. Outside its own pull request, it is evidence only if it ran reviewed code.
- Records are reusable across commits whenever closure contents match. That is how maps stay fresh without running the full suite on every push.
- An engine or recorder upgrade invalidates the records made before it. A full recorded run follows each upgrade.
- Correctness depends on capture completeness. That requires the union graph, absent and listing nodes, the three capture scopes, the runner's reported configuration, shadow mode, audit sampling, nightly runs and the seeded-fault gate.
```

### ADR-0009: replace "Decision" and "Consequences"

```markdown
## Decision
SMAP is a little-endian binary container, encoded and decoded with `DataView`.

**Container.**
- A header: magic, format version, hash algorithm (`sha1` or `sha256`, the repository's object format) and static engine id.
- A section table: tag, section version, flags, offset and length. A decoder skips an unknown optional section and rejects the map on an unknown required one.
- A trailer: SHA-256 of everything before it.

A map that fails any check is invalid, and the plan runs everything.

**Layers.** Each has its own sections and its own content address.
- **Snapshot:** the tree listing as mode, object id and path.
- **Static graph:** the nodes and edges derived from the snapshot, the config and the engine alone. It holds nothing about the machine that built it and no timestamp, so one tree gives the same bytes on every OS.
- **Records** (from M3): per test and environment cell, the record reference, environment fingerprint, closure digest, dynamic edges, completeness flags and time of the run. A test may have several records.

**Encoding.**
- A node's identity is its key string: `f:`, `d:`, `g:`, `p:`, `r:`, `c:`, `u:` or `sm:`. Kinds for skeleton and body are reserved. A numeric id is a position in one file's key table and never appears outside that file.
- Keys are sorted by UTF-16 code units, the order canonical JSON uses. They are stored as UTF-8, front-coded, with no Unicode normalization.
- Adjacency is stored forward only, with delta-varint targets. The decoder derives the reverse index.
- Provenance is a bitmask per edge, one byte: bit 0 static, bit 1 dynamic, bit 2 declared. The other bits are zero. Duplicate edges merge by OR.
- A hash is stored only where a plan cannot derive the change from the snapshot diff: packages, globs and uncertain causes.

**Chunking** per workspace package, with chunk-local ids and an import table, is defined when the server needs it (M5). Until then a map is one file.

## Consequences
- The format is versioned, with golden vectors, round-trip property tests and decoder fuzzing. One golden vector has a path with a character above U+FFFF.
- CI asserts one fixture repository's static-layer hash on every OS. A change to that hash without a change to the engine id fails the build.
- The record layer is an addition to the container, not a new format.
```

### ADR-0012: replace the "Lanes" and "Only trusted records" bullets of "Decision", and add one alternative

```markdown
- **Lanes.** Every run is classified from its verified claims (`event_name`, `ref`, `job_workflow_ref`), never from what the client reports:
  - **evidence:** runs of reviewed code, which are pushes and schedules on the default branch, `workflow_dispatch` on the default branch, and `merge_group`;
  - **pull request:** any pull-request run that can authenticate, whoever its author is;
  - **untrusted:** fork pull requests and unknown actors, which cannot authenticate.
- **Only evidence-lane runs change shared state:** records, static graph segments, the extraction cache and flake state. [ADR-0014](0014-flake-decisions-sprt.md) says when a pull-request observation may also count.
- **A pull-request run is evidence for its own pull request only.** Its records may skip tests on later pushes to that pull request, and nowhere else.
```

Add under "Alternatives considered":

```markdown
- **Trust same-repository pull requests by author association:** rejected. The code and the workflow that produce such a record are the pull request's own and unreviewed. A narrowed test command or a broken recorder would become evidence for everyone.
```

### ADR-0014: replace the "Observations" bullet of "Decision", and add one consequence

```markdown
- **Observations** come from authenticated runs, and only from classes containing at least one pass. Failures in all-fail classes stay pending until a pass shows up.
  - An observation counts toward a test's shared state when its inputs are inputs the default branch has had. In v1 the tree is a default-branch tree; in v2 the closure fingerprint occurs in an evidence-lane map.
  - An observation on content that exists only in a pull request counts toward that pull request's own report. It moves the shared state only together with a flaky failure from the default branch or from a second pull request. No single pull request can quarantine a test.
  - When more than a set number of tests flip in one job, the job is an environment incident and adds no per-test observation.
```

Add under "Consequences":

```markdown
- With selection enforced, unaffected tests do not run on pull requests. Shared evidence then comes from default-branch, nightly, audit-sample and shadow-mode runs. The expected sample numbers are restated for that rate in M7.
```

### ADR-0021: replace "Decision" and "Consequences"

```markdown
## Decision
- On the default branch, a job triggered by `push` builds the map and saves it with `actions/cache/save` under `trommel-map-v<format>-<cell>-<sha>`. It is the only job of the workflow with `cache-mode: write`; every other job is read-only.
- A pull-request run restores the map of its base commit by exact key, or else the newest map of that format and cell, and runs `trommel plan --map .trommel/map`. That computes Δ, the reverse search, proofs and shards locally.
- The map names its origin: repository id, ref, commit and workflow. A plan runs everything if the origin is not the default branch of this repository.
- A pull-request run may save a map of its own. GitHub scopes it to that pull request's merge ref, so it is evidence for that pull request only ([ADR-0012](0012-ci-auth-and-trust-lanes.md)).
- Lite mode has no flake ledger, ingest or UI, and its proofs are unsigned.

## Trust model
GitHub's rules, read on 2026-11-13 in the [dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching):
- a cache saved by a pull-request run is scoped to its merge ref and cannot be restored by the base branch or by another pull request;
- only `push`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build` and `schedule` runs can write the default branch's scope, unless a workflow declares a write-capable `cache-mode`;
- cache contents are not signed, anyone who can open a pull request can read the base branch's caches, and a prefix match returns the most recently created entry.

A fork or an untrusted author therefore cannot replace the map. Lite mode trusts every workflow that runs on those triggers on the default branch, as dependency caching already does. It does not enforce skips in a repository that grants cache writes to `pull_request_target`, `issue_comment` or `workflow_run` workflows. The map holds paths, object ids and test names, and no secrets. Filling the cache quota evicts the map, which costs a run of everything and nothing else.

## Consequences
- Usable selection by M3 with zero infrastructure.
- A repository that needs more than scope-based trust verifies a signed attestation of the map before it enforces, or uses the server.
```

### Sections of architecture.md that follow from these edits

The architecture is a living document, so these need no ADR: the glossary (record, map); §3.1 (`e:` and `generated`); §3.3 (definitions and the algorithm's place); §3.5 (the first two rows); §3.6 (observations); §4.2 (SMAP); §5.1 (`trommel run`); §5.4 (keys); §6; and threat-model §1.3.

---

## 4. Recommendations for the open decisions

### The two day-9 rules

**(a) Every `u:` node is always a seed: confirm it, and keep it past M3.**
- It is the only rule that is sound without resolution evidence (H4), and the new-module exemption at `plan.ts:106` depends on it.
- Its cost is measured. On hono, 26 of 161 tests always run because of it. On this repository none do: the 18 uncertain files are fixtures that nothing imports.
- Keep shadow mode useful by removing false uncertainty at the source, not by weakening the rule. HANDOFF §11 already lists the three causes on hono: self-imports that resolve to `dist/` (M8), `bun:` specifiers, and `new URL('.', import.meta.url)` naming a directory.

**(b) An unparseable lockfile escalates to L3 only when it changes: confirm it.**
- An unchanged lockfile means unchanged external packages, as long as the package manager's settings are unchanged, and those live in files that escalate by themselves: `.npmrc` and `.yarnrc.yml` are non-module root files, `pnpm-workspace.yaml` is a config node, and the root `package.json` is a global input.
- Two limits to record with it. Only root lockfiles are detected, so a nested one is a plain file and gets L1 for its package. And with an unparseable lockfile nothing can be flagged "not in the lockfile", so undeclared dependencies stay invisible until the pnpm and yarn parsers land.

### DECISIONS 16 and 17

- **16, provenance width:** one byte per edge, three bits defined (M4).
- **17, probe-edge volume:** exact hub nodes, built with SMAP v0 (M3). Measured: 84% of edges and 91% of nodes at 10,000 files are probe evidence.

### HANDOFF §10

1. **Mirroring policy.** Keep the public corpus metadata-only for the NOASSERTION and LGPL repositories. baserow is the exception worth acting on: it is the only source with test-level reruns, T3 needs exactly that, and the data expires. Mirror its test reports to private storage now, and decide about publishing after reading its licence files. This is not legal advice, and the download needs your go-ahead.
2. **`trommel-gate` as a required check.** Require it now, alongside the existing `ci.yml` jobs. It runs everything Trommel discovers, it is reversible in one setting, and it starts the count for T8 (zero CI failures caused by Trommel). Do not make it the only required check until C2 and C3 are built: the gate covers one of this repository's four cells, and only the tests Trommel finds.
3. Answered on 2026-11-12.
4. **The GitHub organization.** Create it and move both repositories before M5, not at M6. The App, the OIDC trust rules, cache scopes and branch protection all bind to the repository's identity. Do it in one planned hour, straight after a collector run finishes, and update the corpus repository's caller stub at the same time, because a missed night is a lost day of history. I did not verify how `uses:` behaves across a transfer.
5. **When would-skips become enforceable.** By evidence, not by date. All of these: records with the per-shard environment check and test reconciliation (C2, C3); the independent verifier passing (P4); at least 10,000 seeded mutants with no unsafe skip; and zero shadow escapes over at least 300 faulty changes on the repository, real or seeded. Four weeks is a floor. Start with a high audit rate and lower it as the bound tightens.

### Sequencing and technology

**Sequencing (M1 to M10).** The order is right. Four adjustments:
- **Rest of M1:** the selector and extraction fixes (C1, M6, L1 to L3), `e:` out of the map with the golden test (M1), hubs (M3), then SMAP v0 as container and static layer only (M2), then the pnpm and yarn parsers. `trommel explain` can wait.
- **M2:** Vitest first. 13 of the 15 replay candidates use it, so the Jest reporter can follow the kill gate if time is short. Add the three capture scopes, the reported configuration and resolution evidence to its scope. Start the replay container here.
- **M3:** it carries too much for three weeks over the holidays. M4 needs union assembly, validity, escalations, `plan` and `run` with reconciliation, the verifier and `generated` rules. Ratio-rule ordering needs failure history (M7), and proof signing needs a server key (M5); move both.
- **Before M4:** amend K1, time R2, and archive failed-attempt logs (M7).

**Technology.** I found no evidence against any choice, and some for:
- **Zero-dependency TypeScript on Node ≥22.** T6 is met with a wide margin: 2.5 s cold at 10,000 files against a 30 s target, re-measured here at 1.9 s with short file bodies. The reverse search takes 8 ms at one million edges (recorded), and the reverse index 2.7 ms (measured).
- **Plan, matrix, gate.** The one fact that constrains it, the 1 MB output limit, is already respected by the design in §5.3.
- **Postgres 18, the own queue, RLS, the transport and the UI stack.** No code exercises them yet, and nothing in M1 bears on them.
- **One thing to watch in M2.** The installed Vitest 5.1.0 has `experimental.viteModuleRunner` and `experimental.nodeLoader` settings. If tests can run without Vite's module runner, the recorder has to handle both loaders. I verified the settings exist, not what they do.

---

## 5. Confirmed as sound

| Decision | What I checked |
|---|---|
| Closure content equality with base independence (ADR-0005's core) | The argument in §3.3 holds once C(t) and the environment are pinned (H1, C3). I found no counterexample to the idea itself |
| Snapshots from git objects only, never the working tree | `ls-tree -z --full-tree` and `cat-file --batch`; two builds give identical bytes; P10 passes |
| Absent paths and directory listings as nodes, probing the union of the runners' candidates | The 2,000-run soundness property passes. Probes for shadowing files, new index files and new install locations all select correctly |
| "Uncertainty means run", and the `u:` rule | Probe 12, and the reasoning in H4 |
| L3 on a changed config, another object format, a non-UTF-8 path or a changed lockfile setup | Read in `plan.ts`; covered by tests |
| Run-all fallbacks that exit 0 | A missing map, an invalid map, an invalid config and an internal error are each handled in `cli.ts` |
| `--static` refuses `--mode safe` and labels every would-skip unproven | [args.ts:114](../../packages/cli/src/args.ts#L114); kickoff gap 1 is closed |
| The snapshot listing stored in the map | It is what lets a depth-1 checkout diff without the base commit |
| File-level graph and test-file selection unit (ADR-0003, ADR-0004) | Nothing in M1 argues against either. The barrel question is correctly left to M4 |
| Hashing: blob ids, SHA-256, ed25519 (ADR-0010) | Mode bits are folded into the file hash, which is conservative |
| Canonical JSON and explicit tie-breaks | Read in `canonical-json.ts` and `graph.ts`. The only byte-level break is M1 |
| CSR graph and reverse search | Matches the recorded benchmark; the reverse index is cheap to derive |
| Fork pull requests cannot write the default branch's cache | GitHub's documentation, read 2026-11-13 (M5) |
| Fork pull requests cannot mint OIDC tokens | Fork tokens are read-only and a token needs `id-token: write` (L5), unless a private repository chooses to send write tokens to fork pull requests. Closes open question 7 |
| Vitest 5.1 has the hooks M2 plans to use | `onAfterSuiteRun`, `autoAttachSubprocess` and `recordDependencies` exist in the installed package |
| License, forge scope and the merge-gate decision (ADR-0018 to ADR-0020) | Product decisions; nothing technical bears on them |

---

## 6. Open questions for the owner

1. **Is a collaborator inside the threat model?** H2 holds either way, because the honest case is enough. The answer decides how strict the server's lane rules must be, and whether Lite mode may ever enforce without an attestation.
2. **Does v1 support a test matrix, or one cell?** One cell makes C3's mechanism simpler: a single fingerprint check in `trommel run`. Several cells need per-cell records and keys. This repository runs four.
3. **Should a change to a module that no test reaches escalate by default?** It is the safe default, and it is how `cli.ts` would have been caught. On this repository it would have fired on 14 of the last 70 commits. The alternative is to report without escalating until the shadow data is in.
4. **May Lite mode enforce skips on scope-based trust alone?** Or only with a verified attestation of the map, leaving enforcement to the server otherwise.
5. **Which reading of K1 is the pre-registered one?** M7 proposes pooled, with 300 faulty changes. It is your threshold to set, and it should be set before the first measurement.
6. **May the collector download failed-attempt logs, and may baserow's reports be mirrored privately?** Both are downloads. Both are assets that expire.
7. **May the candidates be cloned to time R2?** Without it the M4 compute budget is a guess.
8. **Should SMAP v0 in M1 stop at the container and the static layer?** That changes the reading of an M1 exit criterion, so it is your call.
9. **When does the repository move to an organization?** See §4, item 4 of the HANDOFF list.
