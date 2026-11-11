import { execFileSync } from 'node:child_process';

export interface CommitAuthorship {
  readonly authorName: string;
  readonly authorEmail: string;
  readonly message: string;
}

const SIGNOFF = /^Signed-off-by: [^<\n]*<([^>\n]+)>\s*$/gm;

/** Null when the message carries a DCO sign-off by the commit author, otherwise the reason. */
export function signoffProblem(commit: CommitAuthorship): string | null {
  const emails = [...commit.message.matchAll(SIGNOFF)].map((match) => match[1]!.toLowerCase());
  if (emails.length === 0) {
    return 'no Signed-off-by line';
  }
  if (!emails.includes(commit.authorEmail.toLowerCase())) {
    return `no Signed-off-by line for the author ${commit.authorEmail}`;
  }
  return null;
}

/** One line per non-merge commit in base..head without the author's sign-off. */
export function unsignedCommits(repoDir: string, base: string, head: string): string[] {
  // Unit separator between fields, record separator between commits: neither appears in messages.
  const log = execFileSync('git', ['log', '--no-merges', '--reverse', '--format=%H%x1f%an%x1f%ae%x1f%B%x1e', `${base}..${head}`], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  const problems: string[] = [];
  for (const record of log.split('\x1e')) {
    const fields = record.replace(/^\n/, '').split('\x1f');
    if (fields.length !== 4) {
      continue;
    }
    const [sha, authorName, authorEmail, message] = fields as [string, string, string, string];
    const problem = signoffProblem({ authorName, authorEmail, message });
    if (problem !== null) {
      const subject = message.split('\n', 1)[0] ?? '';
      problems.push(`${sha.slice(0, 12)} ${subject}: ${problem}`);
    }
  }
  return problems;
}
