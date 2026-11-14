# Contributing to Trommel

Trommel is pre-release. The architecture is in [docs/architecture.md](docs/architecture.md), the plan in [docs/roadmap.md](docs/roadmap.md), and the decisions in [docs/adr/](docs/adr/README.md) and [DECISIONS.md](DECISIONS.md).

## Setup

- **Node.js 22.18 or newer** for development. The CLI itself supports Node 22 and later; repository scripts run TypeScript directly through Node's type stripping, which needs 22.18+. CI tests Node 22, 24 and 26 on Ubuntu, plus Node 22 on Windows.
- `npm ci` installs the development tools. Core, the CLI and the runner plugins have no runtime dependencies.

| Command | What it does |
|---|---|
| `npm test` | Unit and property tests (Vitest, fast-check) |
| `npm run lint` | ESLint with type-aware typescript-eslint rules |
| `npm run typecheck` | `tsc` in strict mode, no emit |
| `npm run check:deps` | Fails if core, the CLI or a runner plugin gains a runtime dependency |

## Ground rules

- **Zero runtime dependencies** in `packages/core`, `packages/cli`, `packages/vitest` and `packages/jest` ([ADR-0002](docs/adr/0002-zero-dependency-cli.md)). devDependencies are fine. CI enforces this.
- **Uncertainty means run.** Anything Trommel cannot resolve becomes an explicit node (`u:`, absent) or an escalation. Nothing is dropped silently.
- **Same input, same bytes out.** Outputs are canonical JSON with sorted keys and explicit tie-breaks, and never contain timestamps or random values.
- **Paths** inside Trommel are POSIX-style, repo-relative and case-sensitive, on every OS.
- **Tests first** for core algorithms. Property tests are seeded and deterministic; set `TROMMEL_FC_SEED` to explore other cases. Timing runs separately from correctness tests, and benchmark numbers are recorded under [bench/](bench/).

## Workflow

- Work on short-lived branches and open a pull request into `main`. Never force-push `main`.
- Write small [conventional commits](https://www.conventionalcommits.org/): `feat`, `fix`, `test`, `docs`, `chore`, `ci`.
- Record non-obvious decisions in [DECISIONS.md](DECISIONS.md) as numbered entries with context, decision and evidence. A changed architecture decision gets a new ADR in [docs/adr/](docs/adr/README.md).
- When code forces a documentation change, update the document in the same pull request.

## Developer Certificate of Origin

Every commit must be signed off. `git commit -s` adds a line like:

```
Signed-off-by: Your Name <you@example.com>
```

The e-mail must match the commit author's. CI checks every commit in a pull request. By signing off, you certify the Developer Certificate of Origin 1.1 ([developercertificate.org](https://developercertificate.org/)):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## License

Trommel is licensed under [Apache-2.0](LICENSE). Contributions are accepted under the same license.
