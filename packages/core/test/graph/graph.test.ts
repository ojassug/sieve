import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DECLARED, DYNAMIC, GraphBuilder, reverseReach, STATIC, whyPath, type Graph } from '../../src/graph/graph.ts';

const names = (graph: Graph, ids: Iterable<number>) => [...ids].map((id) => graph.name(id));

function login(): Graph {
  const b = new GraphBuilder();
  b.addEdge('test/login.test.ts', 'src/auth/index.ts', STATIC);
  b.addEdge('src/auth/index.ts', 'src/auth/token.ts', STATIC);
  b.addEdge('test/other.test.ts', 'src/util.ts', STATIC);
  b.addEdge('src/auth/token.ts', 'src/util.ts', DYNAMIC);
  return b.build();
}

describe('GraphBuilder', () => {
  it('numbers nodes in sorted name order, whatever the insertion order', () => {
    const graph = login();
    expect(names(graph, [0, 1, 2, 3, 4])).toEqual([
      'src/auth/index.ts',
      'src/auth/token.ts',
      'src/util.ts',
      'test/login.test.ts',
      'test/other.test.ts',
    ]);
  });

  it('merges duplicate edges and ORs their provenance', () => {
    const b = new GraphBuilder();
    b.addEdge('a', 'c', STATIC);
    b.addEdge('a', 'b', DECLARED);
    b.addEdge('a', 'c', DYNAMIC);
    const graph = b.build();
    const a = graph.id('a')!;
    expect(names(graph, graph.dependencies(a))).toEqual(['b', 'c']);
    expect(graph.dependencyProvenance(a)).toEqual([DECLARED, STATIC | DYNAMIC]);
    expect(graph.edgeCount).toBe(2);
  });

  it('keeps nodes without edges and lists dependents in id order', () => {
    const b = new GraphBuilder();
    b.addNode('lonely');
    b.addEdge('z', 'm', STATIC);
    b.addEdge('a', 'm', STATIC);
    const graph = b.build();
    expect(graph.id('lonely')).toBeDefined();
    expect(names(graph, graph.dependents(graph.id('m')!))).toEqual(['a', 'z']);
  });

  it('rejects an edge without provenance', () => {
    expect(() => { new GraphBuilder().addEdge('a', 'b', 0); }).toThrow(/provenance/);
  });
});

describe('reverseReach and whyPath', () => {
  it('reaches every transitive dependent of the changed nodes, and explains each', () => {
    const graph = login();
    const reach = reverseReach(graph, [graph.id('src/util.ts')!]);
    expect(names(graph, reach.order)).toEqual(['src/util.ts', 'src/auth/token.ts', 'test/other.test.ts', 'src/auth/index.ts', 'test/login.test.ts']);
    expect(names(graph, whyPath(reach, graph.id('test/login.test.ts')!)!)).toEqual([
      'src/util.ts',
      'src/auth/token.ts',
      'src/auth/index.ts',
      'test/login.test.ts',
    ]);
  });

  it('does not reach dependencies, only dependents', () => {
    const graph = login();
    const reach = reverseReach(graph, [graph.id('src/auth/index.ts')!]);
    expect(names(graph, reach.order)).toEqual(['src/auth/index.ts', 'test/login.test.ts']);
    expect(whyPath(reach, graph.id('src/util.ts')!)).toBeNull();
  });

  it('terminates on cycles', () => {
    const b = new GraphBuilder();
    b.addEdge('a', 'b', STATIC);
    b.addEdge('b', 'a', STATIC);
    b.addEdge('t', 'a', STATIC);
    const graph = b.build();
    expect(names(graph, reverseReach(graph, [graph.id('b')!]).order)).toEqual(['b', 'a', 't']);
  });

  it('explains a node by the shortest path to any seed, breaking ties by the smallest seed id', () => {
    const b = new GraphBuilder();
    b.addEdge('t', 'x', STATIC);
    b.addEdge('x', 'c1', STATIC);
    b.addEdge('t', 'y', STATIC);
    b.addEdge('y', 'c0', STATIC);
    const graph = b.build();
    const reach = reverseReach(graph, [graph.id('c1')!, graph.id('c0')!]);
    expect(names(graph, whyPath(reach, graph.id('t')!)!)).toEqual(['c0', 'y', 't']);
  });

  it('rejects a seed that is not a node', () => {
    expect(() => reverseReach(login(), [99])).toThrow(RangeError);
  });
});

