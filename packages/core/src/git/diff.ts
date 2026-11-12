// Snapshot diffs (architecture §3.1). Git's tree objects are a Merkle tree: equal tree ids prove
// equal subtrees, so the descent only opens directories whose id changed. `naiveDiff` compares
// flat listings instead; it shares no logic with the descent and serves as its oracle (P10).
import type { LsTreeEntry } from './ls-tree.ts';

/** A `git ls-tree -r -t` listing of one tree plus that tree's own id. */
export interface Snapshot {
  readonly rootOid: string;
  readonly entries: readonly LsTreeEntry[];
}

export interface EntryState {
  readonly mode: string;
  readonly oid: string;
}

export interface FileChange {
  readonly path: string;
  /** `added` covers absent→present; a mode-only change is `modified`. */
  readonly kind: 'added' | 'deleted' | 'modified';
  readonly before?: EntryState;
  readonly after?: EntryState;
}

export interface TreeDelta {
  /** Blobs, symlinks and submodule gitlinks that changed, sorted by path. */
  readonly files: readonly FileChange[];
  /** Directories whose listing (entry names and kinds) changed, appeared or vanished; '' is the root. */
  readonly listings: readonly string[];
}

export interface DiffStats {
  visitedDirs: number;
}

export class TreeIndex {
  readonly rootOid: string;
  /** Entries whose path is not valid UTF-8. A non-zero count means the snapshot cannot be trusted. */
  readonly undecodable: number;
  private readonly dirs: ReadonlyMap<string, ReadonlyMap<string, LsTreeEntry>>;

  private constructor(rootOid: string, dirs: Map<string, Map<string, LsTreeEntry>>, undecodable: number) {
    this.rootOid = rootOid;
    this.dirs = dirs;
    this.undecodable = undecodable;
  }

  static build(snapshot: Snapshot): TreeIndex {
    const dirs = new Map<string, Map<string, LsTreeEntry>>([['', new Map()]]);
    const seen = new Set<string>();
    let undecodable = 0;
    for (const entry of snapshot.entries) {
      if (seen.has(entry.path)) {
        throw new Error(`tree listing has a duplicate path: ${entry.path}`);
      }
      seen.add(entry.path);
      if (entry.undecodable === true) {
        undecodable++;
      }
      const slash = entry.path.lastIndexOf('/');
      const dir = slash === -1 ? '' : entry.path.slice(0, slash);
      let children = dirs.get(dir);
      if (children === undefined) {
        children = new Map();
        dirs.set(dir, children);
      }
      children.set(entry.path.slice(slash + 1), entry);
    }
    return new TreeIndex(snapshot.rootOid, dirs, undecodable);
  }

  /** Direct entries of a directory by name; empty for a directory that does not exist. */
  children(dir: string): ReadonlyMap<string, LsTreeEntry> {
    return this.dirs.get(dir) ?? EMPTY;
  }

  /** The entry at `path`; undefined for '' (the root, which has no entry) and for missing paths. */
  entry(path: string): LsTreeEntry | undefined {
    const slash = path.lastIndexOf('/');
    return this.children(slash === -1 ? '' : path.slice(0, slash)).get(path.slice(slash + 1));
  }
}

const EMPTY: ReadonlyMap<string, LsTreeEntry> = new Map();

