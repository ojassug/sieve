# ADR-0018: License — Apache-2.0

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur (decided in the planning session)

## Context
Self-hosting in regulated organizations is Trommel's wedge, and their legal teams often block copyleft licenses. A hosted beta comes later.

## Decision
- Apache-2.0 for every package: CLI, runner plugins, server and UI.
- Contributions use the Developer Certificate of Origin (signed-off commits), not a CLA.
- If a hosted business follows, the final product name gets a trademark. The license itself does not restrict competing hosted offerings.

## Alternatives considered
- **AGPL-3.0 server + Apache CLI:** stops closed SaaS forks, but some companies ban AGPL even for internal use.
- **Functional Source License for the server:** fair source that converts to Apache after two years, but not OSI-approved.
- **MPL-2.0:** file-level copyleft.

## Consequences
- Maximum adoption.
- A future hosted business is protected by operational quality and the trademark, not by the license.
- The `LICENSE` file lands with the repository skeleton (roadmap day 1).
