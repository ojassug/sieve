# ADR-0014: Flake decisions — SPRT episodes, decayed Beta estimates, hysteresis state machine

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §2.5 and §3.6

## Context
Flaky failures drive rerun culture (research report A1). Quarantine decisions need bounded error rates and must be explainable, and estimates must adapt as tests get fixed. FlaPy estimates that about 170 reruns are needed for 95% confidence that a passing test is not flaky ([arXiv 2101.09077](https://arxiv.org/abs/2101.09077)).

## Decision
- **Identical-input classes:**
  - v1: (test case, tree OID, environment);
  - v2: (test case, closure fingerprint, environment).
- **Observations** come only from trusted lanes, and only from classes containing at least one pass. Failures in all-fail classes stay pending until a pass shows up.
- **Detection:** a fresh Wald SPRT per Suspect episode.
  - p₀ = 0.002, p₁ = 0.02, α = 0.01, β = 0.05.
  - Thresholds A ≈ 4.55 and B ≈ −2.99.
  - Increments: a flaky failure adds +2.303, a pass adds −0.0182.
- **Release:** a separate SPRT during Probation with α′ = 0.01 and β′ = 0.10, which takes about 247 clean observations.
- **Estimation:** a Beta(0.5, 50) prior with exponential decay at a 14-day half-life.
- **State machine:** Active → Suspect → Quarantined → Probation → Active. Manual overrides are audited.
- **Quarantine means the test still runs, but its failures don't fail the build.** `sieve run` computes the exit code. Strict mode, which skips quarantined tests, is optional.

## Alternatives considered
- **Fixed thresholds ("k failures in n runs"):** rejected. No error guarantees.
- **Retries only:** rejected. Hides real regressions.
- **Skipping quarantined tests by default:** rejected. Evidence stops arriving, so tests are never released.
- **ML classifiers such as FlakeFlagger:** rejected as the decision rule. They need feature extraction and are less explainable; they may be useful later as a prior.

## Consequences
- Parameters are validated by simulation (P9) and against rerun ground truth (target T3, precision ≥ 0.9).
- The UI shows the log-likelihood-ratio trace against both thresholds.
- Capture divergences seen through v2 classes are reported as incidents, not quarantines.
