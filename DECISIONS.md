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
