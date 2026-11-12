// Reading snapshots from git. File hashes are always git's blob ids (ADR-0010), never hashes of
// working-tree bytes, which differ across OSes when line endings are converted.
import { spawn } from 'node:child_process';

import { CatFileParser, type CatFileRecord } from './cat-file.ts';
import type { Snapshot } from './diff.ts';
import { LsTreeParser, type LsTreeEntry } from './ls-tree.ts';

export type ObjectFormat = 'sha1' | 'sha256';

export async function readObjectFormat(cwd: string): Promise<ObjectFormat> {
  const format = new TextDecoder().decode(await git(cwd, ['rev-parse', '--show-object-format'])).trim();
  if (format !== 'sha1' && format !== 'sha256') {
    throw new Error(`git: unknown object format ${JSON.stringify(format)}`);
  }
  return format;
}

/** The top-level directory of the working tree that contains `cwd`. */
export async function repoRoot(cwd: string): Promise<string> {
  return new TextDecoder().decode(await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

/** Every blob, gitlink and tree under `treeish`, parsed as git streams it, plus the root tree id. */
export async function lsTree(cwd: string, treeish: string): Promise<Snapshot> {
  const rootOid = new TextDecoder().decode(await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${treeish}^{tree}`])).trim();
  const parser = new LsTreeParser();
  const entries: LsTreeEntry[] = [];
  await git(cwd, ['ls-tree', '-r', '-t', '-z', '--full-tree', rootOid], (chunk) => entries.push(...parser.push(chunk)));
  entries.push(...parser.end());
  return { rootOid, entries };
}

/**
 * The contents of the given blobs, by oid, from one `git cat-file --batch` process. A missing
 * object, or one that is not a blob, is an error: callers never see a partial snapshot.
 */
export async function readBlobs(cwd: string, oids: Iterable<string>): Promise<Map<string, Uint8Array>> {
  const wanted = [...new Set(oids)];
  const blobs = new Map<string, Uint8Array>();
  if (wanted.length === 0) {
    return blobs;
  }
  const parser = new CatFileParser();
  const records: CatFileRecord[] = [];
  await git(cwd, ['cat-file', '--batch'], (chunk) => records.push(...parser.push(chunk)), `${wanted.join('\n')}\n`);
  parser.end();
  if (records.length !== wanted.length) {
    throw new Error(`git cat-file returned ${records.length} objects for ${wanted.length} requests`);
  }
  records.forEach((record, i) => {
    if (record.type === 'missing') {
      throw new Error(`git cat-file: object ${wanted[i]!} is missing`);
    }
    if (record.oid !== wanted[i]) {
      throw new Error(`git cat-file: expected ${wanted[i]!}, got ${record.oid}`);
    }
    if (record.type !== 'blob') {
      throw new Error(`git cat-file: object ${record.oid} is a ${record.type}, not a blob`);
    }
    blobs.set(record.oid, record.content);
  });
  return blobs;
}

/**
 * Runs git, streaming stdout to `onChunk` when given (and returning nothing), else returning it.
 * `input`, when given, is written to stdin; stdin is then closed.
 */
function git(cwd: string, args: readonly string[], onChunk?: (chunk: Uint8Array) => void, input = ''): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', reject);
    child.stdin.end(input);
    const out: Uint8Array[] = [];
    const err: Uint8Array[] = [];
    child.stdout.on('data', (chunk: Uint8Array) => {
      if (onChunk) {
        onChunk(chunk);
      } else {
        out.push(chunk);
      }
    });
    child.stderr.on('data', (chunk: Uint8Array) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out));
      } else {
        reject(new Error(`git ${args.join(' ')} exited with ${String(code)}: ${Buffer.concat(err).toString('utf8').trim()}`));
      }
    });
  });
}
