// The static impact graph of one snapshot (architecture §3.1, §3.2), stored as the M1 map: canonical
// JSON at .sieve/map/map.json until SMAP replaces it. Every module file is lexed from its git blob,
// every import resolved, and everything a resolution recorded becomes an edge, so a test depends
// on every file, absent path, directory listing, glob, config and package that could change what
// it loads. What cannot be decided is not dropped: it becomes a `u:` node, always treated as changed
// (DECISIONS 22).
import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.ts';
import type { TreeIndex } from '../git/diff.ts';
import type { ObjectFormat } from '../git/git.ts';
import { dialectOf, lexImportsFromBytes, type ImportRecord } from '../lex/ts.ts';
import { detectLockfile, LOCKFILE_PATHS, parseNpmLockfile, type NpmLockfile } from '../lockfile/npm.ts';
import { matchGlobs } from '../resolve/glob.ts';
import { dirname, Resolver, type Resolution, type Vfs } from '../resolve/resolver.ts';
import { DECLARED, STATIC } from './graph.ts';

/** The map format; a map of another version is invalid (L3). */
export const MAP_VERSION = 1;
/** What builds the graph; a map built by another engine is invalid (L3), since its edges may differ. */
export const ENGINE = 'sieve-static-1';

const MODULE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
/** `.d.ts`, `.d.mts`, `.d.cts` and arbitrary-extension declarations such as `.d.css.ts`. */
const DECLARATION = /\.d\.(?:[^/]*\.)?[cm]?ts$/;

/** A JavaScript or TypeScript module, declaration files included. Every one is a graph node. */
export function isModule(path: string): boolean {
  return MODULE.test(path);
}

/** A module that runs, so its imports are edges. Declaration files never run (DECISIONS 22). */
export function isLexed(path: string): boolean {
  return MODULE.test(path) && !DECLARATION.test(path);
}

export type LockfileState =
  | { readonly kind: 'npm'; readonly path: string; readonly lockfile: NpmLockfile }
  | { readonly kind: 'unparseable'; readonly paths: readonly string[]; readonly reason: string }
  | { readonly kind: 'none' };

/** The root lockfile of a snapshot: parsed when it is npm's, else every lockfile present. */
export function readLockfile(vfs: Vfs): LockfileState {
  const present = LOCKFILE_PATHS.filter((path) => vfs.kind(path) === 'file' || vfs.kind(path) === 'symlink').sort(compareStrings);
  const detected = detectLockfile(new Set(present));
  if (detected.kind === 'none') {
    return { kind: 'none' };
  }
  if (detected.kind === 'npm') {
    const parsed = parseNpmLockfile(vfs.read(detected.path) ?? '');
    return parsed.kind === 'npm' ? { kind: 'npm', path: detected.path, lockfile: parsed } : { kind: 'unparseable', paths: present, reason: parsed.reason };
  }
  return { kind: 'unparseable', paths: present, reason: detected.reason };
}

export type MapLockfile = { readonly kind: 'npm'; readonly path: string } | { readonly kind: 'unparseable'; readonly paths: readonly string[]; readonly reason: string } | { readonly kind: 'none' };

export interface SieveMap {
  readonly version: number;
  readonly engine: string;
  readonly objectFormat: ObjectFormat;
  readonly rootTree: string;
  /** Paths that are not valid UTF-8; non-zero makes every plan from this map run everything. */
  readonly undecodable: number;
  /** The blob id of sieve.config.json, or null without one. */
  readonly config: string | null;
  readonly lockfile: MapLockfile;
  /** Every `ls-tree -r -t` entry as [mode, oid, path], sorted by path: the base of the next diff. */
  readonly snapshot: readonly (readonly [string, string, string])[];
  /** Node key → hash; null is ⊥, a path or package that does not exist. */
  readonly nodes: Readonly<Record<string, string | null>>;
  /** Adjacency: dependent → { dependency → provenance bits }. */
  readonly edges: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The patterns behind each pattern-based g: node; `g:workspaces` is recomputed by the resolver. */
  readonly globs: Readonly<Record<string, readonly string[]>>;
  readonly tests: readonly string[];
  /** `u:` node → why the file is uncertain. */
  readonly uncertain: Readonly<Record<string, readonly string[]>>;
}

export interface DeclaredRule {
  readonly match: string;
  readonly affects: string;
}

