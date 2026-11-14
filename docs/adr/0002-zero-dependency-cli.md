# ADR-0002: Zero-dependency CLI and runner plugins

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §3.2, [ADR-0001](0001-typescript-on-node.md)

## Context
The CLI runs inside customers' CI, next to source code and sometimes secrets, so every dependency is supply-chain surface.

Import extraction doesn't need a full parser: a lexer that tracks strings, template literals, regex literals and comments finds every import statement. Where a real parser is wanted later, `web-tree-sitter` (WASM) avoids native builds. Initializing it with four grammars measured about 22 ms per process (TokenDamper DECISIONS §81).

## Decision
- The CLI, the Vitest plugin, the Jest reporter and the pytest plugin have **zero runtime dependencies**. They have peer dependencies on their runners only, and the pytest plugin uses only the Python standard library.
- Static extraction uses hand-written state-machine lexers: TypeScript first, Python later.
- Hashing uses node:crypto, and the map codec uses `DataView`.
- An optional `deep` package (web-tree-sitter WASM) behind a `LanguageAdapter` seam may come later, for symbol mode and new languages such as C++ for SeamCraft. It is never required.
- Server-side packages may use well-known dependencies: HTTP framework, Postgres driver, `ws`, OpenTelemetry.

## Alternatives considered
- **Bundle web-tree-sitter in the CLI:** rejected. Larger install, WASM init in every plan job, and import extraction doesn't need a full parser.
- **Native tree-sitter bindings:** rejected. node-gyp or per-platform prebuilds.
- **TypeScript compiler API for module resolution:** rejected. A very large dependency, and version coupling with the user's TypeScript.

## Consequences
- Trommel owns lexer and resolver correctness. That means golden fixtures, property tests and the toy-repo seeded-fault gate ([architecture.md](../architecture.md) §7).
- Config and pnpm workspace files need small zero-dependency JSON and YAML-subset parsers.
- Packages are published with npm provenance.
