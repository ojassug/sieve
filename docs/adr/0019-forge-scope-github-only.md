# ADR-0019: Forge scope — GitHub only in v1

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur (decided in the planning session)

## Context
A 6-month solo plan needs focus, and the dogfood repositories are on GitHub.

## Decision
- GitHub (App + Action) is the only native integration in v1.
- Any other CI can use the generic CLI with an API token, for selection, uploads and job-level summaries. It gets no native commit statuses or comments.
- Forge-specific code sits behind a `ForgeAdapter` interface, so GitLab CI and Forgejo/Gitea adapters can be added after launch.

## Alternatives considered
- **GitLab native integration in v1:** rejected. Scope.
- **Forgejo/Gitea native integration in v1:** rejected. Scope.

## Consequences
- Product claims stay at "native on GitHub, any CI through the CLI".
- The adapter seam is exercised with a fake forge in tests from M6.
