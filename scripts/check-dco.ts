// Fails CI when a pull request commit lacks the author's DCO sign-off (CONTRIBUTING.md).
// Usage: node scripts/check-dco.ts <base-sha> <head-sha>
import { unsignedCommits } from './lib/dco.ts';

const [base, head] = process.argv.slice(2);
if (base === undefined || head === undefined) {
  process.stderr.write('usage: node scripts/check-dco.ts <base-sha> <head-sha>\n');
  process.exit(2);
}
const problems = unsignedCommits(process.cwd(), base, head);
for (const problem of problems) {
  process.stderr.write(`dco: ${problem}\n`);
}
if (problems.length > 0) {
  process.stderr.write('dco: sign off with `git commit -s` (see CONTRIBUTING.md)\n');
  process.exitCode = 1;
} else {
  process.stdout.write('dco: every commit is signed off by its author\n');
}
