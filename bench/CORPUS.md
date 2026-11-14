# Corpus selection

The corpus serves two purposes, with two repository sets.

1. **Collector set.** An archive of GitHub CI history: workflow runs with every attempt, jobs, check runs, artifact listings and mirrored test reports. GitHub deletes this history after 90 days, so collection started in week 1. Reruns of the same commit are the flake ground truth for T3, and job timings feed duration estimates.
2. **Replay set.** At least 8 repositories (at least 5 for the K1 kill gate). Each is re-executed at 200 or more historical commits in pinned containers ([TARGETS.md](TARGETS.md), [architecture.md](../docs/architecture.md) §7.3). The replay set is a subset of the collector set, so the CI history of every replay repository is archived too.

## Replay-set criteria

**Hard criteria.** A repository failing any of them is excluded.

| # | Criterion | How it is checked |
|---|---|---|
| R1 | TypeScript or JavaScript tests run by **Vitest or Jest** | The root `package.json` or a workspace manifest |
| R2 | The full suite runs **offline in under 10 minutes**: no network, no external services or databases, no GPU or display. A browser part counts only if it can be cleanly excluded | Timed run in the pinned container (pending, see below) |
| R3 | **At least 200 commits in the last 12 months** on the default branch | GitHub commits API with `since` |
| R4 | **Permissive license**: MIT, Apache-2.0, BSD-2/3-Clause or ISC | The GitHub license field, plus a manual read of the LICENSE file when the field is NOASSERTION or empty |
| R5 | A committed lockfile, so installs are reproducible | Root listing |

**Soft criteria** for balance across the set:
- a mix of Vitest and Jest;
- a mix of monorepos and single packages;
- a mix of lockfile kinds (npm, pnpm, yarn);
- at least one barrel-heavy codebase, for the §3.11 lever;
- repositories under 2 GB.

## First-pass vetting (2026-11-11)

These columns come from the GitHub API on 2026-11-11.
- "Commits" counts the last 12 months on the default branch.
- "Runner" comes from the root `package.json` only.
- "Runs, 2 days" counts all workflow runs created on 2026-11-09 and 2026-11-10. "Reruns" counts the runs among them with `run_attempt > 1`.
- R2 (offline under 10 minutes) is **not checked yet** for any repository.

| Repository | License | Commits | Lockfile | Runner | Runs, 2 days | Reruns | First-pass status |
|---|---|---|---|---|---|---|---|
| vuejs/core | MIT | 447 | pnpm | Vitest | 342 | 1 | candidate |
| colinhacks/zod | MIT | 590 | pnpm | Vitest | 17 | 0 | candidate |
| honojs/hono | MIT | 483 | pnpm | Vitest | 2 | 0 | candidate |
| vitejs/vite | MIT | 1239 | pnpm | Vitest | 769 | 3 | candidate (unit suite only; the playground needs browsers) |
| TanStack/query | MIT | 1860 | pnpm | Vitest | 41 | 0 | candidate |
| trpc/trpc | MIT | 494 | pnpm | Vitest | 779 | 0 | candidate |
| toss/es-toolkit | MIT | 523 | yarn | Vitest | 14 | 0 | candidate |
| sveltejs/svelte | MIT | 774 | pnpm | Vitest | 121 | 0 | candidate |
| unjs/h3 | MIT | 437 | pnpm | Vitest | 57 | 4 | candidate |
| typescript-eslint/typescript-eslint | MIT | 722 | pnpm | Vitest | 590 | 0 | candidate |
| facebook/lexical | MIT | 1035 | pnpm | Vitest | 481 | 2 | candidate (unit suite; e2e uses Playwright) |
| excalidraw/excalidraw | MIT | 284 | yarn | Vitest (and Jest) | 56 | 0 | candidate |
| vueuse/vueuse | MIT | 219 | pnpm | Vitest | 52 | 10 | candidate |
| prettier/prettier | MIT | 1524 | yarn | Jest | 641 | 20 | candidate |
| babel/babel | MIT | 573 | yarn | Jest | 380 | 1 | candidate |
| facebook/docusaurus | MIT | 642 | pnpm | Vitest | 264 | 0 | reserve (1.6 GB repository) |
| vitest-dev/vitest | MIT | 1300 | pnpm | Vitest | 316 | 1 | reserve (much of the suite needs browsers) |
| apollographql/apollo-client | MIT | 402 | npm | Jest | 127 | 16 | reserve (tests run outside GitHub Actions, so no CI history) |
| date-fns/date-fns | none detected | 321 | pnpm | Vitest | 25 | 0 | needs a license read |
| maplibre/maplibre-gl-js | NOASSERTION | 1547 | npm | Vitest | 357 | 0 | excluded: R4 unclear, 1 GB |
| mswjs/msw | MIT | 120 | pnpm | Vitest | 15 | 0 | excluded: R3 |
| pmndrs/zustand | MIT | 122 | pnpm | Vitest | 3 | 0 | excluded: R3 |
| pmndrs/jotai | MIT | 130 | pnpm | Vitest | 67 | 1 | excluded: R3 |
| immerjs/immer | MIT | 146 | yarn | Vitest | 37 | 1 | excluded: R3 |
| reduxjs/redux-toolkit | MIT | 264 | pnpm | not at root | 20 | 0 | needs a workspace check |
| withastro/starlight | MIT | 663 | pnpm | not at root | 160 | 0 | needs a workspace check |

