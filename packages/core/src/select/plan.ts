// Static selection (architecture §3.3 steps 1–4, §3.5) from a base map S to a head snapshot H. With
// no records, nothing here proves a skip safe (ADR-0005, kickoff gap 1): the would-skip set is
// unproven static reachability, reported in shadow mode only.
//
// Δ(S,H): files and listings come from the Merkle descent against the snapshot stored in the map;
// g: and p: nodes are recomputed at H and compared. Every u: node is always a seed. What the
// graph cannot see escalates, and a map or input that cannot be trusted runs everything (L3).
//
// Unmapped inputs (L1, ADR-0005, DECISIONS 29): a changed file that is not a node, and a changed
// node that no test of the map reaches. Something outside the graph may still read it: a child
// process, the runner's main process, a CI step. Every node of its owning package (the deepest
// workspace member that holds it, else the root) then counts as changed, so the escalation follows
// dependencies into other packages and each test it forces gets a why-path. `inputs.ignore`
// exempts both kinds by path, and the plan lists what it exempted.
//
// The environment is no part of this (ADR-0003, DECISIONS 28). A plan is a function of the map,
// the head tree and the config; whether a record fits the machine that runs a test is checked in
// that job, once records exist (ADR-0005).
import { merkleDiff, TreeIndex, type FileChange } from '../git/diff.ts';
import type { ObjectFormat } from '../git/git.ts';
import type { ObjectType } from '../git/ls-tree.ts';
import { forwardReach, reverseReach, whyPath } from '../graph/graph.ts';
import { mapGraph } from '../graph/map.ts';
import { globHash, isModule, readLockfile, type LockfileState, type MapLockfile, type SieveMap } from '../graph/static.ts';
import { LOCKFILE_PATHS } from '../lockfile/npm.ts';
import { matchGlobs } from '../resolve/glob.ts';
import { Resolver, type Vfs } from '../resolve/resolver.ts';

/** Changes to this file are an L3: it defines the tests and the rules themselves. */
export const CONFIG_PATH = 'sieve.config.json';

export interface HeadState {
  readonly objectFormat: ObjectFormat;
  readonly index: TreeIndex;
  readonly vfs: Vfs;
  readonly tests: readonly string[];
  /** The blob id of sieve.config.json at H, or null. */
  readonly config: string | null;
}

export interface PlanRules {
  /** Unmapped inputs that never escalate (`inputs.ignore`), matched against their paths. */
  readonly ignore?: readonly string[];
  /** Tests that always run (`selection.alwaysRun`). */
  readonly alwaysRun?: readonly string[];
}

export interface Escalation {
  readonly level: 'L1' | 'L3';
  readonly cause: string;
  /** For L1: the owning package directory ('' is the repository root). */
  readonly scope?: string;
}

export interface Selection {
  /** Every test at H, sorted. */
  readonly tests: readonly string[];
  /** Nodes whose hash differs between S and H, sorted. */
  readonly changed: readonly string[];
  /** `u:` nodes, seeds on every plan. */
  readonly uncertain: readonly string[];
  readonly escalations: readonly Escalation[];
  /** Tests that reach a seed, each with a shortest path from the test to it. */
  readonly affected: readonly { readonly test: string; readonly path: readonly string[] }[];
  /**
   * Tests that run for another reason: new, `alwaysRun`, or an escalation. An L1 test has a path
   * from the test to a node of the escalated package.
   */
  readonly forced: readonly { readonly test: string; readonly reason: string; readonly path?: readonly string[] }[];
  /** The rest: unproven static reachability, never a safe skip in M1. */
  readonly wouldSkip: readonly string[];
  /** Paths of unmapped inputs that `inputs.ignore` exempted from L1, sorted. */
  readonly ignored: readonly string[];
}

