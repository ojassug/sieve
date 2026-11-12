#!/usr/bin/env node
// Publishes one collection run to the data repository: the release and its assets first, then the
// manifest and state commit. Called by .github/workflows/corpus-collect.yml. The ordering and the
// retry live in publish.ts; DECISIONS 22 says why they are that way.
//
//   node tools/corpus/src/publish-main.ts --repo-dir . --out out --assets assets \
//     --state state/collector-state.json --day 2026-11-12 --run-number 7 \
//     --repo ojassug/sieve-corpus --collector-repo ojassug/sieve --collector-sha <sha>
//
// `gh` reads its token from GH_TOKEN; the push uses the checkout's own credentials.
import { parseArgs } from 'node:util';

import { publish } from './publish.ts';

const { values } = parseArgs({
  options: {
    'repo-dir': { type: 'string' },
    out: { type: 'string' },
    assets: { type: 'string' },
    state: { type: 'string' },
    day: { type: 'string' },
    'run-number': { type: 'string' },
    repo: { type: 'string' },
    'collector-repo': { type: 'string' },
    'collector-sha': { type: 'string' },
    branch: { type: 'string', default: 'main' },
    attempts: { type: 'string', default: '3' },
  },
});

function fail(message: string): never {
  process.stderr.write(`corpus: ${message}\n`);
  process.exit(2);
}

const attempts = Number(values.attempts);
if (!Number.isInteger(attempts) || attempts <= 0) {
  fail('--attempts must be a positive integer');
}

try {
  const result = await publish({
    repoDir: values['repo-dir'] ?? fail('--repo-dir is required'),
    outDir: values.out ?? fail('--out is required'),
    assetsDir: values.assets ?? fail('--assets is required'),
    statePath: values.state ?? fail('--state is required'),
    day: values.day ?? fail('--day is required (YYYY-MM-DD, UTC)'),
    runNumber: values['run-number'] ?? fail('--run-number is required'),
    repo: values.repo ?? fail('--repo is required'),
    collector: {
      repo: values['collector-repo'] ?? fail('--collector-repo is required'),
      sha: values['collector-sha'] ?? fail('--collector-sha is required'),
    },
    branch: values.branch,
    attempts,
  });
  process.stdout.write(
    `corpus: published ${result.tag} with ${String(result.assets.length)} assets; ` +
      (result.commit === null
        ? 'the manifest and state were already on the branch\n'
        : `committed ${result.commit} after ${String(result.attempts)} push attempt(s)\n`),
  );
} catch (error) {
  // Loudly: the release holds the data, but nothing points at it until this commit lands.
  fail(error instanceof Error ? error.message : String(error));
}
