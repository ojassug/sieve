import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { publish, pushIndex, runCommand, stageAssets, type CommandResult, type IndexFile, type Run } from '../src/publish.ts';

/**
 * A bare "remote" plus two clones: `work` stands in for the collection run's checkout, `rival`
 * for whoever else pushes to main while the run is collecting.
 */
function repos() {
  const root = mkdtempSync(join(tmpdir(), 'sieve-publish-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  const rival = join(root, 'rival');
  const git = (cwd: string, args: readonly string[]): string =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  git(root, ['init', '--bare', '-q', '--initial-branch=main', remote]);
  git(root, ['clone', '-q', remote, work]);
  // A clone of an empty repository leaves HEAD unborn; name the branch so every git version agrees.
  git(work, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(work, 'README.md'), 'sieve-corpus\n');
  git(work, ['add', 'README.md']);
  git(work, ['commit', '-qm', 'chore: start the corpus repository']);
  git(work, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  git(root, ['clone', '-q', remote, rival]);

  return {
    root,
    work,
    git,
    /** The bytes of `path` at the remote's main tip. */
    tip(path: string): string {
      return execFileSync('git', ['show', `main:${path}`], { cwd: remote, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    },
    /** Commit subjects at the remote's main tip, newest first. */
    log(): string[] {
      return git(remote, ['log', '--format=%s', 'main']).split('\n');
    },
    /** A commit from someone else, pushed straight to the remote's main. */
    compete(path: string, content: string, subject: string): void {
      git(rival, ['fetch', '-q', 'origin', 'main']);
      git(rival, ['reset', '-q', '--hard', 'FETCH_HEAD']);
      mkdirSync(dirname(join(rival, path)), { recursive: true });
      writeFileSync(join(rival, path), content);
      git(rival, ['add', '--', path]);
      git(rival, ['commit', '-qm', subject]);
      git(rival, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
    },
  };
}

/** Wraps `run` so that a competitor pushes to main immediately before the chosen push attempts. */
function competingPushes(compete: () => void, onAttempts: readonly number[]): Run {
  let pushes = 0;
  return (command, args, cwd) => {
    if (command === 'git' && args.includes('push')) {
      pushes += 1;
      if (onAttempts.includes(pushes)) {
        compete();
      }
    }
    return runCommand(command, args, cwd);
  };
}

describe('pushIndex', () => {
  let repo: ReturnType<typeof repos>;
  let staged: string;
  let files: IndexFile[];

  function stage(name: string, content: string): string {
    const path = join(staged, name);
    writeFileSync(path, content);
    return path;
  }

  beforeEach(() => {
    repo = repos();
    staged = mkdtempSync(join(tmpdir(), 'sieve-staged-'));
    files = [
      { path: 'manifests/2026/2026-11-12-7.json', source: stage('manifest.json', '{"run":7}\n') },
      { path: 'state/collector-state.json', source: stage('state.json', '{"days":["2026-11-12"]}\n') },
    ];
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  });

  it('commits the run files and pushes them to the branch', async () => {
    const result = await pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7' });

    expect(result.attempts).toBe(1);
    expect(result.commit).toMatch(/^[0-9a-f]{40,64}$/);
    expect(repo.tip('manifests/2026/2026-11-12-7.json')).toBe('{"run":7}\n');
    expect(repo.tip('state/collector-state.json')).toBe('{"days":["2026-11-12"]}\n');
    expect(repo.log()[0]).toBe('corpus: 2026-11-12-7');
  });

  it('re-applies onto a commit that landed while the run was collecting', async () => {
    const run = competingPushes(() => {
      repo.compete('collector.ref', 'deadbeef\n', 'chore: bump the collector');
    }, [1]);

    const result = await pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7', run, retryDelayMs: 0 });

    expect(result.attempts).toBe(2);
    // Neither side is lost: the run's manifest and state, and the other commit's file.
    expect(repo.tip('manifests/2026/2026-11-12-7.json')).toBe('{"run":7}\n');
    expect(repo.tip('state/collector-state.json')).toBe('{"days":["2026-11-12"]}\n');
    expect(repo.tip('collector.ref')).toBe('deadbeef\n');
    expect(repo.log()).toEqual(['corpus: 2026-11-12-7', 'chore: bump the collector', 'chore: start the corpus repository']);
  });

  it('keeps the run version when the competing commit touched the same file', async () => {
    const run = competingPushes(() => {
      repo.compete('state/collector-state.json', '{"days":[]}\n', 'chore: reset the collector state');
    }, [1]);

    const result = await pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7', run, retryDelayMs: 0 });

    expect(result.attempts).toBe(2);
    expect(repo.tip('state/collector-state.json')).toBe('{"days":["2026-11-12"]}\n');
    expect(repo.log()[1]).toBe('chore: reset the collector state');
  });

  it('retries until the attempts run out, then fails with what git reported', async () => {
    const run = competingPushes(() => {
      repo.compete('collector.ref', `${String(Math.random())}\n`, 'chore: bump the collector');
    }, [1, 2, 3]);

    await expect(pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7', run, attempts: 3, retryDelayMs: 0 })).rejects.toThrow(
      /3 attempts[\s\S]*(non-fast-forward|fetch first|rejected)/,
    );
    // Nothing of the run reached main, and no half-finished rebase or merge is left behind.
    expect(() => repo.tip('manifests/2026/2026-11-12-7.json')).toThrow();
    expect(existsSync(join(repo.work, '.git', 'rebase-merge'))).toBe(false);
    expect(existsSync(join(repo.work, '.git', 'rebase-apply'))).toBe(false);
    expect(existsSync(join(repo.work, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(repo.git(repo.work, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');
  });

  it('fails loudly when the remote is unreachable', async () => {
    repo.git(repo.work, ['remote', 'set-url', 'origin', join(repo.root, 'missing.git')]);

    await expect(pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7', attempts: 2, retryDelayMs: 0 })).rejects.toThrow(
      /2 attempts[\s\S]*missing\.git/,
    );
  });

  it('reports nothing to commit when the run files are already on the branch', async () => {
    await pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7' });

    const result = await pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7' });

    expect(result).toEqual({ attempts: 1, commit: null });
    expect(repo.log()).toEqual(['corpus: 2026-11-12-7', 'chore: start the corpus repository']);
  });

  it('writes the staged bytes even when the branch has moved on by several commits', async () => {
    repo.compete('a.txt', 'a\n', 'chore: a');
    repo.compete('b.txt', 'b\n', 'chore: b');
    writeFileSync(join(repo.work, 'untracked-out.json'), 'kept\n');

    const result = await pushIndex({ repoDir: repo.work, files, message: 'corpus: 2026-11-12-7', retryDelayMs: 0 });

    expect(result.attempts).toBe(1);
    expect(repo.tip('a.txt')).toBe('a\n');
    expect(repo.tip('b.txt')).toBe('b\n');
    expect(repo.tip('manifests/2026/2026-11-12-7.json')).toBe('{"run":7}\n');
    // The collector's own output sits untracked in the checkout; resetting must not delete it.
    expect(readFileSync(join(repo.work, 'untracked-out.json'), 'utf8')).toBe('kept\n');
  });
});

/** Records every command, serves `gh` from `respond`, and lets `git` run for real. */
function recording(respond: (args: readonly string[]) => CommandResult | undefined) {
  const timeline: string[] = [];
  const run: Run = (command, args, cwd) => {
    const rest = [...args];
    while (rest[0] === '-c') {
      rest.splice(0, 2);
    }
    timeline.push([command, ...rest.slice(0, 2)].join(' '));
    if (command === 'tar') {
      // Stand in for the archive so the checksums have something to hash, resolving the name
      // against the directory tar was given, exactly as tar itself would.
      const flag = rest.findIndex((arg) => arg === '-czf' || arg === '-cf');
      writeFileSync(resolve(cwd, rest[flag + 1]!), `archive of ${rest.at(-1)!}\n`);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    if (command === 'gh') {
      return Promise.resolve(respond(rest) ?? { code: 0, stdout: '', stderr: '' });
    }
    return runCommand(command, args, cwd);
  };
  return { timeline, run };
}

describe('publish', () => {
  let repo: ReturnType<typeof repos>;
  let out: string;
  let assets: string;

  beforeEach(() => {
    repo = repos();
    out = mkdtempSync(join(tmpdir(), 'sieve-out-'));
    assets = join(out, 'assets');
    writeFileSync(join(out, 'manifest.json'), '{"items":[],"requests":12}\n');
    mkdirSync(join(out, 'raw', 'o__a'), { recursive: true });
    writeFileSync(join(out, 'raw', 'o__a', 'runs.ndjson'), '{"id":1}\n');
    mkdirSync(join(out, 'artifacts', 'o__a'), { recursive: true });
    writeFileSync(join(out, 'artifacts', 'o__a', '1.zip'), 'zip\n');
    mkdirSync(join(repo.work, 'state'), { recursive: true });
    writeFileSync(join(repo.work, 'state', 'collector-state.json'), '{"startedOn":"2026-11-12"}\n');
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  const options = () => ({
    repoDir: repo.work,
    outDir: out,
    assetsDir: assets,
    statePath: 'state/collector-state.json',
    day: '2026-11-12',
    runNumber: '7',
    repo: 'ojassug/sieve-corpus',
    collector: { repo: 'ojassug/sieve', sha: 'abc1234' },
    retryDelayMs: 0,
  });

  it('stages the manifest, the state and one archive per repository, with checksums', async () => {
    const { run } = recording(() => undefined);

    const result = await publish({ ...options(), run });

    expect(result.assets).toEqual([
      'SHA256SUMS-2026-11-12-7',
      'artifacts-2026-11-12-7-o__a.tar',
      'manifest-2026-11-12-7.json',
      'raw-2026-11-12-7.tar.gz',
      'state-2026-11-12-7.json',
    ]);
    // The state file rides along as a backup: if the commit never lands, the run is still recoverable.
    expect(readFileSync(join(assets, 'state-2026-11-12-7.json'), 'utf8')).toBe('{"startedOn":"2026-11-12"}\n');
    expect(readFileSync(join(assets, 'manifest-2026-11-12-7.json'), 'utf8')).toBe('{"items":[],"requests":12}\n');
    const sums = readFileSync(join(assets, 'SHA256SUMS-2026-11-12-7'), 'utf8').trimEnd().split('\n');
    expect(sums.map((line) => line.split('  ')[1])).toEqual(result.assets.filter((name) => !name.startsWith('SHA256SUMS')));
    expect(sums.every((line) => /^[0-9a-f]{64} {2}\S/.test(line))).toBe(true);
  });

  it('publishes the release in full before the manifest and state are committed', async () => {
    const { timeline, run } = recording((args) => (args[1] === 'view' ? { code: 1, stdout: '', stderr: 'release not found' } : undefined));

    const result = await publish({ ...options(), run });

    expect(result.tag).toBe('corpus-2026-11-12-7');
    expect(timeline.filter((entry) => entry.startsWith('gh '))).toEqual(['gh release view', 'gh release create', 'gh release edit']);
    // The release has to be out of draft — the data durable — before anything claims it.
    expect(timeline.indexOf('gh release edit')).toBeLessThan(timeline.indexOf('git commit --quiet'));
    expect(repo.tip('manifests/2026/2026-11-12-7.json')).toBe('{"items":[],"requests":12}\n');
    expect(repo.tip('state/collector-state.json')).toBe('{"startedOn":"2026-11-12"}\n');
    expect(repo.log()[0]).toBe('corpus: 2026-11-12-7');
  });

  it('commits nothing when the release fails, so no state claims data that is not stored', async () => {
    const { timeline, run } = recording((args) => {
      if (args[1] === 'view') {
        return { code: 1, stdout: '', stderr: 'release not found' };
      }
      return args[1] === 'create' ? { code: 1, stdout: '', stderr: 'HTTP 503: upstream connect error' } : undefined;
    });

    await expect(publish({ ...options(), run })).rejects.toThrow(/gh release create[\s\S]*503/);

    expect(timeline.some((entry) => entry.startsWith('git commit'))).toBe(false);
    expect(repo.log()).toEqual(['chore: start the corpus repository']);
  });

  it('re-uploads over an existing release when a run number is re-run', async () => {
    const { timeline, run } = recording(() => undefined);

    await publish({ ...options(), run });

    expect(timeline.filter((entry) => entry.startsWith('gh '))).toEqual(['gh release view', 'gh release upload', 'gh release edit']);
  });

  it('works from the repository root with the relative paths the workflow passes', async () => {
    mkdirSync(join(repo.work, 'out', 'raw', 'o__a'), { recursive: true });
    writeFileSync(join(repo.work, 'out', 'manifest.json'), '{"requests":3}\n');
    writeFileSync(join(repo.work, 'out', 'raw', 'o__a', 'runs.ndjson'), '{"id":2}\n');
    const { run } = recording(() => undefined);
    const previous = process.cwd();

    try {
      process.chdir(repo.work);
      const result = await publish({ ...options(), repoDir: '.', outDir: 'out', assetsDir: 'assets', run });
      expect(result.assets).toContain('raw-2026-11-12-7.tar.gz');
    } finally {
      process.chdir(previous);
    }

    expect(readFileSync(join(repo.work, 'assets', 'raw-2026-11-12-7.tar.gz'), 'utf8')).toBe('archive of raw\n');
    expect(repo.tip('manifests/2026/2026-11-12-7.json')).toBe('{"requests":3}\n');
  });
});

describe('stageAssets', () => {
  let out: string;
  let assets: string;
  let statePath: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'sieve-stage-'));
    assets = join(out, 'assets');
    statePath = join(out, 'collector-state.json');
    writeFileSync(statePath, '{"repos":{}}\n');
    writeFileSync(join(out, 'manifest.json'), '{"requests":1}\n');
    mkdirSync(join(out, 'raw', 'o__a'), { recursive: true });
    writeFileSync(join(out, 'raw', 'o__a', 'runs.ndjson'), '{"id":1}\n');
    mkdirSync(join(out, 'artifacts', 'o__a'), { recursive: true });
    writeFileSync(join(out, 'artifacts', 'o__a', '1.zip'), 'zip\n');
  });

  afterEach(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it('gives tar absolute directories and a bare archive name, so no path depends on the caller', async () => {
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const run: Run = (command, args, cwd) => {
      calls.push({ args, cwd });
      const flag = args.findIndex((arg) => arg === '-czf' || arg === '-cf');
      writeFileSync(resolve(cwd, args[flag + 1]!), 'archive\n');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };

    await stageAssets({ outDir: out, assetsDir: assets, statePath, runId: '2026-11-12-7', run });

    expect(calls).toEqual([
      { args: ['-C', resolve(out), '-czf', 'raw-2026-11-12-7.tar.gz', 'raw'], cwd: resolve(assets) },
      { args: ['-C', resolve(out, 'artifacts'), '-cf', 'artifacts-2026-11-12-7-o__a.tar', 'o__a'], cwd: resolve(assets) },
    ]);
  });
});
