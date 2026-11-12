// Module resolution for TypeScript and JavaScript (architecture §3.2), over git's view of the
// repository rather than the working tree, so every OS resolves the same way.
//
// Runners resolve differently (TypeScript prefers `.ts`, Vite's default probes `.js` first, Jest
// and Node have their own lists), so this resolver takes the union: every candidate any of them
// might pick is probed. Each probe is recorded — an existing file is a target, a missing one an
// absent (⊥) node, a probed directory a `d:` node, a config file read a config node — so a
// result depends only on what it recorded. Anything it cannot decide is `unresolved`, never
// silently dropped.
import type { ImportKind } from '../lex/ts.ts';
import { globToRegExp } from './glob.ts';
import { parseJsonc } from './jsonc.ts';
import { parsePnpmWorkspace } from './yaml.ts';

export type EntryKind = 'file' | 'symlink' | 'submodule' | 'dir';

/** A read-only view of one snapshot: repo-relative POSIX paths, case-sensitive, '' is the root. */
export interface Vfs {
  kind(path: string): EntryKind | null;
  /** File contents, or a symlink's target. */
  read(path: string): string | null;
  /** Every file, symlink and submodule path (never a directory), sorted by UTF-16 code units. */
  files(): readonly string[];
}

export class MemoryVfs implements Vfs {
  private readonly entries = new Map<string, EntryKind>([['', 'dir']]);
  private readonly contents = new Map<string, string>();
  private readonly list: string[];

  constructor(files: Readonly<Record<string, string>>, symlinks: Readonly<Record<string, string>> = {}) {
    const add = (path: string, kind: EntryKind, content: string): void => {
      this.entries.set(path, kind);
      this.contents.set(path, content);
      for (let dir = dirname(path); dir !== ''; dir = dirname(dir)) {
        this.entries.set(dir, 'dir');
      }
    };
    for (const [path, content] of Object.entries(files)) {
      add(path, 'file', content);
    }
    for (const [path, target] of Object.entries(symlinks)) {
      add(path, 'symlink', target);
    }
    this.list = [...Object.keys(files), ...Object.keys(symlinks)].sort(compareStrings);
  }

  kind(path: string): EntryKind | null {
    return this.entries.get(path) ?? null;
  }

  read(path: string): string | null {
    return this.contents.get(path) ?? null;
  }

  files(): readonly string[] {
    return this.list;
  }
}

export type ResolutionKind = 'file' | 'external' | 'builtin' | 'ignored' | 'unresolved';

export interface GlobEvidence {
  readonly key: string;
  readonly matches: readonly string[];
}

export interface Resolution {
  readonly kind: ResolutionKind;
  /** Repo files the import may load, sorted. */
  readonly targets: readonly string[];
  /** Probed paths that do not exist: ⊥ nodes. */
  readonly absent: readonly string[];
  /** Directories whose listing the result depends on: `d:` nodes (absent ones included). */
  readonly dirs: readonly string[];
  /** Config files read: package.json, tsconfig chains, workspace files. */
  readonly configs: readonly string[];
  /** Sets the result depends on: workspace name maps and glob matches (`g:` nodes). */
  readonly globs: readonly GlobEvidence[];
  /** The npm package a bare specifier may load from node_modules (a `p:` node). */
  readonly packageName?: string;
  /** Why the import is unresolved. */
  readonly reason?: string;
  /** Inputs the resolver could not read (an unparseable config): the result may be incomplete. */
  readonly uncertain?: true;
}

export interface ResolveRequest {
  readonly from: string;
  readonly specifier: string | null;
  readonly kind: ImportKind;
  readonly patterns?: readonly string[] | null;
  readonly base?: string;
}

/** Every extension any supported runner may append, union of TypeScript, Vite and Jest. */
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
/** A `.js` specifier may name a TypeScript source (TypeScript and Vite both map it). */
const TS_SOURCE_FOR: Readonly<Record<string, readonly string[]>> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const PACKAGE_FIELDS = ['main', 'module', 'browser', 'jsnext:main'];
/** tsconfig bases published under this scope never set `paths` or `baseUrl`. */
const PATHLESS_TSCONFIG_SCOPE = '@tsconfig/';

