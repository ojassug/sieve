/**
 * Canonical JSON: the same value always serializes to the same bytes.
 *
 * - Object keys are sorted by UTF-16 code units at every depth (as in RFC 8785).
 * - Properties whose value is `undefined` are omitted; `undefined` anywhere else is an error.
 * - Numbers use the ECMAScript shortest round-trip form; `-0` becomes `0`; NaN and ±Infinity are errors.
 * - Only plain objects (prototype `Object.prototype` or `null`), arrays, strings, finite numbers,
 *   booleans and null are accepted. Anything else is an error rather than a silent coercion.
 */
export function canonicalJson(value: unknown): string {
  return write(value, null, '', new Set());
}

/** Canonical JSON indented by two spaces, with a trailing newline, for files and terminals. */
export function canonicalJsonPretty(value: unknown): string {
  return `${write(value, '  ', '', new Set())}\n`;
}

function write(value: unknown, indent: string | null, depth: string, path: Set<object>): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number ${String(value)}`);
      }
      return JSON.stringify(value);
    case 'object':
      if (value === null) {
        return 'null';
      }
      return writeContainer(value, indent, depth, path);
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}

function writeContainer(value: object, indent: string | null, depth: string, path: Set<object>): string {
  if (path.has(value)) {
    throw new TypeError('canonicalJson: cycle');
  }
  const inner = indent === null ? depth : depth + indent;
  const open = indent === null ? '' : `\n${inner}`;
  const close = indent === null ? '' : `\n${depth}`;
  const colon = indent === null ? ':' : ': ';
  const parts: string[] = [];

  path.add(value);
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) {
      if (item === undefined) {
        throw new TypeError('canonicalJson: undefined array element');
      }
      parts.push(write(item, indent, inner, path));
    }
  } else {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('canonicalJson: only plain objects and arrays are supported');
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) {
        parts.push(JSON.stringify(key) + colon + write(item, indent, inner, path));
      }
    }
  }
  path.delete(value);

  const [first, last] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (parts.length === 0) {
    return first + last;
  }
  return first + open + parts.join(`,${open}`) + close + last;
}
