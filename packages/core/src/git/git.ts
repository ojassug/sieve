// Reading snapshots from git. File hashes are always git's blob ids (ADR-0010), never hashes of
// working-tree bytes, which differ across OSes when line endings are converted.
import { spawn } from 'node:child_process';

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

/** Every blob, gitlink and tree under `treeish`, parsed as git streams it, plus the root tree id. */
export async function lsTree(cwd: string, treeish: string): Promise<Snapshot> {
  const rootOid = new TextDecoder().decode(await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${treeish}^{tree}`])).trim();
  const parser = new LsTreeParser();
  const entries: LsTreeEntry[] = [];
  await git(cwd, ['ls-tree', '-r', '-t', '-z', '--full-tree', rootOid], (chunk) => entries.push(...parser.push(chunk)));
  entries.push(...parser.end());
  return { rootOid, entries };
}

/** Runs git, streaming stdout to `onChunk` when given (and returning nothing), else returning it. */
function git(cwd: string, args: readonly string[], onChunk?: (chunk: Uint8Array) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
