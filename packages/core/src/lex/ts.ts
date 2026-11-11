// Import extraction for TypeScript and JavaScript (architecture §3.2, ADR-0002). This is a
// lexer, not a parser: it tracks exactly what decides whether text is code — strings, template
// literals (with an interpolation stack), regex versus division, comments and JSX — and a small
// recognizer reads import forms off the token stream. Uncertainty is never silent: a specifier
// that is not a literal yields a record with `specifier: null`, and any state the lexer cannot
// close cleanly (unterminated literal, unbalanced bracket, unparseable import) is a diagnostic
// that marks the whole file uncertain.

export type Dialect = 'ts' | 'tsx' | 'js';

export type ImportKind =
  | 'static'
  | 'side-effect'
  | 'reexport'
  | 'dynamic'
  | 'require'
  | 'require-resolve'
  | 'import-equals'
  | 'glob'
  | 'meta-resolve'
  | 'url'
  | 'mock'
  | 'actual';

export interface ImportRecord {
  readonly kind: ImportKind;
  /** The specifier with escapes decoded, or null when it is not a literal. */
  readonly specifier: string | null;
  /** 1-based line of the statement or call that holds the import. */
  readonly line: number;
  /** UTF-16 offsets of the specifier literal (quotes included), or of the keyword when non-literal. */
  readonly start: number;
  readonly end: number;
  /** `import type` / `export type`: erased in every configuration. */
  readonly typeOnly?: true;
  /** Every named specifier carries `type`; still an edge, because `verbatimModuleSyntax` keeps `import {}`. */
  readonly inlineTypeOnly?: true;
  /** `import.meta.glob` patterns; null when they are not all literals. */
  readonly patterns?: readonly string[] | null;
  readonly query?: string;
  readonly base?: string;
}

export type DiagnosticCode =
  | 'unterminated-string'
  | 'unterminated-template'
  | 'unterminated-comment'
  | 'unterminated-jsx'
  | 'jsx-syntax'
  | 'unbalanced'
  | 'unrecognized-import'
  | 'too-deep'
  | 'invalid-utf8';

export interface LexDiagnostic {
  readonly code: DiagnosticCode;
  readonly line: number;
}

export interface LexResult {
  readonly imports: ImportRecord[];
  readonly diagnostics: LexDiagnostic[];
  /** True when any diagnostic was raised: the file's imports may be incomplete. */
  readonly uncertain: boolean;
}

export function dialectOf(path: string): Dialect {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) {
    return 'tsx';
  }
  return /\.[mc]?ts$/.test(lower) ? 'ts' : 'js';
}

export function lexImports(source: string, dialect: Dialect): LexResult {
  const scanner = new Scanner(source, dialect !== 'ts', dialect === 'tsx');
  scanner.scanJs(false);
  const imports = recognize(scanner);
  const diagnostics = scanner.diagnostics.map(({ code, offset }) => ({ code, line: scanner.lineAt(offset) }));
  return { imports, diagnostics, uncertain: diagnostics.length > 0 };
}

/** Decodes UTF-8 (a byte-order mark is ignored); bytes that are not valid UTF-8 make the file uncertain. */
export function lexImportsFromBytes(bytes: Uint8Array, dialect: Dialect): LexResult {
  try {
    return lexImports(new TextDecoder('utf-8', { fatal: true }).decode(bytes), dialect);
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    const result = lexImports(new TextDecoder('utf-8').decode(bytes), dialect);
    const diagnostics = [{ code: 'invalid-utf8' as const, line: 1 }, ...result.diagnostics];
    return { imports: result.imports, diagnostics, uncertain: true };
  }
}

// ---------------------------------------------------------------------------------------------
// Scanner

const T_IDENT = 1;
const T_PUNCT = 2;
const T_STRING = 3;
/** A template literal without substitutions: as literal as a string. */
const T_TEMPLATE = 4;
const T_TEMPLATE_SUBST = 5;
const T_REGEX = 6;
const T_NUMBER = 7;
const T_PRIVATE = 8;

const OPEN_PAREN = 1;
const OPEN_CONTROL_PAREN = 2;
const OPEN_BRACKET = 3;
const OPEN_BRACE = 4;

/** Template and JSX nesting beyond this is treated as hostile input rather than recursed into. */
const MAX_DEPTH = 256;

