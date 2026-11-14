# SIEVE (codename)

SIEVE is a self-hostable test-intelligence service for CI. On every run it:
- decides which tests a change can affect and which it provably cannot;
- separates flaky tests from real failures and quarantines flaky ones with bounded error rates;
- reports minutes saved together with the measured escape rate.

Every skip carries a machine-checkable proof, and uncertainty always means the test runs.

**Status:** implementation of milestone M1 started on 2026-11-11. Roadmap days 1–10 are merged, the walking skeleton in CI included; the rest of M1 (weeks 2–3) is under way.
- `packages/core` has the snapshot diff, import lexer, module resolver, impact graph, npm lockfile reader, static graph builder and static selection.
- `packages/cli` runs from source: `node packages/cli/src/main.ts graph`, `diff` and `plan --mode shadow --static`. Without test records no skip is proven safe, so plans run every test and report the would-skips as unproven static reachability.
- `.github/workflows/sieve.yml` runs SIEVE on its own pull requests: plan, test shards and a gate, in shadow mode, with the map cached from `main`.
- `tools/corpus` archives CI history into [ojassug/sieve-corpus](https://github.com/ojassug/sieve-corpus).
- A [foundation review](docs/research/2026-11-foundation-review.md) on 2026-11-13 led to seven ADRs being corrected in place. The documents now describe several things the code does not do yet; [HANDOFF.md](HANDOFF.md) §1.1 lists them in the order to build them. The first two are built: the static map holds no environment, and unmapped inputs escalate along the graph.

To continue the work, start with [HANDOFF.md](HANDOFF.md).

## Documents

| Document | What it holds |
|---|---|
| [HANDOFF.md](HANDOFF.md) | Where implementation stands, what is next, and how to continue |
| [DECISIONS.md](DECISIONS.md) | Numbered implementation decisions with evidence, and session hand-overs |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, ground rules, workflow and the Developer Certificate of Origin |
| [docs/architecture.md](docs/architecture.md) | Product definition, architecture diagrams, algorithm specs, data model, interfaces, verification strategy, risks, research spike results |
| [docs/threat-model.md](docs/threat-model.md) | Security model (tenancy, auth, trust lanes, privacy) and the adversarial review |
| [docs/roadmap.md](docs/roadmap.md) | 10 milestones (about 640 commits over 26 weeks), the first two weeks in detail, walking skeleton, cut list, pivot plan |
| [docs/adr/](docs/adr/README.md) | 21 architecture decision records, seven of them corrected in place on 2026-11-13 |
| [docs/research/2026-11-foundation-review.md](docs/research/2026-11-foundation-review.md) | The 2026-11-13 review of the design and the M1 code: findings with evidence, the ADR corrections, and the recommendations still open |
| [bench/TARGETS.md](bench/TARGETS.md) | Pre-registered benchmark targets and the kill criterion |
| [bench/CORPUS.md](bench/CORPUS.md) · [bench/README.md](bench/README.md) | Corpus selection criteria and vetting · recorded benchmark numbers |
| [docs/research/RESEARCH_REPORT.md](docs/research/RESEARCH_REPORT.md) | The 2026-11-04 study that chose SIEVE (unmodified copy) |

## Naming

"SIEVE" is a placeholder. The npm name `sieve` is taken. "SIEVE" is also an NSDI'24 cache-eviction algorithm and the RFC 5228 mail-filtering language. The final name is decided by milestone M9.

## License

Apache-2.0 ([ADR-0018](docs/adr/0018-license-apache-2.md)); see [LICENSE](LICENSE). Contributions are signed off under the Developer Certificate of Origin ([CONTRIBUTING.md](CONTRIBUTING.md)).
