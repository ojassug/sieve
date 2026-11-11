import { describe, expect, it } from 'vitest';

import { canonicalJson, canonicalJsonPretty } from '../src/canonical-json.ts';

describe('canonicalJson', () => {
  it('sorts object keys at every depth', () => {
    const value = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } };
    expect(canonicalJson(value)).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it('sorts integer-like keys as strings, not in property-insertion order', () => {
    expect(canonicalJson({ '9': 2, '10': 1, a: 3 })).toBe('{"10":1,"9":2,"a":3}');
  });

  it('orders keys by UTF-16 code units, not code points or locale', () => {
    // U+1F600 is the surrogate pair D83D DE00, which sorts before U+FF5E in code units.
    const value = { '～': 5, '\u{1F600}': 4, 'é': 3, z: 2, Z: 1 };
    expect(canonicalJson(value)).toBe('{"Z":1,"z":2,"é":3,"\u{1F600}":4,"～":5}');
  });

  it('omits properties whose value is undefined', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('writes negative zero as 0', () => {
    expect(canonicalJson([-0, 0])).toBe('[0,0]');
  });

  it('escapes strings, including lone surrogates', () => {
    expect(canonicalJson(['a"b\\c\n', '\uD800'])).toBe('["a\\"b\\\\c\\n","\\ud800"]');
  });

  it('accepts null-prototype objects and shared non-cyclic references', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['k'] = true;
    const shared = { x: 1 };
    expect(canonicalJson({ bare, p: shared, q: shared })).toBe('{"bare":{"k":true},"p":{"x":1},"q":{"x":1}}');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined array element', [1, undefined]],
    ['top-level undefined', undefined],
    ['bigint', 1n],
    ['function', () => 1],
    ['symbol', Symbol('s')],
    ['Map', new Map()],
    ['Set', new Set()],
    ['Date', new Date(0)],
    ['typed array', new Uint8Array(1)],
    ['class instance', new (class Point { x = 1; })()],
  ])('rejects %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('rejects cycles', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => canonicalJson(a)).toThrow(TypeError);
  });
});

describe('canonicalJsonPretty', () => {
  it('indents by two spaces, keeps empty containers inline and ends with a newline', () => {
    const value = { c: [], b: [1, 2], a: {} };
    expect(canonicalJsonPretty(value)).toBe('{\n  "a": {},\n  "b": [\n    1,\n    2\n  ],\n  "c": []\n}\n');
  });
});
