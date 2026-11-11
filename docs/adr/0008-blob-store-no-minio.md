# ADR-0008: Blob store — local volume or S3-compatible, no bundled MinIO

- Status: Accepted (2026-11-11)
- Deciders: Ojas Sugur
- Related: [architecture.md](../architecture.md) §4.2, [threat-model.md](../threat-model.md) §1.1

## Context
Maps, proof bundles and raw uploads need an object store.

MinIO's status, as of this decision:
- it stopped publishing pre-built images in October 2025 and entered maintenance mode in December 2025 (several secondary sources);
- one source reports the repository was archived in February 2026.

## Decision
- A `BlobStore` interface with two backends:
  - the local filesystem volume, default in compose;
  - any S3-compatible service, the operator's choice (AWS S3, Garage, SeaweedFS, Ceph RGW, community MinIO forks).
- Keys are tenant-prefixed (`t/{tenant}/r/{repo}/…`), and content-addressed objects live under `cas/{sha256}`.
- There is no cross-tenant deduplication.

## Alternatives considered
- **Bundle MinIO:** rejected. Upstream is unmaintained.
- **Postgres large objects or `bytea`:** rejected. Table bloat and bigger backups.
- **Bundle Garage or SeaweedFS:** rejected. Another service to operate.

## Consequences
- Compose is the SIEVE image plus Postgres.
- The filesystem backend must write atomically (temp file + rename) and is covered by GC.
- Hosted mode uses S3.
