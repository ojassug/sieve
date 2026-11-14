# ADR-0020: Merge gate after launch; `merge_group` support in v1

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur (decided in the planning session)
- Related: [architecture.md](../architecture.md) §2.7, [roadmap.md](../roadmap.md) §3

## Context
- GitHub's native merge queue requires workflows to trigger on `merge_group` ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- The queue is available for public repositories owned by organizations and for private repositories on GitHub Enterprise Cloud (GitHub docs, found via search).
- Uber's SubmitQueue (EuroSys 2019) is the prior art for speculative batching ([Uber](https://www.uber.com/blog/research/keeping-master-green-at-scale)).

## Decision
v1 does not implement its own merge queue. It makes GitHub's queue faster and tolerant of flaky tests:
- `merge_group` runs use selection over the combined queued change;
- quarantined failures don't evict PRs;
- Suspect-state failures get one bounded retry;
- budget-mode deferred tests run there.

Trommel's own queue (speculative batches, binary-search bisection, flake posteriors) is the first post-launch milestone that touches merging (M12), aimed at forges without a native queue.

## Alternatives considered
- **Own queue inside the 10 milestones:** rejected. Needs write access to repositories, and competes with the GitHub, Trunk and Mergify queues.
- **A batch-bisection simulator before launch:** rejected for now.

## Consequences
- Dogfooding the merge queue needs a public repository owned by a GitHub organization.
- About 70 commits go to selection safety and the UI instead.
