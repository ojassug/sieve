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

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