// Random directed graphs (cycles allowed), random test nodes and change sets.
const arbGraph = fc
  .integer({ min: 1, max: 30 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      edges: fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1), fc.constantFrom(STATIC, DYNAMIC, DECLARED)), { maxLength: n * 3 }),
      changed: fc.uniqueArray(fc.nat(n - 1), { maxLength: n }),
      insertion: fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n }),
    }),
  );

function build({ n, edges, insertion }: { n: number; edges: [number, number, number][]; insertion: number[] }): Graph {
  const b = new GraphBuilder();
  for (const i of insertion) {
    b.addNode(`n${String(i).padStart(2, '0')}`);
  }
  for (const [from, to, provenance] of edges) {
    b.addEdge(`n${String(from).padStart(2, '0')}`, `n${String(to).padStart(2, '0')}`, provenance);
  }
  expect(b.build().nodeCount).toBe(n);
  return b.build();
}

/** Independent oracle: the forward closure of a node, by depth-first search over the edge list. */
function closure(edges: [number, number, number][], start: number): Set<number> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const [from, to] of edges) {
      if (from === node && !seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  return seen;
}

const label = (i: number) => `n${String(i).padStart(2, '0')}`;

describe('graph properties', () => {
  it('P1 soundness: a node is reached exactly when its forward closure meets the change set', () => {
    fc.assert(
      fc.property(arbGraph, (g) => {
        const graph = build(g);
        const reach = reverseReach(graph, g.changed.map((i) => graph.id(label(i))!));
        for (let i = 0; i < g.n; i++) {
          const affected = [...closure(g.edges, i)].some((node) => g.changed.includes(node));
          expect(reach.reached[graph.id(label(i))!] === 1).toBe(affected);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('P3 monotonicity: a larger change set never reaches fewer nodes', () => {
    fc.assert(
      fc.property(arbGraph, fc.array(fc.boolean(), { minLength: 30, maxLength: 30 }), (g, keep) => {
        const graph = build(g);
        const all = g.changed.map((i) => graph.id(label(i))!);
        const some = all.filter((_, i) => keep[i]);
        const big = reverseReach(graph, all).reached;
        const small = reverseReach(graph, some).reached;
        for (let v = 0; v < graph.nodeCount; v++) {
          expect(small[v]! <= big[v]!).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('why-paths follow real edges from a seed to the node and are shortest', () => {
    fc.assert(
      fc.property(arbGraph, (g) => {
        const graph = build(g);
        const seeds = g.changed.map((i) => graph.id(label(i))!);
        const reach = reverseReach(graph, seeds);
        for (const node of reach.order) {
          const path = whyPath(reach, node)!;
          expect(seeds).toContain(path[0]);
          expect(path.at(-1)).toBe(node);
          for (let k = 1; k < path.length; k++) {
            expect(graph.dependencies(path[k]!)).toContain(path[k - 1]);
          }
          // Shortest: no seed reaches the node in fewer reverse hops (independent BFS by edge list).
          let frontier = new Set(seeds);
          let hops = 0;
          const seen = new Set(seeds);
          while (!frontier.has(node)) {
            const next = new Set<number>();
            for (let u = 0; u < graph.nodeCount; u++) {
              if (!seen.has(u) && graph.dependencies(u).some((d) => frontier.has(d))) {
                next.add(u);
              }
            }
            next.forEach((u) => seen.add(u));
            frontier = next;
            hops++;
          }
          expect(path.length - 1).toBe(hops);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('builds byte-identical adjacency and why-paths whatever the insertion order', () => {
    fc.assert(
      fc.property(arbGraph, fc.integer(), (g, salt) => {
        const a = build(g);
        const shuffled = [...g.edges].sort((x, y) => ((x[0] * 31 + x[1] + salt) % 7) - ((y[0] * 31 + y[1] + salt) % 7));
        const b = build({ ...g, edges: shuffled, insertion: [...g.insertion].reverse() });
        expect([...b.forwardTargets()]).toEqual([...a.forwardTargets()]);
        expect([...b.reverseSources()]).toEqual([...a.reverseSources()]);
        const seedsA = g.changed.map((i) => a.id(label(i))!);
        const seedsB = g.changed.map((i) => b.id(label(i))!);
        const reachA = reverseReach(a, seedsA);
        const reachB = reverseReach(b, seedsB);
        for (const node of reachA.order) {
          expect(names(b, whyPath(reachB, node)!)).toEqual(names(a, whyPath(reachA, node)!));
        }
      }),
      { numRuns: 1000 },
    );
  });
});
