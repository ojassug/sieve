// UTC calendar days ('YYYY-MM-DD') and second-precision ISO ranges for the runs API `created` filter.

const DAY_MS = 86_400_000;

function parseDay(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new RangeError(`not a YYYY-MM-DD day: ${day}`);
  }
  return ms;
}

export function addDays(day: string, n: number): string {
  return new Date(parseDay(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `from` to `to` inclusive, ascending; empty when `to` is before `from`. */
export function daysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = parseDay(from), end = parseDay(to); ms <= end; ms += DAY_MS) {
    days.push(new Date(ms).toISOString().slice(0, 10));
  }
  return days;
}

export function dayBounds(day: string): [string, string] {
  parseDay(day);
  return [`${day}T00:00:00Z`, `${day}T23:59:59Z`];
}

/** Two adjacent halves of an inclusive second-precision range. */
export function splitRange(start: string, end: string): [[string, string], [string, string]] {
  const s = Date.parse(start) / 1000;
  const e = Date.parse(end) / 1000;
  if (!(e > s)) {
    throw new RangeError(`cannot split ${start}..${end}`);
  }
  const mid = Math.floor((s + e) / 2);
  return [
    [start, iso(mid)],
    [iso(mid + 1), end],
  ];
}

function iso(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
}