export interface StaticInput {
  readonly objectFormat: ObjectFormat;
  readonly index: TreeIndex;
  /** The same snapshot as `index`, for the resolver. */
  readonly vfs: Vfs;
  /** Blob bytes of every file `isLexed` accepts. */
  readonly sources: ReadonlyMap<string, Uint8Array>;
  readonly tests: readonly string[];
  /** `inputs.global` patterns: every test depends on what they match. */
  readonly global?: readonly string[];
  readonly declared?: readonly DeclaredRule[];
  /** Environment components (see `environment`); every test depends on each. */
  readonly env?: Readonly<Record<string, string | null>>;
  readonly config?: string | null;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The hash of an `f:` node: the blob id, prefixed by the mode unless it is a regular file. */
export function fileHash(index: TreeIndex, path: string): string | null {
  const entry = index.entry(path);
  if (entry === undefined || entry.type === 'tree') {
    return null;
  }
  return entry.mode === '100644' ? entry.oid : `${entry.mode}:${entry.oid}`;
}

/** The hash of a `d:` node: SHA-256 of the sorted names and kinds; null for a missing directory. */
export function listingHash(index: TreeIndex, dir: string): string | null {
  const listing = index.listing(dir);
  return listing === null ? null : sha256(canonicalJson(listing));
}

/** The hash of a `g:` node: SHA-256 of the sorted matches. */
export function globHash(matches: readonly string[]): string {
  return sha256(canonicalJson([...matches].sort(compareStrings)));
}

/** The hash of an `e:` node; values are hashed so the map never holds environment values. */
export function envHash(value: string | null): string | null {
  return value === null ? null : sha256(value);
}

/** Environment components: Node major.minor, OS and architecture, and each tracked variable. */
export function environment(track: readonly string[], proc: Pick<NodeJS.Process, 'versions' | 'platform' | 'arch' | 'env'> = process): Record<string, string | null> {
  const [major, minor] = proc.versions.node.split('.');
  const env: Record<string, string | null> = { runtime: `node ${major ?? ''}.${minor ?? ''}`, platform: `${proc.platform}-${proc.arch}` };
  for (const name of track) {
    env[`env/${name}`] = proc.env[name] ?? null;
  }
  return env;
}

class MapBuilder {
  readonly nodes = new Map<string, string | null>();
  readonly edges = new Map<string, Map<string, number>>();
  readonly globs = new Map<string, readonly string[]>();
  readonly causes = new Map<string, string[]>();
  private readonly index: TreeIndex;

  constructor(index: TreeIndex) {
    this.index = index;
  }

  node(key: string, hash: string | null): string {
    if (!this.nodes.has(key)) {
      this.nodes.set(key, hash);
    }
    return key;
  }

  file(path: string): string {
    return this.node(`f:${path}`, fileHash(this.index, path));
  }

  dir(path: string): string {
    return this.node(`d:${path}`, listingHash(this.index, path));
  }

  glob(key: string, matches: readonly string[], patterns?: readonly string[]): string {
    if (patterns !== undefined) {
      this.globs.set(key, patterns);
    }
    return this.node(key, globHash(matches));
  }

  edge(from: string, to: string, provenance: number): void {
    let out = this.edges.get(from);
    if (out === undefined) {
      out = new Map();
      this.edges.set(from, out);
    }
    out.set(to, (out.get(to) ?? 0) | provenance);
  }

