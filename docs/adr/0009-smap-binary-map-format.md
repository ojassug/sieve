# ADR-0009: Custom SMAP binary map format

- Status: Accepted (2026-11-11); corrected in place on 2026-11-13 after the [foundation review](../research/2026-11-foundation-review.md), findings C3, M2 and M4
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §4.2, [ADR-0002](0002-zero-dependency-cli.md), [ADR-0010](0010-hashing.md)

## Context
Maps must be decoded both by the zero-dependency CLI (Lite mode, `trommel verify`) and by the server. They must stay compact for graphs of 100k nodes and deduplicate across snapshots.

## Decision
SMAP is a little-endian binary container, encoded and decoded with `DataView`.

**Container.**
- A header: magic, format version, hash algorithm (`sha1` or `sha256`, the repository's object format) and static engine id.
- A section table: tag, section version, flags, offset and length. A decoder skips an unknown optional section and rejects the map on an unknown required one.
- A trailer: SHA-256 of everything before it.

A map that fails any check is invalid, and the plan runs everything.

**Layers.** Each has its own sections and its own content address.
- **Snapshot:** the tree listing as mode, object id and path.
- **Static graph:** the nodes and edges derived from the snapshot, the config and the engine alone. It holds nothing about the machine that built it and no timestamp, so one tree gives the same bytes on every OS.
- **Records** (from M3): per test and environment cell, the record reference, environment fingerprint, closure digest, dynamic edges, completeness flags and time of the run. A test may have several records.

**Encoding.**
- A node's identity is its key string: `f:`, `d:`, `g:`, `p:`, `r:`, `c:`, `u:` or `sm:`. Kinds for skeleton and body are reserved. A numeric id is a position in one file's key table and never appears outside that file.
- Keys are sorted by UTF-16 code units, the order canonical JSON uses. They are stored as UTF-8, front-coded, with no Unicode normalization.
- Adjacency is stored forward only, with delta-varint targets. The decoder derives the reverse index.
- Provenance is a bitmask per edge, one byte: bit 0 static, bit 1 dynamic, bit 2 declared. The other bits are zero. Duplicate edges merge by OR.
- A hash is stored only where a plan cannot derive the change from the snapshot diff: packages, globs and uncertain causes.

**Chunking** per workspace package, with chunk-local ids and an import table, is defined when the server needs it (M5). Until then a map is one file.

## Alternatives considered
- **Protocol Buffers or FlatBuffers:** rejected. Both need runtime libraries in the CLI.
- **JSON:** rejected. Size and parse cost.
- **SQLite files:** rejected. Native dependency.

## Consequences
- The format is versioned, with golden vectors, round-trip property tests and decoder fuzzing. One golden vector has a path with a character above U+FFFF.
- CI asserts one fixture repository's static-layer hash on every OS. A change to that hash is reviewed like a snapshot: it comes with a new engine id, or with a recorded reason why maps from the older builder stay safe to plan from ([DECISIONS.md](../../DECISIONS.md) entry 26).
- The record layer is an addition to the container, not a new format.
