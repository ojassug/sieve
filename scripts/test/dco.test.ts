import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { signoffProblem, unsignedCommits } from '../lib/dco.ts';

describe('signoffProblem', () => {
  const author = { authorName: 'Ada', authorEmail: 'ada@example.com' };

  it('accepts a sign-off by the author', () => {
    expect(signoffProblem({ ...author, message: 'feat: x\n\nSigned-off-by: Ada <ada@example.com>\n' })).toBeNull();
  });

  it('compares the e-mail case-insensitively', () => {
    expect(signoffProblem({ ...author, message: 'feat: x\n\nSigned-off-by: Ada <ADA@Example.com>' })).toBeNull();
  });

  it('rejects a commit without a sign-off', () => {
    expect(signoffProblem({ ...author, message: 'feat: x\n' })).toBe('no Signed-off-by line');
  });

  it('rejects a sign-off by someone other than the author', () => {
    expect(signoffProblem({ ...author, message: 'feat: x\n\nSigned-off-by: Bob <bob@example.com>' })).toBe(
      'no Signed-off-by line for the author ada@example.com',
    );
  });

  it('ignores a sign-off that is not at the start of a line', () => {
    expect(signoffProblem({ ...author, message: 'feat: x\n\nquoting Signed-off-by: Ada <ada@example.com>' })).toBe(
      'no Signed-off-by line',
    );
  });
});

describe('unsignedCommits', () => {
  const repo = mkdtempSync(join(tmpdir(), 'sieve-dco-'));
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...args], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();

  it('lists the commits in base..head that lack the author sign-off', () => {
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'chore: base');
    const base = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-s', '-m', 'feat: signed');
    git('commit', '-q', '--allow-empty', '-m', 'feat: unsigned');
    const unsigned = git('rev-parse', 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'fix: wrong signer\n\nSigned-off-by: Bob <bob@example.com>');
    const wrongSigner = git('rev-parse', 'HEAD');

    expect(unsignedCommits(repo, base, wrongSigner)).toEqual([
      `${unsigned.slice(0, 12)} feat: unsigned: no Signed-off-by line`,
      `${wrongSigner.slice(0, 12)} fix: wrong signer: no Signed-off-by line for the author ada@example.com`,
    ]);
  });
});
