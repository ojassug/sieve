// Publishing one collection run to the data repository (DECISIONS 22).
//
// A run collects for hours, so another commit can land on the data repository's main while it
// works. Rather than fail the push and lose the run's manifest and state, each attempt re-applies
// the run's files onto whatever main has become: the run's own files always win, everything else
// comes from the remote, and no half-finished rebase can be left behind to poison the next try.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command to completion. A non-zero exit is a result, not a rejection. */
export type Run = (command: string, args: readonly string[], cwd: string) => Promise<CommandResult>;

export const runCommand: Run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Uint8Array[] = [];
    const err: Uint8Array[] = [];
    child.stdout.on('data', (chunk: Uint8Array) => out.push(chunk));
    child.stderr.on('data', (chunk: Uint8Array) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    });
  });

/** A file this run owns: `path` inside the repository, written from the staged copy at `source`. */
export interface IndexFile {
  readonly path: string;
  readonly source: string;
}

export interface Author {
  readonly name: string;
  readonly email: string;
}

export interface PushOptions {
  readonly repoDir: string;
  readonly files: readonly IndexFile[];
  readonly message: string;
  readonly branch?: string | undefined;
  readonly attempts?: number | undefined;
  readonly author?: Author | undefined;
  readonly run?: Run | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly retryDelayMs?: number | undefined;
}

export interface PushResult {
  readonly attempts: number;
  /** The commit pushed, or `null` when the files were already on the branch. */
  readonly commit: string | null;
}

const GITHUB_ACTIONS_BOT: Author = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};

type Attempt = { readonly ok: true; readonly commit: string | null } | { readonly ok: false; readonly failure: string };

function failed(what: string, result: CommandResult): Attempt {
  const detail = [result.stderr.trim(), result.stdout.trim()].filter((part) => part !== '').join('\n');
  return { ok: false, failure: `${what} exited ${String(result.code)}: ${detail}` };
}

/**
 * Commits `files` onto the tip of `branch` and pushes, retrying when someone else got there first.
 * Throws with every attempt's git output when it cannot: the manifest and state must never go
 * missing quietly.
 */
export async function pushIndex(options: PushOptions): Promise<PushResult> {
  const maxAttempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 10_000;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  const failures: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await attemptPush(options);
    if (outcome.ok) {
      return { attempts: attempt, commit: outcome.commit };
    }
    failures.push(`attempt ${String(attempt)}: ${outcome.failure}`);
    if (attempt < maxAttempts) {
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`corpus: could not publish the manifest and state in ${String(maxAttempts)} attempts:\n${failures.join('\n')}`);
}

async function attemptPush(options: PushOptions): Promise<Attempt> {
  const { repoDir, files, message } = options;
  const branch = options.branch ?? 'main';
  const author = options.author ?? GITHUB_ACTIONS_BOT;
  const run = options.run ?? runCommand;
  const git = (...args: string[]): Promise<CommandResult> =>
    run('git', ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, ...args], repoDir);

  const fetched = await git('fetch', '--quiet', 'origin', branch);
  if (fetched.code !== 0) {
    return failed('git fetch', fetched);
  }
  // Start again from the remote's tip, so a commit that landed mid-run is kept rather than merged.
  // Only tracked files move: the collector's own output sits untracked in this checkout.
  const rewound = await git('checkout', '--quiet', '--force', '-B', branch, 'FETCH_HEAD');
  if (rewound.code !== 0) {
    return failed('git checkout', rewound);
  }

  for (const file of files) {
    const target = resolve(repoDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.source, target);
  }
  const added = await git('add', '--', ...files.map((file) => file.path));
  if (added.code !== 0) {
    return failed('git add', added);
  }

  // `git diff --cached --quiet` exits 1 when the index differs, 0 when a re-run would be a no-op.
  const staged = await git('diff', '--cached', '--quiet');
  if (staged.code === 0) {
    return { ok: true, commit: null };
  }
  if (staged.code !== 1) {
    return failed('git diff --cached', staged);
  }

  const committed = await git('commit', '--quiet', '-m', message);
  if (committed.code !== 0) {
    return failed('git commit', committed);
  }
  const head = await git('rev-parse', 'HEAD');
  if (head.code !== 0) {
    return failed('git rev-parse', head);
  }
  const pushed = await git('push', 'origin', `HEAD:refs/heads/${branch}`);
  if (pushed.code !== 0) {
    return failed('git push', pushed);
  }
  return { ok: true, commit: head.stdout.trim() };
}

export interface StageOptions {
  readonly outDir: string;
  readonly assetsDir: string;
  /** Absolute path of the collector's state file. */
  readonly statePath: string;
  /** `<day>-<run number>`, the suffix every asset carries. */
  readonly runId: string;
  readonly run?: Run | undefined;
}

export interface StagedAssets {
  /** Asset file names inside `assetsDir`, sorted, including the checksum listing. */
  readonly names: readonly string[];
  readonly manifest: string;
  readonly state: string;
}

async function mustRun(run: Run, command: string, args: readonly string[], cwd: string): Promise<CommandResult> {
  const result = await run(command, args, cwd);
  if (result.code !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()].filter((part) => part !== '').join('\n');
    throw new Error(`corpus: ${command} ${args.join(' ')} exited ${String(result.code)}: ${detail}`);
  }
  return result;
}

