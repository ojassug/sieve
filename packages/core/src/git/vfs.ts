// The resolver's view of one git snapshot (DECISIONS 17): kinds come from tree modes and contents
// from blobs, never from the working tree, so every OS and every checkout resolves alike.
import { execFileSync } from 'node:child_process';

import type { EntryKind, Vfs } from '../resolve/resolver.ts';
import type { TreeIndex } from './diff.ts';
import { readBlobs } from './git.ts';

/** Files the resolver reads on almost every run; `load` fetches them in one batch. */
const CONFIG_NAME = /(?:^|\/)(?:package\.json|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/;

export class GitVfs implements Vfs {
  private readonly index: TreeIndex;
  private readonly readBlob: (oid: string) => Uint8Array | null;
  private readonly texts = new Map<string, string>();
  private readonly decoder = new TextDecoder('utf-8');
  private list: string[] | null = null;

  /** `readBlob` returns a blob's bytes by oid; `load` supplies one backed by git. */
  constructor(index: TreeIndex, readBlob: (oid: string) => Uint8Array | null) {
    this.index = index;
    this.readBlob = readBlob;
  }

  /** A GitVfs for a snapshot of the repository at `cwd`, with config files and symlinks preloaded. */
  static async load(cwd: string, index: TreeIndex): Promise<GitVfs> {
    const probe = new GitVfs(index, () => null);
    const wanted = probe.files().filter((path) => CONFIG_NAME.test(path) || probe.kind(path) === 'symlink');
    const blobs = await readBlobs(cwd, wanted.map((path) => index.entry(path)!.oid));
    // Anything else (a tsconfig `extends` target with another name, say) is read on demand.
    return new GitVfs(index, (oid) => blobs.get(oid) ?? execFileSync('git', ['cat-file', 'blob', oid], { cwd, maxBuffer: 1 << 30 }));
  }

  kind(path: string): EntryKind | null {
    if (path === '') {
      return 'dir';
    }
    const entry = this.index.entry(path);
    if (entry === undefined) {
      return null;
    }
    if (entry.type === 'tree') {
      return 'dir';
    }
    if (entry.type === 'commit') {
      return 'submodule';
    }
    return entry.mode === '120000' ? 'symlink' : 'file';
  }

  /** A file's text or a symlink's target, decoded as UTF-8 with a leading BOM dropped. */
  read(path: string): string | null {
    const cached = this.texts.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const kind = this.kind(path);
    if (kind !== 'file' && kind !== 'symlink') {
      return null;
    }
    const bytes = this.readBlob(this.index.entry(path)!.oid);
    if (bytes === null) {
      return null;
    }
    const text = this.decoder.decode(bytes);
    this.texts.set(path, text);
    return text;
  }

  /** The blob (or gitlink) id at `path`: the hash of its `f:` node. Null for directories and missing paths. */
  oid(path: string): string | null {
    const entry = this.index.entry(path);
    return entry === undefined || entry.type === 'tree' ? null : entry.oid;
  }

  /** Every file, symlink and submodule path, sorted by UTF-16 code units. */
  files(): readonly string[] {
    if (this.list === null) {
      const list: string[] = [];
      const walk = (dir: string): void => {
        for (const [name, entry] of this.index.children(dir)) {
          const path = dir === '' ? name : `${dir}/${name}`;
          if (entry.type === 'tree') {
            walk(path);
          } else {
            list.push(path);
          }
        }
      };
      walk('');
      this.list = list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
    return this.list;
  }
}
