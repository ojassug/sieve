# Benchmarks

- **Targets.** Pre-registered targets are in [TARGETS.md](TARGETS.md). Corpus selection is in [CORPUS.md](CORPUS.md).
- **Separate runs.** Timing scripts run apart from the test suite, so correctness tests never depend on how fast a machine is.
- **Recording.** Each script prints canonical JSON, and results are committed under [results/](results/) with the date and platform in the file name.

## Snapshot path: `node bench/ls-tree.ts [repo]`

This times what `sieve plan` does before any graph work:
- list the head tree with `git ls-tree -r -t -z`;
- parse the listing as a stream;
- index it by directory;
- run the Merkle descent against a base snapshot.

Without an argument, the script builds a synthetic repository with `git fast-import`: 20 packages × 25 modules × 20 files, which is 10,000 files in 541 trees. It then adds two commits on top, one changing 1 file and one changing 100 files.

| Date | Platform | Files | `git ls-tree` alone | `lsTree` (spawn + parse) | Index | Diff, 1 file | Diff, 100 files |
|---|---|---|---|---|---|---|---|
| 2026-11-11 | Windows 11, Ryzen AI 7 350, Node 26.4, git 2.55 | 10,000 | 31.5 ms | 57.6 ms | 3.0 ms | 0.0 ms | 0.4 ms |

All times are medians of 15 runs; the raw output is in [results/2026-11-11-ls-tree-win32.json](results/2026-11-11-ls-tree-win32.json).
- Architecture §3.1 expected about 100 ms for the CLI's listing at 10,000 files.
- `lsTree` also runs `git rev-parse` for the root tree id and parses the stream. Together those add about 26 ms over `git ls-tree` alone.

## Import lexer: `node bench/lex.ts [dir …]`

This times `lexImports` over every `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` and `.tsx` file under the given directories. The default is `node_modules`, which is already installed, so nothing is downloaded. Our own workspace links are skipped.

The script also counts the files the lexer marks **uncertain**. Every uncertain file costs precision, because its owning package escalates to L1. Real third-party code is a check that the uncertainty is not spurious.

| Date | Platform | Files | MB | Throughput | Imports found | Non-literal | Uncertain files |
|---|---|---|---|---|---|---|---|
| 2026-11-11 | Windows 11, Ryzen AI 7 350, Node 26.4 | 2,699 | 43.7 | 32–34 MB/s | 6,862 | 60 | 0 |

The raw output is in [results/2026-11-11-lex-win32.json](results/2026-11-11-lex-win32.json).
- The first run flagged 2 files in Vite and Vitest `.d.ts` output. Both contain method signatures named `import`, such as `import<T>(id: string): Promise<T>`. The fix and its fixture are `signatures.d.ts`.
