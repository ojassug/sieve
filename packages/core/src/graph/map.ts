// Reading the M1 map back. A map is input from a cache that may be stale, truncated or written by
// another version, so every field is checked; anything wrong is a MapError, which the CLI turns
// into a run-all plan (L3, architecture §3.5) instead of a guess.
import { GraphBuilder, type Graph } from './graph.ts';
import { ENGINE, MAP_VERSION, type MapLockfile, type SieveMap } from './static.ts';

export class MapError extends Error {
  override readonly name = 'MapError';
}

const OID = { sha1: /^[0-9a-f]{40}$/, sha256: /^[0-9a-f]{64}$/ } as const;

export function parseMap(text: string): SieveMap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MapError('the map is not JSON');
  }
  const map = record(raw, 'the map');
  if (map['version'] !== MAP_VERSION) {
    throw new MapError(`the map has version ${JSON.stringify(map['version'])}, expected ${MAP_VERSION}`);
  }
  if (map['engine'] !== ENGINE) {
    throw new MapError(`the map was built by engine ${JSON.stringify(map['engine'])}, expected ${ENGINE}`);
  }
  const objectFormat = map['objectFormat'];
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new MapError(`objectFormat must be sha1 or sha256, not ${JSON.stringify(objectFormat)}`);
  }
  const rootTree = map['rootTree'];
  if (typeof rootTree !== 'string' || !OID[objectFormat].test(rootTree)) {
    throw new MapError(`rootTree is not a ${objectFormat} object id`);
  }
  const undecodable = map['undecodable'];
  if (typeof undecodable !== 'number' || !Number.isInteger(undecodable) || undecodable < 0) {
    throw new MapError('undecodable must be a count');
  }
  const config = map['config'];
  if (config !== null && typeof config !== 'string') {
    throw new MapError('config must be a blob id or null');
  }

  const snapshot = list(map['snapshot'], 'snapshot').map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 3 || !entry.every((part) => typeof part === 'string')) {
      throw new MapError(`snapshot[${i}] must be [mode, oid, path]`);
    }
    return entry as [string, string, string];
  });
  const nodes = record(map['nodes'], 'nodes');
  for (const [key, hash] of Object.entries(nodes)) {
    if (hash !== null && typeof hash !== 'string') {
      throw new MapError(`node ${key} must have a string or null hash`);
    }
  }
  const has = (key: string): boolean => Object.hasOwn(nodes, key);
  const edges = record(map['edges'], 'edges');
  for (const [from, out] of Object.entries(edges)) {
    if (!has(from)) {
      throw new MapError(`edges start at ${from}, which is not a node`);
    }
    for (const [to, provenance] of Object.entries(record(out, `edges of ${from}`))) {
      if (!has(to)) {
        throw new MapError(`an edge from ${from} ends at ${to}, which is not a node`);
      }
      if (typeof provenance !== 'number' || !Number.isInteger(provenance) || provenance < 1 || provenance > 7) {
        throw new MapError(`the edge ${from} -> ${to} has provenance ${JSON.stringify(provenance)}`);
      }
    }
  }
  const globs = record(map['globs'], 'globs');
  for (const [key, patterns] of Object.entries(globs)) {
    if (!has(key) || !list(patterns, `globs of ${key}`).every((p) => typeof p === 'string')) {
      throw new MapError(`globs of ${key} must be patterns of a g: node`);
    }
  }
  const tests = list(map['tests'], 'tests');
  for (const test of tests) {
    if (typeof test !== 'string' || !has(`f:${test}`)) {
      throw new MapError(`test ${JSON.stringify(test)} is not a node`);
    }
  }
  const uncertain = record(map['uncertain'], 'uncertain');
  for (const [key, causes] of Object.entries(uncertain)) {
    if (!key.startsWith('u:') || !has(key) || !list(causes, `causes of ${key}`).every((c) => typeof c === 'string')) {
      throw new MapError(`uncertain ${key} must list causes of a u: node`);
    }
  }
  // A plan seeds every u: node; causes and nodes must agree, or a damaged map could hide one.
  for (const key of Object.keys(nodes)) {
    if (key.startsWith('u:') && !Object.hasOwn(uncertain, key)) {
      throw new MapError(`node ${key} has no causes in uncertain`);
    }
  }
  return {
    version: MAP_VERSION,
    engine: ENGINE,
    objectFormat,
    rootTree,
    undecodable,
    config,
    lockfile: lockfile(map['lockfile']),
    snapshot,
    nodes: nodes as Record<string, string | null>,
    edges: edges as Record<string, Record<string, number>>,
    globs: globs as Record<string, string[]>,
    tests: tests as string[],
    uncertain: uncertain as Record<string, string[]>,
  };
}

/** The map's graph; node ids follow sorted key order whatever order the map was written in. */
export function mapGraph(map: SieveMap): Graph {
  const builder = new GraphBuilder();
  for (const key of Object.keys(map.nodes)) {
    builder.addNode(key);
  }
  for (const [from, out] of Object.entries(map.edges)) {
    for (const [to, provenance] of Object.entries(out)) {
      builder.addEdge(from, to, provenance);
    }
  }
  return builder.build();
}

function lockfile(value: unknown): MapLockfile {
  const raw = record(value, 'lockfile');
  if (raw['kind'] === 'none') {
    return { kind: 'none' };
  }
  if (raw['kind'] === 'npm' && typeof raw['path'] === 'string') {
    return { kind: 'npm', path: raw['path'] };
  }
  const paths = raw['paths'];
  if (raw['kind'] === 'unparseable' && typeof raw['reason'] === 'string' && Array.isArray(paths) && paths.every((p) => typeof p === 'string')) {
    return { kind: 'unparseable', paths, reason: raw['reason'] };
  }
  throw new MapError('lockfile is malformed');
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MapError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MapError(`${what} must be an array`);
  }
  return value;
}
