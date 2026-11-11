# Hand-off: SIEVE milestone M1, after roadmap day 8

- **Written:** 2026-11-11 (UTC), at `main` = `00fea91` plus this document.
- **For:** whoever continues the implementation, person or agent.
- **Reading order:** this file, then [DECISIONS.md](DECISIONS.md), then the docs it points to.

## 1. Where things stand

**Days 1–8 of the M1 roadmap are done and merged.** Days 9 and 10 are not started.

| Roadmap day | What it delivered | PR | Its "done when" |
|---|---|---|---|
| 1 | Monorepo skeleton, Apache-2.0 `LICENSE`, CI, `CONTRIBUTING.md` with the DCO, `DECISIONS.md` | [#1](https://github.com/ojassug/sieve/pull/1) | Met: CI green |
| 1–2 | Corpus collector (`tools/corpus`), the [ojassug/sieve-corpus](https://github.com/ojassug/sieve-corpus) data repo, [bench/CORPUS.md](bench/CORPUS.md) | [#2](https://github.com/ojassug/sieve/pull/2) | **Pending:** needs the first daily manifest (§5) |
| 2–3 | `core/git`: streaming `ls-tree -z` parser, object format, Merkle descent, naive diff, P10 | [#3](https://github.com/ojassug/sieve/pull/3) | Met: P10 passes on 10,000 random trees |
| 3–4 | `core/lex/ts`: state-machine import lexer, 19 golden fixtures, MB/s benchmark | [#4](https://github.com/ojassug/sieve/pull/4) | Met |
| 5 | `core/graph`: interning, CSR, reverse BFS, why-paths, P1 and P3 | [#5](https://github.com/ojassug/sieve/pull/5) | Met |
| 6–7 | `core/resolve`: resolver with recorded probes, JSONC, YAML subset, globs | [#6](https://github.com/ojassug/sieve/pull/6) | Met: 5 fixture repos pass |
| 8 | `core/lockfile/npm`: `p:` nodes, lookup, diff; other formats reported as L3 | [#7](https://github.com/ojassug/sieve/pull/7) | Met |
| 9 | CLI v0: `sieve graph`, `sieve diff`, `sieve plan --static --shadow --map` | — | **Not started** (§6) |
| 10 | Walking skeleton in CI on this repo | — | **Not started** (§7) |

**Health at hand-off.**
- **Tests:** 239 in 18 files, all passing on Windows 11 with Node 26.4.
- **CI:** green on `main` (`00fea91`): static checks; Ubuntu on Node 22, 24 and 26; Windows on Node 22. The DCO job runs on pull requests only.
- **Static checks:** lint, typecheck and the zero-dependency check are clean.
- **Not runnable yet:** there is no `sieve` command (`packages/cli/src/main.ts` is a stub) and no graph builder. Day 9 builds both.

**First three things to do:**
1. Check the first corpus run (§5.3) and finish day 1–2.
2. Read §2, then build day 9 (§6).
3. Build day 10 (§7). It needs at least one merge to `main` and two PRs to demonstrate.

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
  - Write tests first for core algorithms. Property tests are seeded: `SIEVE_FC_SEED` overrides the default `20261116`.
  - After writing a test file, mutate the code by hand to prove the tests can fail. Every module so far was checked this way.
  - **Same input, same bytes out:** canonical JSON, explicit tie-breaks, no timestamps or randomness in outputs.
  - **Uncertainty means run:** nothing unresolvable is ever dropped. It becomes `specifier: null`, `unresolved`, a diagnostic or `uncertain`.
  - Paths are POSIX, repo-relative and case-sensitive. File hashes come from git (blob ids), never from working-tree bytes.
  - Zero runtime dependencies in `packages/{core,cli,vitest,jest}`. `npm run check:deps` enforces this.
  - Timing lives in `bench/`, separate from tests. Record numbers under `bench/results/` and [bench/README.md](bench/README.md).
- **Out of scope for M1:** the server, Postgres, the queue, the GitHub App, the UI, the flake ledger, coverage plugins (M2), proofs and `sieve verify` (M3), pytest, tree-sitter, budget mode, and anything LLM.

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

Expect `239 passed` from `npm test`, and no output from lint or typecheck. To reproduce the recorded benchmarks (§9), run `node bench/ls-tree.ts`, `node bench/lex.ts` and `node bench/graph.ts`.

## 4. Repository map

| Path | What it is | Public entry points | Tests |
|---|---|---|---|
| `packages/core/src/canonical-json.ts` | Canonical JSON: sorted keys (UTF-16 order), `-0`→`0`; throws on NaN, `undefined` array elements, cycles and non-plain objects | `canonicalJson`, `canonicalJsonPretty` | `test/canonical-json.test.ts` (21) |
| `packages/core/src/git/ls-tree.ts` | Streaming parser for `git ls-tree -z`, SHA-1 and SHA-256. Non-UTF-8 paths are flagged `undecodable`, never dropped | `LsTreeParser`, `parseLsTree` | `test/git/ls-tree.test.ts` (12) |
| `packages/core/src/git/diff.ts` | `TreeIndex`; Merkle descent `merkleDiff`; oracle `naiveDiff`. Files added, deleted or modified (mode changes count), plus changed directory listings | `TreeIndex.build`, `merkleDiff`, `naiveDiff` | `test/git/diff.test.ts` (10, includes P10) |
| `packages/core/src/git/git.ts` | Runs git: `lsTree` (`ls-tree -r -t -z --full-tree`) and `readObjectFormat` | `lsTree(cwd, rev)`, `readObjectFormat(cwd)` | `test/git/git.test.ts` (3, differential against `git diff-tree`) |
| `packages/core/src/lex/ts.ts` | Import lexer for `.ts`, `.tsx` and JS: 12 record kinds, `typeOnly` and `inlineTypeOnly`, non-literal specifiers as `null`, diagnostics that mark a file uncertain | `lexImports(source, dialect)`, `lexImportsFromBytes`, `dialectOf(path)` | `test/lex/golden.test.ts` (20), `test/lex/lexer.test.ts` (17); fixtures in `test/fixtures/lex/` |
| `packages/core/src/graph/graph.ts` | CSR graph: nodes numbered in sorted-name order; `STATIC`/`DYNAMIC`/`DECLARED` provenance bits; multi-source reverse BFS; why-paths | `GraphBuilder.addNode/addEdge/build`, `reverseReach`, `whyPath` | `test/graph/graph.test.ts` (13: P1, P3, why-paths, determinism) |
| `packages/core/src/resolve/resolver.ts` | Resolution over a `Vfs`, the git view of a snapshot. Probes the union of TypeScript, Vite and Jest candidate orders, and records targets, absent paths, `d:` directories, configs and `g:` sets. Covers tsconfig `paths`/`baseUrl`/`extends`, `exports`/`imports`, workspaces, `__mocks__` and symlinks | `Resolver.resolve({from, specifier, kind, patterns?, base?})`, `Resolver.workspaces()`, `Resolver.ownerDir()`, `MemoryVfs`, `exportsTargets`, `joinPath`, `dirname` | `test/resolve/resolver.test.ts` (52: fixtures plus the evidence-completeness property); fixtures in `test/fixtures/resolve/` |
| `packages/core/src/resolve/{jsonc,yaml,glob}.ts` | JSONC (tsconfig), the pnpm-workspace YAML subset, globs | `parseJsonc`, `parsePnpmWorkspace`, `globToRegExp` | `test/resolve/formats.test.ts` (24) |
| `packages/core/src/lockfile/npm.ts` | package-lock v2/v3 → `p:npm:<install location>`. Node-style `locate`, package-to-package dependencies, diff, lockfile detection; other formats are `unparseable` (L3) | `parseNpmLockfile`, `NpmLockfile.locate/dependencies`, `diffLockfiles`, `detectLockfile` | `test/lockfile/npm.test.ts` (16) |
| `packages/core/src/index.ts` | The package's public exports. Workspace packages export `./src/*.ts` directly (DECISIONS 3) | — | — |
| `packages/cli/src/main.ts` | **A stub.** Prints "no commands yet". `bin: sieve` | — | — |
| `packages/vitest`, `packages/jest` | Placeholders for M2 | — | — |
| `tools/corpus/` | The corpus collector (§5). `repos.json` lists the repositories; `corpus-repo/` is the template for the data repo | `node tools/corpus/src/main.ts …` | `tools/corpus/test/*` (35) |
| `tools/replay`, `tools/toyrepo` | Placeholders for M4 and M3 | — | — |
| `scripts/` | CI guards: `check-zero-deps.ts`, `check-dco.ts` (logic in `scripts/lib/`) | `npm run check:deps`, `npm run check:dco` | `scripts/test/*` (16) |
| `bench/` | `TARGETS.md` (pre-registered), `CORPUS.md` (selection criteria and first-pass vetting), `README.md` (recorded numbers), `results/*.json`, scripts `ls-tree.ts`, `lex.ts`, `graph.ts` | — | — |
| `.github/workflows/ci.yml` | `static` (deps, lint, typecheck; Node 26), `test` (Ubuntu, Node 22/24/26), `windows` (Node 22), `dco` (PRs only) | — | — |

## 5. The corpus collector

### 5.1 What it is

GitHub deletes workflow runs, check runs and artifacts after at most 90 days. The collector archives, for 26 repositories:
- runs, with every attempt;
- jobs for each attempt;
- check runs;
- artifact listings;
- mirrored test-report artifacts.

The data is the flake ground truth (T3) and the durations for the replay corpus.
- **Data repository:** [ojassug/sieve-corpus](https://github.com/ojassug/sieve-corpus), public, created on 2026-11-11 with Ojas's approval.
- **Template:** the workflow and README there come from `tools/corpus/corpus-repo/` in this repository.
- **Pinned code:** the collector code is pinned by commit in `collector.ref`, currently `4d28a10`, which is reachable from `main`.
- **No secrets.** The workflow uses its own `GITHUB_TOKEN`. A probe showed that token can read other public repos' Actions data and download their artifacts, and `/rate_limit` reported 5,000 per hour (DECISIONS 9).
- **Schedule:** daily at 03:17 UTC, plus `workflow_dispatch` with a `max_minutes` input (default 320). The job timeout is 350 minutes.
- **Each run:**
  1. Re-collects the last 7 days, to catch new attempts and short-lived artifacts.
  2. Backfills the oldest uncollected days first, back to 89 days ago, tier 1 repositories first.
  3. Publishes a release `corpus-YYYY-MM-DD-N`. Its assets are `raw-….tar.gz` (canonical NDJSON of the raw API objects), `artifacts-…-<owner>__<repo>.tar`, the manifest and `SHA256SUMS-…`.
  4. Commits `manifests/YYYY/YYYY-MM-DD-N.json` and `state/collector-state.json`.
- **Design and evidence:** DECISIONS 9–11. **Selection criteria and vetting:** [bench/CORPUS.md](bench/CORPUS.md).

### 5.2 Mirroring policy (a decision for Ojas)

- **Default rule.** Test-report archives are mirrored only from permissively licensed repositories (`mirror: true` in `tools/corpus/repos.json`).
- **Metadata only, until Ojas decides:**
  - baserow, PostHog, luma.gl and AutoGPT report a NOASSERTION license;
  - mariadb-connector-nodejs is LGPL-2.1.
- **Why baserow matters.** It is the best JUnit source: Jest, pytest and Playwright shards with reruns.
- **To change the policy:** edit `repos.json`, merge, then bump `collector.ref`.

### 5.3 The first run: check it first

The first run, [43026895799](https://github.com/ojassug/sieve-corpus/actions/runs/43026895799), started at 13:11 UTC on 2026-11-11.
- At hand-off it was still in its `Collect` step, after setup, checkout and the workspace link had all succeeded.
- With the 320-minute budget, it should publish around 18:30–19:00 UTC that day.
- Day 1–2's "done when" is met once `manifests/2026/2026-11-11-1.json` exists.

```bash
gh run view 43026895799 --repo ojassug/sieve-corpus
```

```bash
gh release view corpus-2026-11-11-1 --repo ojassug/sieve-corpus
```

```bash
gh api repos/ojassug/sieve-corpus/contents/manifests/2026 --jq '.[].name'
```

**What to look at in the manifest:**
- `stoppedEarly`: expect the time budget on the first run.
- `pending`.
- `items[].status`: `complete`, `error` or `stopped`, and per-item `error` text.
- `coverage`: backfill days complete per repository, out of the 82 days between 89 and 8 days ago.

**Expected coverage.** This is an estimate, not a measurement:
- The 26 repositories produce roughly 1,000 collected runs a day, at about 3.2 requests per run (measured on vuejs/core).
- A full 89-day backfill therefore needs roughly 300,000 requests.
- One daily run can make about 26,000 requests: 320 minutes at 5,000 per hour.

So expect about two weeks to catch up, while the oldest day expires each day. The manifest's `coverage` makes those losses visible. Record the real numbers in `bench/CORPUS.md`, or in a DECISIONS entry, once you have them.

**If the run failed or published nothing:**
1. Read the log: `gh run view 43026895799 --repo ojassug/sieve-corpus --log-failed`.
2. Fix the collector on a branch in this repository and merge it (with approval).
3. Write the new `main` commit into `collector.ref` in sieve-corpus (approval needed: it's a push).
4. Re-run with `gh workflow run collect.yml --repo ojassug/sieve-corpus`.

Watch for one risk: if publishing runs past the 350-minute job timeout, the whole run's output is lost. If that happens, lower `max_minutes`.

### 5.4 Operating it locally

A metadata-only, request-capped run downloads no artifacts:

```bash
GH_TOKEN="$(gh auth token)" node tools/corpus/src/main.ts --config tools/corpus/repos.json --state /tmp/corpus/state.json --out /tmp/corpus/out --today 2026-11-12 --only vuejs/core --recent-days 1 --horizon-days 1 --max-requests 60 --metadata-only
```

**Flags:**
- `--only` (repeatable);
- `--recent-days` (default 7);
- `--horizon-days` (default 89);
- `--max-minutes` (default 320);
- `--max-requests`;
- `--max-mirror-mb` (default 1500);
- `--metadata-only`;
- `--ref`.

**Known limits:**
- Reruns started more than 7 days after the run was created are missed.
- Repository-wide artifact listings return 500 on large repos, so artifacts are listed per run.
- Records can repeat across runs; consumers deduplicate by id, or by (id, `run_attempt`) for runs.

## 6. Next: day 9, CLI v0

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
      - `e:<component>`: Node major.minor, OS/arch, and the env vars listed in `sieve.config.json`.
   4. **Edges, all `STATIC`.** From the importer to:
      - every resolution target, absent path, `d:` directory, config and `g:` node;
      - the file's own configs (item 3);
      - for a bare specifier, `p:` via `lockfile.locate(packageName, dirname(importer))`.

      Package-to-package edges come from `lockfile.dependencies(location)`. Each test file also gets edges to the `inputs.global` files from `sieve.config.json` (`DECLARED`).
   5. **Uncertainty.** A file with an unresolved or non-literal import, or a lexer diagnostic, or an external package missing from the lockfile, gets a `u:` node.
      - **Recommendation:** treat every `u:` node as always changed, i.e. always a seed. Any test reaching an uncertain importer then always runs.
      - Architecture §3.5's narrower rule (L1 only when the uncertain file changed) relies on dynamic coverage, which doesn't exist until M2/M3. Record whichever rule you pick in DECISIONS.
      - An unparseable lockfile, or more than one, is L3 (run all), per `detectLockfile`.
   6. **Test files.** Use the `projects` in `sieve.config.json` when present. Otherwise use Vitest's default include, `**/*.{test,spec}.?(c|m)[jt]s?(x)`, excluding `node_modules` and `**/fixtures/**`. For this repository that is `packages/*/test/**/*.test.ts`, `tools/*/test/**/*.test.ts` and `scripts/test/**/*.test.ts`.
   7. **Δ(S,H).** Use `merkleDiff` for files and listings, recompute the hashes of the `d:`, `g:`, `p:` and `e:` nodes, and compare them with the map's.
   8. **Selection.** Run `reverseReach(graph, Δ ∪ u-nodes)`. The affected tests run; give each a `whyPath`.
5. **The map file.** For M1 it is canonical JSON (SMAP binary arrives in week 3): `version`, `objectFormat`, `rootTree`, sorted `nodes` (key → hash), sorted `edges` as `[from, to, provenance]`, `tests`, and the uncertain nodes. Store it at `.sieve/map/map.json`; `.sieve/` is already in `.gitignore`.

### 6.2 The CLI (`packages/cli`, zero runtime dependencies)

- **Argument parsing.** `node:util` `parseArgs` plus subcommand dispatch is enough. It is built into Node, so it adds no dependency.
- **`sieve.config.json` loader** with hand-written validation of the §5.1 schema.
- **Commands:**
  - `sieve graph [--rev HEAD] [--out <file>]` prints or writes the map.
  - `sieve diff <base> <head>` prints the canonical-JSON Δ: files, listings and packages.
  - `sieve plan --mode shadow --static --map <dir>` prints the plan.
    - The plan holds the run set, the would-skip set and why-paths for affected tests, plus any escalations with their causes.
    - When `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` are set, it writes the outputs `matrix` and `count`, and a markdown summary.
- **Kickoff gap 1** (DECISIONS 1) **must be handled here:**
  - With no records, a skip can't be safe under ADR-0005. Label would-skips as **unproven static reachability** everywhere, and make `--static` refuse `--mode safe`.
  - §5.1 spells the flag `--mode shadow`, while the roadmap says `--shadow`. Support both, with `--shadow` as an alias, add `--static`, and update architecture §5.1 in the same PR.
- **Run from source.** The CLI runs straight from source through type stripping: `node packages/cli/src/main.ts …` on Node 22.18 or later. In CI, `npm ci --omit=dev --ignore-scripts` installs only the workspace links, and that was verified. The published bundle comes later (DECISIONS 3).
- **Missing or unreadable map.** The plan must fall back to run-all, exit 0, and say so in the summary.

## 7. Next: day 10, the walking skeleton

The spec is [roadmap §5](docs/roadmap.md) plus architecture §5.3 and §5.4. Build `.github/workflows/sieve.yml`:

- **`plan` job.**
  1. `actions/checkout@v7` (depth 1 is fine), then `actions/setup-node@v7` (Node 26).
  2. `npm ci --omit=dev --ignore-scripts`.
  3. `actions/cache/restore@v6` with `key: sieve-map-${{ github.sha }}` and `restore-keys: sieve-map-`.
  4. `node packages/cli/src/main.ts plan --mode shadow --static --map .sieve/map`, which outputs `matrix` and `count`.
- **`test` job.**
  - It runs when `needs.plan.outputs.count != '0'`, with `strategy.matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}`.
  - Each shard runs **its exact file list**. There is no runner plugin until M3, and ADR-0004 forbids Vitest's positional substring filters. Instead, have this repository's `vitest.config.ts` read the list from an env var or a file and set `include` to it (escape any glob characters).
  - In shadow mode every file runs.
- **`sieve-gate` job.** `needs: [plan, test]` and `if: always()`; it fails unless every shard succeeded. Ask Ojas whether to make it the single required check.
- **On a push to `main`.** Build the map (`sieve graph --out .sieve/map/map.json`) and run `actions/cache/save@v6` with key `sieve-map-${{ github.sha }}`.

**Done when** a PR shows the shadow summary with why-paths, and the fallback works. Demonstrating both needs three steps:
1. A first PR, made before any map exists, shows the run-all fallback.
2. Merge the workflow to `main` (with approval), so a push builds and caches the map.
3. A second PR shows the shadow summary.

PRs can restore caches saved on the base branch. Verifying the trust rules for `actions/cache` is M3 work (ADR-0021).

## 8. After day 10: the rest of M1 (weeks 2–3)

These come from the M1 row of [roadmap §1](docs/roadmap.md):
- **pnpm and yarn lockfile parsers.**
  - 24 of the 26 vetted repositories use them (19 pnpm, 5 yarn), so they gate the replay corpus in M4 ([bench/CORPUS.md](bench/CORPUS.md)).
  - Today `detectLockfile` reports both as unparseable (L3).
  - The YAML subset in `core/resolve/yaml.ts` is too small for `pnpm-lock.yaml`.
- **SMAP v0, byte-identical across OSes.**
  - First settle the provenance width. ADR-0009 says 2 bits per edge, but an edge is often both static and dynamic, which needs a 3-bit mask (DECISIONS 16).
- **`sieve explain`.**
- **Golden graphs for 6 repositories.** These need clones, so ask first.
- **T6:** a 10,000-file graph in under 30 s cold and under 3 s incremental. The lexer alone is about 3 s per 100 MB.
- **Measure the probe-edge volume** on a real repository. Expect about 10 edges per extensionless import. If it's too large, add per-directory "probe group" nodes (DECISIONS 17).
- **The open items from the kickoff brief, §7:**
  - Time each candidate's suite offline (R2 in CORPUS.md); none are timed yet.
  - Read the licenses of date-fns, maplibre and every NOASSERTION repository.
  - Note anything that bears on the minimum Vitest and Jest versions (M2). Nothing new so far; SIEVE itself uses Vitest 5.1.

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

All measured on Windows 11, Ryzen AI 7 350, Node 26.4 and git 2.55. There are no Linux numbers yet.

## 10. Decisions waiting on Ojas

1. The mirroring policy for the NOASSERTION and LGPL corpus repositories (§5.2).
2. Whether `sieve-gate` becomes a required check on `main`, which is a branch-protection setting.
3. Which corpus repository day 9 should run on, and approval to clone it. honojs/hono and colinhacks/zod are small and use Vitest.
4. The GitHub org for merge-queue dogfooding (roadmap day 0, needed by M6), and whether the corpus repo should live under it.
5. When to make the CLI's would-skips enforceable. Not before records exist (M2/M3) and 4 clean shadow weeks (M7).

## 11. Known gaps and limits in the merged code

These are honest limits, not bugs. Each one errs towards running more tests.

- **Lexer.** `typeof import('x')` in a type position counts as a dynamic import. JSX detection is a heuristic based on where an expression can start. A would-be regex that reaches the end of its line is reinterpreted as division.
- **Resolver.**
  - **tsconfig.** Only the nearest `tsconfig.json` governs a file: no `references`, no `tsconfig.app.json` variants, and no `include`/`files` check.
  - **Aliases from runner configs** (Vite `resolve.alias`, Jest `moduleNameMapper`) are invisible until M2 exports them. Such imports come out `unresolved`, and so run.
  - **Symlinks.** A path below a symlinked directory is `unresolved`.
  - **Workspaces.** The root package counts as a workspace member in the `workspaces` name map, for self-reference.
- **Graph.** The build merges edges through a `Map` (1.6 s at 1M edges). The M3 map decode replaces it.
- **Collector.** See §5.4. The first run's coverage is still unknown.
- **Docs that still owe updates:**
  - architecture §5.1 CLI flags (day 9);
  - ADR-0009 provenance width (week 3);
  - architecture §9.3 says `GITHUB_TOKEN` gets 1,000 requests per hour; the probe measured 5,000 (DECISIONS 9).

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

**Status of the kickoff doc gaps** (DECISIONS 1):

| Gap | Status |
|---|---|
| 1. No safe skips in M1; CLI flags differ | **Open**, for day 9 (§6.2) |
| 2. `import type` and missing import forms | Resolved by the lexer (14) |
| 3. Where the resolver probes | Resolved: git's view (17) |
| 4. Runners order candidates differently | Resolved: the union (17) |
| 5. Zero-dependency scope | Resolved (6) |
| 6. The §9.8 candidates aren't a replay set | First-pass vetting done; R2 timing **open** |
| 7. Stale hand-over note | Noted (1) |
