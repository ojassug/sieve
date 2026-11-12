import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';

import { TreeIndex } from '../../src/git/diff.ts';
import { lsTree } from '../../src/git/git.ts';
import { GitVfs } from '../../src/git/vfs.ts';
import { MemoryVfs, Resolver } from '../../src/resolve/resolver.ts';
import { snapshot, type FakeFile } from './fake-tree.ts';

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

/** A GitVfs over a fake snapshot, with blob contents served from memory as fake-tree hashes them. */
function fakeGitVfs(files: Readonly<Record<string, FakeFile>>): GitVfs {
  const blobs = new Map(Object.values(files).map((file) => [sha1(`blob:${file.content}`), new TextEncoder().encode(file.content)]));
  return new GitVfs(TreeIndex.build(snapshot(files)), (oid) => blobs.get(oid) ?? null);
}

describe('GitVfs', () => {
  const vfs = fakeGitVfs({
    'src/a.ts': { mode: '100644', content: 'export const a = 1;\n' },
    'bin/run.js': { mode: '100755', content: '#!/usr/bin/env node\n' },
    'src/link.ts': { mode: '120000', content: 'a.ts' },
    'vendor/lib': { mode: '160000', content: 'commit' },
    'package.json': { mode: '100644', content: '﻿{"name":"x"}' },
  });

  it('maps git modes to entry kinds', () => {
    expect(vfs.kind('')).toBe('dir');
    expect(vfs.kind('src')).toBe('dir');
    expect(vfs.kind('src/a.ts')).toBe('file');
    expect(vfs.kind('bin/run.js')).toBe('file');
    expect(vfs.kind('src/link.ts')).toBe('symlink');
    expect(vfs.kind('vendor/lib')).toBe('submodule');
    expect(vfs.kind('src/missing.ts')).toBeNull();
    expect(vfs.kind('src/a.ts/x')).toBeNull();
  });

  it('reads files and symlink targets, and nothing else', () => {
    expect(vfs.read('src/a.ts')).toBe('export const a = 1;\n');
    expect(vfs.read('src/link.ts')).toBe('a.ts');
    expect(vfs.read('package.json')).toBe('{"name":"x"}'); // a BOM is dropped, as Node and TypeScript do
    expect(vfs.read('src')).toBeNull();
    expect(vfs.read('vendor/lib')).toBeNull();
    expect(vfs.read('nope')).toBeNull();
  });

  it('lists every non-directory path in UTF-16 order', () => {
    expect(vfs.files()).toEqual(['bin/run.js', 'package.json', 'src/a.ts', 'src/link.ts', 'vendor/lib']);
  });

  it('exposes the blob oid of a path, for f: node hashes', () => {
    expect(vfs.oid('src/a.ts')).toBe(sha1('blob:export const a = 1;\n'));
    expect(vfs.oid('src')).toBeNull();
    expect(vfs.oid('missing')).toBeNull();
  });
});

// The resolver must not care which Vfs it runs on: over the same files, GitVfs and MemoryVfs give
// identical resolutions, evidence included.
describe('GitVfs against MemoryVfs (property)', () => {
  const PATHS = ['a.ts', 'a.js', 'a/index.ts', 'a/b.ts', 'b/c.mts', 'package.json', 'tsconfig.json', 'pkgs/p/package.json', 'pkgs/p/index.js'];
  const CONTENT: Readonly<Record<string, readonly string[]>> = {
    'package.json': ['{"name":"root","workspaces":["pkgs/*"]}', '{"name":"root"}', 'not json'],
    'tsconfig.json': ['{"compilerOptions":{"baseUrl":"."}}', '{}', '{"compilerOptions":{"paths":{"@/*":["a/*"]}}}'],
    'pkgs/p/package.json': ['{"name":"p","main":"index.js"}', '{"name":"p","exports":"./index.js"}'],
  };
  const SPECIFIERS = ['./a', '../a', './a/b', 'p', '@/b', 'lodash', '../b/c.mjs', 'a'];

  it('resolves identically', () => {
    fc.assert(
      fc.property(
        fc.subarray(PATHS),
        fc.func(fc.nat()),
        fc.constantFrom(...SPECIFIERS),
        fc.constantFrom('src/f.ts', 'a/x.ts', 'pkgs/p/y.ts'),
        (paths, pick, specifier, from) => {
          const files: Record<string, string> = { [from]: '' };
          for (const path of paths) {
            const options = CONTENT[path] ?? [''];
            files[path] = options[pick(path) % options.length]!;
          }
          // a.ts and a/index.ts may coexist; a file and a directory of one name may not.
          if (Object.keys(files).some((f) => Object.keys(files).some((g) => g.startsWith(`${f}/`)))) {
            return;
          }
          const fake = fakeGitVfs(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { mode: '100644', content }])));
          const request = { from, specifier, kind: 'static' as const, patterns: null };
          expect(new Resolver(fake).resolve(request)).toEqual(new Resolver(new MemoryVfs(files)).resolve(request));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('GitVfs.load', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads configs from one batch and any other blob on demand', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sieve-vfs-'));
    dirs.push(dir);
    const git = (args: string[], input?: string): string =>
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8', ...(input === undefined ? {} : { input }) }).trim();
    git(['init', '-q']);
    const blob = (content: string) => git(['hash-object', '-w', '--stdin'], content);
    git(['update-index', '-z', '--index-info'], [
      `100644 ${blob('{"name":"r"}')}\tpackage.json\0`,
      `100644 ${blob('{"extends":"./configs/base"}')}\ttsconfig.json\0`,
      `100644 ${blob('{}')}\tconfigs/base.json\0`,
      `100644 ${blob('import "./b";\r\n')}\tsrc/a.ts\0`,
      `120000 ${blob('a.ts')}\tsrc/link.ts\0`,
    ].join(''));
    const commit = git(['commit-tree', git(['write-tree']), '-m', 'c']);

    const vfs = await GitVfs.load(dir, TreeIndex.build(await lsTree(dir, commit)));
    expect(vfs.read('package.json')).toBe('{"name":"r"}');
    expect(vfs.read('src/link.ts')).toBe('a.ts');
    expect(vfs.read('configs/base.json')).toBe('{}');
    expect(vfs.read('src/a.ts')).toBe('import "./b";\r\n'); // blob bytes, never a checkout's
  });
});