export function selectStatic(map: SieveMap, head: HeadState, rules: PlanRules): Selection {
  const tests = [...new Set(head.tests)].sort(compareStrings);
  const headLockfile = readLockfile(head.vfs);
  const fatal = untrusted(map, head, headLockfile);
  if (fatal !== null) {
    return runAll(tests, fatal);
  }
  const base = TreeIndex.build({
    rootOid: map.rootTree,
    entries: map.snapshot.map(([mode, oid, path]) => ({ mode, oid, path, type: typeOf(mode) })),
  });
  const delta = merkleDiff(base, head.index);
  const lockfileChange = unparseableLockfileChange(map.lockfile, headLockfile, delta.files);
  if (lockfileChange !== null) {
    return runAll(tests, lockfileChange);
  }

  const changed = new Set<string>();
  for (const change of delta.files) {
    if (Object.hasOwn(map.nodes, `f:${change.path}`)) {
      changed.add(`f:${change.path}`);
    }
  }
  for (const dir of delta.listings) {
    if (Object.hasOwn(map.nodes, `d:${dir}`)) {
      changed.add(`d:${dir}`);
    }
  }
  for (const key of recomputedChanges(map, head, headLockfile)) {
    changed.add(key);
  }
  // Every u: node, not only those with causes: a damaged map must not hide one.
  const uncertain = Object.keys(map.nodes).filter((key) => key.startsWith('u:')).sort(compareStrings);

  const resolver = new Resolver(head.vfs);
  const escalations: Escalation[] = [];
  const ignored = new Set<string>();
  const ignore = rules.ignore ?? [];
  const exempt = (path: string): boolean => {
    if (matchGlobs([path], ignore).length === 0) {
      return false;
    }
    ignored.add(path);
    return true;
  };
  const globbed = Object.values(map.globs);
  for (const change of delta.files) {
    const { path, kind } = change;
    const handled = Object.hasOwn(map.nodes, `f:${path}`) || path === CONFIG_PATH || LOCKFILE_PATHS.includes(path);
    // A new module nothing loaded at S can only matter through probes and listings already in Δ, and
    // a new file that a glob of the map matches shows in Δ as that glob's changed hash.
    const seen = kind === 'added' && (isModule(path) || globbed.some((patterns) => matchGlobs([path], patterns).length > 0));
    if (handled || seen || exempt(path)) {
      continue;
    }
    escalations.push({ level: 'L1', scope: resolver.packageOf(path), cause: `${path} was ${kind} and is not in the graph` });
  }

  const graph = mapGraph(map);
  // A changed node that no test of the map reaches is an unmapped input. The map's tests, not H's:
  // a deleted test reaches its own node. A u: node is never in `changed`; it is a seed regardless.
  const tested = forwardReach(graph, map.tests.map((test) => graph.id(`f:${test}`)!));
  for (const key of [...changed].sort(compareStrings)) {
    if (tested[graph.id(key)!] === 1) {
      continue;
    }
    const path = pathOf(key);
    if (path !== null && exempt(path)) {
      continue;
    }
    // A glob has no path of its own, and its matches can lie anywhere: it belongs to the root.
    const scope = path === null ? '' : resolver.packageOf(path);
    escalations.push({ level: 'L1', scope, cause: `${key.startsWith('f:') ? path! : key} changed and no test reaches it` });
  }

  const seeds = [...changed, ...uncertain].map((key) => graph.id(key)!);
  const reach = reverseReach(graph, seeds);
  const scopes = [...new Set(escalations.map((escalation) => escalation.scope!))];
  const packageNodes = Object.keys(map.nodes).filter((key) => {
    const path = pathOf(key);
    return path !== null && scopes.some((scope) => within(path, scope));
  });
  const escalated = reverseReach(graph, packageNodes.map((key) => graph.id(key)!));
  const known = new Set(map.tests);
  const affected: { test: string; path: string[] }[] = [];
  const forced: { test: string; reason: string; path?: string[] }[] = [];
  const alwaysRun = rules.alwaysRun ?? [];
  for (const test of tests) {
    const id = known.has(test) ? graph.id(`f:${test}`) : undefined;
    const path = id === undefined ? null : whyPath(reach, id);
    if (path !== null) {
      affected.push({ test, path: path.reverse().map((node) => graph.name(node)) });
      continue;
    }
    if (id === undefined) {
      forced.push({ test, reason: 'new test file' });
    } else if (matchGlobs([test], alwaysRun).length > 0) {
      forced.push({ test, reason: 'alwaysRun' });
    } else {
      const l1 = whyPath(escalated, id)?.reverse().map((node) => graph.name(node));
      if (l1 !== undefined) {
        const end = pathOf(l1.at(-1)!)!;
        const escalation = escalations.find(({ scope }) => within(end, scope!))!;
        forced.push({ test, reason: `L1: ${escalation.cause}`, path: l1 });
      }
    }
  }
  const running = new Set([...affected.map((a) => a.test), ...forced.map((f) => f.test)]);
  return {
    tests,
    changed: [...changed].sort(compareStrings),
    uncertain,
    escalations,
    affected,
    forced,
    wouldSkip: tests.filter((test) => !running.has(test)),
    ignored: [...ignored].sort(compareStrings),
  };
}

