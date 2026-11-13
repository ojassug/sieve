// Globs for workspace patterns and import.meta.glob: `*` and `?` stay within a path segment,
// `**` spans any number of segments (including none), `{a,b}` alternates and `[...]` is a class.
// Dotfiles are matched like any other name, which over-approximates and so stays safe.

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
      } else {
        re += `(?:${glob.slice(i + 1, close).split(',').map(escape).join('|')})`;
        i = close;
      }
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
      } else {
        re += `[${glob.slice(i + 1, close).replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else if (c === '/' && glob.slice(i + 1) === '**') {
      re += '(?:/.*)?';
      break;
    } else {
      re += escape(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * A literal path as a glob that matches only that path. The dialect has no escape character, so
 * `*`, `?` and `[` become one-character classes, `{` a one-option brace, and a leading `!` (which
 * would make the pattern an exclude) a class too. Every other character is already literal.
 */
export function escapeGlob(path: string): string {
  return path.replace(/[*?[{]|^!/g, (c) => (c === '{' ? '{{}' : `[${c}]`));
}

/** Files matching any include pattern and no `!`-prefixed exclude pattern, in input order. */
export function matchGlobs(files: readonly string[], patterns: readonly string[]): string[] {
  const includes = patterns.filter((p) => !p.startsWith('!')).map((p) => globToRegExp(p));
  const excludes = patterns.filter((p) => p.startsWith('!')).map((p) => globToRegExp(p.slice(1)));
  return files.filter((file) => includes.some((re) => re.test(file)) && !excludes.some((re) => re.test(file)));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