export function merkleDiff(base: TreeIndex, head: TreeIndex, stats?: DiffStats): TreeDelta {
  const files: FileChange[] = [];
  const listings: string[] = [];

  const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);
  const state = (entry: LsTreeEntry): EntryState => ({ mode: entry.mode, oid: entry.oid });

  const wholeSubtree = (index: TreeIndex, dir: string, kind: 'added' | 'deleted'): void => {
    listings.push(dir);
    for (const [name, entry] of index.children(dir)) {
      const path = join(dir, name);
      if (entry.type === 'tree') {
        wholeSubtree(index, path, kind);
      } else {
        files.push(kind === 'added' ? { path, kind, after: state(entry) } : { path, kind, before: state(entry) });
      }
    }
  };

  const visit = (dir: string): void => {
    if (stats) {
      stats.visitedDirs++;
    }
    const before = base.children(dir);
    const after = head.children(dir);
    if (!sameListing(before, after)) {
      listings.push(dir);
    }
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      const path = join(dir, name);
      const b = before.get(name);
      const a = after.get(name);
      if (b?.type === 'tree' && a?.type === 'tree') {
        if (b.oid !== a.oid) {
          visit(path);
        }
        continue;
      }
      if (b?.type === 'tree') {
        wholeSubtree(base, path, 'deleted');
      } else if (b !== undefined && (a === undefined || a.type === 'tree')) {
        files.push({ path, kind: 'deleted', before: state(b) });
      }
      if (a?.type === 'tree') {
        wholeSubtree(head, path, 'added');
      } else if (a !== undefined) {
        if (b === undefined || b.type === 'tree') {
          files.push({ path, kind: 'added', after: state(a) });
        } else if (b.oid !== a.oid || b.mode !== a.mode) {
          files.push({ path, kind: 'modified', before: state(b), after: state(a) });
        }
      }
    }
  };

  if (base.rootOid !== head.rootOid) {
    visit('');
  }
  return { files: files.sort(byPath), listings: listings.sort(compareStrings) };
}

/** Compares complete flat listings; O(#entries). The oracle for `merkleDiff`. */
export function naiveDiff(base: Snapshot, head: Snapshot): TreeDelta {
  const filesOf = (snapshot: Snapshot) => new Map(snapshot.entries.filter((e) => e.type !== 'tree').map((e) => [e.path, e]));
  const before = filesOf(base);
  const after = filesOf(head);
  const files: FileChange[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path);
    const a = after.get(path);
    if (a === undefined) {
      files.push({ path, kind: 'deleted', before: { mode: b!.mode, oid: b!.oid } });
    } else if (b === undefined) {
      files.push({ path, kind: 'added', after: { mode: a.mode, oid: a.oid } });
    } else if (b.mode !== a.mode || b.oid !== a.oid) {
      files.push({ path, kind: 'modified', before: { mode: b.mode, oid: b.oid }, after: { mode: a.mode, oid: a.oid } });
    }
  }

  const listingsOf = (snapshot: Snapshot): Map<string, string> => {
    const names = new Map<string, string[]>([['', []]]);
    for (const entry of snapshot.entries) {
      const slash = entry.path.lastIndexOf('/');
      const dir = slash === -1 ? '' : entry.path.slice(0, slash);
      const list = names.get(dir) ?? [];
      list.push(`${entry.path.slice(slash + 1)}\0${kindOf(entry)}`);
      names.set(dir, list);
      if (entry.type === 'tree' && !names.has(entry.path)) {
        names.set(entry.path, []);
      }
    }
    return new Map([...names].map(([dir, list]) => [dir, list.sort().join('\n')]));
  };
  const beforeListings = listingsOf(base);
  const afterListings = listingsOf(head);
  const listings = [...new Set([...beforeListings.keys(), ...afterListings.keys()])].filter(
    (dir) => beforeListings.get(dir) !== afterListings.get(dir),
  );
  return { files: files.sort(byPath), listings: listings.sort(compareStrings) };
}

/** What `readdir` with file types sees: 'f' file (either blob mode), 'l' symlink, 'm' submodule, 'd' directory. */
function kindOf(entry: LsTreeEntry): string {
  if (entry.type === 'tree') {
    return 'd';
  }
  if (entry.type === 'commit') {
    return 'm';
  }
  return entry.mode === '120000' ? 'l' : 'f';
}

function sameListing(a: ReadonlyMap<string, LsTreeEntry>, b: ReadonlyMap<string, LsTreeEntry>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [name, entry] of a) {
    const other = b.get(name);
    if (other === undefined || kindOf(other) !== kindOf(entry)) {
      return false;
    }
  }
  return true;
}

/** UTF-16 code-unit order, the same order canonical JSON uses for keys. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPath(a: FileChange, b: FileChange): number {
  return compareStrings(a.path, b.path);
}