  uncertain(path: string, cause: string): void {
    const list = this.causes.get(path) ?? [];
    list.push(cause);
    this.causes.set(path, list);
  }
}

export function buildStaticMap(input: StaticInput): SieveMap {
  const { index, vfs } = input;
  const resolver = new Resolver(vfs);
  const lockfile = readLockfile(vfs);
  const b = new MapBuilder(index);
  const files = vfs.files();

  // Packages first, so a missing dependency's ⊥ node can never shadow an installed one.
  if (lockfile.kind === 'npm') {
    for (const [location, pkg] of lockfile.lockfile.packages) {
      const from = b.node(`p:npm:${location}`, pkg.hash);
      const { resolved, missing } = lockfile.lockfile.dependencies(location);
      for (const dependency of resolved) {
        b.edge(from, `p:npm:${dependency}`, STATIC);
      }
      for (const name of missing) {
        b.edge(from, b.node(`p:npm:node_modules/${name}`, null), STATIC);
      }
    }
  }

  for (const path of files) {
    if (isModule(path)) {
      b.file(path);
    }
  }
  for (const path of files) {
    if (!isLexed(path)) {
      continue;
    }
    const bytes = input.sources.get(path);
    if (bytes === undefined) {
      throw new Error(`static graph: no source bytes for ${path}`);
    }
    const from = b.file(path);
    const own = resolver.fileConfigs(path);
    for (const config of [...own.configs, ...own.absent]) {
      b.edge(from, b.file(config), STATIC);
    }
    const lexed = lexImportsFromBytes(bytes, dialectOf(path));
    for (const diagnostic of lexed.diagnostics) {
      b.uncertain(path, `line ${diagnostic.line}: lexer ${diagnostic.code}`);
    }
    for (const record of lexed.imports) {
      if (record.typeOnly === true) {
        continue; // `import type` and `export type` are erased in every configuration
      }
      const resolution = resolver.resolve({
        from: path,
        specifier: record.specifier,
        kind: record.kind,
        patterns: record.patterns ?? null,
        ...(record.base === undefined ? {} : { base: record.base }),
      });
      addResolution(b, from, path, record, resolution, lockfile);
    }
  }

  const globalKey = input.global !== undefined && input.global.length > 0 ? b.glob('g:inputs.global', matchGlobs(files, input.global), input.global) : null;
  if (globalKey !== null) {
    for (const match of matchGlobs(files, input.global!)) {
      b.edge(globalKey, b.file(match), DECLARED);
    }
  }
  const env = Object.entries(input.env ?? {}).map(([name, value]) => b.node(`e:${name}`, envHash(value)));
  const declared = (input.declared ?? []).map((rule) => {
    const matches = matchGlobs(files, [rule.match]);
    const key = b.glob(`g:declared:${rule.match}`, matches, [rule.match]);
    for (const match of matches) {
      b.edge(key, b.file(match), DECLARED);
    }
    return { key, affects: rule.affects };
  });
  const tests = [...new Set(input.tests)].sort(compareStrings);
  for (const test of tests) {
    const from = b.file(test);
    if (globalKey !== null) {
      b.edge(from, globalKey, DECLARED);
    }
    for (const key of env) {
      b.edge(from, key, DECLARED);
    }
    for (const rule of declared) {
      if (matchGlobs([test], [rule.affects]).length > 0) {
        b.edge(from, rule.key, DECLARED);
      }
    }
  }

  const uncertain: Record<string, string[]> = {};
  for (const [path, causes] of b.causes) {
    const key = b.node(`u:${path}`, sha256(canonicalJson(causes)));
    b.edge(`f:${path}`, key, STATIC);
    uncertain[key] = causes;
  }

  return {
    version: MAP_VERSION,
    engine: ENGINE,
    objectFormat: input.objectFormat,
    rootTree: index.rootOid,
    undecodable: index.undecodable,
    config: input.config ?? null,
    lockfile: lockfile.kind === 'npm' ? { kind: 'npm', path: lockfile.path } : lockfile,
    snapshot: index.entries().map((entry) => [entry.mode, entry.oid, entry.path] as const),
    nodes: Object.fromEntries(b.nodes),
    edges: Object.fromEntries([...b.edges].map(([from, out]) => [from, Object.fromEntries(out)])),
    globs: Object.fromEntries(b.globs),
    tests,
    uncertain,
  };
}

function addResolution(b: MapBuilder, from: string, path: string, record: ImportRecord, resolution: Resolution, lockfile: LockfileState): void {
  for (const target of resolution.targets) {
    b.edge(from, b.file(target), STATIC);
  }
  for (const absent of resolution.absent) {
    b.edge(from, b.file(absent), STATIC);
  }
  for (const dir of resolution.dirs) {
    b.edge(from, b.dir(dir), STATIC);
  }
  for (const config of resolution.configs) {
    b.edge(from, b.file(config), STATIC);
  }
  for (const glob of resolution.globs) {
    const key = glob.patterns === undefined ? `g:${glob.key}` : `g:glob:${glob.key}`;
    b.edge(from, b.glob(key, glob.matches, glob.patterns), STATIC);
  }

  const label = record.specifier ?? `a ${record.kind} import with a non-literal specifier`;
  const where = `line ${record.line}`;
  if (resolution.kind === 'unresolved') {
    b.uncertain(path, `${where}: ${label} is unresolved (${resolution.reason ?? 'unknown'})`);
  } else if (resolution.uncertain === true) {
    b.uncertain(path, `${where}: ${label} depends on a config that cannot be read`);
  }
  const name = resolution.packageName;
  if (name === undefined) {
    return;
  }
  // A bare specifier may load from node_modules even when tsconfig paths also found a file.
  const onlyPackage = resolution.kind === 'external';
  if (lockfile.kind === 'npm') {
    const location = lockfile.lockfile.locate(name, dirname(path));
    if (location !== null) {
      b.edge(from, `p:npm:${location}`, STATIC);
      return;
    }
    b.edge(from, b.node(`p:npm:node_modules/${name}`, null), STATIC);
    if (onlyPackage) {
      b.uncertain(path, `${where}: ${name} is not in ${lockfile.path}`);
    }
  } else if (lockfile.kind === 'unparseable') {
    for (const lock of lockfile.paths) {
      b.edge(from, b.file(lock), STATIC);
    }
  } else if (onlyPackage) {
    b.uncertain(path, `${where}: ${name}: there is no lockfile`);
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
