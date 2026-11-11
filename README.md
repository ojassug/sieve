# SIEVE (codename)

SIEVE is a self-hostable test-intelligence service for CI. On every run it:
- decides which tests a change can affect and which it provably cannot;
- separates flaky tests from real failures and quarantines flaky ones with bounded error rates;
- reports minutes saved together with the measured escape rate.

Every skip carries a machine-checkable proof, and uncertainty always means the test runs.

**Status:** architecture approved on 2026-11-11. Implementation starts 2026-11-16. Nothing is runnable yet.

## Documents

| Document | What it holds |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Product definition, architecture diagrams, algorithm specs, data model, interfaces, verification strategy, risks, research spike results |
| [docs/threat-model.md](docs/threat-model.md) | Security model (tenancy, auth, trust lanes, privacy) and the adversarial review |
| [docs/roadmap.md](docs/roadmap.md) | 10 milestones (about 640 commits over 26 weeks), the first two weeks in detail, walking skeleton, cut list, pivot plan |
| [docs/adr/](docs/adr/README.md) | 21 architecture decision records |
| [bench/TARGETS.md](bench/TARGETS.md) | Pre-registered benchmark targets and the kill criterion |
| [docs/research/RESEARCH_REPORT.md](docs/research/RESEARCH_REPORT.md) | The 2026-11-04 study that chose SIEVE (unmodified copy) |

## Naming

"SIEVE" is a placeholder. The npm name `sieve` is taken. "SIEVE" is also an NSDI'24 cache-eviction algorithm and the RFC 5228 mail-filtering language. The final name is decided by milestone M9.

## License

Apache-2.0 ([ADR-0018](docs/adr/0018-license-apache-2.md)). The `LICENSE` file is added with the repository skeleton on day 1 of implementation.