/** After these keywords an expression starts, so `/` begins a regex (unless used as a property name). */
const REGEX_AFTER_KEYWORDS: ReadonlySet<string> = new Set([
  'return', 'typeof', 'instanceof', 'in', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'default',
]);
const CONTROL_KEYWORDS: ReadonlySet<string> = new Set(['if', 'while', 'for', 'with']);

const PUNCTUATORS_3 = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??='];
const PUNCTUATORS_2: ReadonlySet<string> = new Set([
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
]);

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$‌‍]/u;

class Scanner {
  readonly src: string;
  readonly jsx: boolean;
  readonly tsx: boolean;
  pos = 0;
  /** True where an expression may start: `/` then begins a regex and `<` may begin JSX. */
  regexOk = true;
  depth = 0;
  aborted = false;
  controlPending = false;
  readonly kinds: number[] = [];
  readonly starts: number[] = [];
  readonly ends: number[] = [];
  readonly texts: string[] = [];
  readonly diagnostics: { code: DiagnosticCode; offset: number }[] = [];
  private lineStarts: number[] | null = null;

  constructor(src: string, jsx: boolean, tsx: boolean) {
    this.src = src;
    this.jsx = jsx;
    this.tsx = tsx;
  }

  diag(code: DiagnosticCode, offset: number): void {
    if (!this.aborted) {
      this.diagnostics.push({ code, offset });
    }
  }

  emit(kind: number, start: number, end: number, text: string): number {
    this.kinds.push(kind);
    this.starts.push(start);
    this.ends.push(end);
    this.texts.push(text);
    return this.kinds.length - 1;
  }

  lineAt(offset: number): number {
    if (this.lineStarts === null) {
      const starts = [0];
      const src = this.src;
      for (let i = 0; i < src.length; i++) {
        const c = src.charCodeAt(i);
        if (c === 0x0a || c === 0x2028 || c === 0x2029 || (c === 0x0d && src.charCodeAt(i + 1) !== 0x0a)) {
          starts.push(i + 1);
        }
      }
      this.lineStarts = starts;
    }
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  }

