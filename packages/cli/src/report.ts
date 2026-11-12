// What `sieve plan` prints and hands to GitHub Actions: the plan JSON, the shard matrix and count
// for $GITHUB_OUTPUT, and a markdown job summary. In shadow mode every test runs; the static
// selection is only reported, and its would-skips are labelled unproven (kickoff gap 1).
import { canonicalJson, type Escalation, type Selection } from '@sieve-ci/core';

/** The label of every would-skip until records can prove skips safe (ADR-0005). */
export const UNPROVEN = 'unproven static reachability';

const TOP_AFFECTED = 20;
const MAX_LISTED = 200;

export interface PlanReport {
  readonly version: 1;
  readonly mode: 'shadow';
  readonly static: true;
  readonly base: { readonly map: string; readonly rootTree: string } | null;
  readonly head: { readonly rev: string; readonly rootTree: string };
  /** Why no map could be used; the plan then runs everything. */
  readonly fallback?: string;
  readonly escalations: readonly Escalation[];
  readonly changed: readonly string[];
  readonly uncertain: Readonly<Record<string, readonly string[]>>;
  readonly affected: Selection['affected'];
  readonly forced: Selection['forced'];
  /** How many tests the static selection would run. */
  readonly wouldRun: number;
  readonly wouldSkip: readonly { readonly test: string; readonly label: string }[];
  /** Projects SIEVE does not select for (other runners, results-only); run them as usual. */
  readonly notPlanned: readonly string[];
  /** What runs: in shadow mode, every test. */
  readonly run: readonly string[];
  readonly shards: readonly (readonly string[])[];
}

export interface ReportInput {
  readonly selection: Selection;
  readonly base: PlanReport['base'];
  readonly head: PlanReport['head'];
  readonly uncertainCauses?: Readonly<Record<string, readonly string[]>>;
  readonly notPlanned: readonly string[];
  readonly shards: number;
  readonly fallback?: string;
}

export function buildReport(input: ReportInput): PlanReport {
  const { selection } = input;
  const run = [...selection.tests];
  const causes = input.uncertainCauses ?? {};
  return {
    version: 1,
    mode: 'shadow',
    static: true,
    base: input.base,
    head: input.head,
    ...(input.fallback === undefined ? {} : { fallback: input.fallback }),
    escalations: selection.escalations,
    changed: selection.changed,
    uncertain: Object.fromEntries(selection.uncertain.map((key) => [key, causes[key] ?? []])),
    affected: selection.affected,
    forced: selection.forced,
    wouldRun: selection.affected.length + selection.forced.length,
    wouldSkip: selection.wouldSkip.map((test) => ({ test, label: UNPROVEN })),
    notPlanned: input.notPlanned,
    run,
    shards: splitShards(run, input.shards),
  };
}

/** Round-robin over the sorted run set; no more shards than tests. */
export function splitShards(tests: readonly string[], count: number): string[][] {
  const shards: string[][] = Array.from({ length: Math.min(count, tests.length) }, () => []);
  tests.forEach((test, i) => {
    shards[i % shards.length]!.push(test);
  });
  return shards;
}

/** `$GITHUB_OUTPUT` lines: `matrix` for `strategy.matrix` and `count`, the test files to run. */
export function githubOutputs(report: PlanReport): string {
  const matrix = { include: report.shards.map((files, i) => ({ shard: i + 1, files })) };
  return `matrix=${canonicalJson(matrix)}\ncount=${report.run.length}\n`;
}

export function summaryOf(report: PlanReport): string {
  const lines = ['## SIEVE plan (shadow, static)', ''];
  if (report.fallback !== undefined) {
    lines.push(`SIEVE could not use a map (${report.fallback}), so it ran all ${report.run.length} test files.`);
  } else {
    lines.push(
      `Ran all ${report.run.length} test files (shadow mode).`,
      '',
      `Static reachability would have run ${report.wouldRun} and skipped ${report.wouldSkip.length}. ` +
        `Every would-skip is **${UNPROVEN}**: M1 has no test records, so no skip is proven safe, and none is taken.`,
    );
  }
  if (report.notPlanned.length > 0) {
    lines.push('', `Not planned by SIEVE: ${report.notPlanned.join(', ')}. Run them as usual.`);
  }
  if (report.escalations.length > 0) {
    lines.push('', '### Escalations', '');
    for (const escalation of report.escalations) {
      const scope = escalation.scope === undefined ? '' : ` (\`${escalation.scope === '' ? '.' : escalation.scope}\`)`;
      lines.push(`- ${escalation.level}${scope}: ${escalation.cause}`);
    }
  }
  if (report.affected.length > 0) {
    lines.push('', `### Affected tests (${report.affected.length})`, '');
    for (const { path } of report.affected.slice(0, TOP_AFFECTED)) {
      lines.push(`- ${whyPath(path, report.uncertain)}`);
    }
    if (report.affected.length > TOP_AFFECTED) {
      lines.push(`- … and ${report.affected.length - TOP_AFFECTED} more in the plan JSON`);
    }
  }
  const forced = report.fallback === undefined ? report.forced.filter((f) => !f.reason.startsWith('L3: ')) : [];
  if (forced.length > 0) {
    lines.push('', `### Also run (${forced.length})`, '');
    for (const { test, reason } of forced.slice(0, MAX_LISTED)) {
      lines.push(`- \`${test}\`: ${reason}`);
    }
  }
  if (report.wouldSkip.length > 0) {
    lines.push('', `<details><summary>Would skip ${report.wouldSkip.length} (${UNPROVEN})</summary>`, '');
    for (const { test } of report.wouldSkip.slice(0, MAX_LISTED)) {
      lines.push(`- \`${test}\``);
    }
    if (report.wouldSkip.length > MAX_LISTED) {
      lines.push(`- … and ${report.wouldSkip.length - MAX_LISTED} more`);
    }
    lines.push('', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

/** Test first, then each dependency, ending at the changed or uncertain node. */
function whyPath(path: readonly string[], uncertain: PlanReport['uncertain']): string {
  const steps = path.map((node, i) => {
    if (i === path.length - 1 && node.startsWith('u:')) {
      return `uncertain: ${(uncertain[node] ?? []).join('; ')}`;
    }
    const shown = `\`${node.startsWith('f:') ? node.slice(2) : node}\``;
    return i === path.length - 1 ? `${shown} (changed)` : shown;
  });
  return steps.join(' → ');
}