/** The repository path a node stands for: a file, directory or package location; null for a glob. */
function pathOf(key: string): string | null {
  if (key.startsWith('f:') || key.startsWith('d:') || key.startsWith('u:')) {
    return key.slice(2);
  }
  return key.startsWith('p:npm:') ? key.slice('p:npm:'.length) : null;
}

/** Whether `path` is the package directory `scope` or below it; '' holds everything. */
function within(path: string, scope: string): boolean {
  return scope === '' || path === scope || path.startsWith(`${scope}/`);
}

/** A plan that runs every test for one L3 cause. */
export function runAll(tests: readonly string[], cause: string): Selection {
  const sorted = [...new Set(tests)].sort(compareStrings);
  return {
    tests: sorted,
    changed: [],
    uncertain: [],
    escalations: [{ level: 'L3', cause }],
    affected: [],
    forced: sorted.map((test) => ({ test, reason: `L3: ${cause}` })),
    wouldSkip: [],
    ignored: [],
  };
}

/** Why the map cannot be compared with H at all, or null. */
function untrusted(map: SieveMap, head: HeadState, lockfile: LockfileState): string | null {
  if (map.objectFormat !== head.objectFormat) {
    return `the map is for ${map.objectFormat} objects, the repository uses ${head.objectFormat}`;
  }
  if (map.undecodable > 0 || head.index.undecodable > 0) {
    return 'a path in the repository is not valid UTF-8';
  }
  if (map.config !== head.config) {
    return `${CONFIG_PATH} changed`;
  }
  if (lockfile.kind !== 'unparseable' && describe(map.lockfile) !== describe(lockfile)) {
    return `the lockfile changed from ${describe(map.lockfile)} to ${describe(lockfile)}`;
  }
  return null;
}

/** An unparseable lockfile is an L3 once it changes (§3.5): which packages changed is unknowable. */
function unparseableLockfileChange(before: MapLockfile, after: LockfileState, files: readonly FileChange[]): string | null {
  if (after.kind !== 'unparseable') {
    return null;
  }
  const changed = files.some((change) => after.paths.includes(change.path));
  if (before.kind === 'unparseable' && describe(before) === describe(after) && !changed) {
    return null;
  }
  return `${after.paths.join(', ')} changed and cannot be parsed (${after.reason})`;
}

function describe(lockfile: MapLockfile | LockfileState): string {
  return lockfile.kind === 'npm' ? lockfile.path : lockfile.kind === 'unparseable' ? lockfile.paths.join(', ') : 'none';
}

/** g: and p: nodes whose hash at H differs from the map's. */
function recomputedChanges(map: SieveMap, head: HeadState, lockfile: LockfileState): string[] {
  const changed: string[] = [];
  const packages = lockfile.kind === 'npm' ? lockfile.lockfile.packages : new Map<string, { hash: string }>();
  let files: readonly string[] | null = null;
  for (const [key, hash] of Object.entries(map.nodes)) {
    let now: string | null | undefined;
    if (key === 'g:workspaces') {
      now = globHash(new Resolver(head.vfs).workspaces().names);
    } else if (key.startsWith('g:')) {
      const patterns = map.globs[key];
      files ??= head.vfs.files();
      now = patterns === undefined ? undefined : globHash(matchGlobs(files, patterns));
    } else if (key.startsWith('p:npm:')) {
      now = packages.get(key.slice('p:npm:'.length))?.hash ?? null;
    } else {
      continue;
    }
    if (now !== hash) {
      changed.push(key);
    }
  }
  // A new install location can shadow another copy of the same package for some importers, so it
  // changes every copy of that name in the map.
  const added = new Set<string>();
  for (const location of packages.keys()) {
    if (!Object.hasOwn(map.nodes, `p:npm:${location}`)) {
      added.add(packageName(location));
    }
  }
  if (added.size > 0) {
    for (const key of Object.keys(map.nodes)) {
      if (key.startsWith('p:npm:') && added.has(packageName(key))) {
        changed.push(key);
      }
    }
  }
  return changed;
}

/** The name Node's lookup uses: the path after the last `node_modules/`. */
function packageName(location: string): string {
  return location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

function typeOf(mode: string): ObjectType {
  return mode === '040000' ? 'tree' : mode === '160000' ? 'commit' : 'blob';
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
