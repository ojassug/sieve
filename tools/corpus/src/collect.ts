import { dayBounds, splitRange } from './days.ts';
import { HttpError, type GitHubClient } from './github.ts';
import type { RepoState } from './plan.ts';
import { shouldMirror, type ArtifactRules } from './select.ts';
import type { Sink } from './sink.ts';

export interface RepoConfig {
  readonly repo: string;
  /** Workflow file names to collect, or '*' for every workflow in the repo. */
  readonly workflows: readonly string[] | '*';
  /** Download test-report artifacts (otherwise only their metadata is kept). */
  readonly mirror: boolean;
  /** 1 = replay candidate or JUnit source; 2 = everything else. Lower tiers are collected first. */
  readonly tier: 1 | 2;
  readonly why: string;
}

export interface DayCounts {
  runs: number;
  inProgress: number;
  attempts: number;
  jobs: number;
  checkRuns: number;
  artifacts: number;
  mirrored: number;
  mirroredBytes: number;
  /** Matching artifacts left unmirrored because the run's byte budget was spent. */
  mirrorSkipped: number;
  missingWorkflows: string[];
}

interface Run {
  readonly id: number;
  readonly run_attempt: number;
  readonly status: string;
  readonly check_suite_id: number;
}

interface Artifact {
  readonly id: number;
  readonly name: string;
  readonly size_in_bytes: number;
  readonly expired: boolean;
}

export interface CollectOptions {
  readonly rules: ArtifactRules;
  /** GitHub returns at most 1,000 runs per filtered query; larger ranges are split. */
  readonly maxResults?: number;
  /** Shared across the run's days; mirroring stops once an artifact no longer fits. */
  readonly mirrorBudget?: { remainingBytes: number };
}

/**
 * Collects the runs created on one UTC day: each new attempt with its jobs, the run's check runs
 * and artifact metadata, and mirrors matching test-report artifacts. Runs already collected at
 * their current attempt are skipped; runs still in progress are left for a later pass.
 * `state.runs` is updated run by run, so an interrupted day resumes where it stopped.
 */
export async function collectDay(
  client: GitHubClient,
  config: RepoConfig,
  day: string,
  state: RepoState,
  sink: Sink,
  options: CollectOptions,
): Promise<DayCounts> {
  const { repo } = config;
  const counts: DayCounts = { runs: 0, inProgress: 0, attempts: 0, jobs: 0, checkRuns: 0, artifacts: 0, mirrored: 0, mirroredBytes: 0, mirrorSkipped: 0, missingWorkflows: [] };
  const endpoints =
    config.workflows === '*'
      ? [{ name: '*', path: `/repos/${repo}/actions/runs` }]
      : config.workflows.map((file) => ({ name: file, path: `/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs` }));

  const runs = new Map<number, Run>();
  for (const endpoint of endpoints) {
    try {
      const [start, end] = dayBounds(day);
      for (const run of await listRunsCreated(client, endpoint.path, start, end, options.maxResults ?? 1000)) {
        runs.set(run.id, run);
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        counts.missingWorkflows.push(endpoint.name);
        continue;
      }
      throw error;
    }
  }

  for (const run of [...runs.values()].sort((a, b) => a.id - b.id)) {
    if (run.status !== 'completed') {
      counts.inProgress++;
      continue;
    }
    const previous = state.runs[String(run.id)];
    if (previous !== undefined && previous.attempt >= run.run_attempt) {
      continue;
    }
    const base = `/repos/${repo}/actions/runs/${run.id}`;
    for (let attempt = (previous?.attempt ?? 0) + 1; attempt <= run.run_attempt; attempt++) {
      sink.record(repo, 'runs', attempt === run.run_attempt ? run : await client.getJson(`${base}/attempts/${attempt}`));
      counts.attempts++;
      for await (const jobs of client.pages(`${base}/attempts/${attempt}/jobs`, { per_page: 100 }, 'jobs')) {
        for (const job of jobs) {
          sink.record(repo, 'jobs', job);
        }
        counts.jobs += jobs.length;
      }
    }
    for await (const checks of client.pages(`/repos/${repo}/check-suites/${run.check_suite_id}/check-runs`, { per_page: 100 }, 'check_runs')) {
      for (const check of checks) {
        sink.record(repo, 'check-runs', check);
      }
      counts.checkRuns += checks.length;
    }
    const mirrored = new Set(previous?.mirrored ?? []);
    for await (const artifacts of client.pages<Artifact>(`${base}/artifacts`, { per_page: 100 }, 'artifacts')) {
      for (const artifact of artifacts) {
        sink.record(repo, 'artifacts', artifact);
        counts.artifacts++;
        if (config.mirror && !mirrored.has(artifact.id) && shouldMirror(artifact, options.rules)) {
          const budget = options.mirrorBudget;
          if (budget !== undefined && artifact.size_in_bytes > budget.remainingBytes) {
            counts.mirrorSkipped++;
            continue;
          }
          const bytes = await downloadIfPresent(client, repo, artifact.id);
          if (bytes !== null) {
            if (budget !== undefined) {
              budget.remainingBytes -= bytes.length;
            }
            sink.artifact(repo, artifact.id, bytes);
            mirrored.add(artifact.id);
            counts.mirrored++;
            counts.mirroredBytes += bytes.length;
          }
        }
      }
    }
    state.runs[String(run.id)] = { attempt: run.run_attempt, day, mirrored: [...mirrored].sort((a, b) => a - b) };
    counts.runs++;
  }
  return counts;
}

/** Every run created in [start, end], splitting the range while it exceeds the result cap. */
async function listRunsCreated(client: GitHubClient, path: string, start: string, end: string, maxResults: number): Promise<Run[]> {
  const query = { created: `${start}..${end}`, per_page: 100 };
  const first = (await client.getJson(path, { ...query, page: 1 })) as { total_count: number; workflow_runs: Run[] };
  if (first.total_count > maxResults && start !== end) {
    const [left, right] = splitRange(start, end);
    return [...(await listRunsCreated(client, path, ...left, maxResults)), ...(await listRunsCreated(client, path, ...right, maxResults))];
  }
  const runs = [...first.workflow_runs];
  for (let page = 2; (page - 1) * 100 < Math.min(first.total_count, maxResults); page++) {
    const next = (await client.getJson(path, { ...query, page })) as { workflow_runs: Run[] };
    runs.push(...next.workflow_runs);
  }
  return runs;
}

/** Null when the artifact expired or vanished between listing and download. */
async function downloadIfPresent(client: GitHubClient, repo: string, artifactId: number): Promise<Uint8Array | null> {
  try {
    return await client.getArtifactZip(repo, artifactId);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
      return null;
    }
    throw error;
  }
}
