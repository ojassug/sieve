# Decisions log

Implementation decisions too small or too local for an ADR, plus session hand-overs. Entries are numbered and never renumbered. Each one gives the context, the decision and the evidence. Architecture-level decisions live in [docs/adr/](docs/adr/README.md).

## 1. Kickoff (2026-11-11)

- **Context.** The architecture, roadmap, 21 ADRs and pre-registered targets were approved on 2026-11-11 (commits `da4f879`, `0a39d9c`). Implementation was planned to start on Mon 2026-11-16.
- **Decision.**
  - Start M1 on Wed 2026-11-11, five days early, keeping the day order of [roadmap.md](docs/roadmap.md) §4. Days 1–10 are: skeleton, corpus collector, `core/git`, `core/lex/ts`, `core/graph`, `core/resolve/ts`, `core/lockfile/npm`, CLI v0 and the walking skeleton.
  - Work on one short-lived branch and pull request per roadmap day. If a merge is pending, the next day's branch builds on the unmerged one.
  - ADRs can still be corrected in place until 2026-11-16. After that, a changed decision is a new ADR.
- **Gaps found while reading the docs.** Each one is resolved on the day it affects, with its own entry:
  1. M1 has no records, so no skip can be safe under ADR-0005. The walking skeleton's would-skips are unproven static reachability and must be labelled that way. The CLI flags also differ: architecture §5.1 has `--mode shadow`, while the roadmap's day 9 has `--shadow --static`.
  2. Architecture §3.2 says `import type` "is always erased". That holds only for the statement form. `import { type X } from 'm'` becomes `import {} from 'm'` under `verbatimModuleSyntax` and still evaluates `m`. Missing import forms: `import x = require()`, `export * as ns`, `vi.mock`/`jest.mock` (with `__mocks__`), `importActual`/`requireActual`, `require.resolve` and `new URL('…', import.meta.url)`.
  3. The docs don't say where the resolver probes for files: the working tree or git's listing.
  4. The runners probe extensions in different orders. Vite's default tries `.js` before `.ts`, TypeScript prefers `.ts`, and Jest has its own list.
  5. The zero-dependency check named only core and the CLI, but ADR-0002 also covers the runner plugins.
  6. The replay candidates in architecture §9 item 8 were chosen because they upload JUnit, not for re-execution. GitHub's license field shows `mariadb-connector-nodejs` as LGPL-2.1, and PostHog, baserow, luma.gl and AutoGPT as NOASSERTION.
  7. The planning hand-over note says the repo was "not pushed", but `origin/main` was already `0a39d9c` and the repository is public.
- **Evidence.** [roadmap.md](docs/roadmap.md) §4; [docs/adr/README.md](docs/adr/README.md); the GitHub API, read on 2026-11-11.

## 2. TypeScript 6.0, not 7.0

- **Context.** `typescript@latest` is 7.0.2, the native port. typescript-eslint 8.72.2, also the latest, peer-requires `typescript >=4.8.4 <6.1.0`, and type-aware linting needs it.
- **Decision.** Pin TypeScript 6.0.3. Revisit when typescript-eslint supports 7.x.
- **Evidence.** `npm view typescript dist-tags` and `npm view typescript-eslint peerDependencies`, run on 2026-11-11.

## 3. Source-first workspace packages

- **Context.** Core, the CLI and the runner plugins ship with zero runtime dependencies ([ADR-0002](docs/adr/0002-zero-dependency-cli.md)) and support Node 22 and later. A build step in every CI job and in the plan job would add latency and moving parts.
- **Decision.**
  - Workspace packages export `./src/*.ts` directly.
  - Sources use only erasable TypeScript (`erasableSyntaxOnly`) with explicit `.ts` relative imports, so Node's type stripping runs them unchanged. `tsc` only typechecks (`noEmit`).
  - Development needs Node 22.18 or later. The CI test job runs a repository script on every Node version in the matrix to prove type stripping works there.
  - When the CLI is published, it is bundled into one JavaScript file that runs on Node 22. Internal packages are inlined, so they never appear in `dependencies`.
- **Evidence.** `erasableSyntaxOnly` exists since TypeScript 5.8. Node's type stripping has been on by default since 22.18; the CI matrix verifies this.

## 4. Placeholder package names

- **Context.** The npm name `sieve` is taken, and the final name is chosen by M9 (architecture §8.1, risk 10). Architecture §5.3 already uses `@sieve-ci/cli` as a placeholder.
- **Decision.** Packages are named `@sieve-ci/*` and marked `"private": true` until the name is final.

## 5. Exact pins; Node types follow the CLI's floor

- **Context.** Same input, same bytes out, and that includes the toolchain. The CLI supports Node 22 and later.
- **Decision.**
  - devDependencies are pinned exactly (`save-exact` in `.npmrc`).
  - `@types/node` tracks 22.x, so code that uses an API newer than Node 22 fails the typecheck.
  - The TypeScript target and lib are ES2024, which Node 22's V8 (12.4) fully supports.

## 6. Scope of the zero-dependency check

- **Context.** The brief named core and the CLI. [ADR-0002](docs/adr/0002-zero-dependency-cli.md) also covers the runner plugins, and runtime dependencies can also arrive through `optionalDependencies` or `bundleDependencies`.
- **Decision.**
  - `npm run check:deps` covers `packages/{core,cli,vitest,jest}`.
  - It rejects non-empty `dependencies`, `optionalDependencies` and `bundle(d)Dependencies`.
  - It allows `peerDependencies` only in the two runner plugins.
  - A missing manifest counts as a violation, so renaming a package can't skip the check.

## 7. The DCO check covers pull-request commits only

- **Context.** The two documentation commits on `main` (`da4f879`, `0a39d9c`) predate the sign-off rule, and history on `main` is never rewritten.
- **Decision.** CI checks every non-merge commit in `base..head` of a pull request. The sign-off's e-mail must match the commit author's, compared case-insensitively.

## 8. Seeded property tests

- **Context.** Property tests must be deterministic in CI and still able to explore.
- **Decision.** fast-check uses the global seed `20261116`, set in `vitest.setup.ts`. `SIEVE_FC_SEED` overrides it, and failures print the seed and path needed to replay them.

## 9. The corpus collector uses `GITHUB_TOKEN`, not a personal token

