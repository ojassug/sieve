import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dialectOf, lexImports, type ImportRecord, type LexResult } from '../../src/lex/ts.ts';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'lex');

/** The stable, reviewable part of a result; offsets are covered by unit tests instead. */
function project(result: LexResult) {
  return {
    imports: result.imports.map((record: ImportRecord) => {
      const { kind, line, specifier, typeOnly, inlineTypeOnly, patterns, query, base } = record;
      return {
        kind,
        line,
        specifier,
        ...(typeOnly === true ? { typeOnly } : {}),
        ...(inlineTypeOnly === true ? { inlineTypeOnly } : {}),
        ...(kind === 'glob' ? { patterns: patterns ?? null } : {}),
        ...(query === undefined ? {} : { query }),
        ...(base === undefined ? {} : { base }),
      };
    }),
    diagnostics: result.diagnostics.map(({ code, line }) => ({ code, line })),
    uncertain: result.uncertain,
  };
}

describe('lexer golden fixtures', () => {
  const sources = readdirSync(FIXTURES).filter((name) => !name.endsWith('.expected.json'));

  it('has an expectation for every fixture', () => {
    expect(sources.length).toBeGreaterThanOrEqual(18);
    for (const name of sources) {
      expect(readdirSync(FIXTURES)).toContain(`${name}.expected.json`);
    }
  });

  it.each(sources)('%s', (name) => {
    const source = readFileSync(join(FIXTURES, name), 'utf8');
    const expected: unknown = JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), 'utf8'));
    expect(project(lexImports(source, dialectOf(name)))).toEqual(expected);
  });
});
