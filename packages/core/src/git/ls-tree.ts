// Streaming parser for `git ls-tree -z` output: "<mode> SP <type> SP <oid> TAB <path> NUL".

export type ObjectType = 'blob' | 'tree' | 'commit';

export interface LsTreeEntry {
  /** Six octal digits: 100644, 100755, 120000 (symlink), 160000 (gitlink), 040000 (tree). */
  readonly mode: string;
  readonly type: ObjectType;
  /** 40 hex digits in SHA-1 repositories, 64 in SHA-256 ones. */
  readonly oid: string;
  /** Repo-relative POSIX path, exactly as git stores it. */
  readonly path: string;
  /** The path bytes are not valid UTF-8; `path` is a lossy rendering. Consumers must escalate. */
  readonly undecodable?: true;
}

const NUL = 0x00;
const SPACE = 0x20;
const TAB = 0x09;
const MODE = /^[0-7]{6}$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TYPES: ReadonlySet<string> = new Set(['blob', 'tree', 'commit']);

export class LsTreeParser {
  private pending = new Uint8Array(0);
  private readonly strict = new TextDecoder('utf-8', { fatal: true });
  private readonly lossy = new TextDecoder('utf-8');

  /** Entries completed by this chunk; a record split across chunks is held until its NUL arrives. */
  push(chunk: Uint8Array): LsTreeEntry[] {
    let data = chunk;
    if (this.pending.length > 0) {
      data = new Uint8Array(this.pending.length + chunk.length);
      data.set(this.pending);
      data.set(chunk, this.pending.length);
    }
    const entries: LsTreeEntry[] = [];
    let start = 0;
    for (let end = data.indexOf(NUL); end !== -1; end = data.indexOf(NUL, start)) {
      entries.push(this.parseRecord(data.subarray(start, end)));
      start = end + 1;
    }
    this.pending = data.slice(start);
    return entries;
  }

  /** Call once the stream ends; output that does not end in NUL is truncated. */
  end(): LsTreeEntry[] {
    if (this.pending.length > 0) {
      throw new Error('ls-tree: output ends in the middle of a record');
    }
    return [];
  }

  private parseRecord(record: Uint8Array): LsTreeEntry {
    const tab = record.indexOf(TAB);
    const firstSpace = record.indexOf(SPACE);
    const secondSpace = firstSpace === -1 ? -1 : record.indexOf(SPACE, firstSpace + 1);
    if (tab === -1 || secondSpace === -1 || secondSpace > tab) {
      throw new Error(`ls-tree: malformed record ${JSON.stringify(this.lossy.decode(record))}`);
    }
    const mode = this.lossy.decode(record.subarray(0, firstSpace));
    const type = this.lossy.decode(record.subarray(firstSpace + 1, secondSpace));
    const oid = this.lossy.decode(record.subarray(secondSpace + 1, tab));
    const pathBytes = record.subarray(tab + 1);
    if (!MODE.test(mode) || !TYPES.has(type) || !OID.test(oid) || pathBytes.length === 0) {
      throw new Error(`ls-tree: malformed record ${JSON.stringify(this.lossy.decode(record))}`);
    }
    try {
      return { mode, type: type as ObjectType, oid, path: this.strict.decode(pathBytes) };
    } catch {
      return { mode, type: type as ObjectType, oid, path: this.lossy.decode(pathBytes), undecodable: true };
    }
  }
}

export function parseLsTree(bytes: Uint8Array): LsTreeEntry[] {
  const parser = new LsTreeParser();
  return [...parser.push(bytes), ...parser.end()];
}