**What this implies.**
- Only 2 of the 26 repositories use an npm lockfile: 19 use pnpm and 5 use yarn.
- `core/lockfile/npm` (roadmap day 8) therefore covers almost none of the replay set. The pnpm and yarn parsers in M1's week 3 are a prerequisite for M4, not a nice-to-have.
- Jest is thin among active, permissive repositories: prettier, babel, and Jest itself. So the Vitest/Jest balance will lean towards Vitest.

**Still to do before the corpus is frozen in M4:**
- time each candidate's suite offline in the pinned container (R2);
- read the licenses of date-fns, maplibre and every NOASSERTION repository;
- pin the Node version for each repository;
- measure each suite's flake rate over 3 reruns at the same commit.

## Collector set

The list lives in [`tools/corpus/repos.json`](../tools/corpus/repos.json). For each repository it names the workflows to collect and whether to mirror test-report artifacts.
- **Tier 1**, collected first: the 15 replay candidates above, plus the two JUnit sources from architecture §9 item 8 (baserow and Azure/azure-iot-sdk-python).
- **Tier 2:** the rest of the §9 item 8 list.

**What a survey of the §9 item 8 list found (2026-11-11).** That list came from a code search for `--reporter=junit` or `--junitxml` plus `upload-artifact`. Recent runs tell a different story:
- Only **baserow** (`ci.yml`: Jest frontend, pytest backend and Playwright shards, with reruns) and **Azure/azure-iot-sdk-python** (`test-results-python-3.x`) actually upload JUnit reports.
- electron/forge uploads build output, and luma.gl uploads coverage (lcov).
- mozilla-conduit/review and jborean93/ansibug had no runs in the sample.
- **PostHog** created at least 2,500 runs a day, mostly bots and housekeeping. The first collection run took only `ci-frontend.yml`, and still got 4,183 runs for 2026-11-04 alone: two-thirds of everything that run collected. PostHog has been dropped since (DECISIONS.md 21).

**Mirroring policy.**
- Test-report archives are mirrored only from repositories with a permissive license (R4).
- baserow, luma.gl and AutoGPT report NOASSERTION, and mariadb-connector-nodejs is LGPL-2.1. Until their licenses are reviewed, these contribute metadata only.
- Artifact names must match `junit|test[-_ ]?(results?|reports?)` and must not match `coverage|screenshot|video|trace`. Each artifact is capped at 100 MiB, and a collection run mirrors at most 1,500 MiB.

**How it runs.**
- One scheduled workflow a day, with a time budget of 320 minutes.
- **Oldest days first.** It works through the oldest uncollected days first, back to 89 days ago, because GitHub deletes the oldest days first. Then it re-collects the last 2 days for new attempts.
- **Shares.** Every repository may spend 1,000 requests before any repository gets more. Time left after that goes to whatever is still open, in plan order. One busy repository therefore cannot starve the others.
- Each manifest reports coverage of the window and the requests spent per repository, so lost days stay visible.

**First run (2026-11-11, before the shares).**
- The run spent 24,581 requests over 320 minutes and collected 6,208 runs, 6,258 attempts and 83,523 jobs, with no errors.
- It still covered only 1.7 of the 7 recent days it re-collected first, and none of the backfill.
- PostHog alone was two-thirds of the runs.
- Only 68 artifacts (0.2 MB, all meshery) matched the test-report pattern: the replay candidates upload no JUnit. Their value is the run, attempt and job history.

**Collection so far (to the 2026-11-13 manifest).** The shares and oldest-days-first order (DECISIONS.md 21) took effect with the third run, collector `3c92385`.
- Requests per run stay near 25,000: 24,581, 25,086, 26,079 and 23,978. Every run spent its 320-minute budget.
- Work items still pending fell from 2,270 and 2,197 under the old collector to 1,082 and then 703.
- After the fourth run, 11 of the 25 repositories have every day of the 87-day window (89 to 3 days ago). The slowest eight (AutoGPT, baserow, meshery, prettier, TanStack/query, lexical, luma.gl, vuejs/core) have 30 or 31 days, typescript-eslint 35, vite 36, trpc 49, svelte 50, zod 54 and babel 75.
- The fourth run added 8 to 16 days to each of the slowest eight. At that pace, by estimate, the backlog clears in four to eight more daily runs: faster than the 2–3 weeks estimated from the first run. Collection goes oldest day first, so what is still missing is mostly the recent end of the window, the furthest from expiring.

**Where the data lives.** It goes in a separate public repository, [trommelci/trommel-corpus](https://github.com/trommelci/trommel-corpus), created on 2026-11-11. Its template is in [`tools/corpus/corpus-repo/`](../tools/corpus/corpus-repo/README.md).
- Daily manifests and the collector state are committed to git.
- Raw NDJSON and artifact archives are uploaded as release assets. Releases have no retention limit, and keeping the data out of git keeps the repository small.
- The workflow writes with its own `GITHUB_TOKEN`, so no secret is needed (DECISIONS.md entry 9).
