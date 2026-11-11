// JSON with comments and trailing commas, as tsconfig.json allows. Comments and trailing commas
// are blanked out (outside strings), then JSON.parse does the rest, so anything else that is not
// JSON still fails loudly.

export function parseJsonc(text: string): unknown {
  let out = '';
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        i += text[i] === '\\' ? 2 : 1;
      }
      if (i >= text.length) {
        throw new SyntaxError('jsonc: unterminated string');
      }
      i++;
      out += text.slice(start, i);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        throw new SyntaxError('jsonc: unterminated comment');
      }
      out += ' ';
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // A comma followed only by whitespace and then } or ] is a trailing comma.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
