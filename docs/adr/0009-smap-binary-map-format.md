# ADR-0009: Custom SMAP binary map format

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §4.2, [ADR-0002](0002-zero-dependency-cli.md), [ADR-0010](0010-hashing.md)

## Context
Maps must be decoded both by the zero-dependency CLI (Lite mode, `sieve verify`) and by the server. They must stay compact for graphs of 100k nodes and deduplicate across snapshots.

## Decision
SMAP v1 is a little-endian binary format with these sections:
- header: magic, version, hash algorithm;
- a front-coded, sorted path string table;
- a node table: kind, path id, hash;
- forward and reverse CSR adjacency, with delta-varint offsets and targets;
- 2-bit edge provenance (static, dynamic, declared);
- a test table: record reference, environment fingerprint, closure digest.

Maps are chunked per workspace package and content-addressed; the map root is the Merkle root of the chunk hashes.

## Alternatives considered
- **Protocol Buffers or FlatBuffers:** rejected. Both need runtime libraries in the CLI.
- **JSON:** rejected. Size and parse cost.
- **SQLite files:** rejected. Native dependency.

## Consequences
- The format is versioned, with golden vectors, round-trip property tests and decoder fuzzing.
- Unchanged packages share chunks across snapshots, which keeps storage and GC proportional to change.
