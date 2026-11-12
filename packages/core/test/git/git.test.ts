import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { merkleDiff, TreeIndex } from '../../src/git/diff.ts';
import { lsTree, readBlobs, readObjectFormat } from '../../src/git/git.ts';

interface PlumbingFile {
  readonly mode: '100644' | '100755' | '120000' | '160000';
  readonly content: string;
}

/**
 * A repository whose commits are built with plumbing only (hash-object, update-index, write-tree,
 * commit-tree), so modes, symlinks and gitlinks are exact on every OS and nothing is checked out.
 */
function plumbingRepo(format: 'sha1' | 'sha256') {
  const dir = mkdtempSync(join(tmpdir(), `sieve-git-${format}-`));
  const git = (args: string[], input?: string): string =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], {
      cwd: dir,
      encoding: 'utf8',
      ...(input === undefined ? {} : { input }),
    }).trim();
  git(['init', '-q', `--object-format=${format}`]);
  const zeroOid = format === 'sha1' ? 40 : 64;

  return {
    dir,
    commit(files: Record<string, PlumbingFile>): string {
      git(['read-tree', '--empty']);
      const lines = Object.entries(files).map(([path, file]) => {
        const oid = file.mode === '160000' ? file.content.padEnd(zeroOid, '0') : git(['hash-object', '-w', '--stdin'], file.content);
        return `${file.mode} ${oid}\t${path}\0`;
      });
      git(['update-index', '-z', '--index-info'], lines.join(''));
      return git(['commit-tree', git(['write-tree']), '-m', 'c']);
    },
    /** git's own view of the change, as "<status> <path>" lines. */
    diffTree(a: string, b: string): string[] {
      const raw = git(['diff-tree', '-r', '-z', '--no-renames', a, b]).split('\0').filter((part) => part !== '');
      const changes: string[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        changes.push(`${raw[i]!.split(' ').at(-1)!} ${raw[i + 1]!}`);
      }
      return changes.sort();
    },
  };
}

const kindLetter = { added: 'A', deleted: 'D', modified: 'M' } as const;

describe('git snapshots', () => {
  const repos: string[] = [];
  afterAll(() => {
    for (const dir of repos) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['sha1', 'sha256'] as const)('reads %s listings that diff exactly like git diff-tree', async (format) => {
    const repo = plumbingRepo(format);
    repos.push(repo.dir);
    const before = repo.commit({
      'src/index.ts': { mode: '100644', content: 'export * from "./util";\n' },
      'src/util.ts': { mode: '100644', content: 'export const u = 1;\n' },
      'src/deep/a b ü.ts': { mode: '100644', content: 'deep\n' },
      'scripts/run.sh': { mode: '100644', content: '#!/bin/sh\n' },
      'docs/guide.md': { mode: '100644', content: '# guide\n' },
      config: { mode: '100644', content: 'file that becomes a directory\n' },
      vendor: { mode: '160000', content: 'a1' },
    });
    const after = repo.commit({
      'src/index.ts': { mode: '100644', content: 'export * from "./util";\n' },
      'src/util.ts': { mode: '100644', content: 'export const u = 2;\n' },
      'src/new/helper.ts': { mode: '100644', content: 'new\n' },
      'src/deep/a b ü.ts': { mode: '120000', content: '../index.ts' },
      'scripts/run.sh': { mode: '100755', content: '#!/bin/sh\n' },
      'config/app.json': { mode: '100644', content: '{}\n' },
      vendor: { mode: '160000', content: 'b2' },
    });

    expect(await readObjectFormat(repo.dir)).toBe(format);
    const base = await lsTree(repo.dir, before);
    const head = await lsTree(repo.dir, after);
    expect(base.entries.every((entry) => entry.oid.length === (format === 'sha1' ? 40 : 64))).toBe(true);
    expect(base.entries.map((entry) => `${entry.type} ${entry.path}`)).toContain('blob src/deep/a b ü.ts');

    const delta = merkleDiff(TreeIndex.build(base), TreeIndex.build(head));
    const ours = delta.files.map((change) => `${kindLetter[change.kind]} ${change.path}`).sort();
    // git reports blob→symlink as T (type change); SIEVE reports every in-place change as modified.
    const theirs = repo
      .diffTree(before, after)
      .map((line) => line.replace(/^T /, 'M '))
      .sort();
    expect(ours).toEqual(theirs);
    // src/deep: its entry turned from a file into a symlink, which a directory listing exposes.
    expect(delta.listings).toEqual(['', 'config', 'docs', 'src', 'src/deep', 'src/new']);
  });

  it('fails loudly on a revision that does not exist', async () => {
    const repo = plumbingRepo('sha1');
    repos.push(repo.dir);
    await expect(lsTree(repo.dir, 'no-such-ref')).rejects.toThrow(/git/);
  });

  it.each(['sha1', 'sha256'] as const)('reads %s blobs byte-exact through one cat-file process', async (format) => {
    const repo = plumbingRepo(format);
    repos.push(repo.dir);
    const crlf = 'line one\r\nline two\r\n';
    const commit = repo.commit({
      'a.ts': { mode: '100644', content: 'export const a = 1;\n' },
      'crlf.txt': { mode: '100644', content: crlf },
      'empty.txt': { mode: '100644', content: '' },
      'link.ts': { mode: '120000', content: 'a.ts' },
      'copy.ts': { mode: '100644', content: 'export const a = 1;\n' },
    });
    const entries = (await lsTree(repo.dir, commit)).entries;
    const oid = (path: string) => entries.find((entry) => entry.path === path)!.oid;

    const blobs = await readBlobs(repo.dir, ['a.ts', 'crlf.txt', 'empty.txt', 'link.ts', 'copy.ts'].map(oid));
    const text = (path: string) => new TextDecoder().decode(blobs.get(oid(path)));
    expect(blobs.size).toBe(4); // a.ts and copy.ts share one blob
    expect(text('a.ts')).toBe('export const a = 1;\n');
    expect(text('crlf.txt')).toBe(crlf);
    expect(text('empty.txt')).toBe('');
    expect(text('link.ts')).toBe('a.ts');
  });

  it('reads nothing, and spawns nothing, for no oids', async () => {
    expect((await readBlobs('/no/such/dir', [])).size).toBe(0);
  });

  it('fails loudly on a missing object or one that is not a blob', async () => {
    const repo = plumbingRepo('sha1');
    repos.push(repo.dir);
    const commit = repo.commit({ 'dir/a.ts': { mode: '100644', content: 'a\n' } });
    const tree = (await lsTree(repo.dir, commit)).entries.find((entry) => entry.path === 'dir')!.oid;
    await expect(readBlobs(repo.dir, ['0123456789'.repeat(4)])).rejects.toThrow(/missing/);
    await expect(readBlobs(repo.dir, [tree])).rejects.toThrow(/not a blob/);
  });
});