const BUILTINS: ReadonlySet<string> = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'dns/promises', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'inspector/promises', 'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'readline/promises', 'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'timers', 'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm',
  'wasi', 'worker_threads', 'zlib',
]);

class Evidence {
  readonly targets = new Set<string>();
  readonly absent = new Set<string>();
  readonly dirs = new Set<string>();
  readonly configs = new Set<string>();
  readonly globs = new Map<string, readonly string[]>();
  packageName: string | undefined;
  reason: string | undefined;
  uncertain = false;

  note(reason: string): void {
    this.reason ??= reason;
  }
}

interface Tsconfig {
  readonly files: readonly string[];
  readonly absent: readonly string[];
  readonly baseUrl: string | null;
  readonly paths: Readonly<Record<string, readonly string[]>> | null;
  readonly pathsBase: string;
  readonly uncertain: boolean;
}

interface Workspaces {
  readonly configs: readonly string[];
  readonly absent: readonly string[];
  readonly byName: ReadonlyMap<string, string>;
  readonly names: readonly string[];
  readonly uncertain: boolean;
}

export class Resolver {
  private readonly vfs: Vfs;
  private readonly tsconfigCache = new Map<string, Tsconfig>();
  private readonly packageJsonCache = new Map<string, Record<string, unknown> | null>();
  private workspaceCache: Workspaces | null = null;

  constructor(vfs: Vfs) {
    this.vfs = vfs;
  }

  resolve(request: ResolveRequest): Resolution {
    const ev = new Evidence();
    const { from, kind } = request;
    if (kind === 'glob') {
      this.resolveGlob(request, ev);
      return finish(ev, true);
    }
    const specifier = request.specifier;
    if (specifier === null) {
      ev.note('non-literal');
      return finish(ev, false);
    }
    if (specifier.startsWith('node:') || BUILTINS.has(specifier)) {
      return { kind: 'builtin', targets: [], absent: [], dirs: [], configs: [], globs: [] };
    }
    if (specifier.startsWith('data:')) {
      return { kind: 'ignored', targets: [], absent: [], dirs: [], configs: [], globs: [] };
    }
    if (/^https?:/.test(specifier)) {
      ev.note('remote module');
      return finish(ev, false);
    }
    if (/^[a-z][\w+.-]*:/i.test(specifier)) {
      ev.note('virtual module');
      return finish(ev, false);
    }
    const path = stripQuery(specifier);
    const fromDir = dirname(from);
    if (kind === 'url') {
      const target = joinPath(fromDir, path);
      if (target === null) {
        ev.note('outside repository');
      } else {
        this.probe(target, ev);
      }
      return finish(ev, false);
    }
    if (path === '.' || path === '..' || path.startsWith('./') || path.startsWith('../')) {
      this.resolveRelative(fromDir, path, ev);
    } else if (path.startsWith('/')) {
      // Vite treats a leading slash as relative to its root: the package root, or the repo root.
      for (const root of new Set([this.ownerDir(from), ''])) {
        this.resolveRelative(root, `.${path}`, ev);
      }
    } else if (path.startsWith('#')) {
      this.resolveImportsField(from, path, ev);
    } else {
      this.resolveBare(from, path, ev);
    }
    if (kind === 'mock' || kind === 'actual') {
      this.mockCandidates(ev);
    }
    return finish(ev, false);
  }

