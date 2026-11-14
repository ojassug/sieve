# ADR-0012: CI authentication and trust lanes

- Status: Accepted (2026-11-11); corrected in place on 2026-11-13 after the [foundation review](../research/2026-11-foundation-review.md), finding H2
- Deciders: Ojas Sugur
- Related: [threat-model.md](../threat-model.md) §1.2 and §1.3

## Context
Uploads and selection requests come from CI runners.
- GitHub Actions OIDC tokens carry claims such as `repository_id`, `repository_owner_id`, `ref`, `event_name` and `job_workflow_ref` ([OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect)).
- Pull requests from forks get a read-only `GITHUB_TOKEN` and no secrets ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). Secondary sources say OIDC tokens are also withheld from fork runs.
- A workflow started by `workflow_run` can use secrets and write tokens even when the run that triggered it could not (same page).

## Decision
- **Authentication.** CI authenticates with GitHub OIDC JWTs whose audience is bound to the Trommel server and whose claims must match `oidc_trust` rules. The alternative is repo-scoped API tokens stored as hashes.
- **Lanes.** Every run is classified from its verified claims (`event_name`, `ref`, `job_workflow_ref`), never from what the client reports:
  - **evidence:** runs of reviewed code, which are pushes and schedules on the default branch, `workflow_dispatch` on the default branch, and `merge_group`;
  - **pull request:** any pull-request run that can authenticate, whoever its author is;
  - **untrusted:** fork pull requests and unknown actors, which cannot authenticate.
- **Only evidence-lane runs change shared state:** records, static graph segments, the extraction cache and flake state. [ADR-0014](0014-flake-decisions-sprt.md) says when a pull-request observation may also count.
- **A pull-request run is evidence for its own pull request only.** Its records may skip tests on later pushes to that pull request, and nowhere else.
- **Fork PRs:**
  - results are uploaded as artifacts, and the App pulls them on `workflow_run` into the untrusted lane;
  - public repos may opt in to anonymous, read-only, rate-limited planning for forks.

## Alternatives considered
- **Long-lived secrets in CI:** rejected. Leak risk, and they aren't available to forks anyway.
- **`pull_request_target` workflows that check out fork code with secrets:** rejected. The classic code-execution risk.
- **Accept fork uploads directly:** rejected. Map and ledger poisoning: a fork could fabricate passes to force future skips, or flips to get a test quarantined.
- **Trust same-repository pull requests by author association:** rejected. The code and the workflow that produce such a record are the pull request's own and unreviewed. A narrowed test command or a broken recorder would become evidence for everyone.

## Consequences
- Forks get correct results that are never shared beyond their PR.
- Proof objects name the lane of the record they rely on.