/**
 * The run's output as release assets: the raw NDJSON and mirrored artifacts as archives, plus the
 * manifest and the collector state. The state is a backup — if the commit below never lands, the
 * release still holds everything needed to recover the run.
 */
export async function stageAssets(options: StageOptions): Promise<StagedAssets> {
  const { runId } = options;
  const run = options.run ?? runCommand;
  // The workflow passes relative paths, so resolve once: tar is then given an absolute directory to
  // read and a bare archive name to write, and nothing depends on where this process was started.
  const outDir = resolve(options.outDir);
  const assetsDir = resolve(options.assetsDir);
  mkdirSync(assetsDir, { recursive: true });

  const manifest = join(assetsDir, `manifest-${runId}.json`);
  copyFileSync(join(outDir, 'manifest.json'), manifest);
  const state = join(assetsDir, `state-${runId}.json`);
  copyFileSync(resolve(options.statePath), state);

  if (existsSync(join(outDir, 'raw'))) {
    await mustRun(run, 'tar', ['-C', outDir, '-czf', `raw-${runId}.tar.gz`, 'raw'], assetsDir);
  }
  const artifactsDir = join(outDir, 'artifacts');
  if (existsSync(artifactsDir)) {
    const slugs = readdirSync(artifactsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const slug of slugs) {
      await mustRun(run, 'tar', ['-C', artifactsDir, '-cf', `artifacts-${runId}-${slug}.tar`, slug], assetsDir);
    }
  }

  const hashed = readdirSync(assetsDir).sort();
  const lines = hashed.map((name) => `${createHash('sha256').update(readFileSync(join(assetsDir, name))).digest('hex')}  ${name}`);
  const checksums = `SHA256SUMS-${runId}`;
  writeFileSync(join(assetsDir, checksums), `${lines.join('\n')}\n`);
  return { names: [...hashed, checksums].sort(), manifest, state };
}

export interface ReleaseOptions {
  readonly repo: string;
  readonly tag: string;
  readonly title: string;
  readonly notes: string;
  readonly assetsDir: string;
  readonly assets: readonly string[];
  readonly run?: Run | undefined;
}

/** Creates the release as a draft, uploads, then un-drafts it, so no consumer sees a partial one. */
export async function publishRelease(options: ReleaseOptions): Promise<void> {
  const { repo, tag, title, notes, assetsDir, assets } = options;
  const run = options.run ?? runCommand;

  const existing = await run('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft'], assetsDir);
  if (existing.code === 0) {
    // Re-running a job keeps its run number, so the tag may already be there: replace the assets.
    await mustRun(run, 'gh', ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber'], assetsDir);
  } else {
    await mustRun(run, 'gh', ['release', 'create', tag, ...assets, '--repo', repo, '--draft', '--title', title, '--notes', notes], assetsDir);
  }
  await mustRun(run, 'gh', ['release', 'edit', tag, '--repo', repo, '--draft=false'], assetsDir);
}

export interface PublishOptions {
  /** The data repository's checkout, which holds `manifests/` and the state file. */
  readonly repoDir: string;
  readonly outDir: string;
  readonly assetsDir: string;
  /** The state file's path inside the repository, as the collector was given it. */
  readonly statePath: string;
  readonly day: string;
  readonly runNumber: string;
  /** The data repository, `owner/name`. */
  readonly repo: string;
  /** Where the collector code came from, for the release notes. */
  readonly collector: { readonly repo: string; readonly sha: string };
  readonly branch?: string | undefined;
  readonly attempts?: number | undefined;
  readonly author?: Author | undefined;
  readonly run?: Run | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly retryDelayMs?: number | undefined;
}

export interface PublishResult {
  readonly tag: string;
  readonly assets: readonly string[];
  readonly commit: string | null;
  readonly attempts: number;
}

/**
 * Data first, then the index that claims it: the release is fully published before the manifest and
 * state are committed, so the committed state can never promise data that was not stored.
 */
export async function publish(options: PublishOptions): Promise<PublishResult> {
  const { repoDir, outDir, assetsDir, statePath, day, runNumber, repo, collector } = options;
  const runId = `${day}-${runNumber}`;
  const tag = `corpus-${runId}`;
  const manifestPath = `manifests/${day.slice(0, 4)}/${runId}.json`;

  const staged = await stageAssets({ outDir, assetsDir, runId, statePath: resolve(repoDir, statePath), run: options.run });

  await publishRelease({
    repo,
    tag,
    assetsDir,
    assets: staged.names,
    title: `Corpus ${day} (run ${runNumber})`,
    notes: `Collected by ${collector.repo}@${collector.sha}. Manifest: ${manifestPath}`,
    run: options.run,
  });

  const pushed = await pushIndex({
    repoDir,
    files: [
      { path: manifestPath, source: staged.manifest },
      { path: statePath, source: staged.state },
    ],
    message: `corpus: ${runId}`,
    branch: options.branch,
    attempts: options.attempts,
    author: options.author,
    run: options.run,
    sleep: options.sleep,
    retryDelayMs: options.retryDelayMs,
  });

  return { tag, assets: staged.names, commit: pushed.commit, attempts: pushed.attempts };
}