  /**
   * Scans code until EOF, or — when `closing` — until the `}` that ends the template
   * interpolation or JSX expression this call was opened for.
   */
  scanJs(closing: boolean): void {
    const src = this.src;
    const open: number[] = [];
    const openAt: number[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.pos >= src.length) {
        if (open.length > 0) {
          this.diag('unbalanced', openAt[0]!);
        }
        return;
      }
      const c = src.charCodeAt(this.pos);
      if (isIdentStartAt(src, this.pos)) {
        this.scanIdentifier();
        continue;
      }
      if (isDigit(c) || (c === 0x2e && isDigit(src.charCodeAt(this.pos + 1)))) {
        this.scanNumber();
        continue;
      }
      switch (c) {
        case 0x27: // '
        case 0x22: // "
          this.scanString(c);
          continue;
        case 0x60: // `
          this.scanTemplate();
          continue;
        case 0x2f: // /
          if (this.regexOk) {
            this.scanRegex();
          } else {
            this.scanPunctuator();
          }
          continue;
        case 0x3c: // <
          if (this.jsx && this.regexOk && this.looksLikeJsx()) {
            this.scanJsxElement();
            this.regexOk = false;
            this.controlPending = false;
          } else {
            this.scanPunctuator();
          }
          continue;
        case 0x7b: // {
          open.push(OPEN_BRACE);
          openAt.push(this.pos);
          this.emitPunct(1);
          this.regexOk = true;
          continue;
        case 0x7d: {
          // }
          if (open.length === 0) {
            if (closing) {
              this.pos++;
              return;
            }
            this.diag('unbalanced', this.pos);
          } else if (open.pop() !== OPEN_BRACE) {
            this.diag('unbalanced', this.pos);
          }
          openAt.pop();
          this.emitPunct(1);
          this.regexOk = true;
          continue;
        }
        case 0x28: // (
          open.push(this.controlPending ? OPEN_CONTROL_PAREN : OPEN_PAREN);
          openAt.push(this.pos);
          this.emitPunct(1);
          this.regexOk = true;
          continue;
        case 0x29: {
          // )
          const top = open.pop();
          openAt.pop();
          if (top !== OPEN_PAREN && top !== OPEN_CONTROL_PAREN) {
            this.diag('unbalanced', this.pos);
          }
          this.emitPunct(1);
          this.regexOk = top === OPEN_CONTROL_PAREN;
          continue;
        }
        case 0x5b: // [
          open.push(OPEN_BRACKET);
          openAt.push(this.pos);
          this.emitPunct(1);
          this.regexOk = true;
          continue;
        case 0x5d: // ]
          if (open.pop() !== OPEN_BRACKET) {
            this.diag('unbalanced', this.pos);
          }
          openAt.pop();
          this.emitPunct(1);
          this.regexOk = false;
          continue;
        case 0x23: // #
          if (isIdentStartAt(src, this.pos + 1)) {
            const start = this.pos++;
            this.consumeIdentifierChars();
            this.emit(T_PRIVATE, start, this.pos, src.slice(start, this.pos));
            this.regexOk = false;
            this.controlPending = false;
            continue;
          }
          this.scanPunctuator();
          continue;
        default:
          this.scanPunctuator();
      }
    }
  }

  private skipTrivia(): void {
    const src = this.src;
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      if (c === 0x20 || (c >= 0x09 && c <= 0x0d) || (c >= 0x80 && isUnicodeSpace(c))) {
        this.pos++;
      } else if (c === 0x2f && src.charCodeAt(this.pos + 1) === 0x2f) {
        this.skipToLineEnd();
      } else if (c === 0x2f && src.charCodeAt(this.pos + 1) === 0x2a) {
        const end = src.indexOf('*/', this.pos + 2);
        if (end === -1) {
          this.diag('unterminated-comment', this.pos);
          this.pos = src.length;
        } else {
          this.pos = end + 2;
        }
      } else if (c === 0x23 && this.pos === 0 && src.charCodeAt(1) === 0x21) {
        this.skipToLineEnd(); // hashbang
      } else {
        return;
      }
    }
  }

  private skipToLineEnd(): void {
    const src = this.src;
    while (this.pos < src.length && !isLineTerminator(src.charCodeAt(this.pos))) {
      this.pos++;
    }
  }

  private scanIdentifier(): void {
    const start = this.pos;
    this.consumeIdentifierChars();
    const text = this.src.slice(start, this.pos);
    const last = this.kinds.length - 1;
    const afterDot = last >= 0 && this.kinds[last] === T_PUNCT && (this.texts[last] === '.' || this.texts[last] === '?.');
    this.emit(T_IDENT, start, this.pos, text);
    this.regexOk = !afterDot && REGEX_AFTER_KEYWORDS.has(text);
    // `for await (` keeps the control flag alive across `await`.
    this.controlPending = !afterDot && (CONTROL_KEYWORDS.has(text) || (text === 'await' && this.controlPending));
  }

  private consumeIdentifierChars(): void {
    const src = this.src;
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x24 || c === 0x5f) {
        this.pos++;
      } else if (c === 0x5c && src.charCodeAt(this.pos + 1) === 0x75) {
        // \uXXXX or \u{X...} escape inside an identifier
        this.pos += 2;
        if (src.charCodeAt(this.pos) === 0x7b) {
          const close = src.indexOf('}', this.pos);
          this.pos = close === -1 ? src.length : close + 1;
        } else {
          this.pos += 4;
        }
      } else if (c >= 0x80) {
        const cp = src.codePointAt(this.pos)!;
        if (!ID_CONTINUE.test(String.fromCodePoint(cp))) {
          return;
        }
        this.pos += cp > 0xffff ? 2 : 1;
      } else {
        return;
      }
    }
  }

  private scanNumber(): void {
    const src = this.src;
    const start = this.pos;
    const hex = src.charCodeAt(start) === 0x30 && (src.charCodeAt(start + 1) | 0x20) === 0x78;
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      const exponentSign =
        (c === 0x2b || c === 0x2d) && !hex && (src.charCodeAt(this.pos - 1) | 0x20) === 0x65 && this.pos - 1 > start;
      if (isDigit(c) || (c | 0x20) >= 0x61 && (c | 0x20) <= 0x7a || c === 0x5f || c === 0x2e || exponentSign) {
        this.pos++;
      } else {
        break;
      }
    }
    this.emit(T_NUMBER, start, this.pos, '');
    this.regexOk = false;
    this.controlPending = false;
  }

  private scanString(quote: number): void {
    const src = this.src;
    const start = this.pos++;
    for (;;) {
      if (this.pos >= src.length) {
        this.diag('unterminated-string', start);
        break;
      }
      const c = src.charCodeAt(this.pos);
      if (c === quote) {
        this.pos++;
        break;
      }
      if (c === 0x5c) {
        // An escaped CR LF is one line continuation.
        this.pos += src.charCodeAt(this.pos + 1) === 0x0d && src.charCodeAt(this.pos + 2) === 0x0a ? 3 : 2;
        continue;
      }
      if (c === 0x0a || c === 0x0d) {
        this.diag('unterminated-string', start);
        break;
      }
      this.pos++;
    }
    this.emit(T_STRING, start, Math.min(this.pos, src.length), '');
    this.regexOk = false;
    this.controlPending = false;
  }

  private scanTemplate(): void {
    const src = this.src;
    const start = this.pos++;
    const token = this.emit(T_TEMPLATE, start, start, '');
    if (++this.depth > MAX_DEPTH) {
      this.tooDeep(start);
      return;
    }
    let substitutions = false;
    for (;;) {
      if (this.pos >= src.length) {
        this.diag('unterminated-template', start);
        break;
      }
      const c = src.charCodeAt(this.pos);
      if (c === 0x5c) {
        this.pos += 2;
      } else if (c === 0x60) {
        this.pos++;
        break;
      } else if (c === 0x24 && src.charCodeAt(this.pos + 1) === 0x7b) {
        substitutions = true;
        this.pos += 2;
        this.regexOk = true;
        this.controlPending = false;
        this.scanJs(true);
      } else {
        this.pos++;
      }
    }
    this.depth--;
    this.kinds[token] = substitutions ? T_TEMPLATE_SUBST : T_TEMPLATE;
    this.ends[token] = Math.min(this.pos, src.length);
    this.regexOk = false;
    this.controlPending = false;
  }

  /** A `/` where an expression may start. If no closing `/` comes before the line ends, it was division after all. */
  private scanRegex(): void {
    const src = this.src;
    const start = this.pos;
    let inClass = false;
    let i = start + 1;
    for (;;) {
      const c = src.charCodeAt(i);
      if (i >= src.length || isLineTerminator(c)) {
        this.scanPunctuator();
        return;
      }
      if (c === 0x5c) {
        if (i + 1 >= src.length || isLineTerminator(src.charCodeAt(i + 1))) {
          this.scanPunctuator();
          return;
        }
        i += 2;
        continue;
      }
      if (c === 0x5b) {
        inClass = true;
      } else if (c === 0x5d) {
        inClass = false;
      } else if (c === 0x2f && !inClass) {
        break;
      }
      i++;
    }
    this.pos = i + 1;
    this.consumeIdentifierChars(); // flags
    this.emit(T_REGEX, start, this.pos, '');
    this.regexOk = false;
    this.controlPending = false;
  }

  private scanPunctuator(): void {
    const src = this.src;
    const start = this.pos;
    let length = 1;
    const four = src.slice(start, start + 4);
    if (four === '>>>=') {
      length = 4;
    } else if (PUNCTUATORS_3.includes(four.slice(0, 3))) {
      length = 3;
    } else if (PUNCTUATORS_2.has(four.slice(0, 2))) {
      // `a?.5:1` is a conditional with `.5`, not optional chaining.
      length = four.startsWith('?.') && isDigit(src.charCodeAt(start + 2)) ? 1 : 2;
    }
    this.emitPunct(length);
    const text = this.texts[this.texts.length - 1];
    this.regexOk = text !== '++' && text !== '--';
  }

  private emitPunct(length: number): void {
    const start = this.pos;
    this.pos += length;
    this.emit(T_PUNCT, start, this.pos, this.src.slice(start, this.pos));
    this.controlPending = false;
  }

  /** At `<` where an expression may start. In .tsx, `<T,>` and `<T extends …>` are type parameters. */
  private looksLikeJsx(): boolean {
    const src = this.src;
    const next = this.pos + 1;
    if (src.charCodeAt(next) === 0x3e) {
      return true; // fragment
    }
    if (!isIdentStartAt(src, next)) {
      return false;
    }
    if (!this.tsx) {
      return true;
    }
    let i = next;
    while (i < src.length && /[\w$]/.test(src[i]!)) {
      i++;
    }
    while (i < src.length && /\s/.test(src[i]!)) {
      i++;
    }
    if (src[i] === ',') {
      return false;
    }
    return !(src.startsWith('extends', i) && !/[\w$]/.test(src[i + 7] ?? ''));
  }

  private scanJsxElement(): void {
    const src = this.src;
    const start = this.pos++;
    if (++this.depth > MAX_DEPTH) {
      this.tooDeep(start);
      return;
    }
    if (src.charCodeAt(this.pos) === 0x3e) {
      this.pos++;
      this.scanJsxChildren(start);
      this.depth--;
      return;
    }
    this.consumeJsxName();
    for (;;) {
      this.skipTrivia();
      if (this.pos >= src.length) {
        this.diag('unterminated-jsx', start);
        break;
      }
      const c = src.charCodeAt(this.pos);
      if (c === 0x2f && src.charCodeAt(this.pos + 1) === 0x3e) {
        this.pos += 2;
        break;
      }
      if (c === 0x3e) {
        this.pos++;
        this.scanJsxChildren(start);
        break;
      }
      if (c === 0x7b) {
        this.pos++;
        this.regexOk = true;
        this.scanJs(true);
        continue;
      }
      if (!this.consumeJsxName()) {
        this.diag('jsx-syntax', this.pos);
        this.pos++;
        continue;
      }
      this.skipTrivia();
      if (src.charCodeAt(this.pos) !== 0x3d) {
        continue; // boolean attribute
      }
      this.pos++;
      this.skipTrivia();
      const v = src.charCodeAt(this.pos);
      if (v === 0x22 || v === 0x27) {
        // JSX attribute strings have no escapes and may span lines.
        const close = src.indexOf(String.fromCharCode(v), this.pos + 1);
        if (close === -1) {
          this.diag('unterminated-jsx', start);
          this.pos = src.length;
        } else {
          this.pos = close + 1;
        }
      } else if (v === 0x7b) {
        this.pos++;
        this.regexOk = true;
        this.scanJs(true);
      } else if (v === 0x3c) {
        this.scanJsxElement();
      } else {
        this.diag('jsx-syntax', this.pos);
      }
    }
    this.depth--;
  }

  private scanJsxChildren(elementStart: number): void {
    const src = this.src;
    for (;;) {
      if (this.pos >= src.length) {
        this.diag('unterminated-jsx', elementStart);
        return;
      }
      const c = src.charCodeAt(this.pos);
      if (c === 0x7b) {
        this.pos++;
        this.regexOk = true;
        this.scanJs(true);
      } else if (c === 0x3c) {
        let i = this.pos + 1;
        while (i < src.length && /\s/.test(src[i]!)) {
          i++;
        }
        if (src.charCodeAt(i) === 0x2f) {
          const close = src.indexOf('>', i);
          if (close === -1) {
            this.diag('unterminated-jsx', elementStart);
            this.pos = src.length;
          } else {
            this.pos = close + 1;
          }
          return;
        }
        this.scanJsxElement();
      } else {
        this.pos++; // text: quotes, slashes and apostrophes are just characters here
      }
    }
  }

  /** Tag and attribute names: identifiers with `-`, `.` and `:`. False when none was there. */
  private consumeJsxName(): boolean {
    const src = this.src;
    const start = this.pos;
    while (this.pos < src.length) {
      const c = src.charCodeAt(this.pos);
      if (c === 0x2d || c === 0x2e || c === 0x3a) {
        this.pos++;
      } else if (isIdentStartAt(src, this.pos) || isDigit(c)) {
        this.consumeIdentifierChars();
        if (this.pos === start) {
          this.pos++;
        }
      } else {
        break;
      }
    }
    return this.pos > start;
  }

  private tooDeep(offset: number): void {
    this.diag('too-deep', offset);
    this.aborted = true;
    this.pos = this.src.length;
  }
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isLineTerminator(c: number): boolean {
  return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
}

