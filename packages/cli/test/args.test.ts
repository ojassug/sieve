import { describe, expect, it } from 'vitest';

import { parseCommand, planMode, UsageError } from '../src/args.ts';

describe('parseCommand', () => {
  it('reads graph with its defaults and options', () => {
    expect(parseCommand(['graph'])).toEqual({ name: 'graph', rev: 'HEAD', out: null });
    expect(parseCommand(['graph', '--rev', 'main', '--out', 'm.json'])).toEqual({ name: 'graph', rev: 'main', out: 'm.json' });
  });

  it('reads diff with exactly two revisions', () => {
    expect(parseCommand(['diff', 'a', 'b'])).toEqual({ name: 'diff', base: 'a', head: 'b' });
    expect(() => parseCommand(['diff', 'a'])).toThrow(UsageError);
    expect(() => parseCommand(['diff', 'a', 'b', 'c'])).toThrow(UsageError);
  });

  it('reads plan, with --shadow as an alias of --mode shadow', () => {
    const plan = { name: 'plan', mode: 'shadow', static: true, map: '.trommel/map', head: 'HEAD', shards: null };
    expect(parseCommand(['plan', '--mode', 'shadow', '--static', '--map', '.trommel/map'])).toEqual(plan);
    expect(parseCommand(['plan', '--shadow', '--static', '--map', '.trommel/map'])).toEqual(plan);
    expect(parseCommand(['plan', '--static'])).toEqual({ ...plan, mode: null });
    expect(parseCommand(['plan', '--static', '--shards', '4', '--head', 'abc'])).toEqual({ ...plan, mode: null, shards: 4, head: 'abc' });
  });

  it.each([
    [['plan', '--shadow', '--mode', 'safe', '--static'], /--shadow and --mode safe/],
    [['plan', '--mode', 'fast', '--static'], /--mode must be safe, shadow or budget/],
    [['plan', '--static', '--shards', '0'], /--shards must be an integer from 1 to 256/],
    [['plan', '--static', '--frobnicate'], /frobnicate/],
    [['graph', 'extra'], /graph takes no arguments/],
    [['nope'], /unknown command "nope"/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(message);
  });

  it('reads help and version', () => {
    expect(parseCommand([])).toEqual({ name: 'help' });
    expect(parseCommand(['--help'])).toEqual({ name: 'help' });
    expect(parseCommand(['help', 'plan'])).toEqual({ name: 'help', topic: 'plan' });
    expect(parseCommand(['plan', '--help'])).toEqual({ name: 'help', topic: 'plan' });
    expect(parseCommand(['--version'])).toEqual({ name: 'version' });
  });
});

// Kickoff gap 1 (DECISIONS 1): without records no skip is safe, so --static plans are shadow only.
describe('planMode', () => {
  it('runs static plans in shadow mode, from the flag or the config', () => {
    expect(planMode({ mode: 'shadow', static: true }, undefined)).toBe('shadow');
    expect(planMode({ mode: null, static: true }, 'shadow')).toBe('shadow');
    expect(planMode({ mode: null, static: true }, undefined)).toBe('shadow');
  });

  it('refuses --mode safe with --static, from the flag or the config', () => {
    expect(() => planMode({ mode: 'safe', static: true }, undefined)).toThrow(/--static cannot prove a skip safe.*unproven static reachability/);
    expect(() => planMode({ mode: null, static: true }, 'safe')).toThrow(/--static cannot prove a skip safe/);
  });

  it('refuses budget mode and plans without --static, which need records', () => {
    expect(() => planMode({ mode: 'budget', static: true }, undefined)).toThrow(/budget/);
    expect(() => planMode({ mode: 'shadow', static: false }, undefined)).toThrow(/needs --static/);
  });
});
