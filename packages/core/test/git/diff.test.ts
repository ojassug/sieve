import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { merkleDiff, naiveDiff, TreeIndex, type DiffStats } from '../../src/git/diff.ts';
import { snapshot, type FakeFile } from './fake-tree.ts';

const f = (content: string, mode: FakeFile['mode'] = '100644'): FakeFile => ({ mode, content });

function diff(base: Record<string, FakeFile>, head: Record<string, FakeFile>) {
  const stats: DiffStats = { visitedDirs: 0 };
  const delta = merkleDiff(TreeIndex.build(snapshot(base)), TreeIndex.build(snapshot(head)), stats);
  return { ...delta, visitedDirs: stats.visitedDirs };
}

const summary = (delta: ReturnType<typeof diff>) => ({
  files: delta.files.map((change) => `${change.kind} ${change.path}`),
  listings: delta.listings,
  visitedDirs: delta.visitedDirs,
});

describe('merkleDiff', () => {
  const base = { 'src/a.ts': f('a'), 'src/deep/x.ts': f('x'), 'test/a.test.ts': f('t'), 'README.md': f('r') };

  it('finds nothing and visits nothing when the root trees are equal', () => {
    expect(summary(diff(base, { ...base }))).toEqual({ files: [], listings: [], visitedDirs: 0 });
  });

  it('descends only into directories whose tree changed', () => {
    expect(summary(diff(base, { ...base, 'src/deep/x.ts': f('x2') }))).toEqual({
      files: ['modified src/deep/x.ts'],
      listings: [],
      visitedDirs: 3,
    });
  });

  it('reports an absent path becoming present, and the listings that gained it', () => {
    expect(summary(diff(base, { ...base, 'src/new/util.ts': f('u') }))).toEqual({
      files: ['added src/new/util.ts'],
      listings: ['src', 'src/new'],
      visitedDirs: 2,
    });
  });

  it('reports a removed directory as deleted files and vanished listings', () => {
    const { 'src/deep/x.ts': _gone, ...rest } = base;
    expect(summary(diff(base, rest))).toEqual({ files: ['deleted src/deep/x.ts'], listings: ['src', 'src/deep'], visitedDirs: 2 });
  });

  it('treats a file replaced by a directory as a delete plus adds', () => {
    const head = { ...base, 'README.md/inner.md': f('i') };
    delete (head as Record<string, FakeFile>)['README.md'];
    expect(summary(diff(base, head))).toEqual({
      files: ['deleted README.md', 'added README.md/inner.md'],
      listings: ['', 'README.md'],
      visitedDirs: 1,
    });
  });

  it('reports a mode-only change and a submodule commit change as modifications', () => {
    const before = { 'run.sh': f('s'), vendor: f('c1', '160000') };
    const after = { 'run.sh': f('s', '100755'), vendor: f('c2', '160000') };
    const delta = diff(before, after);
    expect(delta.files.map((change) => [change.path, change.kind, change.before?.mode, change.after?.mode])).toEqual([
      ['run.sh', 'modified', '100644', '100755'],
      ['vendor', 'modified', '160000', '160000'],
    ]);
    expect(delta.files[0]!.before!.oid).toBe(delta.files[0]!.after!.oid);
    expect(delta.files[1]!.before!.oid).not.toBe(delta.files[1]!.after!.oid);
  });

  it('sorts paths by UTF-16 code units, not traversal order', () => {
    expect(summary(diff({}, { 'a.b': f('1'), 'a/c': f('2') })).files).toEqual(['added a.b', 'added a/c']);
  });
});

describe('TreeIndex', () => {
  it('rejects a listing in which two entries share a path', () => {
    const { rootOid, entries } = snapshot({ x: f('1') });
    expect(() => TreeIndex.build({ rootOid, entries: [...entries, ...entries] })).toThrow(/duplicate path/);
  });

  it('counts undecodable paths so callers can escalate', () => {
    const { rootOid, entries } = snapshot({ x: f('1') });
    const index = TreeIndex.build({ rootOid, entries: [{ ...entries[0]!, undecodable: true }] });
    expect(index.undecodable).toBe(1);
  });
});

// P10 (architecture §7.1): the Merkle descent equals a naive listing diff on random trees,
// including absent→present, renames, and file↔directory changes. It visits exactly the
// directories present on both sides with different tree ids.
describe('P10 Merkle descent', () => {
  const NAMES = ['a', 'b', 'a.b', 'a-b', 'a0', 'B', 'é'];
  const MODES: FakeFile['mode'][] = ['100644', '100644', '100644', '100755', '120000', '160000'];
  const arbFile = fc.record({ mode: fc.constantFrom(...MODES), content: fc.constantFrom('x', 'y', 'z') });
  const arbPath = fc.array(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 4 }).map((parts) => parts.join('/'));
  const arbFiles = fc.dictionary(arbPath, arbFile, { maxKeys: 25 }).map(withoutPrefixConflicts);

  /** A path cannot be both a file and a directory; keep the shallower file. */
  function withoutPrefixConflicts(files: Record<string, FakeFile>): Record<string, FakeFile> {
    const kept: Record<string, FakeFile> = {};
    for (const path of Object.keys(files).sort((x, y) => x.split('/').length - y.split('/').length || (x < y ? -1 : 1))) {
      const parts = path.split('/');
      const blocked = parts.some((_, i) => i > 0 && parts.slice(0, i).join('/') in kept);
      const shadows = Object.keys(kept).some((other) => other.startsWith(`${path}/`));
      if (!blocked && !shadows) {
        kept[path] = files[path]!;
      }
    }
    return kept;
  }

  const arbPair = arbFiles.chain((base) =>
    fc
      .record({
        fate: fc.array(fc.constantFrom('keep', 'keep', 'modify', 'delete'), { minLength: Object.keys(base).length, maxLength: Object.keys(base).length }),
        added: fc.dictionary(arbPath, arbFile, { maxKeys: 8 }),
      })
      .map(({ fate, added }) => {
        const head: Record<string, FakeFile> = {};
        Object.entries(base).forEach(([path, file], i) => {
          if (fate[i] === 'keep') {
            head[path] = file;
          } else if (fate[i] === 'modify') {
            head[path] = { ...file, content: `${file.content}'` };
          }
        });
        return { base, head: withoutPrefixConflicts({ ...added, ...head }) };
      }),
  );

  it('equals the naive listing diff on 10,000 random tree pairs', () => {
    fc.assert(
      fc.property(arbPair, ({ base, head }) => {
        const s = snapshot(base);
        const h = snapshot(head);
        const stats: DiffStats = { visitedDirs: 0 };
        const descended = merkleDiff(TreeIndex.build(s), TreeIndex.build(h), stats);
        expect(descended).toEqual(naiveDiff(s, h));

        const trees = (entries: typeof s.entries, rootOid: string) =>
          new Map([['', rootOid], ...entries.filter((e) => e.type === 'tree').map((e): [string, string] => [e.path, e.oid])]);
        const sTrees = trees(s.entries, s.rootOid);
        const hTrees = trees(h.entries, h.rootOid);
        const changedOnBothSides = [...sTrees].filter(([dir, oid]) => hTrees.has(dir) && hTrees.get(dir) !== oid).length;
        expect(stats.visitedDirs).toBe(changedOnBothSides);
      }),
      { numRuns: 10_000 },
    );
  });
});
