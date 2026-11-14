# ADR-0005: Safety criterion — closure content equality against a trusted passing record

- Status: Accepted (2026-11-11); corrected in place on 2026-11-13 after the [foundation review](../research/2026-11-foundation-review.md), findings C1, C3, H1 and H4
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §3.3, §3.5, §3.9, §3.10

## Context
- **Commit-keyed maps break.** Test-to-code maps keyed by commit history fail in `--depth 1` CI clones (research report A3).
- **Datadog TIA** skips a test when its covered files and the user's tracked files match a passing run, and any tracked-file change runs everything ([how it works](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/)).
- **Ekstazi**, which uses dynamic file dependencies, cut end-to-end testing time by 32% on average and 54% on longer suites ([ISSTA'15 abstract](https://users.ece.utexas.edu/~gligoric/papers/abstracts/GligoricETAL15Ekstazi.txt)).
- **Facebook's predictive test selection** reports over 95% of individual failures and over 99.9% of faulty changes caught at half the infrastructure cost ([arXiv 1810.05286](https://arxiv.org/abs/1810.05286)). Good economics, but no per-skip guarantee and no per-skip explanation.

## Decision
**Records.** A record R is one passing execution of test file t. [ADR-0012](0012-ci-auth-and-trust-lanes.md) says which runs make records that others may rely on. A record is self-contained. It stores:
- its closure C_R(t) as (node, hash) pairs: every node reachable from t in the union graph of the snapshot it ran on. That graph has all static and declared edges of the snapshot plus the dynamic edges this execution recorded, and static edges are followed from modules found at run time too;
- the closure digest: SHA-256 over the canonical JSON of `["trommel-closure-1", [[node, hash], …]]`, with ⊥ as `null`;
- its environment components, measured in the process that ran the test;
- the versions of the static engine and of the recorder, and the time of the run;
- completeness flags: anything the recorder saw and could not map, such as a subprocess it could not attach to, an untracked file with no `generated` rule, or a script with no node.

**Capture scope.** Dynamic evidence has three scopes: one test file, one worker, one run. What is read or loaded outside a test file's own window (runner start-up, transform and plugin configuration, global setup, worker bootstrap) belongs to every test in that scope. At record time the runner reports its effective configuration: every file and package it names, not only its aliases.

**Safe skip.** Test t may be skipped at head snapshot H only if a record R of t exists and all of these hold:
1. every (node, hash) pair of C_R(t) has the same hash at H;
2. R's environment components equal those of the job that would run t, checked in that job;
3. R was made by the planner's static engine and recorder versions, has no completeness flag, and is younger than the configured horizon;
4. no escalation below applies to t;
5. t is not in the audit sample.

The planner computes conditions 1 and 4 from a base map M_S and Δ(S, H) by reverse search ([architecture.md](../architecture.md) §3.3). That is one way to compute this definition, not a second definition: S never appears in a proof.

**Escalations that override a record.**
- Every uncertain node (`u:`) counts as changed at every H, unless R carries resolution evidence for that importer.
- A changed file that is not a node, and a changed node that no test reaches, are unmapped inputs. Every node of the owning package then counts as changed.
- Lockfile, config and map problems run everything ([architecture.md](../architecture.md) §3.5).

Every skip emits a proof that `trommel verify` can recheck from R and a checkout of H. A server signs its proofs. In Lite mode proofs are unsigned and no more trustworthy than the map they came from ([ADR-0021](0021-lite-mode-actions-cache.md)). Safe mode never uses predicted probabilities.

**What the guarantee covers.** Under determinism (A1) and capture completeness (A2), a safe skip has the outcome of R. Time, randomness, the network, external services and state shared between test files are outside A1. They are documented, bounded by the record horizon and the nightly full run, and surfaced by the flake ledger.

## Alternatives considered
- **Diff against the merge-base commit:** rejected. Needs history in CI, is unsound when the base is wrong, and breaks with merge commits and rebases.
- **Coverage-only with "tracked files run all":** rejected. Blind to file-system inputs and coarse on non-code inputs.
- **Predictive or ML selection:** rejected for skip decisions. Kept as an ordering and budget signal only.

## Consequences
- Soundness does not depend on which base is chosen; the base affects only precision.
- A record is evidence only for the environment it ran in. Outside its own pull request, it is evidence only if it ran reviewed code.
- Records are reusable across commits whenever closure contents match. That is how maps stay fresh without running the full suite on every push.
- An engine or recorder upgrade invalidates the records made before it. A full recorded run follows each upgrade.
- Correctness depends on capture completeness. That requires the union graph, absent and listing nodes, the three capture scopes, the runner's reported configuration, shadow mode, audit sampling, nightly runs and the seeded-fault gate.
