// Command-line parsing: node:util parseArgs per subcommand, so the CLI stays dependency-free.
import { parseArgs } from 'node:util';

import type { Mode } from './config.ts';

export type Command =
  | { readonly name: 'help'; readonly topic?: string }
  | { readonly name: 'version' }
  | { readonly name: 'graph'; readonly rev: string; readonly out: string | null }
  | { readonly name: 'diff'; readonly base: string; readonly head: string }
  | { readonly name: 'plan'; readonly mode: Mode | null; readonly static: boolean; readonly map: string; readonly head: string; readonly shards: number | null };

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const MODES: readonly string[] = ['safe', 'shadow', 'budget'];

export const USAGE = `Usage: sieve <command> [options]

Commands:
  graph [--rev <rev>] [--out <file>]
      Build the static impact graph of a revision (default HEAD) and print it, or write it to
      <file>, as canonical JSON. Day-to-day: sieve graph --out .sieve/map/map.json
  diff <base> <head>
      Print the snapshot difference between two revisions: files, directory listings and
      packages, as canonical JSON.
  plan --mode shadow --static [--map <dir>] [--head <rev>] [--shards <n>]
      Select the tests a change can affect, from the map in <dir> (default .sieve/map) to
      <head> (default HEAD). --shadow is short for --mode shadow. With GITHUB_OUTPUT set it
      writes the outputs matrix and count; with GITHUB_STEP_SUMMARY, a summary. Without a
      usable map it plans every test and exits 0.

      M1 has no test records, so no skip can be proven safe: every would-skip is unproven static
      reachability, --static runs in shadow mode only, and shadow mode runs every test.

Options:
  -h, --help     Show this help (or a command's)
  --version      Print the version
`;

export function parseCommand(argv: readonly string[]): Command {
  const [name, ...rest] = argv;
  if (name === undefined || name === '-h' || name === '--help') {
    return { name: 'help' };
  }
  if (name === 'help') {
    return rest[0] === undefined ? { name: 'help' } : { name: 'help', topic: rest[0] };
  }
  if (name === '--version') {
    return { name: 'version' };
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    return { name: 'help', topic: name };
  }
  switch (name) {
    case 'graph': {
      const { values, positionals } = parse(rest, { rev: { type: 'string' }, out: { type: 'string' } });
      if (positionals.length > 0) {
        throw new UsageError('graph takes no arguments; use --rev <rev>');
      }
      return { name: 'graph', rev: values.rev ?? 'HEAD', out: values.out ?? null };
    }
    case 'diff': {
      const { positionals } = parse(rest, {});
      if (positionals.length !== 2) {
        throw new UsageError('diff takes two revisions: sieve diff <base> <head>');
      }
      return { name: 'diff', base: positionals[0]!, head: positionals[1]! };
    }
    case 'plan': {
      const { values, positionals } = parse(rest, {
        mode: { type: 'string' },
        shadow: { type: 'boolean' },
        static: { type: 'boolean' },
        map: { type: 'string' },
        head: { type: 'string' },
        shards: { type: 'string' },
      });
      if (positionals.length > 0) {
        throw new UsageError('plan takes no arguments');
      }
      if (values.mode !== undefined && !MODES.includes(values.mode)) {
        throw new UsageError('--mode must be safe, shadow or budget');
      }
      if (values.shadow === true && values.mode !== undefined && values.mode !== 'shadow') {
        throw new UsageError(`--shadow and --mode ${values.mode} contradict each other`);
      }
      let shards: number | null = null;
      if (values.shards !== undefined) {
        shards = Number(values.shards);
        if (!/^\d+$/.test(values.shards) || shards < 1 || shards > 256) {
          throw new UsageError('--shards must be an integer from 1 to 256');
        }
      }
      return {
        name: 'plan',
        mode: values.shadow === true ? 'shadow' : ((values.mode as Mode | undefined) ?? null),
        static: values.static === true,
        map: values.map ?? '.sieve/map',
        head: values.head ?? 'HEAD',
        shards,
      };
    }
    default:
      throw new UsageError(`unknown command ${JSON.stringify(name)}`);
  }
}

/**
 * The mode a plan runs in. Kickoff gap 1: with no test records no skip can be proven safe
 * (ADR-0005), so a static plan is shadow only, and plans without --static do not exist yet.
 */
export function planMode(flags: { readonly mode: Mode | null; readonly static: boolean }, configured: Mode | undefined): 'shadow' {
  const mode = flags.mode ?? configured ?? 'shadow';
  if (!flags.static) {
    throw new UsageError('plan needs --static: selection from test records arrives with M2 and M3');
  }
  if (mode === 'safe') {
    throw new UsageError('--static cannot prove a skip safe: without test records every would-skip is unproven static reachability (ADR-0005). Use --mode shadow.');
  }
  if (mode === 'budget') {
    throw new UsageError('budget mode needs test records and durations (M7); use --mode shadow');
  }
  return mode;
}

function parse<T extends Record<string, { type: 'string' | 'boolean' }>>(args: readonly string[], options: T) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}