  /**
   * Config files that govern `path` itself, whatever it imports: its tsconfig chain and the nearest
   * package.json (whose `type` decides how Node loads it), plus every miss found on the way up.
   */
  fileConfigs(path: string): { configs: string[]; absent: string[] } {
    const tsconfig = this.findTsconfig(dirname(path));
    const configs = new Set(tsconfig.files);
    const absent = new Set(tsconfig.absent);
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      const packageJson = joinPath(dir, 'package.json')!;
      if (this.vfs.kind(packageJson) === 'file') {
        configs.add(packageJson);
        break;
      }
      absent.add(packageJson);
      if (dir === '') {
        break;
      }
    }
    return { configs: [...configs].sort(compareStrings), absent: [...absent].sort(compareStrings) };
  }

  /** The directory of the nearest package.json above `path` ('' when only the root has one, or none). */
  ownerDir(path: string): string {
    for (let dir = dirname(path); ; dir = dirname(dir)) {
      if (this.vfs.kind(joinPath(dir, 'package.json')!) === 'file' || dir === '') {
        return dir;
      }
    }
  }

  private resolveRelative(fromDir: string, specifier: string, ev: Evidence): void {
    const path = joinPath(fromDir, specifier);
    if (path === null) {
      ev.note('outside repository');
      return;
    }
    this.resolvePath(path, ev);
  }

  /** A path that may need an extension, a TypeScript source, an index file or a package entry. */
  private resolvePath(path: string, ev: Evidence): void {
    const kind = this.probe(path, ev);
    if (kind === 'file' || kind === 'symlink') {
      return; // every runner tries the exact path first
    }
    const dot = path.lastIndexOf('.');
    const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
    for (const source of TS_SOURCE_FOR[ext] ?? []) {
      this.probe(path.slice(0, dot) + source, ev);
    }
    for (const extension of EXTENSIONS) {
      this.probe(path + extension, ev);
    }
    if (kind === 'dir') {
      if (this.packageJson(path, ev) !== null) {
        this.resolvePackage(path, '.', ev);
      }
      for (const extension of EXTENSIONS) {
        this.probe(`${path}/index${extension}`, ev);
      }
    } else {
      ev.dirs.add(path); // it may yet become a directory with an index file
    }
  }

  private resolveBare(from: string, specifier: string, ev: Evidence): void {
    const match = /^((?:@[^/]+\/)?[^/]+)(\/.*)?$/.exec(specifier);
    if (match === null || match[1]!.startsWith('.')) {
      ev.note('invalid package name');
      return;
    }
    const name = match[1]!;
    const subpath = match[2] === undefined ? '.' : `.${match[2]}`;

    const tsconfig = this.tsconfigFor(dirname(from), ev);
    if (tsconfig !== null) {
      this.applyTsconfig(tsconfig, specifier, ev);
    }

    const workspaces = this.workspaces();
    for (const config of workspaces.configs) {
      ev.configs.add(config);
    }
    for (const path of workspaces.absent) {
      ev.absent.add(path);
    }
    ev.globs.set('workspaces', workspaces.names);
    if (workspaces.uncertain) {
      ev.uncertain = true;
    }
    const dir = workspaces.byName.get(name);
    if (dir !== undefined) {
      this.packageJson(dir, ev);
      this.resolvePackage(dir, subpath, ev);
      return;
    }
    ev.packageName = name;
    this.rootMocks(name, from, ev);
  }

  /** `#name` from the nearest package.json's `imports`; targets may themselves be packages. */
  private resolveImportsField(from: string, specifier: string, ev: Evidence): void {
    const dir = this.ownerDir(from);
    for (let probe = dirname(from); probe !== dir; probe = dirname(probe)) {
      ev.absent.add(joinPath(probe, 'package.json')!);
    }
    const json = this.packageJson(dir, ev);
    const targets = json === null ? null : exportsTargets(json['imports'], specifier, true);
    if (targets === null || targets.length === 0) {
      ev.note('not imported');
      return;
    }
    for (const target of targets) {
      if (target.startsWith('./')) {
        const path = joinPath(dir, target);
        if (path === null) {
          ev.note('outside repository');
        } else {
          this.probe(path, ev);
        }
      } else {
        this.resolveBare(from, target, ev);
      }
    }
  }

  /** A package's entry or subpath: `exports` when present, else main fields, index and plain paths. */
  private resolvePackage(dir: string, subpath: string, ev: Evidence): void {
    const json = this.packageJson(dir, ev);
    if (json === null) {
      return;
    }
    if (json['exports'] !== undefined) {
      const targets = exportsTargets(json['exports'], subpath);
      if (targets === null || targets.length === 0) {
        ev.note('not exported');
        return;
      }
      for (const target of targets) {
        const path = joinPath(dir, target);
        if (path === null) {
          ev.note('outside repository');
        } else {
          this.probe(path, ev);
        }
      }
      return;
    }
    if (subpath !== '.') {
      this.resolvePath(joinPath(dir, subpath)!, ev);
      return;
    }
    for (const field of PACKAGE_FIELDS) {
      const value = json[field];
      if (typeof value === 'string') {
        const path = joinPath(dir, value);
        if (path !== null && path !== dir) {
          this.resolvePath(path, ev);
        }
      }
    }
    this.resolvePath(joinPath(dir, 'index')!, ev);
  }

  private applyTsconfig(tsconfig: Tsconfig, specifier: string, ev: Evidence): void {
    if (tsconfig.paths !== null) {
      let best: string | null = null;
      let star = '';
      for (const pattern of Object.keys(tsconfig.paths)) {
        const at = pattern.indexOf('*');
        if (at === -1) {
          if (pattern === specifier) {
            best = pattern;
            star = '';
            break;
          }
          continue;
        }
        const prefix = pattern.slice(0, at);
        const suffix = pattern.slice(at + 1);
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
          if (best === null || prefix.length > best.indexOf('*')) {
            best = pattern;
            star = specifier.slice(prefix.length, specifier.length - suffix.length);
          }
        }
      }
      if (best !== null) {
        for (const substitution of tsconfig.paths[best]!) {
          const path = joinPath(tsconfig.pathsBase, substitution.replace('*', star));
          if (path !== null) {
            this.resolvePath(path, ev);
          }
        }
      }
    }
    if (tsconfig.baseUrl !== null) {
      const path = joinPath(tsconfig.baseUrl, specifier);
      if (path !== null) {
        this.resolvePath(path, ev);
      }
    }
  }

  /** The tsconfig governing files in `dir`, recorded as evidence; null when there is none. */
  private tsconfigFor(dir: string, ev: Evidence): Tsconfig | null {
    const found = this.findTsconfig(dir);
    for (const file of found.files) {
      ev.configs.add(file);
    }
    for (const path of found.absent) {
      ev.absent.add(path);
    }
    if (found.uncertain) {
      ev.uncertain = true;
    }
    return found.files.length === 0 ? null : found;
  }

  /** The nearest tsconfig.json at or above `dir` with its `extends` chain, and every miss on the way. */
  private findTsconfig(dir: string): Tsconfig {
    const cached = this.tsconfigCache.get(dir);
    if (cached !== undefined) {
      return cached;
    }
    const path = joinPath(dir, 'tsconfig.json')!;
    let found: Tsconfig;
    if (this.vfs.kind(path) === 'file') {
      found = this.loadTsconfig(path, new Set());
    } else if (dir === '') {
      found = { files: [], absent: [path], baseUrl: null, paths: null, pathsBase: '', uncertain: false };
    } else {
      const parent = this.findTsconfig(dirname(dir));
      found = { ...parent, absent: [path, ...parent.absent] };
    }
    this.tsconfigCache.set(dir, found);
    return found;
  }

  private loadTsconfig(path: string, seen: Set<string>): Tsconfig {
    const dir = dirname(path);
    const files = [path];
    const absent: string[] = [];
    let uncertain = false;
    let json: Record<string, unknown> = {};
    try {
      const parsed = parseJsonc(this.vfs.read(path) ?? '');
      json = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      uncertain = true;
    }
    let baseUrl: string | null = null;
    let paths: Record<string, readonly string[]> | null = null;
    let pathsBase = dir;
    const bases = json['extends'] === undefined ? [] : Array.isArray(json['extends']) ? json['extends'] : [json['extends']];
    for (const base of bases) {
      if (typeof base !== 'string') {
        uncertain = true;
        continue;
      }
      if (!base.startsWith('.') && !base.startsWith('/')) {
        uncertain ||= !base.startsWith(PATHLESS_TSCONFIG_SCOPE);
        continue;
      }
      let target = joinPath(dir, base);
      if (target !== null && this.vfs.kind(target) !== 'file' && !target.endsWith('.json')) {
        absent.push(target);
        target = `${target}.json`;
      }
      if (target === null || seen.has(target) || this.vfs.kind(target) !== 'file') {
        if (target !== null && !seen.has(target)) {
          absent.push(target);
        }
        uncertain = true;
        continue;
      }
      const inherited = this.loadTsconfig(target, new Set([...seen, path]));
      files.push(...inherited.files);
      absent.push(...inherited.absent);
      uncertain ||= inherited.uncertain;
      baseUrl = inherited.baseUrl ?? baseUrl;
      if (inherited.paths !== null) {
        paths = { ...inherited.paths };
        pathsBase = inherited.pathsBase;
      }
    }
    const options = json['compilerOptions'];
    if (typeof options === 'object' && options !== null) {
      const own = options as Record<string, unknown>;
      if (typeof own['baseUrl'] === 'string') {
        baseUrl = joinPath(dir, own['baseUrl']);
      }
      if (typeof own['paths'] === 'object' && own['paths'] !== null) {
        paths = {};
        for (const [pattern, targets] of Object.entries(own['paths'] as Record<string, unknown>)) {
          if (Array.isArray(targets)) {
            paths[pattern] = targets.filter((t): t is string => typeof t === 'string');
          }
        }
        pathsBase = dir;
      }
    }
    return { files, absent, baseUrl, paths, pathsBase: baseUrl ?? pathsBase, uncertain };
  }

  /** Workspace packages by name, from pnpm-workspace.yaml or the root package.json `workspaces`. */
  workspaces(): Workspaces {
    if (this.workspaceCache !== null) {
      return this.workspaceCache;
    }
    const configs: string[] = [];
    const absent: string[] = [];
    let uncertain = false;
    const readJson = (path: string): Record<string, unknown> | null => {
      if (this.vfs.kind(path) !== 'file') {
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(this.vfs.read(path) ?? '');
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      } catch {
        uncertain = true;
        return null;
      }
    };
    const root = readJson('package.json');
    if (this.vfs.kind('package.json') === 'file') {
      configs.push('package.json');
    } else {
      absent.push('package.json');
    }
    let patterns: string[] = [];
    if (this.vfs.kind('pnpm-workspace.yaml') === 'file') {
      configs.push('pnpm-workspace.yaml');
      try {
        patterns = parsePnpmWorkspace(this.vfs.read('pnpm-workspace.yaml') ?? '');
      } catch {
        uncertain = true;
      }
    } else {
      absent.push('pnpm-workspace.yaml');
      const field = root?.['workspaces'];
      const list = Array.isArray(field) ? field : typeof field === 'object' && field !== null ? (field as Record<string, unknown>)['packages'] : [];
      patterns = Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
    }
    const includes = patterns.filter((p) => !p.startsWith('!')).map((p) => globToRegExp(trimSlashes(p)));
    const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => globToRegExp(trimSlashes(p.slice(1))));
    const byName = new Map<string, string>();
    const claim = (name: unknown, dir: string): void => {
      if (typeof name !== 'string') {
        return;
      }
      if (byName.has(name)) {
        uncertain = true; // two packages with one name: which one a bare import loads is unknowable here
        return;
      }
      byName.set(name, dir);
    };
    for (const file of this.vfs.files()) {
      if (!file.endsWith('/package.json')) {
        continue;
      }
      const dir = dirname(file);
      if (includes.some((re) => re.test(dir)) && !excludes.some((re) => re.test(dir))) {
        claim(readJson(file)?.['name'], dir);
      }
    }
    if (root !== null && !byName.has(String(root['name']))) {
      claim(root['name'], '');
    }
    const names = [...byName].map(([name, dir]) => `${name}=${dir}`).sort(compareStrings);
    this.workspaceCache = { configs, absent, byName, names, uncertain };
    return this.workspaceCache;
  }

  private resolveGlob(request: ResolveRequest, ev: Evidence): void {
    const patterns = request.patterns ?? null;
    if (patterns === null) {
      ev.note('non-literal');
      return;
    }
    const fromDir = dirname(request.from);
    const baseDir = request.base === undefined ? fromDir : joinPath(fromDir, request.base);
    if (baseDir === null) {
      ev.note('outside repository');
      return;
    }
    const absolute: string[] = [];
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!');
      const body = negated ? pattern.slice(1) : pattern;
      const path = body.startsWith('/') ? joinPath(this.ownerDir(request.from), `.${body}`) : joinPath(baseDir, body);
      if (path === null) {
        ev.note('outside repository');
        return;
      }
      absolute.push(negated ? `!${path}` : path);
    }
    const includes = absolute.filter((p) => !p.startsWith('!')).map((p) => globToRegExp(p));
    const excludes = absolute.filter((p) => p.startsWith('!')).map((p) => globToRegExp(p.slice(1)));
    const matches = this.vfs.files().filter((file) => includes.some((re) => re.test(file)) && !excludes.some((re) => re.test(file)));
    for (const match of matches) {
      ev.targets.add(match);
    }
    ev.globs.set(absolute.join('|'), matches);
  }

  /** `__mocks__/<name>` next to each resolved module, as Jest and Vitest manual mocks are found. */
  private mockCandidates(ev: Evidence): void {
    for (const target of [...ev.targets]) {
      if (target.split('/').includes('__mocks__')) {
        continue;
      }
      const dir = joinPath(dirname(target), '__mocks__')!;
      const file = target.slice(target.lastIndexOf('/') + 1);
      const stem = file.includes('.') ? file.slice(0, file.indexOf('.')) : file;
      ev.dirs.add(dir);
      for (const extension of ['', ...EXTENSIONS]) {
        if (this.vfs.kind(`${dir}/${stem}${extension}`) === 'file') {
          ev.targets.add(`${dir}/${stem}${extension}`);
        }
      }
    }
  }

  /** Jest uses `<root>/__mocks__/<package>` automatically for node_modules packages. */
  private rootMocks(name: string, from: string, ev: Evidence): void {
    for (const root of new Set(['', this.ownerDir(from)])) {
      const mocks = joinPath(root, '__mocks__')!;
      ev.dirs.add(mocks);
      if (name.startsWith('@')) {
        ev.dirs.add(`${mocks}/${name.slice(0, name.indexOf('/'))}`);
      }
      for (const extension of ['', ...EXTENSIONS]) {
        if (this.vfs.kind(`${mocks}/${name}${extension}`) === 'file') {
          ev.targets.add(`${mocks}/${name}${extension}`);
        }
      }
    }
  }

  /** Records what is at `path`; follows symlinks; anything below a symlinked directory is unknowable. */
  private probe(path: string, ev: Evidence, depth = 0): EntryKind | null {
    if (this.belowSymlink(path)) {
      ev.note('symlinked directory');
      ev.absent.add(path);
      return null;
    }
    const kind = this.vfs.kind(path);
    if (kind === 'file') {
      ev.targets.add(path);
    } else if (kind === 'dir') {
      ev.dirs.add(path);
    } else if (kind === 'symlink') {
      ev.targets.add(path);
      const target = this.vfs.read(path) ?? '';
      const resolved = target.startsWith('/') ? null : joinPath(dirname(path), target);
      if (resolved === null || depth > 8) {
        ev.note('symlink outside repository');
      } else {
        const next = this.probe(resolved, ev, depth + 1);
        if (next === 'dir') {
          ev.note('symlinked directory');
          ev.targets.delete(path);
        }
      }
    } else if (kind === 'submodule') {
      ev.note('submodule');
    } else {
      ev.absent.add(path);
    }
    return kind;
  }

  private belowSymlink(path: string): boolean {
    for (let dir = dirname(path); dir !== ''; dir = dirname(dir)) {
      if (this.vfs.kind(dir) === 'symlink') {
        return true;
      }
    }
    return false;
  }

  /** The parsed package.json in `dir`, recorded as a config (or an absent probe). */
  private packageJson(dir: string, ev: Evidence): Record<string, unknown> | null {
    const path = joinPath(dir, 'package.json')!;
    if (this.vfs.kind(path) !== 'file') {
      ev.absent.add(path);
      return null;
    }
    ev.configs.add(path);
    let json = this.packageJsonCache.get(path);
    if (json === undefined) {
      try {
        const parsed: unknown = JSON.parse(this.vfs.read(path) ?? '');
        json = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        json = null;
      }
      this.packageJsonCache.set(path, json);
    }
    if (json === null) {
      ev.uncertain = true;
      ev.note('invalid package.json');
    }
    return json;
  }
}