function isUnicodeSpace(c: number): boolean {
  return c === 0xa0 || c === 0xfeff || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

function isIdentStartAt(src: string, pos: number): boolean {
  const c = src.charCodeAt(pos);
  if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x24 || c === 0x5f) {
    return true;
  }
  if (c === 0x5c) {
    return src.charCodeAt(pos + 1) === 0x75;
  }
  if (c < 0x80 || Number.isNaN(c)) {
    return false;
  }
  return ID_START.test(String.fromCodePoint(src.codePointAt(pos)!));
}

// ---------------------------------------------------------------------------------------------
// Recognizer

const MOCK_METHODS: ReadonlySet<string> = new Set([
  'mock', 'doMock', 'unmock', 'doUnmock', 'importMock', 'requireMock', 'createMockFromModule', 'genMockFromModule', 'setMock',
]);
const ACTUAL_METHODS: ReadonlySet<string> = new Set(['importActual', 'requireActual']);
/** After `import`, these mean the word is a property key, class field or binding, not an import. */
const NOT_AN_IMPORT: ReadonlySet<string> = new Set([':', '=', ';', ')', ',', '}', ']', '?', '!', '<']);

function recognize(s: Scanner): ImportRecord[] {
  const { kinds, starts, ends, texts, src } = s;
  const n = kinds.length;
  const records: ImportRecord[] = [];
  /** `require` tokens already reported as part of `import x = require(…)`. */
  const consumed = new Set<number>();

  const isPunct = (i: number, text: string): boolean => i < n && kinds[i] === T_PUNCT && texts[i] === text;
  const isIdent = (i: number, text?: string): boolean => i < n && kinds[i] === T_IDENT && (text === undefined || texts[i] === text);
  const isLiteral = (i: number): boolean => i < n && (kinds[i] === T_STRING || kinds[i] === T_TEMPLATE);
  const afterDot = (i: number): boolean => i > 0 && kinds[i - 1] === T_PUNCT && (texts[i - 1] === '.' || texts[i - 1] === '?.');
  const value = (i: number): string => decodeLiteral(src.slice(starts[i]! + 1, ends[i]! - 1));
  /** First token after token `i` ends (skips a template's interpolation tokens). */
  const after = (i: number): number => {
    let k = i + 1;
    while (k < n && starts[k]! < ends[i]!) {
      k++;
    }
    return k;
  };
  /** Index of the `)` matching the `(` at `open`, or -1. */
  const matchingParen = (open: number): number => {
    let depth = 0;
    for (let k = open; k < n; k++) {
      if (kinds[k] === T_PUNCT) {
        const t = texts[k];
        if (t === '(' || t === '[' || t === '{') {
          depth++;
        } else if (t === ')' || t === ']' || t === '}') {
          depth--;
          if (depth === 0) {
            return t === ')' ? k : -1;
          }
        }
      }
    }
    return -1;
  };

  const push = (kind: ImportKind, keyword: number, literal: number | null, extra: Partial<ImportRecord> = {}): void => {
    const at = literal ?? keyword;
    records.push({
      kind,
      specifier: literal === null ? null : value(literal),
      line: s.lineAt(starts[keyword]!),
      start: starts[at]!,
      end: ends[at]!,
      ...extra,
    });
  };

  /** `keyword(` …: a literal first argument, a non-literal one, or nothing for `name() {}` methods. */
  const call = (kind: ImportKind, keyword: number, open: number): void => {
    const arg = open + 1;
    if (isPunct(arg, ')')) {
      return; // zero arguments: a method definition, or a call that loads nothing
    }
    const close = matchingParen(open);
    if (close !== -1 && isPunct(close + 1, '{')) {
      return; // `require(x) { … }` defines a method
    }
    if (isIdent(arg) && (isPunct(arg + 1, ':') || (isPunct(arg + 1, '?') && isPunct(arg + 2, ':')))) {
      return; // `import(id: string): T` is a typed parameter list: a signature, not a call
    }
    const literal = isLiteral(arg) && (isPunct(arg + 1, ')') || isPunct(arg + 1, ','));
    push(kind, keyword, literal ? arg : null);
  };

  const specifierList = (open: number): { close: number; named: number; typed: number } => {
    let named = 0;
    let typed = 0;
    let words: string[] = [];
    const finish = (): void => {
      if (words.length > 0) {
        named++;
        if (words[0] === 'type' && (words.length === 2 || words.length === 4)) {
          typed++;
        }
      }
      words = [];
    };
    let k = open + 1;
    for (; k < n && !isPunct(k, '}'); k++) {
      if (isPunct(k, ',')) {
        finish();
      } else if (kinds[k] === T_IDENT || kinds[k] === T_STRING) {
        words.push(kinds[k] === T_IDENT ? texts[k]! : '"');
      } else {
        return { close: -1, named, typed };
      }
    }
    finish();
    return { close: k < n ? k : -1, named, typed };
  };

  const importStatement = (keyword: number): void => {
    let j = keyword + 1;
    let typeOnly = false;
    if (isIdent(j, 'type')) {
      const t = j + 1;
      const bindingNamedType = (isIdent(t, 'from') && kinds[t + 1] === T_STRING) || isPunct(t, ',') || isPunct(t, '=');
      if (!bindingNamedType) {
        typeOnly = true;
        j = t;
      }
    }
    const flags = typeOnly ? { typeOnly: true as const } : {};
    if (isIdent(j) && isPunct(j + 1, '=')) {
      if (isIdent(j + 2, 'require') && isPunct(j + 3, '(')) {
        const literal = isLiteral(j + 4) && isPunct(j + 5, ')');
        push('import-equals', keyword, literal ? j + 4 : null, flags);
        consumed.add(j + 2);
      }
      return; // otherwise `import A = B.C`, a namespace alias
    }
    let hasBinding = false;
    let named = 0;
    let typed = 0;
    for (let k = j; k < n; k++) {
      if (isIdent(k, 'from') && kinds[k + 1] === T_STRING) {
        const inline = !typeOnly && named > 0 && typed === named && !hasBinding;
        push('static', keyword, k + 1, inline ? { inlineTypeOnly: true } : flags);
        return;
      }
      if (isPunct(k, '{')) {
        const list = specifierList(k);
        if (list.close === -1) {
          break;
        }
        named += list.named;
        typed += list.typed;
        k = list.close;
      } else if (isIdent(k) || isPunct(k, '*')) {
        hasBinding = true;
      } else if (!isPunct(k, ',')) {
        break;
      }
    }
    s.diagnostics.push({ code: 'unrecognized-import', offset: starts[keyword]! });
  };

  const exportStatement = (keyword: number): void => {
    let j = keyword + 1;
    let typeOnly = false;
    if (isIdent(j, 'type') && (isPunct(j + 1, '{') || isPunct(j + 1, '*'))) {
      typeOnly = true;
      j++;
    }
    const flags = typeOnly ? { typeOnly: true as const } : {};
    if (isPunct(j, '*')) {
      for (let k = j + 1; k < n; k++) {
        if (isIdent(k, 'from') && kinds[k + 1] === T_STRING) {
          push('reexport', keyword, k + 1, flags);
          return;
        }
        if (!isIdent(k) && kinds[k] !== T_STRING) {
          break;
        }
      }
      s.diagnostics.push({ code: 'unrecognized-import', offset: starts[keyword]! });
    } else if (isPunct(j, '{')) {
      const list = specifierList(j);
      if (list.close !== -1 && isIdent(list.close + 1, 'from') && kinds[list.close + 2] === T_STRING) {
        const inline = !typeOnly && list.named > 0 && list.typed === list.named;
        push('reexport', keyword, list.close + 2, inline ? { inlineTypeOnly: true } : flags);
      }
    }
  };

  const glob = (keyword: number, open: number): void => {
    let k = open + 1;
    let patterns: string[] | null = [];
    let literalAt: number | null = null;
    if (isLiteral(k)) {
      patterns.push(value(k));
      literalAt = k;
      k++;
    } else if (isPunct(k, '[')) {
      for (k++; k < n && !isPunct(k, ']'); k++) {
        if (isLiteral(k)) {
          patterns.push(value(k));
          literalAt ??= k;
        } else if (!isPunct(k, ',')) {
          patterns = null;
          break;
        }
      }
      k++;
    } else {
      patterns = null;
    }
    const extra: { patterns: string[] | null; query?: string; base?: string } = { patterns };
    if (patterns !== null && isPunct(k, ',') && isPunct(k + 1, '{')) {
      const close = matchingBrace(k + 1);
      for (let o = k + 2; o < close; o++) {
        const key = kinds[o] === T_IDENT ? texts[o] : kinds[o] === T_STRING ? value(o) : null;
        if ((key === 'query' || key === 'base') && isPunct(o + 1, ':')) {
          if (isLiteral(o + 2) && (isPunct(o + 3, ',') || o + 3 === close)) {
            extra[key] = value(o + 2);
          } else {
            extra.patterns = null; // a base or query we cannot read changes what the patterns mean
          }
        }
      }
    }
    push('glob', keyword, null, extra);
    if (literalAt !== null) {
      const last = records[records.length - 1]!;
      records[records.length - 1] = { ...last, start: starts[literalAt]!, end: ends[literalAt]! };
    }
  };

  const matchingBrace = (open: number): number => {
    let depth = 0;
    for (let k = open; k < n; k++) {
      if (isPunct(k, '{')) {
        depth++;
      } else if (isPunct(k, '}') && --depth === 0) {
        return k;
      }
    }
    return n;
  };

  const isImportMetaUrl = (k: number): boolean =>
    isIdent(k, 'import') && isPunct(k + 1, '.') && isIdent(k + 2, 'meta') && isPunct(k + 3, '.') && isIdent(k + 4, 'url');

  for (let i = 0; i < n; i++) {
    if (kinds[i] !== T_IDENT) {
      continue;
    }
    const word = texts[i];
    if (word === 'require') {
      // `module.require(…)` loads a module; `obj.require(…)` is just a method.
      if (consumed.has(i) || (afterDot(i) && !(isIdent(i - 2, 'module') && !afterDot(i - 2)))) {
        continue;
      }
      if (isPunct(i + 1, '(')) {
        call('require', i, i + 1);
      } else if (isPunct(i + 1, '.') && isIdent(i + 2, 'resolve') && isPunct(i + 3, '(')) {
        call('require-resolve', i, i + 3);
      }
      continue;
    }
    if (afterDot(i)) {
      continue;
    }
    switch (word) {
      case 'import':
        if (isPunct(i + 1, '(')) {
          call('dynamic', i, i + 1);
        } else if (isPunct(i + 1, '.') && isIdent(i + 2, 'meta')) {
          if (isPunct(i + 3, '.') && isPunct(i + 5, '(')) {
            const prop = texts[i + 4];
            if (prop === 'glob' || prop === 'globEager') {
              glob(i, i + 5);
            } else if (prop === 'resolve') {
              call('meta-resolve', i, i + 5);
            }
          }
        } else if (kinds[i + 1] === T_STRING) {
          push('side-effect', i, i + 1);
        } else if (i + 1 < n && !(kinds[i + 1] === T_PUNCT && NOT_AN_IMPORT.has(texts[i + 1]!))) {
          importStatement(i);
        }
        break;
      case 'export':
        exportStatement(i);
        break;
      case 'vi':
      case 'jest':
        if (isPunct(i + 1, '.') && isIdent(i + 2) && isPunct(i + 3, '(')) {
          const method = texts[i + 2]!;
          const kind = ACTUAL_METHODS.has(method) ? 'actual' : MOCK_METHODS.has(method) ? 'mock' : null;
          const arg = i + 4;
          if (kind === null || isPunct(arg, ')')) {
            break;
          }
          if (isLiteral(arg) && (isPunct(arg + 1, ')') || isPunct(arg + 1, ','))) {
            push(kind, i, arg);
          } else if (isIdent(arg, 'import') && isPunct(arg + 1, '(') && isLiteral(arg + 2) && isPunct(arg + 3, ')')) {
            push(kind, i, arg + 2); // vi.mock(import('./x'), …)
          } else {
            push(kind, i, null);
          }
        }
        break;
      case 'new':
        if (isIdent(i + 1, 'URL') && isPunct(i + 2, '(')) {
          const arg = i + 3;
          const next = after(arg);
          if (arg < n && (kinds[arg] === T_STRING || kinds[arg] === T_TEMPLATE || kinds[arg] === T_TEMPLATE_SUBST) && isPunct(next, ',') && isImportMetaUrl(next + 1)) {
            push('url', i, kinds[arg] === T_TEMPLATE_SUBST ? null : arg);
          }
        }
        break;
      default:
    }
  }
  return records;
}

/** Cooks a string or template body: escapes and line continuations, as the runtime would. */
function decodeLiteral(raw: string): string {
  if (!raw.includes('\\')) {
    return raw;
  }
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = raw[++i];
    switch (e) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'v':
        out += '\v';
        break;
      case '0':
        out += '\0';
        break;
      case 'x':
        out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 3), 16));
        i += 2;
        break;
      case 'u':
        if (raw[i + 1] === '{') {
          const close = raw.indexOf('}', i);
          out += String.fromCodePoint(Number.parseInt(raw.slice(i + 2, close), 16));
          i = close;
        } else {
          out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 5), 16));
          i += 4;
        }
        break;
      case '\r':
        if (raw[i + 1] === '\n') {
          i++;
        }
        break;
      case '\n':
      case ' ':
      case ' ':
        break;
      default:
        out += e ?? '';
    }
  }
  return out;
}
