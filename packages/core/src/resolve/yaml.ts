// The subset of YAML that pnpm-workspace.yaml uses for `packages`: a block or flow list of
// scalars. Anything else under `packages` throws, so the caller treats the workspace set as
// unknown instead of silently guessing it.

export function parsePnpmWorkspace(text: string): string[] {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]!);
    const match = /^packages\s*:(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const rest = match[1]!.trim();
    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) {
        throw new SyntaxError('pnpm-workspace.yaml: multi-line flow lists are not supported');
      }
      return rest
        .slice(1, -1)
        .split(',')
        .map((item) => scalar(item.trim()))
        .filter((item) => item !== '');
    }
    if (rest !== '') {
      throw new SyntaxError(`pnpm-workspace.yaml: unsupported value for packages: ${rest}`);
    }
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = stripComment(lines[j]!);
      if (item.trim() === '') {
        continue;
      }
      if (!/^\s/.test(item)) {
        break; // the next top-level key
      }
      const entry = /^\s+-\s+(.*)$/.exec(item);
      if (entry === null) {
        throw new SyntaxError(`pnpm-workspace.yaml: unsupported entry under packages: ${item.trim()}`);
      }
      items.push(scalar(entry[1]!.trim()));
    }
    return items;
  }
  return [];
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote !== null) {
      if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function scalar(raw: string): string {
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1);
  }
  if (/^[&*!|>{[]/.test(raw)) {
    throw new SyntaxError(`pnpm-workspace.yaml: unsupported scalar ${raw}`);
  }
  return raw;
}
