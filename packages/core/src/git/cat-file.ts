// Streaming parser for `git cat-file --batch` output: "<oid> SP <type> SP <size> LF <bytes> LF" per
// object, or "<oid> SP missing LF". Content is copied once into a buffer of its declared size, so a
// large blob split over many chunks costs O(size), and content bytes are never interpreted.

export type CatFileRecord =
  | { readonly oid: string; readonly type: 'blob' | 'tree' | 'commit' | 'tag'; readonly content: Uint8Array }
  | { readonly oid: string; readonly type: 'missing' };

const LF = 0x0a;
const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/;
const MISSING = /^(\S+) missing$/;

export class CatFileParser {
  private header: Uint8Array = new Uint8Array(0);
  private current: { oid: string; type: 'blob' | 'tree' | 'commit' | 'tag'; content: Uint8Array; filled: number } | null = null;
  /** The content is complete and its trailing LF has not arrived yet. */
  private awaitingLf = false;
  private readonly decoder = new TextDecoder('utf-8');

  push(chunk: Uint8Array): CatFileRecord[] {
    const records: CatFileRecord[] = [];
    let at = 0;
    while (at < chunk.length) {
      if (this.awaitingLf) {
        if (chunk[at] !== LF) {
          throw new Error('cat-file: object content is not followed by a newline');
        }
        at++;
        this.awaitingLf = false;
        const { oid, type, content } = this.current!;
        records.push({ oid, type, content });
        this.current = null;
      } else if (this.current !== null) {
        const take = Math.min(this.current.content.length - this.current.filled, chunk.length - at);
        this.current.content.set(chunk.subarray(at, at + take), this.current.filled);
        this.current.filled += take;
        at += take;
        this.awaitingLf = this.current.filled === this.current.content.length;
      } else {
        const lf = chunk.indexOf(LF, at);
        const end = lf === -1 ? chunk.length : lf;
        this.header = concat(this.header, chunk.subarray(at, end));
        at = end;
        if (lf !== -1) {
          at++;
          const record = this.startObject(this.decoder.decode(this.header));
          this.header = new Uint8Array(0);
          if (record !== null) {
            records.push(record);
          }
        }
      }
    }
    return records;
  }

  /** Call once the stream ends; output that stops inside a header or an object is truncated. */
  end(): void {
    if (this.header.length > 0 || this.current !== null) {
      throw new Error('cat-file: output ends in the middle of an object');
    }
  }

  /** Parses a header; returns the record at once when there is no content to wait for. */
  private startObject(line: string): CatFileRecord | null {
    const missing = MISSING.exec(line);
    if (missing !== null) {
      return { oid: missing[1]!, type: 'missing' };
    }
    const match = HEADER.exec(line);
    if (match === null) {
      throw new Error(`cat-file: malformed header ${JSON.stringify(line)}`);
    }
    // An empty object is complete at once; the content branch sees that and waits for its LF.
    this.current = { oid: match[1]!, type: match[2] as 'blob', content: new Uint8Array(Number(match[3])), filled: 0 };
    return null;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) {
    return b.slice();
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
