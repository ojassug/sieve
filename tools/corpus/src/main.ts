#!/usr/bin/env node
// Corpus collector: archives GitHub CI history (runs with attempts, jobs, check runs, test-report
// artifacts) before the 90-day retention drops it. See bench/CORPUS.md.
//
//   node tools/corpus/src/main.ts --config tools/corpus/repos.json --state state.json --out out --today 2026-11-12
//
// Reads the token from GITHUB_TOKEN or GH_TOKEN. Writes out/manifest.json and updates the state file.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

import { canonicalJsonPretty } from '@sieve-ci/core';

import type { RepoConfig } from './collect.ts';
import { GitHubClient } from './github.ts';
import type { CollectorState } from './plan.ts';
import { runCollection } from './run.ts';

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    state: { type: 'string' },
    out: { type: 'string' },
    today: { type: 'string' },
    ref: { type: 'string', default: 'local' },
    only: { type: 'string', multiple: true },
    'max-minutes': { type: 'string', default: '320' },
    'max-requests': { type: 'string' },
    'max-mirror-mb': { type: 'string', default: '1500' },
    'repo-share': { type: 'string', default: '1000' },
    'recent-days': { type: 'string', default: '2' },
    'horizon-days': { type: 'string', default: '89' },
    'metadata-only': { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  process.stderr.write(`corpus: ${message}\n`);
  process.exit(2);
}

function positiveInt(name: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`--${name} must be a positive integer`);
  }
  return value;
}

const configPath = values.config ?? fail('--config is required');
const statePath = values.state ?? fail('--state is required');
const outDir = values.out ?? fail('--out is required');
const today = values.today ?? fail('--today is required (YYYY-MM-DD, UTC)');
const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? fail('set GITHUB_TOKEN or GH_TOKEN');

function isRepoConfig(entry: unknown): entry is RepoConfig {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const { repo, workflows, mirror, tier, why } = entry as Record<string, unknown>;
  return (
    typeof repo === 'string' &&
    /^[\w.-]+\/[\w.-]+$/.test(repo) &&
    (workflows === '*' || (Array.isArray(workflows) && (workflows as unknown[]).every((name) => typeof name === 'string'))) &&
    typeof mirror === 'boolean' &&
    (tier === 1 || tier === 2) &&
    typeof why === 'string'
  );
}

function readConfig(raw: unknown): RepoConfig[] {
  const fields = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const repos = fields['version'] === 1 ? fields['repos'] : undefined;
  if (!Array.isArray(repos)) {
    fail(`${configPath}: expected {"version": 1, "repos": [...]}`);
  }
  return (repos as unknown[]).map((entry) => (isRepoConfig(entry) ? entry : fail(`${configPath}: invalid entry ${JSON.stringify(entry)}`)));
}

const configBytes = readFileSync(configPath);
const selected: RepoConfig[] = readConfig(JSON.parse(configBytes.toString('utf8')))
  .filter((repo) => values.only === undefined || values.only.includes(repo.repo))
  .map((repo) => (values['metadata-only'] ? { ...repo, mirror: false } : repo));

const state: CollectorState = existsSync(statePath)
  ? (JSON.parse(readFileSync(statePath, 'utf8')) as CollectorState)
  : { startedOn: today, repos: {} };

const maxRequests = values['max-requests'] === undefined ? undefined : positiveInt('max-requests', values['max-requests']);
const client = new GitHubClient({
  token,
  deadline: Date.now() + positiveInt('max-minutes', values['max-minutes']) * 60_000,
  ...(maxRequests === undefined ? {} : { maxRequests }),
});

mkdirSync(outDir, { recursive: true });
const manifest = await runCollection({
  config: { version: 1, repos: selected },
  state,
  client,
  outDir,
  today,
  recentDays: positiveInt('recent-days', values['recent-days']),
  horizonDays: positiveInt('horizon-days', values['horizon-days']),
  maxMirrorBytes: positiveInt('max-mirror-mb', values['max-mirror-mb']) * 1024 * 1024,
  repoShare: positiveInt('repo-share', values['repo-share']),
  collector: { ref: values.ref, configSha256: createHash('sha256').update(configBytes).digest('hex') },
});

mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, canonicalJsonPretty(state));

const tally = (status: string) => manifest.items.filter((item) => item.status === status).length;
const mirrored = manifest.items.reduce((sum, item) => sum + (item.counts?.mirroredBytes ?? 0), 0);
process.stdout.write(
  `corpus: ${tally('complete')} days complete, ${tally('error')} errors, ${manifest.pending} pending; ` +
    `${manifest.requests} requests; ${(mirrored / 1024 / 1024).toFixed(1)} MiB mirrored` +
    (manifest.stoppedEarly === null ? '\n' : `; stopped early: ${manifest.stoppedEarly}\n`),
);
for (const item of manifest.items.filter((entry) => entry.status === 'error')) {
  process.stderr.write(`corpus: ${item.repo} ${item.day}: ${item.error ?? ''}\n`);
}
