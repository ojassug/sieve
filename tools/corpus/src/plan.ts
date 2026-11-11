import { addDays, daysInRange } from './days.ts';

export interface RunState {
  readonly attempt: number;
  readonly day: string;
  readonly mirrored: readonly number[];
}

export interface RepoState {
  days: Record<string, 'complete'>;
  runs: Record<string, RunState>;
}

export interface CollectorState {
  startedOn: string;
  repos: Record<string, RepoState>;
}

export interface WorkItem {
  readonly repo: string;
  readonly day: string;
  /** Recent days are re-listed every run to catch new attempts and short-lived artifacts. */
  readonly kind: 'recent' | 'backfill';
}

export interface PlanOptions {
  readonly today: string;
  /** Days before today that are re-collected on every run. */
  readonly recentDays: number;
  /** The oldest day still worth collecting, as days before today (GitHub keeps 90). */
  readonly horizonDays: number;
}

/**
 * Recent days first (they hold new attempts and artifacts that may expire quickly), then the
 * backfill oldest-first, because the oldest days disappear first. Repos keep their priority order.
 */
export function planWork(repos: readonly string[], state: CollectorState, options: PlanOptions): WorkItem[] {
  const { today, recentDays, horizonDays } = options;
  const items: WorkItem[] = [];
  for (const day of daysInRange(addDays(today, -recentDays), addDays(today, -1))) {
    for (const repo of repos) {
      items.push({ repo, day, kind: 'recent' });
    }
  }
  for (const day of daysInRange(addDays(today, -horizonDays), addDays(today, -recentDays - 1))) {
    for (const repo of repos) {
      if (state.repos[repo]?.days[day] !== 'complete') {
        items.push({ repo, day, kind: 'backfill' });
      }
    }
  }
  return items;
}
