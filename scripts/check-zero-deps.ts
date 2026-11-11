// Fails CI when core, the CLI or a runner plugin gains a runtime dependency (ADR-0002).
import { checkRepo } from './lib/zero-deps.ts';

const problems = checkRepo(process.cwd());
for (const problem of problems) {
  process.stderr.write(`zero-deps: ${problem}\n`);
}
if (problems.length > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write('zero-deps: core, cli, vitest and jest have no runtime dependencies\n');
}
