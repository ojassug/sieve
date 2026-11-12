import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CatFileParser, type CatFileRecord } from '../../src/git/cat-file.ts';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(64);
const utf8 = (text: string) => new TextEncoder().encode(text);

/** `git cat-file --batch` output for the given records. */
function encode(records: readonly CatFileRecord[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const record of records) {
    if (record.type === 'missing') {
      parts.push(utf8(`${record.oid} missing\n`));
    } else {
      parts.push(utf8(`${record.oid} ${record.type} ${record.content.length}\n`), record.content, utf8('\n'));
    }
  }
  return Buffer.concat(parts);
}

function parseInChunks(bytes: Uint8Array, cuts: readonly number[]): CatFileRecord[] {
  const parser = new CatFileParser();
  const out: CatFileRecord[] = [];
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    out.push(...parser.push(bytes.subarray(start, cut)));
    start = cut;
  }
  parser.end();
  return out;
}

describe('CatFileParser', () => {
  it('reads headers and exact byte counts, including content with newlines and NULs', () => {
    const content = new Uint8Array([0x0a, 0x00, 0x41, 0x0a, 0x0d, 0x0a]);
    const records: CatFileRecord[] = [
      { oid: OID_A, type: 'blob', content },
      { oid: OID_B, type: 'blob', content: new Uint8Array(0) },
      { oid: OID_A, type: 'missing' },
    ];
    expect(parseInChunks(encode(records), [])).toEqual(records);
  });

  it('gives the same records however the stream is split (property)', () => {
    const record = fc.oneof(
      fc.record({ oid: fc.constantFrom(OID_A, OID_B), type: fc.constantFrom('blob' as const, 'tree' as const), content: fc.uint8Array({ maxLength: 40 }) }),
      fc.record({ oid: fc.constantFrom(OID_A, OID_B), type: fc.constant('missing' as const) }),
    );
    fc.assert(
      fc.property(fc.array(record, { maxLength: 8 }), fc.array(fc.nat(), { maxLength: 10 }), (records, rawCuts) => {
        const bytes = encode(records);
        const cuts = [...new Set(rawCuts.map((cut) => cut % (bytes.length + 1)))].sort((a, b) => a - b);
        expect(parseInChunks(bytes, cuts)).toEqual(records);
      }),
      { numRuns: 2000 },
    );
  });

  it('fails loudly when the stream ends inside a record', () => {
    const parser = new CatFileParser();
    parser.push(utf8(`${OID_A} blob 5\nabc`));
    expect(() => {
      parser.end();
    }).toThrow(/middle of an object/);
  });

  it('rejects a malformed header', () => {
    expect(() => new CatFileParser().push(utf8('nonsense\n'))).toThrow(/malformed header/);
    expect(() => new CatFileParser().push(utf8(`${OID_A} blob -1\n`))).toThrow(/malformed header/);
  });

  it('rejects content that is not followed by a newline', () => {
    expect(() => new CatFileParser().push(utf8(`${OID_A} blob 1\nxy`))).toThrow(/newline/);
  });
});
