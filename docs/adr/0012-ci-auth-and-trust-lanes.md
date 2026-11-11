# ADR-0012: CI authentication and trust lanes

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [threat-model.md](../threat-model.md) §1.2 and §1.3

## Context
Uploads and selection requests come from CI runners.
- GitHub Actions OIDC tokens carry claims such as `repository_id`, `repository_owner_id`, `ref`, `event_name` and `job_workflow_ref` ([OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect)).
- Pull requests from forks get a read-only `GITHUB_TOKEN` and no secrets ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). Secondary sources say OIDC tokens are also withheld from fork runs.
- A workflow started by `workflow_run` can use secrets and write tokens even when the run that triggered it could not (same page).

## Decision
- **Authentication.** CI authenticates with GitHub OIDC JWTs whose audience is bound to the SIEVE server and whose claims must match `oidc_trust` rules. The alternative is repo-scoped API tokens stored as hashes.
- **Lanes.** Every run is classified into one:
  - **trusted:** default-branch pushes and schedules, `merge_group`, `workflow_dispatch` by writers, and same-repo PRs whose `author_association` is OWNER, MEMBER or COLLABORATOR;
  - **untrusted:** forks, first-time contributors, unknown actors.
- **Only trusted records** become skip evidence or flake observations for anyone other than their own PR.
- **Fork PRs:**
  - results are uploaded as artifacts, and the App pulls them on `workflow_run` into the untrusted lane;
  - public repos may opt in to anonymous, read-only, rate-limited planning for forks.

## Alternatives considered
- **Long-lived secrets in CI:** rejected. Leak risk, and they aren't available to forks anyway.
- **`pull_request_target` workflows that check out fork code with secrets:** rejected. The classic code-execution risk.
- **Accept fork uploads directly:** rejected. Map and ledger poisoning: a fork could fabricate passes to force future skips, or flips to get a test quarantined.

## Consequences
- Forks get correct results that are never shared beyond their PR.
- Proof objects name the lane of the record they rely on.
