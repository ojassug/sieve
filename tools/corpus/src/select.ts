export interface ArtifactRules {
  readonly include: RegExp;
  readonly exclude: RegExp;
  readonly maxBytes: number;
}

/** Test-report artifacts (JUnit and friends) by name; coverage, builds and media are not mirrored. */
export const DEFAULT_RULES: ArtifactRules = {
  include: /junit|test[-_ ]?(results?|reports?)/i,
  exclude: /coverage|screenshot|video|trace/i,
  maxBytes: 100 * 1024 * 1024,
};

export function shouldMirror(
  artifact: { readonly name: string; readonly size_in_bytes: number; readonly expired: boolean },
  rules: ArtifactRules,
): boolean {
  return (
    !artifact.expired &&
    artifact.size_in_bytes <= rules.maxBytes &&
    rules.include.test(artifact.name) &&
    !rules.exclude.test(artifact.name)
  );
}
