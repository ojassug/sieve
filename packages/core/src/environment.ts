// Environment components of the process that runs a test. They belong to a record (ADR-0005) and
// are compared in the job that runs the test, never in the static map: a map is a function of the
// tree, the config and the engine only (ADR-0003, DECISIONS 28). Nothing under graph/ or select/
// may import this module. It has no caller until records exist (M2).
import { createHash } from 'node:crypto';

/** Environment components: Node major.minor, OS and architecture, and each tracked variable. */
export function environment(track: readonly string[], proc: Pick<NodeJS.Process, 'versions' | 'platform' | 'arch' | 'env'> = process): Record<string, string | null> {
  const [major, minor] = proc.versions.node.split('.');
  const env: Record<string, string | null> = { runtime: `node ${major ?? ''}.${minor ?? ''}`, platform: `${proc.platform}-${proc.arch}` };
  for (const name of track) {
    env[`env/${name}`] = proc.env[name] ?? null;
  }
  return env;
}

/** The hash of one component; values are hashed so that what is stored never holds an environment value. */
export function envHash(value: string | null): string | null {
  return value === null ? null : createHash('sha256').update(value).digest('hex');
}
