import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-0002: the CLI, core and the runner plugins ship with zero runtime dependencies.
 * Runner plugins may declare peer dependencies on their runner; nothing else may.
 */
export const POLICIES: readonly { readonly dir: string; readonly allowPeers: boolean }[] = [
  { dir: 'packages/core', allowPeers: false },
  { dir: 'packages/cli', allowPeers: false },
  { dir: 'packages/vitest', allowPeers: true },
  { dir: 'packages/jest', allowPeers: true },
];

export function findViolations(manifest: Record<string, unknown>, allowPeers: boolean): string[] {
  const problems: string[] = [];
  for (const field of ['dependencies', 'optionalDependencies']) {
    const names = dependencyNames(manifest[field]);
    if (names === null) {
      problems.push(`${field} must be an object`);
    } else if (names.length > 0) {
      problems.push(`${field} must be empty (found: ${names.join(', ')})`);
    }
  }
  for (const field of ['bundleDependencies', 'bundledDependencies']) {
    const value = manifest[field];
    const empty = value === undefined || value === false || (Array.isArray(value) && value.length === 0);
    if (!empty) {
      problems.push(`${field} must be absent or empty`);
    }
  }
  if (!allowPeers) {
    const peers = dependencyNames(manifest['peerDependencies']);
    if (peers === null || peers.length > 0) {
      problems.push(`peerDependencies are only allowed in runner plugins (found: ${(peers ?? ['?']).join(', ')})`);
    }
  }
  return problems;
}

/** Checks every package the policy names; a missing manifest is a violation, not a skip. */
export function checkRepo(root: string): string[] {
  const problems: string[] = [];
  for (const { dir, allowPeers } of POLICIES) {
    const path = join(root, dir, 'package.json');
    if (!existsSync(path)) {
      problems.push(`${dir}: package.json is missing`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    for (const problem of findViolations(manifest, allowPeers)) {
      problems.push(`${dir}: ${problem}`);
    }
  }
  return problems;
}

/** Sorted dependency names, or null when the field is present but not an object. */
function dependencyNames(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.keys(value).sort();
}
