// Test helper: a git snapshot built in memory (see ../git/fake-tree.ts), with a GitVfs whose blobs
// are served from memory and the bytes of every lexed source, as the CLI reads them from git.
import { createHash } from 'node:crypto';

import { TreeIndex } from '../../src/git/diff.ts';
import { GitVfs } from '../../src/git/vfs.ts';
import { isLexed } from '../../src/graph/static.ts';
import { snapshot, type FakeFile } from '../git/fake-tree.ts';

export interface FakeRepo {
  readonly index: TreeIndex;
  readonly vfs: GitVfs;
  readonly sources: ReadonlyMap<string, Uint8Array>;
}

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

/** Plain strings are regular files; a FakeFile sets the mode too. */
export function fakeRepo(files: Readonly<Record<string, string | FakeFile>>): FakeRepo {
  const normalized = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, typeof file === 'string' ? { mode: '100644' as const, content: file } : file]));
  const blobs = new Map(Object.values(normalized).map((file) => [sha1(`blob:${file.content}`), new TextEncoder().encode(file.content)]));
  const index = TreeIndex.build(snapshot(normalized));
  const vfs = new GitVfs(index, (oid) => blobs.get(oid) ?? null);
  const sources = new Map(vfs.files().filter(isLexed).map((path) => [path, new TextEncoder().encode(normalized[path]!.content)]));
  return { index, vfs, sources };
}
