# ADR-0003: File-level graph granularity

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §3.1, §3.2, §3.11

## Context
- Test runners execute files.
- ESM evaluates every module a barrel file re-exports, so barrel members are genuine runtime dependencies of anything that imports the barrel.
- Symbol-level analysis needs V8 function ranges remapped through source maps, plus AST region scanning.

## Decision
- v1 graph nodes are files plus synthetic nodes:
  - directory listings (`d:`);
  - external packages per install location (`p:`);
  - globs (`g:`);
  - environment components (`e:`);
  - submodule gitlinks (`sm:`);
  - absent paths (hash ⊥);
  - unresolved specifiers (`u:`).
- Edges carry their provenance: static, dynamic or declared.
- **Symbol-level refinement is a measured lever.** It means file skeleton plus executed function bodies, using a function-body scanner built on the import lexer. It is built only if the M4 replay shows at least 10 points of savings lost to barrel blowup.

## Alternatives considered
- **Symbol-level from day 1:** rejected for now. Much more mapping code before the kill test, and the soundness argument has to handle `fn.toString()` and `length`.
- **AST-node granularity:** rejected. Identities are unstable across edits, graphs get large, and no runner can execute anything below a test case anyway.

## Consequences
- A simpler soundness argument and faster progress in M1–M3.
- Precision loss in barrel-heavy repos gets measured, not guessed.
- The map format reserves node kinds for skeleton and body.
