#!/usr/bin/env node
// Entry point for the `sieve` binary; runs from source through Node's type stripping (DECISIONS 3).
import { run } from './cli.ts';

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
