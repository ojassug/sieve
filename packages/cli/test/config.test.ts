import { describe, expect, it } from 'vitest';

import { ConfigError, DEFAULT_GLOBAL, DEFAULT_IGNORE, discoverTests, parseConfig, rulesOf } from '../src/config.ts';

// The example from architecture §5.1, verbatim.
const EXAMPLE = {
  version: 1,
  server: 'https://trommel.internal.example',
  projects: [
    { name: 'web', runner: 'vitest', root: 'packages/web', command: 'npx vitest run' },
    { name: 'api', runner: 'jest', root: 'packages/api', command: 'npx jest' },
    { name: 'e2e', runner: 'playwright', mode: 'results-only' },
  ],
  inputs: {
    global: ['package.json', '.env.test'],
    declared: [{ match: 'fixtures/payments/**', affects: 'packages/api/test/payments/**' }],
    generated: [{ outputs: 'packages/web/src/gql/**', inputs: ['schema.graphql', 'codegen.ts'] }],
    ignore: ['**/*.md', 'docs/**'],
  },
  env: { track: ['NODE_ENV', 'TZ'] },
  selection: { mode: 'shadow', auditRate: 0.02, alwaysRun: [], trustPullRequestsFrom: 'writers' },
  quarantine: { enabled: true, strict: false, sprt: { p0: 0.002, p1: 0.02, alpha: 0.01, beta: 0.05 } },
  sharding: { max: 16, targetMinutes: 10 },
};

const errorsOf = (value: unknown): readonly string[] => {
  try {
    parseConfig(JSON.stringify(value));
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  return [];
};

describe('parseConfig', () => {
  it('accepts the architecture §5.1 example', () => {
    expect(parseConfig(JSON.stringify(EXAMPLE))).toEqual(EXAMPLE);
  });

  it('accepts the smallest config', () => {
    expect(parseConfig('{ "version": 1 }')).toEqual({ version: 1 });
  });

  it('rejects text that is not JSON, or not an object', () => {
    expect(() => parseConfig('{ version: 1 }')).toThrow(/not valid JSON/);
    expect(errorsOf([1])).toEqual(['the config must be an object']);
  });

  it.each([
    ['a missing version', {}, 'version: required'],
    ['another version', { version: 2 }, 'version: must be 1'],
    ['an unknown key', { version: 1, sharding: { maxx: 3 } }, 'sharding.maxx: unknown key'],
    ['an unknown runner', { version: 1, projects: [{ name: 'a', runner: 'mocha' }] }, 'projects[0].runner: must be one of vitest, jest, playwright, pytest'],
    ['a project without a name', { version: 1, projects: [{ runner: 'vitest' }] }, 'projects[0].name: required'],
    ['two projects with one name', { version: 1, projects: [{ name: 'a', runner: 'vitest' }, { name: 'a', runner: 'jest' }] }, 'projects[1].name: "a" is already used'],
    ['a root outside the repository', { version: 1, projects: [{ name: 'a', runner: 'vitest', root: '../x' }] }, 'projects[0].root: must be a repo-relative POSIX path inside the repository'],
    ['an absolute root', { version: 1, projects: [{ name: 'a', runner: 'vitest', root: '/abs' }] }, 'projects[0].root: must be a repo-relative POSIX path inside the repository'],
    ['a pattern that is not a string', { version: 1, inputs: { global: ['a', 3] } }, 'inputs.global[1]: must be a string'],
    ['a declared rule without affects', { version: 1, inputs: { declared: [{ match: 'a/**' }] } }, 'inputs.declared[0].affects: required'],
    ['an unknown mode', { version: 1, selection: { mode: 'fast' } }, 'selection.mode: must be one of safe, shadow, budget'],
    ['an audit rate above 1', { version: 1, selection: { auditRate: 1.5 } }, 'selection.auditRate: must be a number from 0 to 1'],
    ['an env name with a space', { version: 1, env: { track: ['A B'] } }, 'env.track[0]: must be an environment variable name'],
    ['zero shards', { version: 1, sharding: { max: 0 } }, 'sharding.max: must be an integer from 1 to 256'],
    ['p0 not below p1', { version: 1, quarantine: { sprt: { p0: 0.1, p1: 0.05, alpha: 0.01, beta: 0.05 } } }, 'quarantine.sprt: p0 must be below p1'],
    ['a server that is not a URL', { version: 1, server: 'trommel.internal' }, 'server: must be an http(s) URL'],
  ])('rejects %s', (_name, value, problem) => {
    expect(errorsOf(value)).toContain(problem);
  });

  it('reports every problem at once', () => {
    expect(errorsOf({ version: 1, server: 1, sharding: { max: 'x' } })).toEqual(['server: must be an http(s) URL', 'sharding.max: must be an integer from 1 to 256']);
  });
});

describe('discoverTests', () => {
  const FILES = [
    'packages/core/test/a.test.ts',
    'packages/core/test/fixtures/resolve/x.test.ts',
    'packages/core/src/b.spec.mts',
    'packages/web/src/c.test.tsx',
    'packages/web/node_modules/dep/d.test.js',
    'packages/api/src/__tests__/e.ts',
    'packages/api/src/f.test.js',
    'scripts/test/g.test.ts',
    'src/h.ts',
  ];

  it("uses Vitest's default include without a config, excluding node_modules and fixtures", () => {
    expect(discoverTests(FILES, { version: 1 })).toEqual({
      tests: ['packages/api/src/f.test.js', 'packages/core/src/b.spec.mts', 'packages/core/test/a.test.ts', 'packages/web/src/c.test.tsx', 'scripts/test/g.test.ts'],
      notPlanned: [],
    });
  });

  it("matches each project's patterns inside its root, with Jest's defaults for Jest", () => {
    const config = parseConfig(JSON.stringify(EXAMPLE));
    expect(discoverTests(FILES, config)).toEqual({ tests: ['packages/api/src/__tests__/e.ts', 'packages/api/src/f.test.js', 'packages/web/src/c.test.tsx'], notPlanned: ['e2e'] });
  });

  it('takes include and exclude from the project when given', () => {
    const config = parseConfig(JSON.stringify({ version: 1, projects: [{ name: 's', runner: 'vitest', include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'], exclude: ['**/fixtures/**'] }] }));
    expect(discoverTests(FILES, config).tests).toEqual(['packages/core/test/a.test.ts', 'scripts/test/g.test.ts']);
  });
});

describe('rulesOf', () => {
  it('applies the defaults', () => {
    expect(rulesOf({ version: 1 })).toEqual({ global: DEFAULT_GLOBAL, declared: [], ignore: DEFAULT_IGNORE, alwaysRun: [], shards: 1, mode: 'shadow' });
  });

  it('gives env.track no effect until records exist: it is validated only', () => {
    expect(rulesOf(parseConfig(JSON.stringify({ version: 1, env: { track: ['NODE_ENV', 'TZ'] } })))).toEqual(rulesOf({ version: 1 }));
  });

  it('adds declared global inputs to the defaults and takes everything else from the config', () => {
    const rules = rulesOf(parseConfig(JSON.stringify(EXAMPLE)));
    expect(rules.global).toEqual([...DEFAULT_GLOBAL, '.env.test']);
    expect(rules).toMatchObject({ ignore: ['**/*.md', 'docs/**'], shards: 16, mode: 'shadow', declared: EXAMPLE.inputs.declared });
  });
});
