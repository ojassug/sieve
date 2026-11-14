import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/canonical-json.ts';
import { STATIC } from '../../src/graph/graph.ts';
import { mapGraph, parseMap } from '../../src/graph/map.ts';
import { buildStaticMap, type TrommelMap } from '../../src/graph/static.ts';
import { fakeRepo } from './fake-repo.ts';

const repo = fakeRepo({ 'src/a.ts': "import './b';\n", 'src/b.ts': '', 'a.test.ts': "import './src/a';\n" });
const map = buildStaticMap({ objectFormat: 'sha1', index: repo.index, vfs: repo.vfs, sources: repo.sources, tests: ['a.test.ts'] });
const text = canonicalJson(map);
const edit = (change: (raw: Record<string, unknown>) => void): string => {
  const raw = JSON.parse(text) as Record<string, unknown>;
  change(raw);
  return JSON.stringify(raw);
};

describe('parseMap', () => {
  it('reads back exactly what was written', () => {
    expect(parseMap(text)).toEqual(map);
    expect(canonicalJson(parseMap(text))).toBe(text);
  });

  it.each([
    ['text that is not JSON', '{', /not JSON/],
    ['another map version', edit((m) => (m['version'] = 2)), /version 2/],
    ['another engine', edit((m) => (m['engine'] = 'trommel-static-0')), /engine/],
    ['an unknown object format', edit((m) => (m['objectFormat'] = 'md5')), /objectFormat/],
    ['a root tree that is not an object id', edit((m) => (m['rootTree'] = 'HEAD')), /rootTree/],
    ['a missing field', edit((m) => delete m['tests']), /tests/],
    ['an edge to a node that does not exist', edit((m) => ((m['edges'] as Record<string, Record<string, number>>)['f:src/a.ts']!['f:nope'] = STATIC)), /f:nope/],
    ['a provenance outside the three bits', edit((m) => ((m['edges'] as Record<string, Record<string, number>>)['f:src/a.ts']!['f:src/b.ts'] = 8)), /provenance/],
    ['a test that is not a node', edit((m) => (m['tests'] = ['nope.test.ts'])), /nope\.test\.ts/],
    ['a snapshot entry that is malformed', edit((m) => (m['snapshot'] = [['100644', 'x']])), /snapshot/],
    // A plan seeds every u: node, so a map whose causes and nodes disagree is damaged.
    ['a u: node without causes', edit((m) => ((m['nodes'] as Record<string, string>)['u:src/b.ts'] = 'a'.repeat(64))), /u:src\/b\.ts/],
    ['causes for a node that is not a u: node', edit((m) => (m['uncertain'] = { 'f:src/b.ts': ['x'] })), /f:src\/b\.ts/],
  ])('rejects %s', (_name, input, message) => {
    expect(() => parseMap(input)).toThrow(message);
  });
});

describe('mapGraph', () => {
  it('has every node, including ones without edges, and every edge', () => {
    const graph = mapGraph(map);
    expect(graph.nodeCount).toBe(Object.keys(map.nodes).length);
    const a = graph.id('f:src/a.ts')!;
    expect(graph.dependencies(a).map((id) => graph.name(id))).toContain('f:src/b.ts');
  });

  it('is identical however the map was ordered', () => {
    const shuffled: TrommelMap = { ...map, nodes: Object.fromEntries(Object.entries(map.nodes).reverse()), edges: Object.fromEntries(Object.entries(map.edges).reverse()) };
    expect(mapGraph(shuffled).forwardTargets()).toEqual(mapGraph(map).forwardTargets());
  });
});
