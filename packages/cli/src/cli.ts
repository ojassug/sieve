// The `sieve` commands. Everything is read from git objects at a revision (never the working
// tree), and everything printed is canonical JSON, so the same inputs give the same bytes.
//
// Exit codes: 0 success (a plan that fell back to running everything is a success: it must never
// block CI), 1 an error, 2 a usage error.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  buildStaticMap,
  canonicalJson,
  canonicalJsonPretty,
  diffLockfiles,
  GitVfs,
  isLexed,
  lsTree,
  MapError,
  merkleDiff,
  parseMap,
  readBlobs,
  readLockfile,
  readObjectFormat,
  repoRoot,
  runAll,
  selectStatic,
  TreeIndex,
  type LockfileState,
  type ObjectFormat,
  type Selection,
  type SieveMap,
} from '@sieve-ci/core';

import { parseCommand, planMode, USAGE, UsageError, type Command } from './args.ts';
import { CONFIG_FILE, ConfigError, discoverTests, parseConfig, rulesOf, type SieveConfig } from './config.ts';
import { buildReport, githubOutputs, summaryOf } from './report.ts';

export interface Io {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export async function run(argv: readonly string[], io: Io): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    return usage(error, io);
  }
  try {
    switch (command.name) {
      case 'help':
        io.stdout(USAGE);
        return 0;
      case 'version':
        io.stdout(`${version()}\n`);
        return 0;
      case 'graph':
        return await graph(command, io);
      case 'diff':
        return await diff(command, io);
      case 'plan':
        return await plan(command, io);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      return usage(error, io);
    }
    io.stderr(`sieve: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function usage(error: unknown, io: Io): number {
  io.stderr(`sieve: ${(error as Error).message}\nRun sieve --help for usage.\n`);
  return 2;
}

function version(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

interface Snapshot {
  readonly root: string;
  readonly rev: string;
  readonly objectFormat: ObjectFormat;
  readonly index: TreeIndex;
  readonly vfs: GitVfs;
  /** sieve.config.json at this revision. */
  readonly config: { readonly oid: string; readonly text: string } | null;
}

async function snapshotAt(root: string, rev: string): Promise<Snapshot> {
  const [objectFormat, listing] = await Promise.all([readObjectFormat(root), lsTree(root, rev)]);
  const index = TreeIndex.build(listing);
  const vfs = await GitVfs.load(root, index);
  const oid = vfs.kind(CONFIG_FILE) === 'file' ? vfs.oid(CONFIG_FILE) : null;
  return { root, rev, objectFormat, index, vfs, config: oid === null ? null : { oid, text: vfs.read(CONFIG_FILE) ?? '' } };
}

function configOf(snapshot: Snapshot): SieveConfig {
  return snapshot.config === null ? { version: 1 } : parseConfig(snapshot.config.text);
}

async function graph(command: Extract<Command, { name: 'graph' }>, io: Io): Promise<number> {
  const started = performance.now();
  const snapshot = await snapshotAt(await repoRoot(io.cwd), command.rev);
  const config = configOf(snapshot);
  const rules = rulesOf(config);
  const files = snapshot.vfs.files();
  const lexed = files.filter(isLexed);
  const blobs = await readBlobs(snapshot.root, lexed.map((path) => snapshot.vfs.oid(path)!));
  const sources = new Map(lexed.map((path) => [path, blobs.get(snapshot.vfs.oid(path)!)!]));
  const map = buildStaticMap({
    objectFormat: snapshot.objectFormat,
    index: snapshot.index,
    vfs: snapshot.vfs,
    sources,
    tests: discoverTests(files, config).tests,
    global: rules.global,
    declared: rules.declared,
    config: snapshot.config?.oid ?? null,
  });
  const text = `${canonicalJson(map)}\n`;
  if (command.out === null) {
    io.stdout(text);
  } else {
    const out = resolve(io.cwd, command.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  const edges = Object.values(map.edges).reduce((sum, out) => sum + Object.keys(out).length, 0);
  io.stderr(
    `sieve graph: ${files.length} files, ${lexed.length} lexed; ${Object.keys(map.nodes).length} nodes, ${edges} edges; ` +
      `${map.tests.length} tests, ${Object.keys(map.uncertain).length} uncertain files; ${text.length} bytes in ${Math.round(performance.now() - started)} ms\n`,
  );
  return 0;
}

async function diff(command: Extract<Command, { name: 'diff' }>, io: Io): Promise<number> {
  const root = await repoRoot(io.cwd);
  const [base, head] = await Promise.all([snapshotAt(root, command.base), snapshotAt(root, command.head)]);
  const delta = merkleDiff(base.index, head.index);
  const before = readLockfile(base.vfs);
  const after = readLockfile(head.vfs);
  const packages =
    before.kind === 'npm' && after.kind === 'npm'
      ? { before: before.path, after: after.path, ...diffLockfiles(before.lockfile, after.lockfile) }
      : { before: describe(before), after: describe(after), unknown: 'package changes are only computed between two npm lockfiles' };
  io.stdout(
    canonicalJsonPretty({
      base: { rev: command.base, rootTree: base.index.rootOid },
      head: { rev: command.head, rootTree: head.index.rootOid },
      files: delta.files,
      listings: delta.listings,
      packages,
    }),
  );
  return 0;
}

function describe(lockfile: LockfileState): string {
  return lockfile.kind === 'npm' ? lockfile.path : lockfile.kind === 'unparseable' ? `${lockfile.paths.join(', ')} (unparseable: ${lockfile.reason})` : 'none';
}

async function plan(command: Extract<Command, { name: 'plan' }>, io: Io): Promise<number> {
  const head = await snapshotAt(await repoRoot(io.cwd), command.head);
  let config: SieveConfig = { version: 1 };
  let fallback: string | undefined;
  try {
    config = configOf(head);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    fallback = error.message;
  }
  planMode(command, fallback === undefined ? config.selection?.mode : undefined);
  const rules = rulesOf(config);
  const { tests, notPlanned } = discoverTests(head.vfs.files(), config);
  const mapPath = `${command.map.replace(/[\\/]+$/, '')}/map.json`;

  let map: SieveMap | null = null;
  if (fallback === undefined) {
    try {
      map = parseMap(readFileSync(resolve(io.cwd, mapPath), 'utf8'));
    } catch (error) {
      if (error instanceof MapError) {
        fallback = `the map at ${mapPath} is invalid: ${error.message}`;
      } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        fallback = `no map at ${mapPath}`;
      } else {
        fallback = `the map at ${mapPath} cannot be read: ${(error as Error).message}`;
      }
    }
  }
  let selection: Selection;
  if (map === null) {
    selection = runAll(tests, fallback!);
  } else {
    try {
      const state = { objectFormat: head.objectFormat, index: head.index, vfs: head.vfs, tests, config: head.config?.oid ?? null };
      selection = selectStatic(map, state, { ignore: rules.ignore, alwaysRun: rules.alwaysRun });
    } catch (error) {
      // A bug must not block CI either: run everything and say why.
      io.stderr(`sieve: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      fallback = `internal error: ${error instanceof Error ? error.message : String(error)}`;
      selection = runAll(tests, fallback);
    }
  }

  const report = buildReport({
    selection,
    base: map === null ? null : { map: mapPath, rootTree: map.rootTree },
    head: { rev: command.head, rootTree: head.index.rootOid },
    ...(map === null ? {} : { uncertainCauses: map.uncertain }),
    notPlanned,
    shards: command.shards ?? rules.shards,
    ...(fallback === undefined ? {} : { fallback }),
  });
  io.stdout(canonicalJsonPretty(report));
  const outputs = io.env['GITHUB_OUTPUT'];
  if (outputs !== undefined && outputs !== '') {
    appendFileSync(outputs, githubOutputs(report));
  }
  const summary = io.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, summaryOf(report));
  }
  io.stderr(
    fallback === undefined
      ? `sieve plan: shadow mode runs all ${report.run.length} test files; static reachability would run ${report.wouldRun} and skip ${report.wouldSkip.length} (unproven)\n`
      : `sieve plan: running all ${report.run.length} test files: ${fallback}\n`,
  );
  return 0;
}
