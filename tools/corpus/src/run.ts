import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { canonicalJsonPretty } from '@sieve-ci/core';

import { collectDay, type DayCounts, type RepoConfig } from './collect.ts';
import { addDays, daysInRange } from './days.ts';
import { BudgetExhausted, type GitHubClient } from './github.ts';
import { planWork, type CollectorState, type RepoState, type WorkItem } from './plan.ts';
import { DEFAULT_RULES } from './select.ts';
import { FileSink } from './sink.ts';

export interface CorpusConfig {
  readonly version: 1;
  readonly repos: readonly RepoConfig[];
}

export interface RunOptions {
  readonly config: CorpusConfig;
  /** Updated in place; the caller persists it. */
  readonly state: CollectorState;
  readonly client: GitHubClient;
  readonly outDir: string;
  readonly today: string;
  readonly recentDays: number;
  readonly horizonDays: number;
  /** Total bytes of artifacts this run may mirror. */
  readonly maxMirrorBytes: number;
  readonly collector: { readonly ref: string; readonly configSha256: string };
}

export interface ItemResult extends WorkItem {
  readonly status: 'complete' | 'error' | 'stopped';
  readonly counts?: DayCounts;
  readonly error?: string;
}

export interface Manifest {
  readonly version: 1;
  readonly collectedOn: string;
  readonly collector: { readonly ref: string; readonly configSha256: string };
  readonly options: { readonly recentDays: number; readonly horizonDays: number; readonly maxMirrorBytes: number };
  readonly requests: number;
  readonly stoppedEarly: string | null;
  /** Planned items that did not finish (complete or error) in this run. */
  readonly pending: number;
  readonly items: readonly ItemResult[];
  /** Backfill days collected so far out of those still inside GitHub's retention window. */
  readonly coverage: Record<string, { complete: number; days: number }>;
  readonly files: readonly { path: string; bytes: number; sha256: string }[];
}

export async function runCollection(options: RunOptions): Promise<Manifest> {
  const { config, state, client, outDir, today, recentDays, horizonDays } = options;
  const repos = [...config.repos].sort((a, b) => a.tier - b.tier);
  const byName = new Map(repos.map((repo) => [repo.repo, repo]));
  const planned = planWork(
    repos.map((repo) => repo.repo),
    state,
    { today, recentDays, horizonDays },
  );
  const sink = new FileSink(outDir);
  const mirrorBudget = { remainingBytes: options.maxMirrorBytes };
  const items: ItemResult[] = [];
  let stoppedEarly: string | null = null;

  for (const item of planned) {
    const repoState = (state.repos[item.repo] ??= { days: {}, runs: {} });
    try {
      const counts = await collectDay(client, byName.get(item.repo)!, item.day, repoState, sink, { rules: DEFAULT_RULES, mirrorBudget });
      if (item.kind === 'backfill') {
        repoState.days[item.day] = 'complete';
      }
      items.push({ ...item, status: 'complete', counts });
    } catch (error) {
      if (error instanceof BudgetExhausted) {
        stoppedEarly = error.message;
        items.push({ ...item, status: 'stopped' });
        break;
      }
      items.push({ ...item, status: 'error', error: String(error instanceof Error ? error.message : error).slice(0, 300) });
    }
  }

  const oldest = addDays(today, -horizonDays);
  const backfillDays = daysInRange(oldest, addDays(today, -recentDays - 1));
  const coverage: Manifest['coverage'] = {};
  for (const { repo } of repos) {
    const repoState = (state.repos[repo] ??= { days: {}, runs: {} });
    prune(repoState, oldest);
    coverage[repo] = { complete: backfillDays.filter((day) => repoState.days[day] === 'complete').length, days: backfillDays.length };
  }

  const manifest: Manifest = {
    version: 1,
    collectedOn: today,
    collector: options.collector,
    options: { recentDays, horizonDays, maxMirrorBytes: options.maxMirrorBytes },
    requests: client.requests,
    stoppedEarly,
    pending: planned.length - items.filter((item) => item.status !== 'stopped').length,
    items,
    coverage,
    files: listFiles(outDir),
  };
  writeFileSync(join(outDir, 'manifest.json'), canonicalJsonPretty(manifest));
  return manifest;
}

/** Drops days that left the retention window and runs whose day is finished. */
function prune(repoState: RepoState, oldest: string): void {
  repoState.days = Object.fromEntries(Object.entries(repoState.days).filter(([day]) => day >= oldest));
  repoState.runs = Object.fromEntries(
    Object.entries(repoState.runs).filter(([, run]) => run.day >= oldest && repoState.days[run.day] !== 'complete'),
  );
}

function listFiles(outDir: string): Manifest['files'] {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const full = join(entry.parentPath, entry.name);
    const path = relative(outDir, full).split(sep).join('/');
    if (path === 'manifest.json') {
      continue;
    }
    const bytes = readFileSync(full);
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
