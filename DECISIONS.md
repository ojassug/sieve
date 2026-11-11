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
