# ADR-0013: GitHub integration pattern

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §5.3

## Context
- GitHub Actions has no native way to end a job early with a chosen conclusion (`actions/runner#662`, open since 2020 per the research report).
- A job skipped by an `if:` condition reports Success and does not block required checks ([conditions](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution)).
- A matrix can generate at most 256 jobs ([limits](https://docs.github.com/en/actions/reference/limits)).
- Merge-queue checks require the `merge_group` trigger ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- Only GitHub Apps can create check runs; a request carries at most 50 annotations, and a summary at most 65,535 characters ([check runs](https://docs.github.com/en/rest/checks/runs)).
- Secondary rate limits allow 80 content-creating requests per minute and 500 per hour ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).

## Decision
- **Workflow shape:**
  - a `plan` job (SIEVE CLI) that outputs `matrix` and `count`;
  - a `test` matrix job with `if: count != '0'` and `fromJSON(matrix)`;
  - a `sieve-gate` job with `if: always()`, which is the single required check.
- The CLI writes job summaries, which cost no API calls.
- The App owns one canonical "SIEVE" check run per head SHA, with at most 3 writes per run (create, final update, optional sticky comment), coalesced.
- Workflows trigger on `pull_request`, `push` and `merge_group`.
- A single-job mode (plan and run in one job) is offered for small repos.

## Alternatives considered
- **Early-exit hacks that cancel jobs or fake conclusions:** rejected. Fragile, and the UX is confusing.
- **The commit statuses API only:** rejected. Less rich, and no annotations.
- **One check run per shard:** rejected. Rate-limit pressure.

## Consequences
- Users restructure their test workflow once; `sieve init` generates it.
- Plans that select zero tests finish cleanly.
- API usage per run is bounded.
