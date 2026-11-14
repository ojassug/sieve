# Hand-off: Trommel milestone M1, after roadmap day 10

- **Written:** 2026-11-11 (UTC), at `main` = `00fea91` plus this document.
- **Updated:** 2026-11-14, after the foundation review and seven ADR corrections. Read §1.1 before anything else: it says where the documents now run ahead of the code. Items 1 and 2 of its worklist are done: the selector backstops (DECISIONS 29) and the environment out of the map (DECISIONS 28). Updated again on 2026-11-14 for the rename to Trommel (DECISIONS 30), and once more when the roadmap dropped its dates and commit counts (DECISIONS 31): a milestone is done when its exit criteria are met.
- **For:** whoever continues the implementation, person or agent.
- **Reading order:** this file, then [DECISIONS.md](DECISIONS.md), then the docs it points to.

## 1. Where things stand

**Days 1–10 of the M1 roadmap are done and merged.** The rest of M1 (§8) is under way.

| Roadmap day | What it delivered | PR | Its "done when" |
|---|---|---|---|
| 1 | Monorepo skeleton, Apache-2.0 `LICENSE`, CI, `CONTRIBUTING.md` with the DCO, `DECISIONS.md` | [#1](https://github.com/trommelci/trommel/pull/1) | Met: CI green |
| 1–2 | Corpus collector (`tools/corpus`), the [trommelci/trommel-corpus](https://github.com/trommelci/trommel-corpus) data repo, [bench/CORPUS.md](bench/CORPUS.md) | [#2](https://github.com/trommelci/trommel/pull/2) | Met: the first manifest was published on 2026-11-11 (§5.3) |
| 2–3 | `core/git`: streaming `ls-tree -z` parser, object format, Merkle descent, naive diff, P10 | [#3](https://github.com/trommelci/trommel/pull/3) | Met: P10 passes on 10,000 random trees |
| 3–4 | `core/lex/ts`: state-machine import lexer, 19 golden fixtures, MB/s benchmark | [#4](https://github.com/trommelci/trommel/pull/4) | Met |
| 5 | `core/graph`: interning, CSR, reverse BFS, why-paths, P1 and P3 | [#5](https://github.com/trommelci/trommel/pull/5) | Met |
| 6–7 | `core/resolve`: resolver with recorded probes, JSONC, YAML subset, globs | [#6](https://github.com/trommelci/trommel/pull/6) | Met: 5 fixture repos pass |
| 8 | `core/lockfile/npm`: `p:` nodes, lookup, diff; other formats reported as L3 | [#7](https://github.com/trommelci/trommel/pull/7) | Met |
| 9 | CLI v0: `trommel graph`, `trommel diff`, `trommel plan --static --shadow --map` | [#11](https://github.com/trommelci/trommel/pull/11) | Met: runs on this repository and on honojs/hono (§6) |
| 10 | Walking skeleton in CI on this repo: `.github/workflows/trommel.yml` | [#13](https://github.com/trommelci/trommel/pull/13) | Met: run-all fallback on #13, map cached from `main`, shadow summary with why-paths on [#14](https://github.com/trommelci/trommel/pull/14) (§7, DECISIONS 25) |

**Health at hand-off.**
- **Tests:** 239 in 18 files, all passing on Windows 11 with Node 26.4.
- **CI:** green on `main` (`00fea91`): static checks; Ubuntu on Node 22, 24 and 26; Windows on Node 22. The DCO job runs on pull requests only.
- **Static checks:** lint, typecheck and the zero-dependency check are clean.
- **Day 9 update (2026-11-12, branch `m1/d09-cli`):** `trommel graph`, `trommel diff` and `trommel plan --mode shadow --static --map` run from source with `node packages/cli/src/main.ts`. 395 tests pass in 28 files, with main merged in after #10. See §6 and DECISIONS 23–24.
- **Day 10 update (2026-11-13, branch `m1/d10-skeleton`):**
  - [#12](https://github.com/trommelci/trommel/pull/12) raised Vitest's `testTimeout` to 20 s. The Windows job on `main` had timed out on a git-heavy corpus test after #11 merged.
  - `.github/workflows/trommel.yml` runs plan → shards → `trommel-gate` on every PR in shadow mode, and builds the map on pushes to `main`.
  - 416 tests pass in 29 files. See §7 and DECISIONS 25.
- **Environment out of the map (2026-11-14, [#16](https://github.com/trommelci/trommel/pull/16), merged):**
  - The map and the static plan hold nothing about any machine. The engine id is `trommel-static-2`, and `packages/core/test/graph/golden.test.ts` pins a fixture map's SHA-256 on every CI OS.
  - 449 tests pass in 31 files. See §1.1 and DECISIONS 28.
  - **Expect one run-all plan** wherever a cached `trommel-static-1` map meets the new planner, this change's own PR included. The summary gives the engine mismatch as the cause.
- **Selector backstops (2026-11-14, [#17](https://github.com/trommelci/trommel/pull/17), merged):**
  - An unmapped input (a changed file that is not a node, or a changed node that no test reaches) makes every node of its owning package changed, so the escalation follows the graph across packages. The owning package is the deepest workspace member, else the root. Every `u:` node seeds the plan, and `parseMap` checks causes and nodes both ways.
  - `trommel.config.json` adds `inputs.ignore` for benchmarks, the CI guards' entry points and the lint config. So #17's own plan ran all 31 test files once, as expected: the config changed (L3), in run [43560947907](https://github.com/trommelci/trommel/actions/runs/43560947907). The merge's push run [43561166703](https://github.com/trommelci/trommel/actions/runs/43561166703) cached `trommel-map-ab408f9…` (1,466 nodes, 2,790 edges).
  - 473 tests pass in 31 files. See §1.1 and DECISIONS 29.
- **Renamed Trommel (2026-11-14, DECISIONS 30):**
  - Every identifier changed with the name: the `trommel` command, `@trommel/*` packages, `trommel.config.json`, `.trommel/map`, `TROMMEL_*` variables, `trommel.yml` with its `trommel-gate` job, and the engine id `trommel-static-2`. The golden hash moved with the engine id and nothing else. DECISIONS 30 maps every old name to the new one.
  - The repositories move to the `trommelci` organisation as `trommelci/trommel` and `trommelci/trommel-corpus`. Ojas renames and transfers both, and then the two rename PRs merge. The corpus repository calls this repository's reusable workflow by its new path.
  - **Expect one run-all plan** on each branch until a push to `main` caches a `trommel-map-*` map. Maps cached under the old key are not restored.

**First four things to do:**
1. Read §1.1. Seven ADRs changed on 2026-11-13, and the code is catching up: items 1 and 2 of its worklist are done.
2. Check that the collector is making progress (§5.3): coverage should grow with each daily run.
3. Start the rest of M1 (§8), in the order §1.1 gives. Every PR now shows Trommel's shadow summary: read it, and record any would-skip that should have run.
4. Take the open decisions to Ojas (§10).

### 1.1 The foundation review (2026-11-13)

**What happened.** Before M2 writes its first record, the whole design and the merged code were reviewed. The report is [docs/research/2026-11-foundation-review.md](docs/research/2026-11-foundation-review.md), and [DECISIONS.md](DECISIONS.md) entry 27 is its summary.
- **Verdict:** the foundation is sound enough to build M2 on, if seven contracts are corrected before records exist.
- **Ojas approved seven ADR corrections,** and they are merged: ADR-0003, 0004, 0005, 0009, 0012, 0014 and 0021. [docs/architecture.md](docs/architecture.md) and [docs/threat-model.md](docs/threat-model.md) are updated to match, and [docs/roadmap.md](docs/roadmap.md) §6 lists the work each milestone gained.
- **No code changed.** Every plan is still shadow-only and every would-skip unproven, so nothing below is a live fault.

**What the corrected ADRs now require**, in one line each:

| ADR | Now requires |
|---|---|
| 0003 | The static graph is a function of the tree, the config and the engine only: no environment nodes. Shared probes sit behind hub nodes (`r:`, `c:`) |
| 0004 | The runner decides what a test file is. `trommel run` also runs every file the runner discovers that the plan does not mention |
| 0005 | A record stores its own closure, environment, versions, flags and time. A skip needs every recorded hash to match at the head, and the environment to match in the job that runs the test. Uncertain files and unmapped inputs override any record |
| 0009 | SMAP is a container with a snapshot layer, a static layer and, from M3, a record layer. Provenance is one byte per edge |
| 0012 | Only runs of reviewed code (default-branch pushes and schedules, `merge_group`) change shared state. A pull-request run is evidence for its own pull request only |
| 0014 | No single pull request can quarantine a test |
| 0021 | Lite mode's trust model is written down. Keys carry the format and the environment cell; only the map job may write the cache |

**Where the code lags, and the order to fix it in.** The first four are M1 work and come before SMAP v0, because each changes what a map contains.

1. ~~**Selector backstops** (`core/select/plan.ts`).~~ Done on 2026-11-14 (DECISIONS 29). An unmapped input makes every node of its owning package changed, and a changed node that no test reaches is one. The owning package is the deepest workspace member, not the nearest `package.json`, which closed a hole: a fixture repository with its own `package.json` had been a package with no tests. `inputs.ignore` covers both kinds, and the summary lists what it exempted. On this repository's last 70 commits the rule fired on 3, each within one package.
2. ~~**Environment out of the map** (`core/graph/static.ts`).~~ Done on 2026-11-14 (DECISIONS 28). The `e:` nodes are gone from the map and from static selection, the engine id is `trommel-static-2`, and `golden.test.ts` pins a fixture map's SHA-256 on every CI OS. When a later item changes that hash, it must also say whether the engine id changes.
3. **Resolution hubs** (`core/resolve`, `core/graph/static.ts`). Probes are 84% of edges at 10,000 files. The soundness property in `plan.test.ts` is the regression test, because its oracle shares no graph code.
4. **SMAP v0:** the container, the snapshot layer and the static layer only. The record layer is a new section in M3.
5. **M2:** the record schema of ADR-0005, three capture scopes, the runner's reported configuration, and resolution evidence for non-literal imports.
6. **M3:** `trommel run` with discovery reconciliation and the per-shard environment and tree check; base-free proofs; the Lite-mode key layout, `cache-mode` and origin check.

**Findings that are still only recommendations** (review §2, DECISIONS 27). Each needs Ojas's decision or a small fix:
- four dependencies the static extractor drops without flagging them (M6);
- K1's wording, and the logs the collector does not keep (M7);
- `generated` rules, which decide the savings on most of the corpus (M8);
- six low-severity items (L2–L7). L1, the `u:` seeds, is fixed (DECISIONS 29).

**One number to distrust.** The review measured `main` at `86a995e`. Day 10 and the fix of DECISIONS 26 merged after it, so its counts for this repository (1,461 nodes, 2,777 edges, 28 tests) are a day old. Its line citations were refreshed to `main` at `acf76c2`.

## 2. Ground rules that carry over

They come from the kickoff brief and [CONTRIBUTING.md](CONTRIBUTING.md).

- **Ask Ojas first** before:
  - the first push of a session;
  - creating a repo or org;
  - adding a secret;
  - downloading anything, including `git clone` of corpus repos and `npm install` of a new package;
  - merging to `main`.

  Never force-push, and never rewrite `main`.
- **Branches.**
  - One short-lived branch and PR per roadmap day, named like `m1/d09-cli`.
  - If a merge is pending, the next day's branch builds on the unmerged one.
  - Merge in order with merge commits, not squash, so the small signed-off commits survive.
  - Retarget the next PR to `main` before merging it.
- **Commits.**
  - Small, conventional (`feat`, `fix`, `test`, `docs`, `chore`, `ci`), signed off with `git commit -s`; CI checks every PR commit.
  - Agent-written commits also end with the `Co-Authored-By:` trailer the session asks for.
- **Decisions already made aren't reopened.** If you think one is wrong, write the evidence and propose a new ADR. ADRs may be corrected in place until 2026-11-16; after that, a changed decision is a new ADR. Non-obvious implementation calls go in `DECISIONS.md` as context, decision and evidence.
- **Engineering rules.**
  - Write tests first for core algorithms. Property tests are seeded: `TROMMEL_FC_SEED` overrides the default `20261116`.
  - After writing a test file, mutate the code by hand to prove the tests can fail. Every module so far was checked this way.
  - **Same input, same bytes out:** canonical JSON, explicit tie-breaks, no timestamps or randomness in outputs.
  - **Uncertainty means run:** nothing unresolvable is ever dropped. It becomes `specifier: null`, `unresolved`, a diagnostic or `uncertain`.
  - Paths are POSIX, repo-relative and case-sensitive. File hashes come from git (blob ids), never from working-tree bytes.
  - Zero runtime dependencies in `packages/{core,cli,vitest,jest}`. `npm run check:deps` enforces this.
  - Timing lives in `bench/`, separate from tests. Record numbers under `bench/results/` and [bench/README.md](bench/README.md).
- **Out of scope for M1:** the server, Postgres, the queue, the GitHub App, the UI, the flake ledger, coverage plugins (M2), proofs and `trommel verify` (M3), pytest, tree-sitter, budget mode, and anything LLM.

## 3. Setting up and verifying

Development needs Node 22.18 or later. Repository scripts run TypeScript directly through Node's type stripping, and CI also tests Node 22, 24 and 26.

```bash
npm ci
```

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm run check:deps
```

Expect `473 passed` from `npm test` (after DECISIONS 29), and no output from lint or typecheck. To reproduce the recorded benchmarks (§9), run `node bench/ls-tree.ts`, `node bench/lex.ts`, `node bench/graph.ts` and `node bench/static-graph.ts`.

To try the CLI on this repository:

```bash
node packages/cli/src/main.ts graph --out .trommel/map/map.json
```

```bash
node packages/cli/src/main.ts plan --mode shadow --static --map .trommel/map
```

## 4. Repository map

| Path | What it is | Public entry points | Tests |
|---|---|---|---|
| `packages/core/src/canonical-json.ts` | Canonical JSON: sorted keys (UTF-16 order), `-0`→`0`; throws on NaN, `undefined` array elements, cycles and non-plain objects | `canonicalJson`, `canonicalJsonPretty` | `test/canonical-json.test.ts` (21) |
| `packages/core/src/git/ls-tree.ts` | Streaming parser for `git ls-tree -z`, SHA-1 and SHA-256. Non-UTF-8 paths are flagged `undecodable`, never dropped | `LsTreeParser`, `parseLsTree` | `test/git/ls-tree.test.ts` (12) |
| `packages/core/src/git/diff.ts` | `TreeIndex`; Merkle descent `merkleDiff`; oracle `naiveDiff`. Files added, deleted or modified (mode changes count), plus changed directory listings | `TreeIndex.build`, `merkleDiff`, `naiveDiff` | `test/git/diff.test.ts` (10, includes P10) |
| `packages/core/src/git/git.ts` | Runs git: `lsTree` (`ls-tree -r -t -z --full-tree`) and `readObjectFormat` | `lsTree(cwd, rev)`, `readObjectFormat(cwd)` | `test/git/git.test.ts` (9, differential against `git diff-tree`) |
| `packages/core/src/lex/ts.ts` | Import lexer for `.ts`, `.tsx` and JS: 12 record kinds, `typeOnly` and `inlineTypeOnly`, non-literal specifiers as `null`, diagnostics that mark a file uncertain | `lexImports(source, dialect)`, `lexImportsFromBytes`, `dialectOf(path)` | `test/lex/golden.test.ts` (20), `test/lex/lexer.test.ts` (17); fixtures in `test/fixtures/lex/` |
| `packages/core/src/graph/graph.ts` | CSR graph: nodes numbered in sorted-name order; `STATIC`/`DYNAMIC`/`DECLARED` provenance bits; multi-source reverse BFS; forward reach; why-paths | `GraphBuilder.addNode/addEdge/build`, `reverseReach`, `forwardReach`, `whyPath` | `test/graph/graph.test.ts` (P1, P3, forward reach, why-paths, determinism) |
| `packages/core/src/resolve/resolver.ts` | Resolution over a `Vfs`, the git view of a snapshot. Probes the union of TypeScript, Vite and Jest candidate orders, and records targets, absent paths, `d:` directories, configs and `g:` sets. Covers tsconfig `paths`/`baseUrl`/`extends`, `exports`/`imports`, workspaces, `__mocks__` and symlinks | `Resolver.resolve({from, specifier, kind, patterns?, base?})`, `Resolver.workspaces()`, `Resolver.ownerDir()` (nearest `package.json`, for resolution), `Resolver.packageOf()` (deepest workspace member, for escalations), `MemoryVfs`, `exportsTargets`, `joinPath`, `dirname` | `test/resolve/resolver.test.ts` (71: fixtures, `fileConfigs`, `packageOf`, plus the evidence-completeness properties); fixtures in `test/fixtures/resolve/` |
| `packages/core/src/resolve/{jsonc,yaml,glob}.ts` | JSONC (tsconfig), the pnpm-workspace YAML subset, globs | `parseJsonc`, `parsePnpmWorkspace`, `globToRegExp`, `escapeGlob` | `test/resolve/formats.test.ts` (34) |
| `packages/core/src/lockfile/npm.ts` | package-lock v2/v3 → `p:npm:<install location>`. Node-style `locate`, package-to-package dependencies, diff, lockfile detection; other formats are `unparseable` (L3) | `parseNpmLockfile`, `NpmLockfile.locate/dependencies`, `diffLockfiles`, `detectLockfile` | `test/lockfile/npm.test.ts` (16) |
| `packages/core/src/index.ts` | The package's public exports. Workspace packages export `./src/*.ts` directly (DECISIONS 3) | — | — |
| `packages/core/src/git/{cat-file,vfs}.ts` | `git cat-file --batch` parser; `GitVfs`, the resolver's `Vfs` over a `TreeIndex` with blobs from git | `readBlobs(cwd, oids)`, `CatFileParser`, `GitVfs.load`, `repoRoot` | `test/git/cat-file.test.ts`, `test/git/vfs.test.ts`, `test/git/git.test.ts` |
| `packages/core/src/graph/{static,map}.ts` | The static graph builder and the M1 map (canonical JSON): node keys and hashes, edges, `u:` nodes (DECISIONS 23). A function of the tree, the config and the engine only (DECISIONS 28) | `buildStaticMap`, `ENGINE`, `parseMap`, `mapGraph`, `readLockfile`, `isModule`/`isLexed` | `test/graph/static.test.ts`, `test/graph/map.test.ts`, `test/graph/golden.test.ts` (the pinned fixture hash) |
| `packages/core/src/environment.ts` | Environment components for the M2 recorder: runtime, platform and tracked variables. No caller yet, and lint keeps it out of the graph and selection modules (DECISIONS 28) | `environment`, `envHash` | `test/environment.test.ts` (6) |
| `packages/core/src/select/plan.ts` | Δ(S,H) from a map to a head snapshot, escalations L1/L3, reverse BFS with why-paths (DECISIONS 24). Unmapped inputs seed their owning package (DECISIONS 29) | `selectStatic`, `runAll` | `test/select/plan.test.ts` (examples plus the 2,000-run soundness property) |
| `packages/cli/src/` | `trommel graph`, `diff`, `plan`: `args.ts` (parseArgs, kickoff gap 1), `config.ts` (§5.1 validation, test discovery), `report.ts` (plan JSON, matrix, summary), `cli.ts`, `main.ts`. `bin: trommel` | `node packages/cli/src/main.ts --help` | `test/{args,config,report,cli}.test.ts` (`cli.test.ts` is end to end) |
| `packages/vitest`, `packages/jest` | Placeholders for M2 | — | — |
| `tools/corpus/` | The corpus collector (§5). `repos.json` lists the repositories; `corpus-repo/` is the template for the data repo | `node tools/corpus/src/main.ts …` | `tools/corpus/test/*` (50) |
| `tools/replay`, `tools/toyrepo` | Placeholders for M4 and M3 | — | — |
| `scripts/` | CI guards: `check-zero-deps.ts`, `check-dco.ts` (logic in `scripts/lib/`). `lib/test-files.ts` turns a shard's `TROMMEL_TEST_FILES` list into Vitest's `include` (DECISIONS 25) | `npm run check:deps`, `npm run check:dco` | `scripts/test/*` (37) |
| `trommel.config.json` | Trommel's config for this repository: 3 shards, one declared input for the CLI end-to-end test, and `inputs.ignore` for benchmarks, CI guard entry points and the lint config (DECISIONS 29) | — | — |
| `.github/workflows/trommel.yml` | The walking skeleton: `plan`, `test` (one job per shard), `trommel-gate`, and `map` on pushes to `main` (DECISIONS 25) | — | — |
| `bench/` | `TARGETS.md` (pre-registered), `CORPUS.md` (selection criteria and first-pass vetting), `README.md` (recorded numbers), `results/*.json`, scripts `ls-tree.ts`, `lex.ts`, `graph.ts` | — | — |
| `.github/workflows/ci.yml` | `static` (deps, lint, typecheck; Node 26), `test` (Ubuntu, Node 22/24/26), `windows` (Node 22), `dco` (PRs only) | — | — |

## 5. The corpus collector

### 5.1 What it is

GitHub deletes workflow runs, check runs and artifacts after at most 90 days. The collector archives, for 25 repositories:
- runs, with every attempt;
- jobs for each attempt;
- check runs;
- artifact listings;
- mirrored test-report artifacts.

The data is the flake ground truth (T3) and the durations for the replay corpus.
- **Data repository:** [trommelci/trommel-corpus](https://github.com/trommelci/trommel-corpus), public, created on 2026-11-11 with Ojas's approval.
- **Where the run lives:** in this repository, as the reusable workflow [.github/workflows/corpus-collect.yml](.github/workflows/corpus-collect.yml). trommel-corpus's own `collect.yml` is a stub that sets the schedule and calls it at `@main`; its source copy is `tools/corpus/corpus-repo/.github/workflows/collect.yml`, alongside the data repository's README. A `templates` job in each run fails if those two copies have drifted, without stopping collection.
- **Pinned code:** a run collects with the collector from the commit of the workflow file it is running (`job.workflow_sha`), and records it in the manifest. There is no `collector.ref` any more: merging to `main` here is what changes the next run (DECISIONS 22).
- **No secrets.** The workflow uses its own `GITHUB_TOKEN`. A probe showed that token can read other public repos' Actions data and download their artifacts, and `/rate_limit` reported 5,000 per hour (DECISIONS 9).
- **Schedule:** daily at 03:17 UTC, plus `workflow_dispatch` with a `max_minutes` input (default 320). The job timeout is 350 minutes.
- **Each run:**
  1. Collects the oldest uncollected days first, back to 89 days ago, tier 1 repositories first within each day. Then it re-collects the last 2 days for new attempts.
  2. Splits its requests fairly. Each repository may spend 1,000 (`--repo-share`) before any repository gets more; leftover time then goes to whatever is still open (DECISIONS 21).
  3. Publishes a release `corpus-YYYY-MM-DD-N`, as a draft until every asset is uploaded. Its assets are `raw-….tar.gz` (canonical NDJSON of the raw API objects), `artifacts-…-<owner>__<repo>.tar`, `SHA256SUMS-…`, and copies of the manifest and the collector state as a backup.
  4. Then commits `manifests/YYYY/YYYY-MM-DD-N.json` and `state/collector-state.json`, re-applying onto the latest `main` if something else landed there meanwhile. Both steps are `tools/corpus/src/publish.ts` (DECISIONS 22).
- **Design and evidence:** DECISIONS 9–11, 21 and 22. **Selection criteria and vetting:** [bench/CORPUS.md](bench/CORPUS.md).

### 5.2 Mirroring policy (a decision for Ojas)

- **Default rule.** Test-report archives are mirrored only from permissively licensed repositories (`mirror: true` in `tools/corpus/repos.json`).
- **Metadata only, until Ojas decides:**
  - baserow, luma.gl and AutoGPT report a NOASSERTION license;
  - mariadb-connector-nodejs is LGPL-2.1.
- **Why baserow matters.** It is the best JUnit source: Jest, pytest and Playwright shards with reruns.
- **To change the policy:** edit `repos.json` and merge it here. The next run picks it up.

### 5.3 Runs so far, and how to check progress

**First run.** [43026895799](https://github.com/trommelci/trommel-corpus/actions/runs/43026895799) succeeded on 2026-11-11, 13:11–18:32 UTC. It published release `corpus-2026-11-11-1` and `manifests/2026/2026-11-11-1.json`, which meets day 1–2's "done when". Its numbers, before the fix:
- 24,581 requests, 6,208 runs, 6,258 attempts, 83,523 jobs and no errors. That is 660 MB of raw NDJSON, 30 MB gzipped.
- It covered only Nov 4 (all repositories) and part of Nov 5. That was 1.7 of the 7 recent days it re-collected first, and no backfill at all.
- PostHog's `ci-frontend.yml` took 4,183 runs of one day, two-thirds of everything collected.
- Only 68 artifacts matched the test-report pattern, all from meshery.

**The fix**, in DECISIONS 21, has three parts: oldest days first, per-repository shares, and PostHog dropped. It takes effect on the first run that starts after it reached `main` here; check that run's manifest the same way.

**Scheduled runs.** The 03:17 UTC runs for 2026-11-12 and 2026-11-13 both fired about eight hours late: 43207509015 at 11:15 UTC, still on the old collector, and 43413524405 at 11:00 UTC. GitHub can delay or drop scheduled runs. If they go missing, start runs by hand with `gh workflow run collect.yml --repo trommelci/trommel-corpus`.

**Pushing to trommel-corpus during a run no longer loses it.**
- In the first two runs, the publish step committed and pushed without pulling first. A concurrent push (a `collector.ref` bump, for instance) would have made its push fail and lost that run's manifest and state, although the release assets would still have been published. Neither run was hit.
- The publish step now re-applies onto the latest `main` and retries, and fails loudly rather than quietly if it still cannot push (DECISIONS 22).
- Better still, normal operation no longer pushes there: the collector version follows `main` in this repository. The remaining reasons to push to trommel-corpus are updating the caller stub or the README from `tools/corpus/corpus-repo/`, which the `templates` job in each run will tell you about. Those are safe during a run, but check `gh run list --repo trommelci/trommel-corpus` first anyway if you want the run's log to stay easy to read.

```bash
gh run view 43026895799 --repo trommelci/trommel-corpus
```

```bash
gh release view corpus-2026-11-11-1 --repo trommelci/trommel-corpus
```

```bash
gh api repos/trommelci/trommel-corpus/contents/manifests/2026 --jq '.[].name'
```

**What to look at in the manifest:**
- `stoppedEarly`: expect the time budget on the first run.
- `pending`.
- `items[].status`: `complete`, `error`, `capped` (the share ran out and no time was left) or `stopped`, and per-item `error` text.
- `requestsByRepo`: what each repository cost.
- `coverage`: backfill days complete per repository, out of the 87 days between 89 and 3 days ago. Before the fix it re-collected 7 recent days, so the first two manifests count out of 82.

**Expected coverage.** This is an estimate, from the first run's counts:
- Without PostHog, the repositories produce roughly 1,300 runs a day, at about 3 requests per run: roughly 4,000 requests a day.
- One daily run can make about 25,000 requests.
- So each run should cover about 6 days of history, and the coverage should net about 5 days a day while the oldest day expires.
- Expect the backlog to clear within 2–3 weeks. The manifest's `coverage` makes those losses visible.

**Measured, to the 2026-11-13 manifest** (also in [bench/CORPUS.md](bench/CORPUS.md)). Collection is faster than the estimate:

| Run | Collector | Requests | Items done | Pending after | Repositories with all days |
|---|---|---|---|---|---|
| 1, 2026-11-11 (43026895799) | old | 24,581 | 44 | 2,270 | 0 of 26 |
| 2, 2026-11-12 (43207509015) | old | 25,086 | 117 | 2,197 | 0 of 26 |
| 3, 2026-11-12, by hand (43289738736) | fixed, `3c92385` | 26,079 | 1,142, plus 13 capped and 1 error | 1,082 | 8 of 25 |
| 4, 2026-11-13 (43413524405) | fixed, `3c92385` | 23,978 | 416, plus 7 capped | 703 | 11 of 25 |

- Every run spent its 320-minute budget and stopped one item partway through (`stoppedEarly`: time budget spent).
- After run 4, 11 repositories have all 87 days. The slowest eight (AutoGPT, baserow, meshery, prettier, TanStack/query, lexical, luma.gl, vuejs/core) have 30 or 31, then typescript-eslint 35, vite 36, trpc 49, svelte 50, zod 54 and babel 75.
- Run 4 added 8 to 16 days to each of the slowest eight, while one day a day expires. At that pace they need four to eight more daily runs, fewer once finished repositories free their share. That is an estimate.
- Run 3's one error (`Unexpected end of JSON input`, es-toolkit, 2026-08-19) was collected again: es-toolkit has every day after run 4.

**If the run failed or published nothing:**
1. Read the log: `gh run view 43026895799 --repo trommelci/trommel-corpus --log-failed`.
2. Fix the collector on a branch in this repository and merge it (with approval).
3. Re-run with `gh workflow run collect.yml --repo trommelci/trommel-corpus`. It picks up `main` as it now stands; nothing needs pushing to trommel-corpus.

Watch for one risk: if publishing runs past the 350-minute job timeout, the whole run's output is lost. If that happens, lower `max_minutes`.

### 5.4 Operating it locally

A metadata-only, request-capped run downloads no artifacts:

```bash
GH_TOKEN="$(gh auth token)" node tools/corpus/src/main.ts --config tools/corpus/repos.json --state /tmp/corpus/state.json --out /tmp/corpus/out --today 2026-11-12 --only vuejs/core --recent-days 1 --horizon-days 1 --max-requests 60 --metadata-only
```

**Flags:**
- `--only` (repeatable);
- `--recent-days` (default 2);
- `--repo-share` (default 1000);
- `--horizon-days` (default 89);
- `--max-minutes` (default 320);
- `--max-requests`;
- `--max-mirror-mb` (default 1500);
- `--metadata-only`;
- `--ref`.

**Known limits:**
- Once caught up, a day is collected a final time when it is 3 days old, so reruns started later than that are missed.
- Repository-wide artifact listings return 500 on large repos, so artifacts are listed per run.
- Records can repeat across runs; consumers deduplicate by id, or by (id, `run_attempt`) for runs.

## 6. Day 9, CLI v0

**Status (2026-11-12):** built on branch `m1/d09-cli`, following the plan below; DECISIONS 23 and 24 record where it chose or deviated. It runs on this repository and on honojs/hono (cloned with Ojas's approval; the results are in DECISIONS 24 and [bench/README.md](bench/README.md)). Two readings to confirm with Ojas: an unparseable lockfile escalates to L3 only when it changes (architecture §3.5), and every `u:` node is always changed (the recommendation in item 4.5). On 2026-11-13 the second became part of ADR-0005. The first is still open: the review recommends confirming it (§10).

**Done when:** it runs on this repository and on one corpus repository. Cloning a corpus repository is a download, so ask first.

### 6.1 Pieces still missing in `core`

1. **Reading blobs from git.**
   - Add `readBlobs(cwd, oids)` in `core/git`. Use one `git cat-file --batch` process: write oids to stdin and parse `<oid> <type> <size>\n<bytes>\n`.
   - Lex blob bytes with `lexImportsFromBytes`, never working-tree files, so CRLF can't matter (DECISIONS 12).
2. **A `GitVfs` that implements the resolver's `Vfs`.** Build it from a `TreeIndex`:
   - mode `100644`/`100755` → `file`;
   - `120000` → `symlink`, whose blob holds the target;
   - `160000` → `submodule`;
   - a tree → `dir`.

   `read()` goes through `readBlobs`. `files()` lists every non-tree path, sorted. Note that `TreeIndex` already exposes `children(dir)`.
3. **File-level config dependencies.** Each source file depends on its tsconfig chain and its nearest `package.json`, whose `type` field changes module semantics. The resolver computes the tsconfig chain internally (`findTsconfig`) but has no public method for it yet. Add one, e.g. `Resolver.fileConfigs(path)` → `{ configs, absent }`. It needs tests, including the evidence-completeness style of property.
4. **A static graph builder.** Suggested home: `core/graph/static.ts`.
   1. **Source files.** `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs`. Decide `.d.ts` explicitly; it is type-only at runtime.
   2. **Records.** Lex each file, skip `typeOnly` records, keep `inlineTypeOnly` ones, and resolve each.
   3. **Node keys and hashes:**
      - `f:<path>`: the blob oid; an absent path uses the same key with hash ⊥;
      - `d:<dir>`: SHA-256 of the sorted name and kind entries, the same listing semantics as `diff.ts`'s `kindOf`; ⊥ if missing;
      - `g:<key>`: SHA-256 of the sorted matches. That includes the synthetic `workspaces` node, whose matches are `name=dir`;
      - `p:npm:<location>`: the lockfile hash;
      - ~~`e:<component>`: Node major.minor, OS/arch, and the env vars listed in `trommel.config.json`.~~ Removed on 2026-11-14: the environment belongs to a record, not to the map (DECISIONS 28).
   4. **Edges, all `STATIC`.** From the importer to:
      - every resolution target, absent path, `d:` directory, config and `g:` node;
      - the file's own configs (item 3);
      - for a bare specifier, `p:` via `lockfile.locate(packageName, dirname(importer))`.

      Package-to-package edges come from `lockfile.dependencies(location)`. Each test file also gets edges to the `inputs.global` files from `trommel.config.json` (`DECLARED`).
   5. **Uncertainty.** A file with an unresolved or non-literal import, or a lexer diagnostic, or an external package missing from the lockfile, gets a `u:` node.
      - **Recommendation:** treat every `u:` node as always changed, i.e. always a seed. Any test reaching an uncertain importer then always runs.
      - Architecture §3.5's narrower rule (L1 only when the uncertain file changed) relies on dynamic coverage, which doesn't exist until M2/M3. Record whichever rule you pick in DECISIONS.
      - An unparseable lockfile, or more than one, is L3 (run all), per `detectLockfile`.
   6. **Test files.** Use the `projects` in `trommel.config.json` when present. Otherwise use Vitest's default include, `**/*.{test,spec}.?(c|m)[jt]s?(x)`, excluding `node_modules` and `**/fixtures/**`. For this repository that is `packages/*/test/**/*.test.ts`, `tools/*/test/**/*.test.ts` and `scripts/test/**/*.test.ts`.
   7. **Δ(S,H).** Use `merkleDiff` for files and listings, recompute the hashes of the `d:`, `g:` and `p:` nodes, and compare them with the map's.
   8. **Selection.** Run `reverseReach(graph, Δ ∪ u-nodes)`. The affected tests run; give each a `whyPath`.
5. **The map file.** Until SMAP v0 replaces it later in M1, it is canonical JSON: `version`, `objectFormat`, `rootTree`, sorted `nodes` (key → hash), sorted `edges` as `[from, to, provenance]`, `tests`, and the uncertain nodes. Store it at `.trommel/map/map.json`; `.trommel/` is already in `.gitignore`.

### 6.2 The CLI (`packages/cli`, zero runtime dependencies)

- **Argument parsing.** `node:util` `parseArgs` plus subcommand dispatch is enough. It is built into Node, so it adds no dependency.
- **`trommel.config.json` loader** with hand-written validation of the §5.1 schema.
- **Commands:**
  - `trommel graph [--rev HEAD] [--out <file>]` prints or writes the map.
  - `trommel diff <base> <head>` prints the canonical-JSON Δ: files, listings and packages.
  - `trommel plan --mode shadow --static --map <dir>` prints the plan.
    - The plan holds the run set, the would-skip set and why-paths for affected tests, plus any escalations with their causes.
    - When `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` are set, it writes the outputs `matrix` and `count`, and a markdown summary.
- **Kickoff gap 1** (DECISIONS 1) **must be handled here:**
  - With no records, a skip can't be safe under ADR-0005. Label would-skips as **unproven static reachability** everywhere, and make `--static` refuse `--mode safe`.
  - §5.1 spells the flag `--mode shadow`, while the roadmap says `--shadow`. Support both, with `--shadow` as an alias, add `--static`, and update architecture §5.1 in the same PR.
- **Run from source.** The CLI runs straight from source through type stripping: `node packages/cli/src/main.ts …` on Node 22.18 or later. In CI, `npm ci --omit=dev --ignore-scripts` installs only the workspace links, and that was verified. The published bundle comes later (DECISIONS 3).
- **Missing or unreadable map.** The plan must fall back to run-all, exit 0, and say so in the summary.

## 7. Day 10, the walking skeleton

**Status (2026-11-13):** built on branch `m1/d10-skeleton`, following the plan below; DECISIONS 25 records where it chose or deviated.
- Shards get their file lists through `TROMMEL_TEST_FILES`, which `vitest.config.ts` reads.
- `trommel.config.json` sets 3 shards and declares that the CLI end-to-end test depends on `packages/cli/src/**`.
- **Done when: met (2026-11-13).**
  1. #13's run [43435242836](https://github.com/trommelci/trommel/actions/runs/43435242836) found no map and ran all 29 files, saying why.
  2. The merge's push run [43435914996](https://github.com/trommelci/trommel/actions/runs/43435914996) cached `trommel-map-f065f80…`.
  3. #14's run [43479358998](https://github.com/trommelci/trommel/actions/runs/43479358998) restored it, and static reachability would run 11 of 29, with why-paths.

The spec is [roadmap §5](docs/roadmap.md) plus architecture §5.3 and §5.4. Build `.github/workflows/trommel.yml`:

- **`plan` job.**
  1. `actions/checkout@v7` (depth 1 is fine), then `actions/setup-node@v7` (Node 26).
  2. `npm ci --omit=dev --ignore-scripts`.
  3. `actions/cache/restore@v6` with `key: trommel-map-${{ github.sha }}` and `restore-keys: trommel-map-`.
  4. `node packages/cli/src/main.ts plan --mode shadow --static --map .trommel/map`, which outputs `matrix` and `count`.
- **`test` job.**
  - It runs when `needs.plan.outputs.count != '0'`, with `strategy.matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}`.
  - Each shard runs **its exact file list**. There is no runner plugin until M3, and ADR-0004 forbids Vitest's positional substring filters. Instead, have this repository's `vitest.config.ts` read the list from an env var or a file and set `include` to it (escape any glob characters).
  - In shadow mode every file runs.
- **`trommel-gate` job.** `needs: [plan, test]` and `if: always()`; it fails unless every shard succeeded. Ask Ojas whether to make it the single required check.
- **On a push to `main`.** Build the map (`trommel graph --out .trommel/map/map.json`) and run `actions/cache/save@v6` with key `trommel-map-${{ github.sha }}`.

**Done when** a PR shows the shadow summary with why-paths, and the fallback works. Demonstrating both needs three steps:
1. A first PR, made before any map exists, shows the run-all fallback.
2. Merge the workflow to `main` (with approval), so a push builds and caches the map.
3. A second PR shows the shadow summary.

PRs can restore caches saved on the base branch. Verifying the trust rules for `actions/cache` is M3 work (ADR-0021).

## 8. After day 10: the rest of M1

These come from the M1 row of [roadmap §1](docs/roadmap.md):
- **pnpm and yarn lockfile parsers.**
  - 24 of the 26 vetted repositories use them (19 pnpm, 5 yarn), so they gate the replay corpus in M4 ([bench/CORPUS.md](bench/CORPUS.md)).
  - Today `detectLockfile` reports both as unparseable (L3).
  - The YAML subset in `core/resolve/yaml.ts` is too small for `pnpm-lock.yaml`.
- **The four M1 items of §1.1,** before SMAP: ~~selector backstops~~ (done, DECISIONS 29), ~~the environment out of the map~~ (done, DECISIONS 28), resolution hubs, then SMAP v0 itself.
- **SMAP v0, byte-identical across OSes.**
  - The JSON map already is: `golden.test.ts` pins one fixture's hash on every CI OS. SMAP v0 takes that fixture over for its static layer.
  - The provenance width is settled: one byte per edge, three bits defined (ADR-0009, DECISIONS 27).
  - v0 is the container, the snapshot layer and the static layer. The record layer comes in M3.
- **`trommel explain`.**
- **Golden graphs for 6 repositories.** These need clones, so ask first.
- **T6:** a 10,000-file graph in under 30 s cold and under 3 s incremental. The lexer alone is about 3 s per 100 MB.
- ~~**Measure the probe-edge volume.**~~ Done on 2026-11-13: 84% of edges at 10,000 files. The answer is hub nodes (§1.1 item 3, DECISIONS 27).
- **The open items from the kickoff brief, §7:**
  - Time each candidate's suite offline (R2 in CORPUS.md); none are timed yet.
  - Read the licenses of date-fns, maplibre and every NOASSERTION repository.
  - Note anything that bears on the minimum Vitest and Jest versions (M2). Nothing new so far; Trommel itself uses Vitest 5.1.

## 9. Recorded numbers

| What | Result | Where |
|---|---|---|
| `git ls-tree -r -t -z` on 10,000 files (541 trees) | 31.5 ms on its own; 57.6 ms including spawn and parse; index 3.0 ms; diff 0.0 ms for 1 file, 0.4 ms for 100 | `bench/results/2026-11-11-ls-tree-win32.json` |
| Import lexer over `node_modules` (2,699 files, 43.7 MB) | 32–34 MB/s; 6,862 imports, 60 of them non-literal; **0 files falsely uncertain** | `bench/results/2026-11-11-lex-win32.json` |
| Graph at 100,000 nodes and 999,950 edges | Build 1.6 s; reverse BFS 7.6–8.5 ms with every node reached | `bench/results/2026-11-11-graph-win32.json` |
| P10, Merkle descent against the naive diff | 10,000 random tree pairs, all equal | `packages/core/test/git/diff.test.ts` |
| Lexer, generative | 2,000 programs plus 3,000 arbitrary inputs | `packages/core/test/lex/lexer.test.ts` |
| P1, P3 and why-paths | 2,000 / 2,000 / 1,000 random graphs | `packages/core/test/graph/graph.test.ts` |
| Resolver evidence completeness | 400 repositories × 13 specifiers | `packages/core/test/resolve/resolver.test.ts` |
| T6: `trommel graph` cold, synthetic 10,000-file TS monorepo (42 MB) | **2.5 s** (target 30 s); 106,390 nodes, 684,501 edges, 26.7 MB JSON map; plan from it 0.8 s | `bench/results/2026-11-12-static-graph-win32.json` |
| `trommel graph` cold on this repository | 0.36 s; 1,457 nodes, 2,739 edges | `bench/results/2026-11-12-static-graph-trommel-win32.json` |
| Static selection soundness | 2,000 random repository pairs; 20 hand mutants caught | `packages/core/test/select/plan.test.ts` |

All measured on Windows 11, Ryzen AI 7 350, Node 26.4 and git 2.55. There are no Linux numbers yet.

## 10. Decisions waiting on Ojas

1. The mirroring policy for the NOASSERTION and LGPL corpus repositories (§5.2).
2. Whether `trommel-gate` becomes a required check on `main`, which is a branch-protection setting.
3. ~~Which corpus repository day 9 should run on.~~ Answered 2026-11-12: honojs/hono, cloned with approval.
4. ~~The GitHub org for merge-queue dogfooding (roadmap day 0, needed by M6), and whether the corpus repo should live under it.~~ Answered 2026-11-14: `trommelci`, and the corpus repository moves there too (DECISIONS 30).
5. When to make the CLI's would-skips enforceable. Not before records exist (M2/M3) and 4 clean shadow weeks (M7).

The review recommends an answer to each of 1, 2, 4 and 5 in its §4. In short: mirror baserow's reports privately now; require `trommel-gate` alongside `ci.yml`, not in its place; move to the org before M5; and enforce on evidence (about 300 faulty changes with no escape), not on a date.

**Added by the foundation review (2026-11-13).** Its §6 gives the context for each.

6. Whether an unparseable lockfile escalates to L3 only when it changes (the open day-9 reading). The review says yes.
7. Whether a collaborator is inside the threat model. It decides how strict the server's lane rules are.
8. Whether v1 supports a test matrix or one environment cell. This repository's `ci.yml` runs four cells; `trommel.yml` covers one.
9. ~~Whether a change to a module that no test reaches escalates by default, or is only reported until shadow data is in.~~ Answered 2026-11-14: it escalates by default, and `inputs.ignore` can exempt it (DECISIONS 29).
10. Whether Lite mode may enforce skips on GitHub's cache scoping alone, or only with a verified attestation of the map.
11. Which reading of K1 is the pre-registered one. The review proposes the pooled median, with no miss among at least 300 faulty changes. `bench/TARGETS.md` allows a dated amendment before the first measurement.
12. Two downloads of data that expires: the logs of failed attempts for the collector, and baserow's test reports.
13. Cloning the 15 replay candidates to time their suites (R2). Without it the M4 compute budget is a guess.
14. Which of the review's remaining findings (M6, M8, L1–L7) to fix, and when.

## 11. Known gaps and limits in the merged code

These are honest limits, not bugs. Each one errs towards running more tests.

- **Lexer.** `typeof import('x')` in a type position counts as a dynamic import. JSX detection is a heuristic based on where an expression can start. A would-be regex that reaches the end of its line is reinterpreted as division.
- **Resolver.**
  - **tsconfig.** Only the nearest `tsconfig.json` governs a file: no `references`, no `tsconfig.app.json` variants, and no `include`/`files` check.
  - **Aliases from runner configs** (Vite `resolve.alias`, Jest `moduleNameMapper`) are invisible until M2 exports them. Such imports come out `unresolved`, and so run.
  - **Symlinks.** A path below a symlinked directory is `unresolved`.
  - **Workspaces.** The root package counts as a workspace member in the `workspaces` name map, for self-reference.
- **Graph.** The build merges edges through a `Map` (1.6 s at 1M edges). The M3 map decode replaces it.
- **Static selection (day 9, DECISIONS 23–24).**
  - Every would-skip is unproven: anything a test reads through `fs` (fixtures, snapshots) is invisible statically. An unmapped input escalates its owning package (L1), which covers most of it: the package's own tests, and every test elsewhere that reaches the package (DECISIONS 29).
  - A lockfile bump of a package that no test imports, such as eslint, runs everything: the package belongs to the root. `inputs.ignore` can name its install location (`node_modules/eslint`). An unreached glob also escalates the root, and cannot be ignored.
  - An added module is not in the map, so it never counts as unreached (entry 24's exemption). Whatever starts to use it shows up as a change of its own.
  - The review's DECLARED edge from every test to its runner's package node is not built. A runner package that no test reaches escalates when it changes; one that tests import is reached through them.
  - Every test that reaches an uncertain file always runs, whether or not anything changed.
  - Global inputs are found by conventional names (`vitest.setup.*`, `jest.setup.*` and runner configs). A setup file with another name must be listed in `inputs.global`.
  - Nothing compares environments. The map and the static plan hold nothing about any machine (DECISIONS 28), and the check in the job that runs the test arrives with `trommel run` (M3). Until then a would-skip says nothing about the Node version or the OS, one more reason it stays unproven.
  - `env.track` in `trommel.config.json` is validated and used for nothing until the M2 recorder reads it.
  - The JSON map is about 2.7 KB per file (26.7 MB at 10,000 files), and a plan re-parses it and rebuilds the CSR arrays (0.8 s at 10,000 files). SMAP fixes both. Extraction is not cached, so incremental builds are as slow as cold ones.
  - Only npm lockfiles are parsed. With pnpm or yarn, every bare import depends on the lockfile file, and any change to it runs everything (L3).
  - Precision costs seen on hono:
    - A version bump in the root `package.json` reruns every test, because each file depends on its whole nearest `package.json`. Hashing only the fields that change module semantics (`type`, `exports`, `imports`, `main`, dependencies) would fix it.
    - A self-import whose `exports` point at build output (`dist/`) is unresolved, so it is uncertain.
    - `bun:` specifiers count as unknown virtual modules.
- **Walking skeleton (day 10, DECISIONS 25).**
  - Every test runs twice on a PR, once in `ci.yml` and once in the shards, until shadow mode gives way to real skips.
  - Shards are split round-robin, not by duration.
  - The map is rebuilt from scratch on every push to `main`.
  - ADR-0021 now states the cache trust model: a fork or an untrusted author cannot replace the map. Its key layout, `cache-mode` and origin check are M3 work; `trommel.yml` still saves `trommel-map-<sha>` and restores by prefix.
  - The shards run exactly the plan's list, which comes from Trommel's own discovery. A test that Vitest would run and Trommel does not find runs only in `ci.yml`. Keep `ci.yml` required until `trommel run` reconciles with the runner (ADR-0004).
  - A directory named by `new URL(…, import.meta.url)` depends on every file below it (DECISIONS 26). In a global input, a URL that names the repository root would select every test on any change, so this repository uses `import.meta.dirname`.
- **Collector.** See §5.4. Coverage after four runs is in §5.3; the backlog is not cleared yet.
- **Found by the foundation review and not fixed** (its M6, L2 and L3; DECISIONS 27; L1 is fixed, DECISIONS 29):
  - An import of a `.vue` or `.svelte` file is a plain target: that file's own imports are not followed, and nothing is flagged.
  - A `file:` link dependency outside the workspace list gets a `p:` node with a constant hash and no edge to its sources.
  - A workspace package wins by name even when a nested installed copy would shadow it for that importer.
  - `createRequire` bound to a name other than `require` yields no record.
  - Two `import.meta.glob` calls can share one `g:` node when a pattern contains a vertical bar.
- **Docs that still owe updates:**
  - architecture §3.1 on `generated` files and §3.10 on the enforcement gate, and `bench/TARGETS.md` on K1. The review recommends changes (M7, M8), and they wait on Ojas (§10).

## 12. Environment notes (Windows host)

- **Shells.** PowerShell 5.1 is the default; it has no `&&`, and paths over 260 characters fail. Git Bash is available and handles both better.
  - In Git Bash, `python3` is the Microsoft Store stub and **hangs** waiting for input, so script with Node instead.
  - Long heredocs that mix quote styles can fail to parse in Git Bash. Write the script to a temporary `.cjs` file and run it with `node`.
- **TypeScript 6.0.3 is pinned.** `typescript@latest` is 7.0.2, but typescript-eslint 8.72 needs TypeScript below 6.1 (DECISIONS 2).
- **`erasableSyntaxOnly`.** No enums, namespaces or constructor parameter properties. Relative imports use `.ts` extensions, and types use `import type`.
- **`@types/node` 22.** Don't use Node APIs newer than 22, which is the CLI floor.
- **ESLint `--fix`** can leave a constant unused after rewriting a regex into `startsWith`. Re-run lint.
- **Fixtures.**
  - Fixtures live under `**/fixtures/**`. tsc and Vitest skip them, and ESLint ignores them.
  - Name byte-exact fixtures `*.crlf.*`, so `.gitattributes` keeps their CRLF bytes.
  - Resolver fixtures declare symlinks in `_symlinks.json` and expectations in `_expected.json`.
- **Line endings.** `* text=auto eol=lf` keeps the working tree LF even with `core.autocrlf=true`.
- **Git worktrees.** A worktree under `.claude/worktrees/` has no `node_modules` of its own, so `@trommel/core` resolves to the main checkout's sources, not the worktree's. Link the worktree's packages into its own `node_modules/@trommel/` (directory junctions, no download) and delete `node_modules/.vitest-cache`, or tests and the CLI run stale code. PowerShell's `New-Item -ItemType Junction` does it; `mklink` is awkward to quote from Git Bash.
- **Credentials.** `gh` is authenticated as `ojassug`.
- **Scratch scripts are not in the repo:** the vetting and survey scripts behind CORPUS.md, and the hand-mutation helper.
  - The method is described in CORPUS.md and in the PR descriptions of #2 and #4–#7.
  - Committing the vetting script as `tools/corpus/src/vet.ts` would make CORPUS.md reproducible.

## 13. Where decisions are recorded

[DECISIONS.md](DECISIONS.md):

| Entry | Topic |
|---|---|
| 1 | Kickoff, with the 7 doc gaps |
| 2 | TypeScript 6.0, not 7.0 |
| 3 | Source-first workspace packages |
| 4 | Placeholder names |
| 5 | Exact pins |
| 6 | Zero-dependency check scope |
| 7 | DCO scope |
| 8 | Seeded property tests |
| 9 | `GITHUB_TOKEN` for the collector |
| 10 | Collector design |
| 11 | Corpus storage |
| 12 | Snapshot diff semantics |
| 13 | ls-tree cost |
| 14 | The lexer |
| 15 | Lexer throughput |
| 16 | The graph, with the SMAP provenance question |
| 17 | Module resolution |
| 18 | npm lockfiles |
| 19 | The first session hand-over |
| 20 | This document |
| 21 | Collector budget |
| 22 | Race-proof corpus publishing |
| 23 | The static graph and the M1 map |
| 24 | Static selection and CLI v0 |
| 25 | The walking skeleton in CI |
| 26 | Directory URLs as dependencies |
| 27 | The foundation review and the seven ADR corrections |
| 28 | The environment out of the static map, engine `trommel-static-2`, the golden map |
| 29 | Unmapped inputs follow the graph; unreached changed nodes escalate; the owning package is a workspace member |
| 30 | The name is Trommel: every identifier renamed, the `trommelci` org, the trademark screen |
| 31 | The roadmap has no dates or commit budgets: a milestone is done when its exit criteria are met |

**Status of the kickoff doc gaps** (DECISIONS 1):

| Gap | Status |
|---|---|
| 1. No safe skips in M1; CLI flags differ | Resolved on day 9 (24): `--static` is shadow only, would-skips are labelled unproven, `--shadow` is an alias |
| 2. `import type` and missing import forms | Resolved by the lexer (14) |
| 3. Where the resolver probes | Resolved: git's view (17) |
| 4. Runners order candidates differently | Resolved: the union (17) |
| 5. Zero-dependency scope | Resolved (6) |
| 6. The §9.8 candidates aren't a replay set | First-pass vetting done; R2 timing **open** |
| 7. Stale hand-over note | Noted (1) |
