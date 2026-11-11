// Test helper: builds `git ls-tree -r -t` style snapshots from a path → file map, computing tree
// ids bottom-up the way git does (equal subtrees get equal ids), so diffs can be checked offline.
import { createHash } from 'node:crypto';

import type { LsTreeEntry } from '../../src/git/ls-tree.ts';

export interface FakeFile {
  readonly mode: '100644' | '100755' | '120000' | '160000';
  /** Stands in for the blob content (or the submodule commit). */
  readonly content: string;
}

export interface FakeSnapshot {
  readonly rootOid: string;
  readonly entries: LsTreeEntry[];
}

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

export function snapshot(files: Readonly<Record<string, FakeFile>>): FakeSnapshot {
  const children = new Map<string, Map<string, LsTreeEntry>>([['', new Map()]]);
  const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
  const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

  for (const [path, file] of Object.entries(files)) {
    const dir = dirOf(path);
    for (let d = dir; d !== '' && !children.has(d); d = dirOf(d)) {
      children.set(d, new Map());
    }
    const type = file.mode === '160000' ? 'commit' : 'blob';
    children.get(dir)!.set(nameOf(path), { mode: file.mode, type, oid: sha1(`${type}:${file.content}`), path });
  }

  const entries: LsTreeEntry[] = [];
  const visit = (dir: string): string => {
    const own = children.get(dir)!;
    for (const [child] of children) {
      if (child !== '' && dirOf(child) === dir) {
        const oid = visit(child);
        own.set(nameOf(child), { mode: '040000', type: 'tree', oid, path: child });
      }
    }
    const listing = [...own.values()].map((entry) => `${entry.mode} ${nameOf(entry.path)} ${entry.oid}`).sort().join('\n');
    const oid = sha1(`tree:${listing}`);
    entries.push(...own.values());
    return oid;
  };
  const rootOid = visit('');
  return { rootOid, entries };
}