- **Context.** The collector reads Actions data and downloads artifacts from other public repositories. It was not known whether a workflow's `GITHUB_TOKEN` is allowed to do that, or whether it is limited to 1,000 requests per hour as the docs say.
- **Evidence.** A one-off probe workflow (run 43022083834 on a temporary `probe/artifact-access` branch, since deleted) called the API with `GITHUB_TOKEN`:
  - against electron/forge and baserow/baserow, listing runs, listing a run attempt's jobs, listing a commit's check runs and listing artifacts all returned 200;
  - downloading electron/forge's newest artifact returned **302**, then 200 with a 436,043-byte zip archive;
  - `/rate_limit` reported a core **limit of 5,000** for the token;
  - baserow's repository-wide `GET /actions/artifacts` returned **500**. It also failed for meshery and AutoGPT in a survey with a user token, so listings of large repositories fail on GitHub's side.
- **Decision.**
  - The collector authenticates with its own workflow `GITHUB_TOKEN`, so no secret is needed.
  - It lists artifacts per run, never per repository.
  - It retries 5xx responses with backoff, honours `retry-after` and the reset time, and reads the rate limit from response headers instead of assuming one.

## 10. Collector design

- **Context.** History older than 90 days is gone. A daily job gets at most 6 hours, and on 2026-11-11 the candidates created anywhere from 1 to more than 2,500 runs a day. A live metadata-only test against vuejs/core took about 3.2 requests and about 38 KB of raw JSON per run.
- **Decision.**
  - **Work order.** The last 7 days are re-collected on every run, to catch new attempts and short-lived artifacts. The backfill then goes oldest day first, back to 89 days ago, tier 1 repositories before tier 2.
  - **Run listing.** Runs are listed per workflow, by `created` day. A range whose `total_count` exceeds GitHub's 1,000-result cap is split in halves.
  - **Per run.** The collector fetches each new attempt and its jobs, the check runs of the check suite, and the artifact listing, and mirrors matching test reports.
  - **Resumable state.** State records, per run, the attempt seen and the artifacts mirrored. It is updated run by run, so an interrupted day resumes where it stopped.
  - **Budgets.** The request and time budgets end a run cleanly. The manifest records what is pending and the coverage of the retention window.
  - **Raw objects.** Records are raw API objects written as canonical NDJSON. Consumers deduplicate.
- **Evidence.** Tests in `tools/corpus/test`, mutation-checked by hand against the fake API. Metadata-only live runs on 2026-11-11 against colinhacks/zod and vuejs/core.

## 11. Corpus storage (proposed; awaiting approval)

- **Context.** The data has to outlive GitHub's 90 days, be publicly reproducible (TARGETS.md, "Publication"), and cost nothing to run.
- **Decision (proposed).**
  - A separate public repository, `ojassug/sieve-corpus`, built from the template in `tools/corpus/corpus-repo/`.
  - Manifests and collector state are committed to git.
  - Raw NDJSON (`.tar.gz`) and mirrored artifacts (`.tar`, per repository) are uploaded as daily release assets, which have no retention limit.
  - The collector is pinned by commit in `collector.ref`.
  - Mirroring is limited to permissively licensed repositories; the rest contribute metadata only (bench/CORPUS.md).
