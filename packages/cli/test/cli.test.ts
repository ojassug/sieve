// End to end: the CLI run from source, as CI runs it, against a throwaway git repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MAIN = join(import.meta.dirname, '..', 'src', 'main.ts');
const LOCK = JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/lodash': { version: '4.17.21', integrity: 'sha512-1' } } });

let repo: string;
const git = (...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: repo, encoding: 'utf8' }).trim();
const write = (files: Record<string, string>): void => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
};
const commit = (files: Record<string, string>): string => {
  write(files);
  git('add', '-A');
  git('commit', '-q', '-m', 'c');
  return git('rev-parse', 'HEAD');
};

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
const trommel = (args: string[], env: Record<string, string> = {}): Run => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_')));
  const result = spawnSync(process.execPath, [MAIN, ...args], { cwd: repo, encoding: 'utf8', env: { ...clean, ...env } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

let base: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'trommel-cli-'));
  git('init', '-q');
  base = commit({
    '.gitignore': '.trommel/\n',
    'package.json': '{"name":"demo","type":"module"}\n',
    'package-lock.json': LOCK,
    'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
    'src/b.ts': 'export const b = 1;\n',
    'src/c.ts': "import _ from 'lodash';\nexport const c = _;\n",
    'test/a.test.ts': "import { a } from '../src/a';\n",
    'test/c.test.ts': "import { c } from '../src/c';\n",
    'README.md': '# demo\n',
  });
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('trommel graph, then plan', () => {
  it('writes the map of HEAD', () => {
    const run = trommel(['graph', '--out', '.trommel/map/map.json']);
    expect(run.stderr).toMatch(/2 tests/);
    expect(run.status).toBe(0);
    const map = JSON.parse(readFileSync(join(repo, '.trommel/map/map.json'), 'utf8')) as { tests: string[]; rootTree: string };
    expect(map.tests).toEqual(['test/a.test.ts', 'test/c.test.ts']);
    expect(map.rootTree).toBe(git('rev-parse', 'HEAD^{tree}'));
  });

  it('plans a change in shadow mode: everything runs, the selection is reported', () => {
    commit({ 'src/b.ts': 'export const b = 2;\n', 'README.md': '# demo, edited\n' });
    const outputs = join(repo, '..', `${repo.split(/[\\/]/).at(-1)!}-outputs.txt`);
    const summary = join(repo, '..', `${repo.split(/[\\/]/).at(-1)!}-summary.md`);
    writeFileSync(outputs, 'earlier=1\n');
    const run = trommel(['plan', '--mode', 'shadow', '--static', '--map', '.trommel/map'], { GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: summary });
    expect(run.status).toBe(0);
    const plan = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(plan['affected']).toEqual([{ test: 'test/a.test.ts', path: ['f:test/a.test.ts', 'f:src/a.ts', 'f:src/b.ts'] }]);
    expect(plan['wouldSkip']).toEqual([{ test: 'test/c.test.ts', label: 'unproven static reachability' }]);
    expect(plan['run']).toEqual(['test/a.test.ts', 'test/c.test.ts']);
    expect(plan['escalations']).toEqual([]);
    expect(readFileSync(outputs, 'utf8')).toBe('earlier=1\nmatrix={"include":[{"files":["test/a.test.ts","test/c.test.ts"],"shard":1}]}\ncount=2\n');
    expect(readFileSync(summary, 'utf8')).toContain('`test/a.test.ts` → `src/a.ts` → `src/b.ts` (changed)');
  });

  it('accepts --shadow for --mode shadow, and --shards', () => {
    const run = trommel(['plan', '--shadow', '--static', '--map', '.trommel/map', '--shards', '2']);
    expect(run.status).toBe(0);
    expect((JSON.parse(run.stdout) as { shards: string[][] }).shards).toEqual([['test/a.test.ts'], ['test/c.test.ts']]);
  });

  it('prints the snapshot difference between two revisions', () => {
    const run = trommel(['diff', base, 'HEAD']);
    expect(run.status).toBe(0);
    const delta = JSON.parse(run.stdout) as { files: { path: string; kind: string }[]; listings: string[]; packages: unknown };
    expect(delta.files.map((f) => `${f.kind} ${f.path}`)).toEqual(['modified README.md', 'modified src/b.ts']);
    expect(delta.listings).toEqual([]);
    expect(delta.packages).toEqual({ before: 'package-lock.json', after: 'package-lock.json', added: [], changed: [], removed: [] });
  });

  it('takes absolute paths for --out and --map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trommel-cli-abs-'));
    try {
      expect(trommel(['graph', '--rev', base, '--out', join(dir, 'map.json')]).status).toBe(0);
      const run = trommel(['plan', '--shadow', '--static', '--map', dir]);
      expect(run.status).toBe(0);
      expect((JSON.parse(run.stdout) as { fallback?: string }).fallback).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds byte-identical maps of the same revision', () => {
    const run = trommel(['graph', '--rev', base]);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(readFileSync(join(repo, '.trommel/map/map.json'), 'utf8'));
  });
});

describe('trommel plan fallbacks', () => {
  it.each([
    ['there is no map', [], 'no map at nowhere/map.json'],
    ['the map is not JSON', [['bad/map.json', '{']], 'the map at bad/map.json is invalid: the map is not JSON'],
  ])('plans every test, exiting 0, when %s', (_name, files, cause) => {
    for (const [path, content] of files as [string, string][]) {
      write({ [path]: content });
    }
    const dir = (files as [string, string][]).length > 0 ? 'bad' : 'nowhere';
    const outputs = join(repo, '..', `${repo.split(/[\\/]/).at(-1)!}-fallback.txt`);
    const run = trommel(['plan', '--shadow', '--static', '--map', dir], { GITHUB_OUTPUT: outputs });
    expect(run.status).toBe(0);
    const plan = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(plan['fallback']).toBe(cause);
    expect(plan['run']).toEqual(['test/a.test.ts', 'test/c.test.ts']);
    expect(readFileSync(outputs, 'utf8')).toContain('count=2\n');
  });

  it('plans every test when trommel.config.json is invalid', () => {
    commit({ 'trommel.config.json': '{ "version": 2 }' });
    const run = trommel(['plan', '--shadow', '--static']);
    expect(run.status).toBe(0);
    expect((JSON.parse(run.stdout) as { fallback: string }).fallback).toBe('invalid trommel.config.json: version: must be 1');
    git('rm', '-q', 'trommel.config.json');
    git('commit', '-q', '-m', 'c');
  });
});

describe('trommel usage errors', () => {
  it('refuses --mode safe with --static (kickoff gap 1)', () => {
    const run = trommel(['plan', '--mode', 'safe', '--static', '--map', '.trommel/map']);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/unproven static reachability/);
    expect(run.stdout).toBe('');
  });

  it('exits 2 on an unknown command, and prints help', () => {
    expect(trommel(['frob']).status).toBe(2);
    const help = trommel(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('plan --mode shadow --static');
  });

  it('exits 1 on a revision that does not exist', () => {
    const run = trommel(['graph', '--rev', 'no-such-rev']);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/trommel: /);
  });
});