/**
 * Targets of `exports` (or `imports`) for a subpath, as a union over every condition except
 * `types`: null when no key matches, an empty list when the match is excluded.
 */
export function exportsTargets(field: unknown, subpath: string, imports = false): string[] | null {
  let map: Record<string, unknown>;
  if (typeof field === 'string' || Array.isArray(field) || (isRecord(field) && !imports && !Object.keys(field).some((key) => key.startsWith('.')))) {
    map = { '.': field };
  } else if (isRecord(field)) {
    map = field;
  } else {
    return null;
  }
  if (Object.hasOwn(map, subpath) && !subpath.includes('*')) {
    return targetsOf(map[subpath], null);
  }
  let best: string | null = null;
  let star = '';
  for (const key of Object.keys(map)) {
    const at = key.indexOf('*');
    if (at === -1 || key.includes('*', at + 1)) {
      continue;
    }
    const prefix = key.slice(0, at);
    const suffix = key.slice(at + 1);
    if (subpath.startsWith(prefix) && subpath !== prefix && subpath.length >= key.length && subpath.endsWith(suffix)) {
      if (best === null || patternKeyCompare(best, key) === 1) {
        best = key;
        star = subpath.slice(prefix.length, subpath.length - suffix.length);
      }
    }
  }
  return best === null ? null : targetsOf(map[best], star);
}

