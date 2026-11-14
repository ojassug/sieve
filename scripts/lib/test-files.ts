// The exact test files one CI shard runs. The `trommel` plan job hands each shard its file list,
// and vitest.config.ts turns the list into its `include`. Until the runner plugin arrives in M3,
// this is how a shard runs its list and nothing else: ADR-0004 rules out Vitest's positional
// filters, which match substrings, so `a.test.ts` would also run `data.test.ts`.
//
// Uncertainty means run: a list that cannot be read, or that names a file that is not there,
// fails the shard loudly instead of letting it run fewer files than the plan said.
import { statSync } from 'node:fs';
import { join } from 'node:path';

/** JSON array of repository-relative POSIX paths. Unset or empty: the configured include applies. */
export const TEST_FILES_ENV = 'TROMMEL_TEST_FILES';

/** Validates the list: a non-empty JSON array of repository-relative POSIX paths. */
export function parseTestFiles(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`the test file list is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  if (!Array.isArray(value)) {
    throw new Error('the test file list must be a JSON array of paths');
  }
  if (value.length === 0) {
    throw new Error('the test file list lists no files; a shard with nothing to run should not have started');
  }
  return value.map((entry: unknown, i) => {
    if (typeof entry !== 'string' || entry === '') {
      throw new Error(`[${String(i)}]: must be a non-empty string`);
    }
    const problem = pathProblem(entry);
    if (problem !== null) {
      throw new Error(`[${String(i)}]: ${JSON.stringify(entry)} ${problem}`);
    }
    return entry;
  });
}

function pathProblem(path: string): string | null {
  if (path.includes('\\')) {
    return 'contains a backslash; paths are POSIX';
  }
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return 'must be repository-relative';
  }
  const segments = path.split('/');
  if (segments.includes('')) {
    return 'has an empty segment';
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return "has a '.' or '..' segment";
  }
  return null;
}

/**
 * Escapes the characters that glob syntax gives a meaning, so the pattern matches only the file
 * of that name. This covers what tinyglobby (Vitest's globber) escapes, and also `!`, `+` and `@`
 * everywhere, since a backslash before any character makes it literal.
 */
export function escapeGlob(path: string): string {
  return path.replace(/[()[\]{}*?|!+@]/g, '\\$&');
}

/**
 * The `include` patterns for the files listed in {@link TEST_FILES_ENV}, or null when it is unset
 * or empty. Throws, naming the variable, when the list is invalid or a listed path under `root`
 * is not a file.
 */
export function testFilesFromEnv(env: Readonly<Record<string, string | undefined>>, root: string): string[] | null {
  const text = env[TEST_FILES_ENV];
  if (text === undefined || text === '') {
    return null;
  }
  let files: string[];
  try {
    files = parseTestFiles(text);
  } catch (error) {
    throw new Error(`${TEST_FILES_ENV}: ${(error as Error).message}`, { cause: error });
  }
  for (const file of files) {
    if (!statSync(join(root, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${TEST_FILES_ENV}: ${file} is not a file in ${root}`);
    }
  }
  return files.map(escapeGlob);
}
