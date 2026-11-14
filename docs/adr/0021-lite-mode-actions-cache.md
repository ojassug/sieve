# ADR-0021: Lite mode via `actions/cache`

- Status: Accepted (2026-11-11); corrected in place on 2026-11-13 after the [foundation review](../research/2026-11-foundation-review.md), finding M5
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §5.4, [roadmap.md](../roadmap.md) M3

## Context
The selection engine ships before the server (selection-first sequencing, M1–M4). Teams with small repos may never want a server.

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

## Alternatives considered
- **Store maps in git refs (`refs/trommel/*`):** not chosen for v1. Needs write access and adds refs to the repository, but works on any forge, so it stays a possible later option.
- **The Actions artifacts API:** rejected. Downloading across runs needs API calls and tokens.

## Consequences
- Usable selection by M3 with zero infrastructure.
- A repository that needs more than scope-based trust verifies a signed attestation of the map before it enforces, or uses the server.
