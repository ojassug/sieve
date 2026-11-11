import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LsTreeParser, parseLsTree } from '../../src/git/ls-tree.ts';

const SHA1_A = 'a'.repeat(40);
const SHA1_B = '0123456789abcdef0123456789abcdef01234567';
const SHA256 = 'f'.repeat(64);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

// Records exactly as `git ls-tree -r -t -z` prints them: "<mode> <type> <oid>\t<path>\0".
const SAMPLE =
  `040000 tree ${SHA1_A}\tsrc\0` +
  `100644 blob ${SHA1_B}\tsrc/a b.ts\0` +
  `100755 blob ${SHA1_B}\tsrc/run.sh\0` +
  `120000 blob ${SHA1_B}\tsrc/link\0` +
  `160000 commit ${SHA1_A}\tvendor/lib\0` +
  `100644 blob ${SHA1_B}\tsrc/tab\there.ts\0` +
  `100644 blob ${SHA1_B}\tsrc/new\nline.ts\0` +
  `100644 blob ${SHA1_B}\tsrc/ünï\u{1F600}.ts\0`;

describe('parseLsTree', () => {
  it('parses mode, type, oid and path, including spaces, tabs, newlines and non-ASCII paths', () => {
    expect(parseLsTree(utf8(SAMPLE))).toEqual([
      { mode: '040000', type: 'tree', oid: SHA1_A, path: 'src' },
      { mode: '100644', type: 'blob', oid: SHA1_B, path: 'src/a b.ts' },
      { mode: '100755', type: 'blob', oid: SHA1_B, path: 'src/run.sh' },
      { mode: '120000', type: 'blob', oid: SHA1_B, path: 'src/link' },
      { mode: '160000', type: 'commit', oid: SHA1_A, path: 'vendor/lib' },
      { mode: '100644', type: 'blob', oid: SHA1_B, path: 'src/tab\there.ts' },
      { mode: '100644', type: 'blob', oid: SHA1_B, path: 'src/new\nline.ts' },
      { mode: '100644', type: 'blob', oid: SHA1_B, path: 'src/ünï\u{1F600}.ts' },
    ]);
  });

  it('accepts SHA-256 object ids', () => {
    expect(parseLsTree(utf8(`100644 blob ${SHA256}\tx\0`))).toEqual([{ mode: '100644', type: 'blob', oid: SHA256, path: 'x' }]);
  });

  it('returns nothing for empty output', () => {
    expect(parseLsTree(new Uint8Array(0))).toEqual([]);
  });

  it('flags a path that is not valid UTF-8 instead of dropping it', () => {
    const bytes = new Uint8Array([...utf8(`100644 blob ${SHA1_B}\tbad`), 0xff, 0x00]);
    expect(parseLsTree(bytes)).toEqual([{ mode: '100644', type: 'blob', oid: SHA1_B, path: 'bad�', undecodable: true }]);
  });

  it.each([
    ['a missing tab', `100644 blob ${SHA1_B} x\0`],
    ['an unknown type', `100644 tag ${SHA1_B}\tx\0`],
    ['a short oid', `100644 blob abc\tx\0`],
    ['an upper-case oid', `100644 blob ${SHA1_B.toUpperCase()}\tx\0`],
    ['a bad mode', `10064 blob ${SHA1_B}\tx\0`],
    ['an empty path', `100644 blob ${SHA1_B}\t\0`],
    ['a truncated last record', `100644 blob ${SHA1_B}\tx`],
  ])('rejects %s', (_name, text) => {
    expect(() => parseLsTree(utf8(text))).toThrow(/ls-tree/);
  });
});

describe('LsTreeParser', () => {
  it('gives the same entries however the stream is chunked', () => {
    const bytes = utf8(SAMPLE);
    const whole = parseLsTree(bytes);
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: bytes.length - 1 }), { maxLength: 12 }), (cuts) => {
        const parser = new LsTreeParser();
        const entries = [];
        let start = 0;
        for (const cut of [...cuts].sort((a, b) => a - b)) {
          entries.push(...parser.push(bytes.subarray(start, cut)));
          start = cut;
        }
        entries.push(...parser.push(bytes.subarray(start)), ...parser.end());
        expect(entries).toEqual(whole);
      }),
    );
  });
});
