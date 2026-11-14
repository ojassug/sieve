// trommel.config.json (architecture §5.1): parsed with JSON.parse and checked by hand, since the CLI
// has no runtime dependencies. Unknown keys are errors, so a typo never silently changes selection.
import { matchGlobs, type DeclaredRule } from '@trommel/core';

export const CONFIG_FILE = 'trommel.config.json';

export type Runner = 'vitest' | 'jest' | 'playwright' | 'pytest';
export type Mode = 'safe' | 'shadow' | 'budget';

export interface Project {
  readonly name: string;
  readonly runner: Runner;
  /** Repo-relative directory the project's patterns are relative to; '' (the default) is the root. */
  readonly root?: string;
  readonly command?: string;
  /** Results are uploaded, never selected. */
  readonly mode?: 'results-only';
  /** Test file globs relative to `root`; default: the runner's own default. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface TrommelConfig {
  readonly version: 1;
  readonly server?: string;
  readonly projects?: readonly Project[];
  readonly inputs?: {
    readonly global?: readonly string[];
    readonly declared?: readonly DeclaredRule[];
    readonly generated?: readonly { readonly outputs: string; readonly inputs: readonly string[] }[];
    readonly ignore?: readonly string[];
  };
  /** Validated and not used yet: tracked variables belong to a record (M2), not to the map or a static plan (DECISIONS 28). */
  readonly env?: { readonly track?: readonly string[] };
  readonly selection?: { readonly mode?: Mode; readonly auditRate?: number; readonly alwaysRun?: readonly string[]; readonly trustPullRequestsFrom?: 'writers' };
  readonly quarantine?: { readonly enabled?: boolean; readonly strict?: boolean; readonly sprt?: { readonly p0: number; readonly p1: number; readonly alpha: number; readonly beta: number } };
  readonly sharding?: { readonly max?: number; readonly targetMinutes?: number };
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`invalid ${CONFIG_FILE}: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

const RUNNERS: readonly Runner[] = ['vitest', 'jest', 'playwright', 'pytest'];
const MODES: readonly Mode[] = ['safe', 'shadow', 'budget'];
/** Vitest's default `include`, `**\/*.{test,spec}.?(c|m)[jt]s?(x)`, without extglobs. */
const VITEST_INCLUDE = ['**/*.{test,spec}.{js,ts,jsx,tsx,cjs,cts,mjs,mts,cjsx,ctsx,mjsx,mtsx}'];
/** Jest's default `testMatch`. */
const JEST_INCLUDE = ['**/__tests__/**/*.{js,jsx,ts,tsx}', '**/*.{spec,test}.{js,jsx,ts,tsx}', '**/{spec,test}.{js,jsx,ts,tsx}'];
const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/fixtures/**'];
/** Global inputs of every test (architecture §3.2): root package.json, .env files, runner configs and conventional setup files. */
export const DEFAULT_GLOBAL: readonly string[] = ['package.json', '.env*', '**/{vite,vitest}.config.*', '**/vitest.{workspace,setup}.*', '**/jest.{config,setup}.*'];
/** Changes that never escalate (architecture §3.5). */
export const DEFAULT_IGNORE: readonly string[] = ['**/*.md', 'docs/**', 'LICENSE*'];

export function parseConfig(text: string): TrommelConfig {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError([`not valid JSON (${(error as Error).message})`]);
  }
  const problems: string[] = [];
  validate(value, problems);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return value as TrommelConfig;
}

type Check = (value: unknown, path: string, problems: string[]) => void;

function validate(value: unknown, problems: string[]): void {
  if (!isRecord(value)) {
    problems.push('the config must be an object');
    return;
  }
  object(
    {
      version: (v, path, out) => {
        if (v !== 1) out.push(`${path}: must be 1`);
      },
      server: (v, path, out) => {
        if (typeof v !== 'string' || !/^https?:\/\/[^/\s]+/.test(v)) out.push(`${path}: must be an http(s) URL`);
      },
      projects: projects,
      inputs: (v, path, out) => {
        object({ global: patterns, declared: arrayOf(objectCheck({ match: string, affects: string }, ['match', 'affects'])), generated: arrayOf(objectCheck({ outputs: string, inputs: patterns }, ['outputs', 'inputs'])), ignore: patterns }, [], v, path, out);
      },
      env: (v, path, out) => {
        object({ track: arrayOf((name, p, o) => (typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? undefined : o.push(`${p}: must be an environment variable name`))) }, [], v, path, out);
      },
      selection: (v, path, out) => {
        object({ mode: oneOf(MODES), auditRate: numberIn(0, 1, 'a number from 0 to 1'), alwaysRun: patterns, trustPullRequestsFrom: oneOf(['writers']) }, [], v, path, out);
      },
      quarantine: (v, path, out) => {
        object({ enabled: boolean, strict: boolean, sprt: sprt }, [], v, path, out);
      },
      sharding: (v, path, out) => {
        object({ max: (n, p, o) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 256 ? undefined : o.push(`${p}: must be an integer from 1 to 256`)), targetMinutes: numberIn(Number.MIN_VALUE, Infinity, 'a positive number') }, [], v, path, out);
      },
    },
    ['version'],
    value,
    '',
    problems,
  );
}

