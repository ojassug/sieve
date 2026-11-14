# trommel-corpus

A daily archive of GitHub Actions history for the [Trommel](https://github.com/trommelci/trommel) replay corpus and flake ground truth. GitHub keeps workflow runs, check runs and artifacts of public repositories for at most 90 days. This repository keeps them for longer.

- **Collector:** [`tools/corpus`](https://github.com/trommelci/trommel/tree/main/tools/corpus) in trommelci/trommel. The repositories and their workflows are listed in its `repos.json`.
- **How a run starts:** the workflow here only sets the schedule. It calls [`corpus-collect.yml`](https://github.com/trommelci/trommel/blob/main/.github/workflows/corpus-collect.yml) in trommelci/trommel, pinned to `main`, and that workflow collects with the collector from its own commit. Each manifest records the commit its run used, so runs stay reproducible without this repository pinning a version. Nothing here needs a push to change how collection works.
- **Selection criteria:** [`bench/CORPUS.md`](https://github.com/trommelci/trommel/blob/main/bench/CORPUS.md).
- **Schedule:** daily at 03:17 UTC, plus manual runs.

## Layout

| Where | What |
|---|---|
| `manifests/YYYY/YYYY-MM-DD-N.json` | One manifest per collection run (N is the run number). For each repository and day it records what was collected, the request count, how much of the 90-day window is covered, and the SHA-256 of every file |
| `state/collector-state.json` | Completed days, and the attempt at which each recent run was last seen |
| Release `corpus-YYYY-MM-DD-N` | `raw-….tar.gz` holds raw GitHub API objects as canonical NDJSON: runs per attempt, jobs per attempt, check runs and artifact listings. Each `artifacts-…-<owner>__<repo>.tar` holds mirrored test-report archives. `SHA256SUMS-…` lists the hash of every asset. `manifest-….json` and `state-….json` are copies of the two files above, so a run stays recoverable even if its commit never lands |

Records can repeat across runs when a collection was interrupted, so deduplicate by `(kind, id)`, and for runs by `(id, run_attempt)`.

## Data and licensing

Everything here comes from public repositories through the public GitHub API. Test-report archives are mirrored only for repositories marked `mirror` in `repos.json`, which are those under a permissive license. Every other repository contributes metadata only. To have a repository removed, open an issue.
