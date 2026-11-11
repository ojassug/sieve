import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { dialectOf, lexImports, lexImportsFromBytes } from '../../src/lex/ts.ts';

describe('dialectOf', () => {
  it.each([
    ['a.ts', 'ts'],
    ['a.mts', 'ts'],
    ['a.cts', 'ts'],
    ['types.d.ts', 'ts'],
    ['a.tsx', 'tsx'],
    ['a.js', 'js'],
    ['a.mjs', 'js'],
    ['a.cjs', 'js'],
    ['a.jsx', 'js'],
  ] as const)('%s is %s', (path, dialect) => {
    expect(dialectOf(path)).toBe(dialect);
  });
});

describe('lexImports offsets', () => {
  it('spans the specifier literal, quotes included', () => {
    const [record] = lexImports("import a from './x';", 'ts').imports;
    expect([record!.start, record!.end]).toEqual([14, 19]);
  });

  it('spans the keyword when the specifier is not a literal', () => {
    const [record] = lexImports('await import(x);', 'ts').imports;
    expect([record!.start, record!.end]).toEqual([6, 12]);
  });
});

describe('lexImportsFromBytes', () => {
  it('ignores a byte-order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("import './x';")]);
    expect(lexImportsFromBytes(bytes, 'ts').imports.map((r) => r.specifier)).toEqual(['./x']);
  });

  it('marks a file that is not valid UTF-8 as uncertain', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("import './x'; // "), 0xff, 0x0a]);
    const result = lexImportsFromBytes(bytes, 'ts');
    expect(result.uncertain).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['invalid-utf8']);
    expect(result.imports.map((r) => r.specifier)).toEqual(['./x']);
  });
});

describe('lexImports robustness', () => {
  it('never throws and is deterministic on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), fc.constantFrom('ts' as const, 'tsx' as const, 'js' as const), (source, dialect) => {
        const first = lexImports(source, dialect);
        expect(lexImports(source, dialect)).toEqual(first);
      }),
      { numRuns: 3000 },
    );
  });

  it('handles deep bracket nesting without recursion', () => {
    expect(lexImports(`${'('.repeat(100_000)}${')'.repeat(100_000)}`, 'ts').diagnostics).toEqual([]);
  });

  it('reports pathological template nesting instead of overflowing the stack', () => {
    const depth = 1000;
    const result = lexImports(`const s = ${'`${'.repeat(depth)}1${'}`'.repeat(depth)};`, 'ts');
    expect(result.diagnostics.map((d) => d.code)).toContain('too-deep');
    expect(result.uncertain).toBe(true);
  });
});

// Generated programs bury real imports among strings, comments, templates, regexes and
// divisions full of quote, slash and import-like text. Every real import must come out, in
// order, and nothing else; the noise is valid syntax, so no diagnostic may appear.
describe('generated programs', () => {
  const NOISE_CHARS = ['a', 'Z', '0', ' ', '"', "'", '`', '/', '*', '$', '{', '}', '(', ')', '[', ']', ';', '<', '>', '#'];
  const PIECES = [...NOISE_CHARS, "import('./nope')", 'require("./nope")'];
  /** Noise text that contains none of the excluded characters, so the surrounding literal stays valid. */
  const text = (exclude: string[]) =>
    fc
      .array(fc.constantFrom(...PIECES.filter((piece) => !exclude.some((ch) => piece.includes(ch)))), { maxLength: 8 })
      .map((parts) => parts.join(''));

  const noise = fc.oneof(
    text(["'"]).map((t) => `const s = '${t}\\'';`),
    text(['"']).map((t) => `const s = "${t}";`),
    text([]).map((t) => `// ${t}`),
    text(['*']).map((t) => `/* ${t} */`),
    fc.tuple(text(['`', '$']), text(["'"]), text(['`', '$'])).map(([a, b, c]) => `const t = \`${a}\${'${b}'}\${\`${c}\\\`\`}\`;`),
    text(['/', '[', '*']).map((t) => `const re = /${t.replace(/\\/g, '')}\\/[/'"]/g;`),
    fc.constant('const d = a / b / c;'),
    fc.constant('if (ok) /x/.test(y);'),
    fc.constant('function f() { return { a: 1 }; }'),
    fc.constant('const j = <T,>(x: T) => x;'),
  );

  const real = fc.tuple(fc.constantFrom('static', 'side-effect', 'reexport', 'dynamic', 'require'), fc.integer({ min: 0, max: 999 })).map(([kind, n]) => {
    const specifier = `./m${n}`;
    const code = {
      static: `import x${n} from '${specifier}';`,
      'side-effect': `import "${specifier}";`,
      reexport: `export * from '${specifier}';`,
      dynamic: `const v${n} = await import(\`${specifier}\`);`,
      require: `const r${n} = require('${specifier}');`,
    }[kind];
    return { kind, specifier, code };
  });

  it('finds exactly the real imports, in order, with no diagnostics', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof({ arbitrary: noise.map((code) => ({ code })), weight: 3 }, { arbitrary: real, weight: 1 }), { maxLength: 25 }),
        fc.constantFrom('\n', '\r\n'),
        fc.constantFrom('ts' as const, 'tsx' as const),
        (statements, newline, dialect) => {
          const source = statements.map((s) => s.code).join(newline);
          const result = lexImports(source, dialect);
          const wanted = statements.filter((s): s is { kind: string; specifier: string; code: string } => 'kind' in s);
          expect(result.diagnostics).toEqual([]);
          expect(result.imports.map((r) => [r.kind, r.specifier])).toEqual(wanted.map((s) => [s.kind, s.specifier]));
        },
      ),
      { numRuns: 2000 },
    );
  });
});