/** Node's PATTERN_KEY_COMPARE: 1 when `b` is the more specific key. */
function patternKeyCompare(a: string, b: string): number {
  const aStar = a.indexOf('*');
  const bStar = b.indexOf('*');
  const baseA = aStar === -1 ? a.length : aStar + 1;
  const baseB = bStar === -1 ? b.length : bStar + 1;
  if (baseA > baseB) {
    return -1;
  }
  if (baseB > baseA) {
    return 1;
  }
  if (aStar === -1) {
    return 1;
  }
  if (bStar === -1) {
    return -1;
  }
  return a.length > b.length ? -1 : b.length > a.length ? 1 : 0;
}

function targetsOf(value: unknown, star: string | null): string[] {
  if (typeof value === 'string') {
    return [star === null ? value : value.replaceAll('*', star)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => targetsOf(item, star));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([condition, item]) => (condition === 'types' || condition === 'typings' ? [] : targetsOf(item, star)));
  }
  return [];
}

function finish(ev: Evidence, isGlob: boolean): Resolution {
  const targets = [...ev.targets].sort(compareStrings);
  const kind: ResolutionKind = isGlob ? (ev.reason === undefined ? 'file' : 'unresolved') : targets.length > 0 ? 'file' : ev.packageName !== undefined ? 'external' : 'unresolved';
  return {
    kind,
    targets,
    absent: [...ev.absent].filter((path) => !ev.targets.has(path)).sort(compareStrings),
    dirs: [...ev.dirs].sort(compareStrings),
    configs: [...ev.configs].sort(compareStrings),
    globs: [...ev.globs].sort(([a], [b]) => compareStrings(a, b)).map(([key, matches]) => ({ key, matches })),
    ...(ev.packageName === undefined ? {} : { packageName: ev.packageName }),
    ...(kind === 'unresolved' ? { reason: ev.reason ?? 'not found' } : {}),
    ...(ev.uncertain ? { uncertain: true as const } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drops a Vite query (`?raw`) or hash; a leading `#` is a subpath import, not a hash. */
function stripQuery(specifier: string): string {
  const query = specifier.search(/[?#]/);
  return query > 0 ? specifier.slice(0, query) : specifier;
}

function trimSlashes(pattern: string): string {
  return pattern.replace(/^\.\//, '').replace(/\/+$/, '');
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Joins and normalizes POSIX paths; null when the result would leave the repository. */
export function joinPath(dir: string, relative: string): string | null {
  const parts = dir === '' ? [] : dir.split('/');
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
