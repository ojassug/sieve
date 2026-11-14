# ADR-0010: Hashing

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §3.1, §3.9

## Context
File content hashes have to be available cheaply in shallow clones. Proofs have to be checkable by third parties and resistant to crafted collisions.

## Decision
- **File content:** the git blob OID as the repository stores it. Both SHA-1 and SHA-256 object formats are supported; the format is detected and recorded.
- **Everything Trommel computes** (directory-name digests, closure fingerprints, environment fingerprints, CAS keys, proof digests): SHA-256 via node:crypto.
- **Proof signatures:** ed25519 via node:crypto, with key ids so keys can be rotated.

## Alternatives considered
- **BLAKE3:** rejected. Needs a native or WASM dependency in the CLI.
- **xxHash:** rejected. Not collision-resistant.
- **Re-hashing every file with SHA-256:** rejected. Wasted work, since git already has the OIDs.

## Consequences
- No extra dependencies.
- The risk of a crafted SHA-1 collision in a SHA-1 repository is accepted. Anyone able to commit such a file could more simply weaken or delete the test. SHA-256 repositories are supported.
