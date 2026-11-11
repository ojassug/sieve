# ADR-0005: Safety criterion — closure content equality against a trusted passing record

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §3.3, §3.5, §3.9, §3.10

## Context
- **Commit-keyed maps break.** Test-to-code maps keyed by commit history fail in `--depth 1` CI clones (research report A3).
- **Datadog TIA** skips a test when its covered files and the user's tracked files match a passing run, and any tracked-file change runs everything ([how it works](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/)).
- **Ekstazi**, which uses dynamic file dependencies, cut end-to-end testing time by 32% on average and 54% on longer suites ([ISSTA'15 abstract](https://users.ece.utexas.edu/~gligoric/papers/abstracts/GligoricETAL15Ekstazi.txt)).
- **Facebook's predictive test selection** reports over 95% of individual failures and over 99.9% of faulty changes caught at half the infrastructure cost ([arXiv 1810.05286](https://arxiv.org/abs/1810.05286)). Good economics, but no per-skip guarantee and no per-skip explanation.

## Decision
A test t may be skipped at head snapshot H only if all four hold:
1. A trusted passing record R of t exists whose closure C(t) (the static closure ∪ R's dynamic dependencies ∪ declared dependencies) has the same content hashes at base snapshot S as in R.
2. The environment fingerprint matches.
3. C(t) ∩ Δ(S, H) = ∅.
4. t is not in the audit sample.

Every skip emits a signed proof object that `sieve verify` can check. Uncertainty escalates through levels L0–L3, and uncertainty always means the test runs. Safe mode never uses predicted probabilities.

## Alternatives considered
- **Diff against the merge-base commit:** rejected. Needs history in CI, is unsound when the base is wrong, and breaks with merge commits and rebases.
- **Coverage-only with "tracked files run all":** rejected. Blind to file-system inputs and coarse on non-code inputs.
- **Predictive or ML selection:** rejected for skip decisions. Kept as an ordering and budget signal only.

## Consequences
- Soundness is independent of which base is chosen; the base affects only precision.
- Records are reusable across commits whenever closure contents match. That is how maps stay fresh without running the full suite on every push.
- Correctness now depends on capture completeness. That requires the union graph, absent and listing nodes, shadow mode, audit sampling, nightly runs and the seeded-fault gate.
