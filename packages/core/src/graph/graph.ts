// The impact graph (architecture §3.2, §3.3): nodes are interned names, edges point from a
// dependent to what it depends on, each with a provenance bitmask. Adjacency is stored as CSR in
// typed arrays, forward and reverse. Node ids follow sorted name order, so the same graph built in
// any order has identical arrays, BFS order and why-paths.

/** Edge provenance bits; one edge can carry several when sources agree. */
export const STATIC = 1;
export const DYNAMIC = 2;
export const DECLARED = 4;
const ALL_PROVENANCE = STATIC | DYNAMIC | DECLARED;

export class GraphBuilder {
  private readonly ids = new Map<string, number>();
  private readonly from: number[] = [];
  private readonly to: number[] = [];
  private readonly provenance: number[] = [];

  addNode(name: string): number {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.ids.size;
      this.ids.set(name, id);
    }
    return id;
  }

  /** `from` depends on `to`. */
  addEdge(from: string, to: string, provenance: number): void {
    if (provenance === 0 || (provenance & ~ALL_PROVENANCE) !== 0) {
      throw new RangeError(`edge ${from} -> ${to} needs a provenance of STATIC, DYNAMIC and/or DECLARED`);
    }
    this.from.push(this.addNode(from));
    this.to.push(this.addNode(to));
    this.provenance.push(provenance);
  }

  build(): Graph {
    const names = [...this.ids.keys()].sort(compareStrings);
    const remap = new Uint32Array(names.length);
    names.forEach((name, id) => {
      remap[this.ids.get(name)!] = id;
    });

    // Edges keyed (from, to) in the canonical numbering, duplicates merged by OR-ing provenance.
    const merged = new Map<number, number>();
    const n = names.length;
    for (let e = 0; e < this.from.length; e++) {
      const key = remap[this.from[e]!]! * n + remap[this.to[e]!]!;
      merged.set(key, (merged.get(key) ?? 0) | this.provenance[e]!);
    }
    const keys = [...merged.keys()].sort((a, b) => a - b);

    const forwardOffsets = new Uint32Array(n + 1);
    const forwardTargets = new Uint32Array(keys.length);
    const forwardProvenance = new Uint8Array(keys.length);
    const reverseOffsets = new Uint32Array(n + 1);
    keys.forEach((key, e) => {
      forwardOffsets[Math.floor(key / n) + 1]!++;
      reverseOffsets[(key % n) + 1]!++;
      forwardTargets[e] = key % n;
      forwardProvenance[e] = merged.get(key)!;
    });
    for (let v = 0; v < n; v++) {
      forwardOffsets[v + 1]! += forwardOffsets[v]!;
      reverseOffsets[v + 1]! += reverseOffsets[v]!;
    }
    // Keys are sorted by source, so each reverse bucket fills in ascending source order.
    const reverseSources = new Uint32Array(keys.length);
    const reverseProvenance = new Uint8Array(keys.length);
    const fill = reverseOffsets.slice(0, n);
    for (const key of keys) {
      const slot = fill[key % n]!++;
      reverseSources[slot] = Math.floor(key / n);
      reverseProvenance[slot] = merged.get(key)!;
    }
    return new Graph(names, forwardOffsets, forwardTargets, forwardProvenance, reverseOffsets, reverseSources, reverseProvenance);
  }
}

export class Graph {
  readonly nodeCount: number;
  readonly edgeCount: number;
  private readonly names: readonly string[];
  private readonly index: ReadonlyMap<string, number>;
  /** @internal CSR arrays; exposed read-only through the accessors below. */
  readonly fwdOffsets: Uint32Array;
  readonly fwdTargets: Uint32Array;
  readonly fwdProvenance: Uint8Array;
  readonly revOffsets: Uint32Array;
  readonly revSources: Uint32Array;
  readonly revProvenance: Uint8Array;

  constructor(
    names: readonly string[],
    fwdOffsets: Uint32Array,
    fwdTargets: Uint32Array,
    fwdProvenance: Uint8Array,
    revOffsets: Uint32Array,
    revSources: Uint32Array,
    revProvenance: Uint8Array,
  ) {
    this.names = names;
    this.index = new Map(names.map((name, id) => [name, id]));
    this.nodeCount = names.length;
    this.edgeCount = fwdTargets.length;
    this.fwdOffsets = fwdOffsets;
    this.fwdTargets = fwdTargets;
    this.fwdProvenance = fwdProvenance;
    this.revOffsets = revOffsets;
    this.revSources = revSources;
    this.revProvenance = revProvenance;
  }