- **Status.** Approved on 2026-11-11 and created as [ojassug/sieve-corpus](https://github.com/ojassug/sieve-corpus), with the collector pinned to `4d28a10`. The first run started the same day (workflow run 43026895799).

## 12. Snapshot diff semantics (`core/git`)

- **Context.** Architecture §3.1 defines `f:` hashes as blob ids and `d:` hashes as a digest of a directory's entry names. It leaves several cases open: mode changes, symlinks, submodules, paths that are not valid UTF-8, and the order of output.
- **Decision.**
  - **Change kinds.** A blob, symlink or gitlink whose oid *or mode* changes is `modified`, so an executable-bit flip counts as a change, which is conservative. A path that turns from file into directory, or the reverse, is a `deleted` plus `added`s.
  - **Listings.** A directory's listing is the set of its entry names *and kinds*: file, symlink, submodule or directory. A file that becomes a symlink therefore changes its directory's listing, as `readdir` with file types would show. A directory that appears or vanishes counts as a listing change too, because its `d:` node goes to or from absent.
  - **Path order.** Every path list is sorted by UTF-16 code units, the order canonical JSON uses for keys, and never by git's tree order. Both diffs therefore yield byte-identical results on every OS.
  - **Undecodable paths.** A path whose bytes are not valid UTF-8 is kept, with a lossy rendering and an `undecodable` flag. `TreeIndex` counts these paths, so callers can escalate (L3). Duplicate paths throw.
  - **Reading from git.** `lsTree` reads `git ls-tree -r -t -z --full-tree <root tree>` as a stream. It never hashes working-tree bytes, because those differ across OSes when line endings are converted.
- **Evidence.**
  - P10 (`packages/core/test/git/diff.test.ts`): the descent equals the naive diff on 10,000 seeded random tree pairs. It also visits exactly the directories that exist on both sides with different ids.
  - A differential test against `git diff-tree -r --no-renames` on SHA-1 and SHA-256 repositories built with plumbing.
  - Five hand mutants of the descent, all caught.

## 13. `git ls-tree` cost at 10,000 files

- **Context.** Open item: measure `git ls-tree` on a 10,000-file repository. Architecture §3.1 expected about 100 ms.
- **Evidence.** On the synthetic 10,000-file repository (`node bench/ls-tree.ts`), medians of 15 runs on Windows 11 with Node 26.4 and git 2.55:
  - `git ls-tree` alone: 31.5 ms;
  - the full snapshot read (`lsTree`): 57.6 ms;
  - `TreeIndex.build`: 3 ms;
  - the descent: under 0.5 ms for 1 or 100 changed files.

  The details are in [bench/README.md](bench/README.md).
- **Decision.** The CLI lists the whole head tree locally. The two-round-trip protocol in §3.1 matters for the server's bandwidth, not for the CLI's latency.

## 14. The TypeScript/JavaScript import lexer (`core/lex/ts`)

- **Context.** Architecture §3.2 and ADR-0002 call for a hand-written, zero-dependency state machine. The kickoff found gap 2: `import type` semantics, plus import forms the docs don't list.
- **Decision.**
  - **Origin.** The lexer was written fresh. TokenDamper's `ts-validator.ts` was read for reference only, and no code was ported, so it needs no provenance line.
  - **Two stages.** A scanner produces tokens. A recognizer then reads import forms off the token stream.
  - **Twelve record kinds:**
    - `static`, `side-effect`, `reexport`, `dynamic`;
    - `require` (including `module.require`), `require-resolve`;
    - `import-equals` (`import x = require()`);
    - `glob`: `import.meta.glob`/`globEager`, with patterns and the `query` and `base` options;
    - `meta-resolve`;
    - `url` (`new URL('…', import.meta.url)`);
    - `mock`: `vi` or `jest` mock, `doMock`, `unmock` and similar; `vi.mock(import('./x'))` is recognised;
    - `actual`: `importActual` and `requireActual`.

    Specifier queries such as `?raw` are kept verbatim for the resolver.
  - **Type-only imports.** Statement-level `import type` and `export type` are marked `typeOnly`. When every named specifier carries an inline `type`, the record is marked `inlineTypeOnly`, but it stays an edge, because `verbatimModuleSyntax` keeps it as `import {}`. That resolves kickoff gap 2.
  - **Uncertainty is never silent.**
    - A non-literal specifier yields `specifier: null`, or `patterns: null` for a glob.
    - Diagnostics mark the whole file uncertain: unterminated strings, templates, comments or JSX; unbalanced brackets; an `import` or `export … from` that can't be parsed; template or JSX nesting deeper than 256; invalid UTF-8.
  - **Regex versus division** is decided by the previous significant token:
    - a keyword after `.` or `?.` is a property name;
    - the `)` closing `if`, `while`, `for` or `with` lets a regex follow;
    - `++` and `--` are operands;
    - a would-be regex that reaches the end of its line is reinterpreted as division.
  - **JSX.** It is on for `.tsx`, `.js` and `.jsx`, and off for `.ts`, where `<T>x` is a type assertion. `<` opens JSX only where an expression can start. In `.tsx`, `<T,>` and `<T extends …>` are type parameters. JSX text and attribute strings are not code.
  - **Definitions are not calls.** These are treated as definitions or signatures:
    - `import(` or `require(` with no arguments, or with `{` after the matching `)`;
    - a first argument written `name:` or `name?:`;
    - `import<` in any form.

    `typeof import('x')` in a type position is recorded as a dynamic import, which is conservative.
- **Evidence.**
  - 19 golden fixtures with hand-derived expectations.
  - A generative test: 2,000 seeded programs bury real imports among adversarial strings, comments, templates, regexes and divisions, under LF and CRLF, and every one must come out in order with no diagnostics.
  - 3,000 arbitrary inputs: no throw, and identical output on repeat.
  - 10 hand mutants of key decisions, all caught.
  - On the 2,699 files under `node_modules` (43.7 MB), **0 files are marked uncertain**. Before the signature fix, two files were wrongly flagged, both Vite and Vitest `.d.ts` output with `import<T>(…)` method signatures.

## 15. Lexer throughput

- **Evidence.** `node bench/lex.ts` runs at 32–34 MB/s (median of 5 passes over 43.7 MB) on Windows 11 with Node 26.4.
- **Implication.** A cold lex of a 10,000-file repository that averages 10 KB per file (100 MB) takes about 3 s. That is a tenth of T6's 30-second budget for the whole static graph. Extraction is cached by (blob oid, extractor version), so incremental runs only re-lex changed blobs.

## 16. Graph representation (`core/graph`)

- **Context.** Architecture §3.2 and §3.3 specify the graph:
  - CSR adjacency in both directions;
  - a provenance per edge (static, dynamic or declared);
  - a multi-source reverse BFS with parent pointers for why-paths;
  - output that is deterministic across runs and OSes (P6).
- **Decision.**
  - **Edge direction.** An edge points from the dependent to what it depends on. The BFS walks the reverse arrays from the changed nodes.
  - **Canonical ids.** `GraphBuilder.build()` numbers nodes in sorted name order, in UTF-16 code-unit order. The same graph built in any order therefore gives identical CSR arrays, BFS order and why-paths.
  - **Ties.** Seeds and neighbours are visited in ascending id order, and the first discovery wins. A why-path is therefore a shortest path to the lowest-numbered nearest seed.
  - **Provenance is a 3-bit mask:** `STATIC=1`, `DYNAMIC=2`, `DECLARED=4`. Duplicate edges are merged by OR-ing the bits, because one edge is often both static and dynamic.
    - This differs from ADR-0009 and §4.2, which give SMAP a "2-bit provenance per edge". Two bits can't represent combinations of three sources.
    - To settle when SMAP is built (week 3): a 3-bit mask, or 2 bits plus a rule that drops a source.
  - Seeds that aren't nodes throw. Callers map changed paths to nodes, or to escalations (§3.5), first.
- **Evidence.**
  - P1: a node is reached exactly when its forward closure meets the change set. Checked against a DFS oracle over the raw edge list on 2,000 random graphs, with cycles allowed.
  - P3: monotonicity, on 2,000 graphs.
  - Why-paths follow real edges and are shortest, checked by an independent BFS on 1,000 graphs.
  - Building with permuted insertion order gives identical arrays and why-paths, on 1,000 graphs.
  - 5 hand mutants, all caught.
  - At 100,000 nodes and 1M edges, the reverse BFS takes 7.6–8.5 ms in the worst case, when every node is reached; §3.3 expected tens of milliseconds. The build takes 1.6 s ([bench/README.md](bench/README.md)).

## 17. Module resolution (`core/resolve`)

- **Context.**
  - Architecture §3.2 asks the resolver to cover relative paths, extensions, index files, tsconfig `paths`/`baseUrl`/`extends`, package `exports`/`imports` and workspaces, with "probe recording".
  - Kickoff gaps 3 and 4 asked where to probe, and how to handle runners that order candidates differently.
- **Decision.**
  - **Where it probes.** The resolver works on a virtual file system: git's case-sensitive listing of one snapshot, through the `Vfs` interface, never the working tree. Untracked and ignored files are invisible to it; `generated` rules and the M2 fs hooks cover them.
  - **Union of runners.** For a missing exact path, every candidate any runner might pick is probed:
    - the path itself;
    - `.js`→`.ts`/`.tsx`, `.jsx`→`.tsx`, `.mjs`→`.mts`, `.cjs`→`.cts`;
    - the extensions `.ts .tsx .mts .cts .js .jsx .mjs .cjs .json`;
    - for a directory, its package.json entry and `index` with every extension.

    Every existing candidate is a target and every missing one an absent (⊥) node. When the exact path exists, it alone is the target, because Vite, Jest and Node all try it first.
  - **Directories.** Any path probed as a directory is a `d:` node, including one that doesn't exist. A missing directory is one `d:` node instead of eleven `index` probes, and it is still sound: if the directory appears, its listing changes.
  - **Exports and imports.** Targets are the union over every condition except `types`/`typings`, through nested conditions and fallback arrays. The key is chosen by Node's `PATTERN_KEY_COMPARE`, the most specific match. `null` means not exported. Without `exports`, the entry is the union of `main`, `module`, `browser` and `jsnext:main`, plus `index`.
  - **tsconfig.**
    - The nearest `tsconfig.json` governs. Each missing `tsconfig.json` on the way up is a ⊥ node.
    - `extends` may omit `.json`, and chains are followed.
    - Package bases are not readable from git. Those under `@tsconfig/` are assumed to set no paths; any other package base marks the result uncertain.
    - The best `paths` match (longest prefix) and `baseUrl` add candidates on top of normal resolution, never instead of it.
  - **Workspaces.**
    - Packages come from pnpm-workspace.yaml, or else the root package.json `workspaces`, with `!` excludes.
    - A bare import depends on one synthetic node, `workspaces`, that lists every `name=dir`. Its edges therefore don't grow with the number of packages, and a rename or a new package still affects every bare import.
    - Duplicate package names make the result uncertain.
  - **Mocks.**
    - An external package also depends on the `__mocks__` listing at the repo root and at the importer's package root, because Jest uses `<root>/__mocks__/<pkg>` automatically. Existing mock files there are targets.
    - `vi.mock` and `jest.mock` records add `__mocks__/<name>` next to each resolved module.
  - **Everything else is explicit:**
    - `node:` and builtins → `builtin`;
    - `data:` → `ignored`;
    - `http(s):` → `unresolved: remote module`;
    - other schemes such as `virtual:` → `unresolved: virtual module`;
    - a path below a symlinked directory → `unresolved: symlinked directory`;
    - an unparseable package.json or tsconfig → `uncertain`.
- **Evidence.**
  - 5 fixture repositories with 43 hand-derived cases.
  - An exact probe list for one import.
  - Unit tests for JSONC, the pnpm YAML subset, globs and `exportsTargets`.
  - **The soundness property:** on 400 random repositories × 13 specifiers, adding any file that isn't recorded evidence, or removing any file that isn't a target, config or under a recorded directory, never changes the result.
  - 10 hand mutants of the safety-critical choices, all caught.
- **Cost, still to measure.** Probe edges will dominate the edge count, at about 10 per extensionless import. If SMAP size or graph build time demands it, shared per-directory "probe group" nodes can cut that.

## 18. npm lockfiles (`core/lockfile/npm`)

- **Decision.**
  - Every `node_modules/…` entry in a v2 or v3 `packages` map becomes `p:npm:<install location>`. Its hash is the `integrity`; without one, `version|resolved`; for a workspace link, `link:<dir>`. The root entry and workspace declarations are skipped, because they are package.json files that are already `f:` nodes.
  - `locate(name, dir)` follows Node's walk up the `node_modules` directories, never through `node_modules/node_modules`.
  - A package depends on what its dependencies, optional dependencies and peers resolve to from its own location; unresolvable names are reported as missing.
  - v1 lockfiles, invalid JSON, pnpm, yarn, bun, or more than one lockfile kind are reported as `unparseable`, which escalates to L3 (§3.5).
- **Evidence.** 16 tests, including a parse of this repository's own lockfile. pnpm and yarn parsing is due in M1's week 3; bench/CORPUS.md shows it is a prerequisite for the replay corpus.

## 19. Session hand-over (2026-11-11): days 1–8 done, 9–10 next

- **Done.** All changes are on stacked branches, one pull request per roadmap day:

  | Day | Pull request | State |
  |---|---|---|
  | 1, skeleton and CI | #1 | merged |
  | 1–2, corpus collector | #2 | open |
  | 2–3, `core/git` and P10 | #3 | open |
  | 3–4, import lexer | #4 | open |
  | 5, graph with P1 and P3 | #5 | open |
  | 6–7, resolver | #6 | open |
  | 8, npm lockfile | #7 | open |

  At the time of writing, 239 tests pass locally. #2–#5 were green in CI; #6 and #7 were pending.
- **Corpus.** [ojassug/sieve-corpus](https://github.com/ojassug/sieve-corpus) was created with approval. Its first collection run, 43026895799, was still running.
- **Open item: day 1–2's "done when".** It is met once that run publishes `manifests/2026/2026-11-11-1.json`. If the run failed, read its log, fix the collector on #2, update `collector.ref` and re-run the workflow.
- **Next: day 9, CLI v0.**
  - `core/git`: read blob contents with `git cat-file --batch`, and add a `GitVfs` over `TreeIndex` plus blobs.
  - A static graph builder:
    - lex every source file;
    - resolve every record;
    - add edges to targets, absent paths, `d:`, configs and `g:` nodes;
    - add each importer's tsconfig chain and nearest package.json;
    - add `p:` nodes through `locate` and lockfile package edges;
    - mark `u:` nodes and uncertain files.
  - The CLI: an argument parser, a `sieve.config.json` loader, and `sieve graph`, `diff` and `plan --static --shadow --map <dir>`, all emitting canonical JSON. Would-skips must be labelled unproven (kickoff gap 1).
- **Next: day 10.** The walking skeleton workflow (plan → matrix → shards → `sieve-gate`), with the map in `actions/cache` (roadmap §5).
- **How to verify.** Run `npm ci`, then `npm test`, `npm run lint` and `npm run typecheck`. `node bench/ls-tree.ts`, `node bench/lex.ts` and `node bench/graph.ts` reproduce the recorded numbers.

## 20. Hand-off document (2026-11-11)

- **Context.** After entry 19 was written, Ojas approved merging #2–#7. They were merged into `main` in order, with merge commits, and `main` is green at `00fea91`. Ojas then asked for a hand-off detailed enough for someone else to continue.
- **Decision.**
  - [HANDOFF.md](HANDOFF.md) at the repository root is the single place to start. It covers:
    - status;
    - ground rules;
    - setup and verification;
    - a module map with entry points;
    - how to operate the corpus collector;
    - detailed plans for days 9 and 10;
    - the rest of M1;
    - recorded numbers;
    - decisions waiting on Ojas;
    - known limits;
    - environment notes.
  - Entry 19's PR states are superseded: every one of #1–#7 is merged.
  - Architecture §3.1 now defines `d:` hashes as names *and kinds*, matching entry 12 and the code. Whoever builds the graph on day 9 should implement against that.
- **Evidence.** `gh pr view` shows #1–#7 merged; CI on `main` passes.

## 21. Collector budget: oldest days first, per-repository shares, PostHog dropped

- **Context.** The first collection run (43026895799, 2026-11-11) succeeded but could not keep up:
  - 24,581 requests over 320 minutes collected 6,208 runs, 6,258 attempts and 83,523 jobs, with no errors.
  - That covered only 1.7 of the 7 recent days it re-collected first (Nov 4, and Nov 5 for 19 of 26 repositories), and none of the backfill.
  - PostHog's `ci-frontend.yml` was 4,183 of those runs, all from one day.
  - Only 68 artifacts (0.2 MB, meshery) matched the test-report pattern.
- **Decision.**
  - **Oldest days first.** Days are collected oldest first: the backfill, then a recent window that shrinks from 7 to 2 days. GitHub deletes the oldest days first, and a recent day not reached in time is collected later as a backfill day.
  - **Per-repository shares.** In phase 1, each repository may spend `repoShare` requests (default 1,000; 25 repositories × 1,000 is about one run's capacity). A repository that hits its share stops for the phase; the client throws `ShareExhausted`, distinct from `BudgetExhausted`. In phase 2, the remaining time goes to the open work in plan order. State is saved run by run, so an interrupted day resumes without refetching.
  - **The manifest** now records `requestsByRepo`, `options.repoShare`, and a `capped` item status.
  - **PostHog/posthog is removed** from `repos.json`. It is tier 2 and metadata-only (NOASSERTION), and most of its runs are bots.
- **Evidence.** Tests in `tools/corpus/test` cover the share limit in the client, the new plan order, and the two phases: a capped repository yields to the others, then finishes from the leftover time. Two hand mutants are caught: dropping phase 2, and ignoring the share. The first run's numbers are in its manifest, `manifests/2026/2026-11-11-1.json` in sieve-corpus.

## 22. Race-proof corpus publishing: a reusable workflow, and re-apply before pushing

- **Context.** A collection run holds the data repository for hours, and its last act is a push to `main` there. Three things could go wrong:
  - **A push during a run lost the run.** Anything landing on sieve-corpus `main` while a run collected — a `collector.ref` bump, a workflow edit — made the run's final push non-fast-forward. The release, with the data, was already published; the manifest and `state/collector-state.json` were not. The next run redid the work and the release sat orphaned with nothing pointing at it. The `collect` concurrency group keeps two runs apart and does nothing about a person. DECISIONS 21's PR added a `git pull --rebase` loop to the template, but it was untestable bash that left a half-finished rebase behind on a conflict, so attempts 2 and 3 failed for a new reason; the copy live in sieve-corpus never got even that.
  - **A partial release was visible.** One `gh release create` created the release and uploaded every asset, so a failure part-way left a published release missing assets.
  - **The cause was structural.** `collector.ref` lived in the data repository, so every collector change needed a hand push into it — exactly the event that lost runs. The workflow also existed twice, as the template here and the copy there, free to drift.
- **Decision.**
  - **The data repository no longer holds the collector version.** sieve-corpus's `collect.yml` becomes a thin caller of `.github/workflows/corpus-collect.yml` in this repository, and `collector.ref` is deleted. The reusable workflow checks out the collector from `job.workflow_repository` at `job.workflow_sha`, the commit of the workflow file that is running, so a run is pinned to itself and the manifest still records that commit through `--ref`. Normal operation needs no push to sieve-corpus at all: merging here changes the next run.
  - **Pinned to `@main`, not to a tag.** CI gates `main`, and a tag would move the manual step rather than remove it. The cost is that a bad merge can break the next night's collection; that is recoverable, a lost day of a 90-day window is not.
  - **One source of truth, checked daily.** The steps a run performs exist once, here. The caller stub and the data repository's README are still copies, so a `templates` job in the reusable workflow diffs them against `tools/corpus/corpus-repo/` and fails when they differ. It is a job of its own, not a step in `collect`: drift turns the run red without stopping collection, because a stale README must never cost a day of history that GitHub is about to delete.
  - **Publishing is a tested script**, `tools/corpus/src/publish.ts` with a thin `publish-main.ts` CLI, rather than inline YAML. Commands are injected, so ordering and failure handling are testable.
  - **Data first, then the index that claims it.** The release is created as a draft, its assets uploaded, and only then un-drafted; the manifest and state are committed after that. A consumer never sees a partial release, and committed state can never promise data that was not stored. The manifest and the state file are also release assets, so a run whose commit never lands stays recoverable. Re-running a job, which keeps its run number, uploads over the existing release instead of failing on the tag.
  - **Re-apply rather than rebase.** Each attempt fetches `origin/main`, resets the branch to it, writes the run's staged manifest and state over whatever is there, commits and pushes. Three attempts by default, then it throws with every attempt's git output. Against `git pull --rebase`: there is no conflict state to abort when someone touched the same file, the run's own files always win while every other file comes from the remote, and it is idempotent — a re-run that would commit the same bytes reports nothing to do instead of failing. Only tracked files move, so the collector's untracked output in the checkout survives.
- **Evidence.** `tools/corpus/test/publish.test.ts` builds a real bare "remote" with two clones and has a competitor push to `main` immediately before chosen push attempts:
  - a commit that lands mid-run is kept and the run's manifest and state still arrive, on the second attempt;
  - a competitor that touched `state/collector-state.json` itself does not conflict, and the run's version wins;
  - a competitor on every attempt exhausts them and throws with git's rejection, leaving no `rebase-merge`, `rebase-apply` or `MERGE_HEAD` behind and HEAD still on the branch;
  - an unreachable remote fails with git's own message;
  - the files already being on the branch reports nothing to commit;
  - `gh release edit --draft=false` runs before the first `git commit`, and a failing `gh release create` commits nothing at all.

## 23. The static graph and the M1 map (`core/graph/static`)

- **Context.** Day 9 builds the static impact graph (architecture §3.1, §3.2) and stores it for plans ([HANDOFF.md](HANDOFF.md) §6.1). Several choices were left open: declaration files, the rule for uncertain files, lockfiles that cannot be parsed, mode changes, and the map's format.
- **Decision.**
  - **Inputs come from git objects only.** `readBlobs` reads every blob through one `git cat-file --batch` process. `GitVfs` serves the resolver from a `TreeIndex`: modes `100644`/`100755` are files, `120000` symlinks, `160000` submodules, trees directories.
  - **Module files** (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`) are all nodes, imported or not. **Declaration files** (`.d.ts`, `.d.mts`, `.d.cts`, `.d.<ext>.ts`) are nodes but are never lexed: no runtime evaluates them. Type tests (Vitest typecheck) would need them; they are out of scope until records exist. Statement-level `import type` is skipped; inline `type` specifiers stay edges (entry 14).
  - **Node keys and hashes.**
    - `f:<path>`: the blob id, prefixed by the mode unless it is `100644` (`100755:<oid>`, `120000:<oid>`), so a mode change is a change, as in entry 12. A path that does not exist hashes to `null` (⊥).
    - `d:<dir>`: SHA-256 of the canonical JSON of its sorted `[name, kind]` pairs, with entry 12's kinds; `null` if missing.
    - `g:workspaces` (the resolver's name map), `g:glob:<patterns>` (`import.meta.glob`), `g:inputs.global` and `g:declared:<match>`: SHA-256 of the canonical JSON of the sorted matches. The map keeps each pattern-based node's patterns, so a plan can recompute it.
    - `p:npm:<location>`: the lockfile hash (entry 18). Every package in the lockfile is a node.
    - `e:runtime` (Node major.minor), `e:platform` (OS and architecture) and `e:env/<NAME>` for each tracked variable: SHA-256 of the value, so the map never holds environment values.
    - `u:<path>`: an uncertain file.
  - **Edges.**
    - STATIC, from each lexed file: to everything each resolution recorded (targets, absent paths, directories, configs, globs); to its own config chain (`Resolver.fileConfigs`: the tsconfig chain and the nearest `package.json`); and, for a bare specifier, to `p:npm:` via `locate`, or to the ⊥ node `p:npm:node_modules/<name>` when the package is not installed.
    - STATIC, from each package: to what its dependencies resolve to, or to that ⊥ node.
    - DECLARED, from each test: to `g:inputs.global`, every `e:` node and the declared rules that match it.
  - **The `u:` rule: an uncertain file's `u:` node is always changed, a seed of every plan.**
    - A file is uncertain when the lexer raised a diagnostic, an import is unresolved (non-literal ones included), a resolution read a config it could not parse, or a bare import names a package missing from the lockfile (or there is no lockfile).
    - Any test that reaches the file always runs.
    - Architecture §3.5's narrower rule, L1 only when the uncertain file changed, relies on dynamic coverage that does not exist until M2/M3.
  - **Lockfiles that cannot be parsed** (pnpm, yarn, bun, npm v1) **or more than one.**
    - Bare imports depend on each lockfile's `f:` node, and a plan escalates to L3 when any of them changed or the set of lockfiles changed.
    - This is §3.5's row "lockfile changed but unparseable". HANDOFF §6.1's "unparseable is L3" is read the same way, so an unchanged pnpm lockfile costs no precision.
    - Both corpus candidates, hono and zod, use pnpm.
  - **Default global inputs:** the root `package.json`, `.env*`, Vite and Vitest configs, `vitest.workspace.*`, `vitest.setup.*`, and Jest's config and setup, by their conventional names. `inputs.global` adds to them. Runner configs are module files, so their imports are followed too.
  - **The map** is canonical JSON at `.sieve/map/map.json` until SMAP (week 3). It holds `version` 1, `engine` `sieve-static-1` (another engine's map is invalid), `objectFormat`, `rootTree`, `undecodable`, the config's blob id, the lockfile setup, `snapshot`, `nodes`, `edges`, `globs`, `tests` and `uncertain` (the causes per `u:` node).
    - `snapshot` lists every `ls-tree` entry as `[mode, oid, path]`, so a plan diffs against it without the base commit, which a depth-1 checkout does not have.
    - `edges` is an adjacency object, `{ from: { to: provenance } }`: the same content as `[from, to, provenance]` triples, in less space.
    - `parseMap` checks every field and both ends of every edge. Anything wrong is a `MapError`, and the plan runs everything.
- **Evidence.**
  - Example tests for every node and edge kind (`static.test.ts`, `map.test.ts`), and determinism: identical bytes whatever order the sources arrive in, and byte-identical maps of one revision from the CLI.
  - `Resolver.fileConfigs` passes the evidence-completeness property of entry 17 (400 runs). `GitVfs` and `MemoryVfs` give identical resolutions (500 runs).
  - **T6:** `sieve graph` on a synthetic 10,000-file TypeScript monorepo (42.1 MB) takes **2.5 s cold**, against 30 s. On this repository it takes 0.36 s. See [bench/README.md](bench/README.md).
  - **Probe-edge volume** (entry 17's open item): in the synthetic repository, 60,000 imports, mostly extensionless, give 684,501 edges, about 10 per import as estimated, and a 26.7 MB map. SMAP and per-directory probe groups are the levers if size matters.
  - On this repository 18 files are uncertain, all lexer fixtures that nothing imports, so no test runs because of them.

## 24. Static selection and CLI v0; kickoff gap 1 resolved

- **Context.** Day 9's CLI: `sieve graph`, `sieve diff` and `sieve plan --static --shadow --map` ([HANDOFF.md](HANDOFF.md) §6.2). Kickoff gap 1 (entry 1) was still open: no skip can be safe without records, and the docs spelled the flags two ways.
- **Decision.**
  - **Δ(S,H).** Files and listings come from the Merkle descent against the map's snapshot; `g:`, `p:` and `e:` nodes are recomputed at H. Every `u:` node is a seed. A new install location of a package named `N` seeds every `p:` node named `N`, because it can shadow another copy for some importers.
  - **Escalations** (§3.5), each listed with its cause:
    - **L1**, every test under the owning package (the nearest `package.json` at H): a changed file that is not a graph node. Exempt are files matching `inputs.ignore` (default `**/*.md`, `docs/**`, `LICENSE*`), lockfiles and `sieve.config.json` (handled below), and newly added module files, whose effect already shows through the probes and listings they would satisfy.
    - **L3**, every test: `sieve.config.json` changed; another object format; a path that is not UTF-8; the lockfile setup changed; a lockfile that cannot be parsed changed.
    - **Run-all fallback, exit 0:** no map, an invalid map (version, engine or any malformed field), an invalid config, or an internal error. CI is never blocked.
  - New test files and `alwaysRun` tests always run. Why-paths go from the test to the changed or uncertain node.
  - **Kickoff gap 1.**
    - `plan` needs `--static` until records exist (M2/M3).
    - `--static` refuses `--mode safe`, whether from the flag or from `selection.mode` in the config, and `budget`, with exit code 2. Shadow mode runs every test.
    - `--shadow` is an alias of `--mode shadow`.
    - Every would-skip is labelled **unproven static reachability**: per test in the plan JSON, and in the summary.
    - Architecture §5.1 is updated to match.
  - **GitHub outputs.**
    - `matrix` is `{"include":[{"shard":k,"files":[…]}]}`: the sorted run set split round-robin into `--shards` exact file lists (default `sharding.max`, else 1).
    - `count` is the number of test files to run.
    - The step summary has the would-run and would-skip counts, escalations, up to 20 why-paths and the would-skip list.
  - **Config.** `sieve.config.json` is read from git at the planned revision and validated by hand against the §5.1 schema; without one, the defaults apply. Projects may add `include` and `exclude` globs; otherwise each runner's default applies, without `node_modules` and `fixtures`.
  - **Exit codes:** 0 for success, fallbacks included; 1 for an error; 2 for a usage error.
- **Evidence.**
  - **Soundness property:** 2,000 seeded pairs of small repositories with shadowing probes, tsconfig paths, workspaces, nested package copies and global inputs.
    - If what a test loads differs between S and H, or any of it is uncertain, the plan must select the test.
    - The oracle follows resolutions, configs, lockfile packages and global inputs directly, and shares no graph code.
    - 20 hand mutants of the builder and the selection were all caught. A first version that used the builder as its own oracle caught only 7.
  - End-to-end CLI tests on a throwaway repository: graph, plan with `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY`, each fallback, `--mode safe` refused, diff, byte-identical maps and absolute paths.
  - On this repository, a map built at `2a4a4b7` and planned at the CLI commit selects 11 of 27 test files: 7 affected, with why-paths, and 4 new test files. The other 16 are unproven would-skips.
  - **On honojs/hono** (corpus, pnpm, no `sieve.config.json`), at `f6fbaf02`: `sieve graph` takes 0.44 s cold for 585 files, with 161 test files found by Vitest's default include and 45 uncertain files.
    - Planning `HEAD~6` → `HEAD~1` (13 changed nodes, `src/hono-base.ts` among them) selects 114 of 161: 87 through changed files, 26 through uncertain files and 1 new test file. The other 47 are unproven would-skips.
    - The 26 come mostly from adapters that import `hono` itself: its `exports` point at `dist/`, which is build output and not in git. The rest are `bun:test` (an unknown scheme) and one non-literal `import()`.
    - Planning `HEAD~10` → `HEAD` selects all 161: the release commit bumps the version in the root `package.json`, which every file depends on (its nearest `package.json`, and a global input).
    - hono's own Vitest config uses projects with extglob includes, so discovery without a `sieve.config.json` also counts adapter and runtime tests that hono runs elsewhere.

## 25. The walking skeleton in CI (day 10)

- **Context.** Day 10 puts the plan → matrix → shards → gate slice into CI on this repository, in shadow mode, with the map kept in `actions/cache` (roadmap §4 and §5, architecture §5.3 and §5.4, [HANDOFF.md](HANDOFF.md) §7). Until the runner plugin and `sieve run` arrive (M3), a shard needs some other way to run an exact file list. ADR-0004 rules out Vitest's positional filters, which match substrings.
- **Decision.**
  - **`.github/workflows/sieve.yml`** runs on pull requests, pushes to `main` and merge groups, alongside `ci.yml`, which still runs the whole suite on every OS and Node version. Its jobs:
    - **`plan`** restores the map, runs `sieve plan --mode shadow --static --map .sieve/map` from source, and writes `matrix`, `count` and the job summary.
    - **`test`** is a matrix of shards from the plan, skipped when `count` is 0. Each shard runs `npx vitest run` with its file list.
    - **`sieve-gate`** always runs (`if: always()`). It passes only if `plan` succeeded and every shard succeeded, or the shards were skipped because `count` was 0.
    - **`map`** runs only on pushes: `sieve graph --out .sieve/map/map.json`, then `actions/cache/save` under `sieve-map-<sha>`.
  - **Finding the map.** `plan` restores with key `sieve-map-<sha>` and `restore-keys: sieve-map-`, so a pull request gets the newest map saved on `main`. If no cache matches, the CLI's run-all fallback applies.
  - **Plan and map share one Node version** (`NODE_VERSION`, 26) and one runner image. The map records the runtime and platform as `e:` nodes that every test depends on, so a mismatch would mark every test affected.
  - **Exact file lists, until M3.**
    - The shard passes `SIEVE_TEST_FILES`, a JSON array of repository-relative POSIX paths, and `vitest.config.ts` makes it the `include` (`scripts/lib/test-files.ts`).
    - Each path is glob-escaped: what tinyglobby, Vitest's globber, escapes, plus `!`, `+` and `@` everywhere.
    - `exclude` is emptied, so nothing can drop a listed file.
    - A list that is invalid, or that names something that is not a file, fails the shard loudly. Uncertainty means run: a shard must never run fewer files than its plan.
  - **`sieve.config.json`.**
    - `sharding.max` is 3: the 29 test files split round-robin into 3 shards.
    - One `inputs.declared` rule: `packages/cli/src/**` affects `packages/cli/test/cli.test.ts`. That test runs the CLI as a child process, by path, which the static graph cannot see. Core changes reach the CLI sources through their imports, so one rule covers both packages.
  - **Global inputs avoid `new URL(…, import.meta.url)`.** The resolver reads it as an import it cannot resolve (§11 of the hand-off). In `vitest.config.ts`, which every test depends on, that would mark every test affected on every change. Both new files use `import.meta.dirname` instead.
  - **Not yet:**
    - `sieve-gate` is not a required check. That is a branch-protection setting for Ojas to decide ([HANDOFF.md](HANDOFF.md) §10).
    - The gate is a shell step until `sieve gate` exists.
    - Shards are round-robin, not duration-balanced; LPT planning (§3.8) needs recorded durations.
- **Evidence.**
  - **Discovery matches Vitest.** With no `projects` in the config, `sieve plan` finds the same 29 files as `vitest list` under `vitest.config.ts`.
  - **Run-all fallback.** With no map, `sieve plan` exits 0, writes `count=29` and 3 shards, and the summary says it could not use a map.
  - **A past fix, re-planned.** A map built at the parent of `4742257` (a fix in `packages/core/src/git/git.ts`), planned at `4742257`, selects 9 of 27 test files, with why-paths. One of the 18 would-skips was `cli.test.ts`, which drives `git.ts` through the CLI, hence the declared rule.
  - **A probe on this branch.** A throwaway commit adds one line to `git.ts` on top of this branch, made with `git commit-tree` so no branch moves. Planned against this branch's map, it selects 10 of 29, `cli.test.ts` among them, through `g:declared:packages/cli/src/**`.
    - Before the switch to `import.meta.dirname`, the same probe selected all 29, through the uncertain `vitest.config.ts`.
    - After it, the map has 18 uncertain files, all of them lexer fixtures that are data.
  - **The file-list mechanism.** `scripts/test/test-files.test.ts` covers parsing, escaping, and two end-to-end `vitest list` runs:
    - one through this repository's `vitest.config.ts`;
    - one over names such as `a[1]`, `b(x)`, `!f`, `g+(h)` and `i@(j)`, plus `l*`, `m?` and `n|o` off Windows, each with an unlisted twin that the unescaped name would match as a glob.

    Mutants that skip escaping, or escape only brackets, fail both end-to-end runs. A config that ignores the list fails the first.

## 26. A directory named by `new URL(…, import.meta.url)` is a dependency

- **Context.** The lexer records `new URL(spec, import.meta.url)` as a `url` record, so assets next to a module are dependencies. When `spec` named a directory (`'.'`, `'..'`, `'./fixtures/'`), the resolver found no file and reported it as unresolved ("not found"), which made the file uncertain: every test reaching it always ran.
  - Day 10 hit this in `vitest.config.ts`, a global input, where it would have selected every test on every change (entry 25).
  - On honojs/hono it made test files uncertain whose only problem was a fixtures directory.
  - The same pattern written as `import.meta.dirname` was invisible altogether, so the stricter treatment fell only on one spelling.
- **Decision.**
  - **A directory URL** depends on every file below it, since the code may read any of them. The resolution's targets are those files, recorded as a glob over `<dir>/**` (`g:glob:<dir>/**`), so a file appearing there changes the glob's hash. `'..'` up to the repository root gives `**`, every file.
  - **Directory names are glob-escaped.** The dialect has no escape character, so `escapeGlob` writes `*`, `?` and `[` as one-character classes, `{` as a one-option brace, and a leading `!` as a class.
  - **A missing target** is recorded as a directory that may yet appear (a `d:` node), as for imports.
  - **Symlinks and submodules below the directory.** A symlink to a file is followed, and both count. A symlink to a directory or out of the repository, or a submodule, leaves the URL unresolved: what the code could read below it cannot be listed.
  - **Selection (L1).** An added file that a glob of the map matches no longer escalates its package. It shows in Δ as that glob's changed hash, which selects exactly its dependents, like a new module's probes. This covers directory URLs, `import.meta.glob`, `inputs.global` and declared inputs. A new file no glob matches still escalates.
  - **The engine stays `sieve-static-1`.** The planner never re-resolves at H: it trusts the map's edges and only recomputes node hashes, whose definitions did not change.
    - An old map read by the new planner selects what the old engine would have.
    - A new map read by an old planner uses the same glob dialect, and escalates more, not less.
    - So `ENGINE` changes when hash definitions or the reading of a map change, not when the builder becomes more precise.
  - **Code that walks out of the directory** (`new URL('.', import.meta.url)` and then `../src`) reads files this does not record. Like any `fs` read, that is why every would-skip stays unproven until records exist (M2/M3).
- **Evidence.**
  - **Resolver examples:** a file, a directory with or without a trailing slash, `'.'`, the root, `app/[slug]`, a symlink to a file, symlinks to a directory and out of the repository, a missing path and a path outside the repository.
  - **Evidence-completeness property.** It now also runs over `url` records, with directory specifiers added. It caught a mutant that dropped the "may yet become a directory" record: an absent target that became a directory changed the result unseen.
  - **`escapeGlob` properties:** 2,000 pairs of paths built from glob characters. The escaped glob matches exactly its path, and with `/**` exactly the path and what is below it, never as an exclude.
  - **Selection examples:** the importer is not uncertain; a file changing below the directory selects it with a why-path; a file appearing selects it with no escalation; a new file outside any glob still escalates; the directory appearing selects it through `d:`.
  - **7 hand mutants were all caught:** no escaping; no "may yet become a directory"; no glob; symlinks not checked; files not targets; the L1 exemption dropped; every added file exempt.
  - **On hono** at `f6fbaf02`, uncertain files fall from 45 to 44. Nodes rise from 3,288 to 3,377 and edges from 13,543 to 14,453.
    - `adapters/deno/test/serve-static.test.ts` now depends on `adapters/deno/test/**`.
    - `build/declaration-emit.test.ts` depends on its fixtures directory, and on `**` through `new URL('..', import.meta.url)`, which names the repository root.
  - **On this repository**, `vitest.config.ts` keeps `import.meta.dirname`. A root-directory URL in a global input would now be a dependency on every file, which still selects every test on any change.
