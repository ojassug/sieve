import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJson } from '@sieve-ci/core';

export type Stream = 'runs' | 'jobs' | 'check-runs' | 'artifacts';

export interface Sink {
  record(repo: string, stream: Stream, value: unknown): void;
  artifact(repo: string, artifactId: number, bytes: Uint8Array): void;
}

/** `owner/name` as a single path segment. */
export function repoSlug(repo: string): string {
  return repo.replace('/', '__');
}

/**
 * Raw API objects as canonical NDJSON under `raw/<slug>/<stream>.ndjson`, and mirrored artifact
 * archives under `artifacts/<slug>/<id>.zip`. Records can repeat across collection days when a
 * run was interrupted mid-way; consumers dedupe by (stream, id).
 */
export class FileSink implements Sink {
  private readonly outDir: string;

  constructor(outDir: string) {
    this.outDir = outDir;
  }

  record(repo: string, stream: Stream, value: unknown): void {
    const dir = join(this.outDir, 'raw', repoSlug(repo));
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${stream}.ndjson`), `${canonicalJson(value)}\n`);
  }

  artifact(repo: string, artifactId: number, bytes: Uint8Array): void {
    const dir = join(this.outDir, 'artifacts', repoSlug(repo));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${artifactId}.zip`), bytes);
  }
}