  name(id: number): string {
    const name = this.names[id];
    if (name === undefined) {
      throw new RangeError(`no node ${id}`);
    }
    return name;
  }

  id(name: string): number | undefined {
    return this.index.get(name);
  }

  /** What `id` depends on, ascending. */
  dependencies(id: number): number[] {
    return [...this.fwdTargets.subarray(this.fwdOffsets[id], this.fwdOffsets[id + 1])];
  }

  dependencyProvenance(id: number): number[] {
    return [...this.fwdProvenance.subarray(this.fwdOffsets[id], this.fwdOffsets[id + 1])];
  }

  /** What depends on `id`, ascending. */
  dependents(id: number): number[] {
    return [...this.revSources.subarray(this.revOffsets[id], this.revOffsets[id + 1])];
  }

  forwardTargets(): Uint32Array {
    return this.fwdTargets.slice();
  }

  reverseSources(): Uint32Array {
    return this.revSources.slice();
  }
}

export interface Reach {
  /** 1 for every node that is a seed or transitively depends on one. */
  readonly reached: Uint8Array;
  /** For a reached non-seed node, the neighbour one hop closer to a seed; -1 otherwise. */
  readonly parent: Int32Array;
  /** Reached nodes in BFS order, seeds first (ascending). */
  readonly order: Uint32Array;
}

/**
 * Multi-source reverse BFS: everything that depends, directly or transitively, on any seed.
 * O(seeds + reached edges). First discovery wins, with seeds and neighbours in ascending id order,
 * so parents give a shortest path to the lowest-numbered nearest seed.
 */
export function reverseReach(graph: Graph, seeds: Iterable<number>): Reach {
  const n = graph.nodeCount;
  const reached = new Uint8Array(n);
  const parent = new Int32Array(n).fill(-1);
  const queue = new Uint32Array(n);
  let tail = 0;
  for (const seed of [...new Set(seeds)].sort((a, b) => a - b)) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= n) {
      throw new RangeError(`seed ${seed} is not a node`);
    }
    reached[seed] = 1;
    queue[tail++] = seed;
  }
  const { revOffsets, revSources } = graph;
  for (let head = 0; head < tail; head++) {
    const v = queue[head]!;
    for (let k = revOffsets[v]!; k < revOffsets[v + 1]!; k++) {
      const u = revSources[k]!;
      if (reached[u] === 0) {
        reached[u] = 1;
        parent[u] = v;
        queue[tail++] = u;
      }
    }
  }
  return { reached, parent, order: queue.slice(0, tail) };
}

/** 1 for every seed and everything it depends on, directly or transitively. O(seeds + reached edges). */
export function forwardReach(graph: Graph, seeds: Iterable<number>): Uint8Array {
  const n = graph.nodeCount;
  const reached = new Uint8Array(n);
  const queue = new Uint32Array(n);
  let tail = 0;
  for (const seed of seeds) {
    if (!Number.isInteger(seed) || seed < 0 || seed >= n) {
      throw new RangeError(`seed ${seed} is not a node`);
    }
    if (reached[seed] === 0) {
      reached[seed] = 1;
      queue[tail++] = seed;
    }
  }
  const { fwdOffsets, fwdTargets } = graph;
  for (let head = 0; head < tail; head++) {
    const v = queue[head]!;
    for (let k = fwdOffsets[v]!; k < fwdOffsets[v + 1]!; k++) {
      const w = fwdTargets[k]!;
      if (reached[w] === 0) {
        reached[w] = 1;
        queue[tail++] = w;
      }
    }
  }
  return reached;
}

/** The chain from a seed to `node` (seed first), or null when `node` was not reached. */
export function whyPath(reach: Reach, node: number): number[] | null {
  if (reach.reached[node] !== 1) {
    return null;
  }
  const path = [node];
  for (let v = reach.parent[node]!; v !== -1; v = reach.parent[v]!) {
    path.push(v);
  }
  return path.reverse();
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
