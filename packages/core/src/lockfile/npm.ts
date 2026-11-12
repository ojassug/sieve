// npm lockfiles → `p:npm:<install location>` nodes (architecture §3.1). A package's hash is its
// lockfile identity at that location: the integrity when present, else version and resolved URL,
// and `link:<dir>` for workspace links (whose files are already `f:` nodes). Formats this module
// cannot read are reported as unparseable, which escalates to L3 (§3.5) instead of guessing.

export interface LockedPackage {
  readonly location: string;
  readonly name: string;
  readonly hash: string;
  /** The workspace directory a link entry points at. */
  readonly link?: string;
}

export interface Unparseable {
  readonly kind: 'unparseable';
  readonly format: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  readonly reason: string;
}

export class NpmLockfile {
  readonly kind = 'npm';
  /** Installed packages by location, sorted by location. */
  readonly packages: ReadonlyMap<string, LockedPackage>;
  private readonly declared: ReadonlyMap<string, readonly string[]>;

  constructor(packages: ReadonlyMap<string, LockedPackage>, declared: ReadonlyMap<string, readonly string[]>) {
    this.packages = packages;
    this.declared = declared;
  }

  /** The location Node would load `name` from, searching node_modules upwards from `dir`; null if not installed. */
  locate(name: string, dir: string): string | null {
    for (const modules of lookupDirs(dir)) {
      const location = `${modules}/${name}`;
      if (this.packages.has(location)) {
        return location;
      }
    }
    return null;
  }

  /** Where a package's dependencies, optional dependencies and peers resolve from its own location. */
  dependencies(location: string): { resolved: string[]; missing: string[] } {
    const resolved = new Set<string>();
    const missing = new Set<string>();
    for (const name of this.declared.get(location) ?? []) {
      const found = this.locate(name, location);
      if (found === null) {
        missing.add(name);
      } else {
        resolved.add(found);
      }
    }
    return { resolved: [...resolved].sort(compareStrings), missing: [...missing].sort(compareStrings) };
  }
}

export function parseNpmLockfile(text: string): NpmLockfile | Unparseable {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'unparseable', format: 'npm', reason: 'invalid JSON' };
  }
  const root = isRecord(json) ? json : {};
  if (root['lockfileVersion'] === 1) {
    return { kind: 'unparseable', format: 'npm', reason: 'lockfileVersion 1 has no packages map' };
  }
  const entries = root['packages'];
  if (!isRecord(entries)) {
    return { kind: 'unparseable', format: 'npm', reason: 'no packages map' };
  }
  const packages = new Map<string, LockedPackage>();
  const declared = new Map<string, string[]>();
  for (const location of Object.keys(entries).sort(compareStrings)) {
    const entry = entries[location];
    // '' is the root project and paths without node_modules are workspace declarations: both are
    // package.json files in the repository, already tracked as `f:` nodes.
    if (!location.includes('node_modules/') || !isRecord(entry)) {
      continue;
    }
    const name = typeof entry['name'] === 'string' ? entry['name'] : location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const resolved = typeof entry['resolved'] === 'string' ? entry['resolved'] : '';
    if (entry['link'] === true) {
      packages.set(location, { location, name, hash: `link:${resolved}`, link: resolved });
      continue;
    }
    const integrity = typeof entry['integrity'] === 'string' ? entry['integrity'] : null;
    const version = typeof entry['version'] === 'string' ? entry['version'] : '';
    packages.set(location, { location, name, hash: integrity ?? `${version}|${resolved}` });
    declared.set(location, [
      ...Object.keys(isRecord(entry['dependencies']) ? entry['dependencies'] : {}),
      ...Object.keys(isRecord(entry['optionalDependencies']) ? entry['optionalDependencies'] : {}),
      ...Object.keys(isRecord(entry['peerDependencies']) ? entry['peerDependencies'] : {}),
    ]);
  }
  return new NpmLockfile(packages, declared);
}

/** Install locations that appeared, changed hash or disappeared between two lockfiles. */
export function diffLockfiles(before: NpmLockfile, after: NpmLockfile): { added: string[]; changed: string[]; removed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [location, pkg] of after.packages) {
    const old = before.packages.get(location);
    if (old === undefined) {
      added.push(location);
    } else if (old.hash !== pkg.hash) {
      changed.push(location);
    }
  }
  for (const location of before.packages.keys()) {
    if (!after.packages.has(location)) {
      removed.push(location);
    }
  }
  return { added, changed, removed };
}

const LOCKFILES: readonly (readonly [string, Unparseable['format']])[] = [
  ['npm-shrinkwrap.json', 'npm'],
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

/** Every root lockfile name `detectLockfile` knows. */
export const LOCKFILE_PATHS: readonly string[] = LOCKFILES.map(([path]) => path);

export type DetectedLockfile = { readonly kind: 'npm'; readonly path: string } | (Unparseable & { readonly path: string }) | { readonly kind: 'none' };

/** Which root lockfile the install uses. Only npm's is parsed; others, or several kinds at once, are unparseable. */
export function detectLockfile(rootFiles: ReadonlySet<string>): DetectedLockfile {
  const present = LOCKFILES.filter(([path]) => rootFiles.has(path));
  if (present.length === 0) {
    return { kind: 'none' };
  }
  const [path, format] = present[0]!;
  const formats = new Set(present.map(([, f]) => f));
  if (formats.size > 1) {
    const names = present.map(([p]) => p).sort(compareStrings);
    return { kind: 'unparseable', format: 'unknown', path: names[0]!, reason: `more than one lockfile: ${names.join(', ')}` };
  }
  if (format === 'npm') {
    return { kind: 'npm', path };
  }
  return { kind: 'unparseable', format, path, reason: `${format} lockfiles are not parsed yet` };
}

/** node_modules directories Node searches from `dir`, nearest first (never `node_modules/node_modules`). */
function lookupDirs(dir: string): string[] {
  const dirs: string[] = [];
  const parts = dir === '' ? [] : dir.split('/');
  for (let i = parts.length; i >= 0; i--) {
    if (i > 0 && parts[i - 1] === 'node_modules') {
      continue;
    }
    const base = parts.slice(0, i).join('/');
    dirs.push(base === '' ? 'node_modules' : `${base}/node_modules`);
  }
  return dirs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