function projects(value: unknown, path: string, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push(`${path}: must be an array`);
    return;
  }
  const names = new Set<string>();
  value.forEach((project: unknown, i) => {
    const at = `${path}[${i}]`;
    object({ name: string, runner: oneOf(RUNNERS), root: repoPath, command: string, mode: oneOf(['results-only']), include: patterns, exclude: patterns }, ['name', 'runner'], project, at, problems);
    const name = isRecord(project) ? project['name'] : undefined;
    if (typeof name === 'string') {
      if (names.has(name)) {
        problems.push(`${at}.name: ${JSON.stringify(name)} is already used`);
      }
      names.add(name);
    }
  });
}

function sprt(value: unknown, path: string, problems: string[]): void {
  const probability = numberIn(Number.MIN_VALUE, 1 - Number.EPSILON, 'a probability between 0 and 1');
  const before = problems.length;
  object({ p0: probability, p1: probability, alpha: probability, beta: probability }, ['p0', 'p1', 'alpha', 'beta'], value, path, problems);
  if (problems.length === before && isRecord(value) && (value['p0'] as number) >= (value['p1'] as number)) {
    problems.push(`${path}: p0 must be below p1`);
  }
}

function object(checks: Readonly<Record<string, Check>>, required: readonly string[], value: unknown, path: string, problems: string[]): void {
  const at = (key: string) => (path === '' ? key : `${path}.${key}`);
  if (!isRecord(value)) {
    problems.push(`${path}: must be an object`);
    return;
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      problems.push(`${at(key)}: required`);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const check = Object.hasOwn(checks, key) ? checks[key] : undefined;
    if (check === undefined) {
      problems.push(`${at(key)}: unknown key`);
    } else {
      check(item, at(key), problems);
    }
  }
}

function objectCheck(checks: Readonly<Record<string, Check>>, required: readonly string[]): Check {
  return (value, path, problems) => {
    object(checks, required, value, path, problems);
  };
}

function arrayOf(check: Check): Check {
  return (value, path, problems) => {
    if (!Array.isArray(value)) {
      problems.push(`${path}: must be an array`);
      return;
    }
    value.forEach((item: unknown, i) => {
      check(item, `${path}[${i}]`, problems);
    });
  };
}

function string(value: unknown, path: string, problems: string[]): void {
  if (typeof value !== 'string') {
    problems.push(`${path}: must be a string`);
  }
}

const patterns = arrayOf(string);

function boolean(value: unknown, path: string, problems: string[]): void {
  if (typeof value !== 'boolean') {
    problems.push(`${path}: must be true or false`);
  }
}

function repoPath(value: unknown, path: string, problems: string[]): void {
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => part === '..' || part === '.')) {
    problems.push(`${path}: must be a repo-relative POSIX path inside the repository`);
  }
}

function oneOf(values: readonly string[]): Check {
  return (value, path, problems) => {
    if (typeof value !== 'string' || !values.includes(value)) {
      problems.push(`${path}: must be one of ${values.join(', ')}`);
    }
  };
}

function numberIn(min: number, max: number, what: string): Check {
  return (value, path, problems) => {
    if (typeof value !== 'number' || !(value >= min && value <= max)) {
      problems.push(`${path}: must be ${what}`);
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Test files of every project Trommel plans (Vitest and Jest, not results-only), sorted. */
export function discoverTests(files: readonly string[], config: TrommelConfig): { tests: string[]; notPlanned: string[] } {
  const projects = config.projects ?? [{ name: 'default', runner: 'vitest' as const }];
  const tests = new Set<string>();
  const notPlanned: string[] = [];
  for (const project of projects) {
    if ((project.runner !== 'vitest' && project.runner !== 'jest') || project.mode === 'results-only') {
      notPlanned.push(project.name);
      continue;
    }
    const root = (project.root ?? '').replace(/\/+$/, '');
    const include = project.include ?? (project.runner === 'jest' ? JEST_INCLUDE : VITEST_INCLUDE);
    const exclude = project.exclude ?? DEFAULT_EXCLUDE;
    const inside = files.filter((file) => root === '' || file.startsWith(`${root}/`));
    const relative = inside.map((file) => (root === '' ? file : file.slice(root.length + 1)));
    const chosen = new Set(matchGlobs(relative, [...include, ...exclude.map((pattern) => `!${pattern}`)]));
    inside.forEach((file, i) => {
      if (chosen.has(relative[i]!)) {
        tests.add(file);
      }
    });
  }
  return { tests: [...tests].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), notPlanned };
}

export interface Rules {
  readonly global: readonly string[];
  readonly declared: readonly DeclaredRule[];
  readonly ignore: readonly string[];
  readonly alwaysRun: readonly string[];
  readonly shards: number;
  readonly mode: Mode;
}

/** The config with defaults applied. Declared global inputs add to the defaults; the rest replace them. */
export function rulesOf(config: TrommelConfig): Rules {
  return {
    global: [...new Set([...DEFAULT_GLOBAL, ...(config.inputs?.global ?? [])])],
    declared: config.inputs?.declared ?? [],
    ignore: config.inputs?.ignore ?? DEFAULT_IGNORE,
    alwaysRun: config.selection?.alwaysRun ?? [],
    shards: config.sharding?.max ?? 1,
    mode: config.selection?.mode ?? 'shadow',
  };
}
