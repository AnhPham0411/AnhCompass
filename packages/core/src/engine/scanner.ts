/** Token-level source scanning for dependency extraction.
 *
 *  Regex matching over raw diff lines cannot tell code from text: a commented
 *  import, a codegen template string, or a markdown fence all look like a
 *  dependency, while a multi-line import or a re-export looks like nothing.
 *  Tokenizing first removes both failure modes — comments and string bodies
 *  never reach the matcher, and statements are matched across line breaks.
 */

export type SourceLanguage = 'js' | 'python';

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);

/** Language for a path, or null when the file is not source we can parse
 *  (markdown, JSON manifests, unknown extensions). */
export function languageForPath(filePath: string): SourceLanguage | null {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  if (JS_EXTENSIONS.has(ext)) return 'js';
  if (PYTHON_EXTENSIONS.has(ext)) return 'python';
  return null;
}

interface Token {
  kind: 'word' | 'string' | 'punct';
  value: string;
  line: number;
}

export interface ImportRef {
  /** Module specifier as written: 'lodash/fp', 'requests.adapters' */
  specifier: string;
  /** 1-based line of the statement keyword within the scanned text */
  line: number;
}

export interface ScanResult {
  imports: ImportRef[];
  /** Comment text by 1-based line — suppression directives live here */
  comments: Map<number, string>;
}

export function scanSource(text: string, language: SourceLanguage): ScanResult {
  const { tokens, comments } =
    language === 'js' ? tokenizeJs(text) : tokenizePython(text);
  const imports = language === 'js' ? extractJsImports(tokens) : extractPythonImports(tokens);
  return { imports, comments };
}

/** Does a specifier resolve to the forbidden package?
 *  Subpaths count ('lodash/fp' → lodash); look-alikes do not ('lodash-es'). */
export function specifierMatchesPackage(
  specifier: string,
  pkg: string,
  language: SourceLanguage,
): boolean {
  if (specifier === pkg) return true;
  return language === 'python' ? specifier.startsWith(`${pkg}.`) : specifier.startsWith(`${pkg}/`);
}

function addComment(comments: Map<number, string>, line: number, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const prev = comments.get(line);
  comments.set(line, prev ? `${prev} ${trimmed}` : trimmed);
}

/** JS/TS tokenizer. Comments are collected, not emitted; string and template
 *  bodies become single opaque tokens. Template substitutions (`${...}`) are
 *  tokenized as code, since a require() inside one is a real dependency.
 *
 *  Known limit: a regex literal containing import-like text (`/import 'x'/`)
 *  is tokenized as code. Detecting regex literals needs expression-position
 *  tracking; the pattern is rare enough not to justify it. */
function tokenizeJs(text: string): { tokens: Token[]; comments: Map<number, string> } {
  const tokens: Token[] = [];
  const comments = new Map<number, string>();
  const n = text.length;
  /** brace depth inside each open template substitution */
  const templates: number[] = [];
  let mode: 'code' | 'template' = 'code';
  let i = 0;
  let line = 1;

  while (i < n) {
    const ch = text[i]!;

    if (mode === 'template') {
      if (ch === '\n') {
        line++;
        i++;
      } else if (ch === '\\') {
        i += 2;
      } else if (ch === '`') {
        templates.pop();
        mode = 'code';
        i++;
      } else if (ch === '$' && text[i + 1] === '{') {
        templates[templates.length - 1] = 0;
        mode = 'code';
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      addComment(comments, line, text.slice(i + 2, stop));
      i = stop;
      continue;
    }

    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const bodyEnd = close === -1 ? n : close;
      let commentLine = line;
      for (const part of text.slice(i + 2, bodyEnd).split('\n')) {
        addComment(comments, commentLine, part.replace(/^\s*\*/, ''));
        commentLine++;
      }
      const stop = close === -1 ? n : close + 2;
      for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const startLine = line;
      const quote = ch;
      let value = '';
      i++;
      while (i < n) {
        const c = text[i]!;
        if (c === '\\') {
          value += text[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        if (c === '\n') break; // unterminated — bail, the newline is handled next pass
        value += c;
        i++;
      }
      tokens.push({ kind: 'string', value, line: startLine });
      continue;
    }

    if (ch === '`') {
      templates.push(0);
      mode = 'template';
      i++;
      continue;
    }

    if (isJsWordStart(ch)) {
      let j = i;
      while (j < n && isJsWordChar(text[j]!)) j++;
      tokens.push({ kind: 'word', value: text.slice(i, j), line });
      i = j;
      continue;
    }

    if (templates.length > 0) {
      const top = templates.length - 1;
      if (ch === '{') {
        templates[top] = templates[top]! + 1;
      } else if (ch === '}') {
        if (templates[top] === 0) {
          mode = 'template';
          i++;
          continue;
        }
        templates[top] = templates[top]! - 1;
      }
    }

    tokens.push({ kind: 'punct', value: ch, line });
    i++;
  }

  return { tokens, comments };
}

function isJsWordStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isJsWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/** Is the token at `index` in statement position?
 *
 *  `import x from 'y'` and `export … from 'y'` are declarations: the grammar
 *  only admits them at the top level of a module, never inside an expression.
 *  So the keyword must open a statement — start of file, after a `;` or a
 *  brace, or on a line of its own.
 *
 *  What this buys is JSX. `<p>run: import _ from 'lodash'</p>` is element text,
 *  not code, and the tokenizer has no way to know that; the keyword there sits
 *  mid-line behind a `:` and is rejected here instead. Telling a developer that
 *  the prose in their component is a forbidden dependency is exactly the false
 *  positive that gets a checker switched off.
 *
 *  Known limit: JSX text that begins its own line still looks like a statement
 *  and is still reported. Separating those needs a real JSX parser. */
function inStatementPosition(tokens: Token[], index: number): boolean {
  const prev = tokens[index - 1];
  if (!prev) return true;
  if (prev.line !== tokens[index]!.line) return true;
  return prev.kind === 'punct' && (prev.value === ';' || prev.value === '{' || prev.value === '}');
}

/** Every form that creates a module dependency in JS/TS. */
function extractJsImports(tokens: Token[]): ImportRef[] {
  const imports: ImportRef[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== 'word') continue;

    if (token.value === 'import' || token.value === 'export') {
      const next = tokens[i + 1];

      // `import('pkg')` is an expression and legal anywhere; the declaration
      // forms below are not, so they are held to statement position.
      const isDynamic = next?.kind === 'punct' && next.value === '(';
      if (!isDynamic && !inStatementPosition(tokens, i)) continue;

      // import 'pkg' — side effect only
      if (token.value === 'import' && next?.kind === 'string') {
        imports.push({ specifier: next.value, line: token.line });
        continue;
      }

      // import('pkg') — dynamic
      if (
        token.value === 'import' &&
        next?.kind === 'punct' &&
        next.value === '(' &&
        tokens[i + 2]?.kind === 'string'
      ) {
        imports.push({ specifier: tokens[i + 2]!.value, line: token.line });
        continue;
      }

      // `... from 'pkg'` — static import, re-export, `export * from`.
      // Scanning by token spans line breaks, so multi-line imports resolve.
      for (let j = i + 1; j < tokens.length; j++) {
        const ahead = tokens[j]!;
        if (ahead.kind === 'punct' && ahead.value === ';') break;
        if (ahead.kind === 'word' && (ahead.value === 'import' || ahead.value === 'export')) break;
        if (ahead.kind === 'word' && ahead.value === 'from' && tokens[j + 1]?.kind === 'string') {
          imports.push({ specifier: tokens[j + 1]!.value, line: token.line });
          break;
        }
      }
      continue;
    }

    // require('pkg') — also covers `import x = require('pkg')`
    if (
      token.value === 'require' &&
      tokens[i + 1]?.kind === 'punct' &&
      tokens[i + 1]!.value === '(' &&
      tokens[i + 2]?.kind === 'string'
    ) {
      imports.push({ specifier: tokens[i + 2]!.value, line: token.line });
    }
  }

  return imports;
}

/** Python tokenizer — `#` comments, triple-quoted and plain strings. */
function tokenizePython(text: string): { tokens: Token[]; comments: Map<number, string> } {
  const tokens: Token[] = [];
  const comments = new Map<number, string>();
  const n = text.length;
  let i = 0;
  let line = 1;

  while (i < n) {
    const ch = text[i]!;

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    if (ch === '#') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      addComment(comments, line, text.slice(i + 1, stop));
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const startLine = line;
      const triple = text.slice(i, i + 3);
      const isTriple = triple === '"""' || triple === "'''";
      const delimiter = isTriple ? triple : ch;
      i += delimiter.length;
      let value = '';
      while (i < n) {
        if (text[i] === '\\') {
          value += text[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (text.startsWith(delimiter, i)) {
          i += delimiter.length;
          break;
        }
        if (text[i] === '\n') {
          line++;
          if (!isTriple) {
            break; // unterminated single-line string
          }
        }
        value += text[i];
        i++;
      }
      tokens.push({ kind: 'string', value, line: startLine });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      tokens.push({ kind: 'word', value: text.slice(i, j), line });
      i = j;
      continue;
    }

    tokens.push({ kind: 'punct', value: ch, line });
    i++;
  }

  return { tokens, comments };
}

/** `import a, b.c as d` and `from a.b import c`. Relative imports are skipped. */
/** Python functions that take a module name as a string and return the module.
 *  A dependency introduced this way is invisible to `import` statements but is
 *  the same dependency at runtime. */
const PYTHON_DYNAMIC_IMPORTS = new Set(['import_module', '__import__']);

function extractPythonImports(tokens: Token[]): ImportRef[] {
  const imports: ImportRef[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== 'word') continue;

    // importlib.import_module('requests') / __import__('requests')
    if (PYTHON_DYNAMIC_IMPORTS.has(token.value)) {
      const open = tokens[i + 1];
      const arg = tokens[i + 2];
      if (
        open?.kind === 'punct' &&
        open.value === '(' &&
        arg?.kind === 'string' &&
        arg.value.length > 0
      ) {
        imports.push({ specifier: arg.value, line: token.line });
        i += 2;
        continue;
      }
    }

    if (token.value === 'from') {
      let j = i + 1;
      let name = '';
      while (j < tokens.length) {
        const ahead = tokens[j]!;
        if (ahead.kind === 'word' && ahead.value === 'import') break;
        if (ahead.kind === 'word' || (ahead.kind === 'punct' && ahead.value === '.')) {
          name += ahead.value;
          j++;
          continue;
        }
        break;
      }
      if (name && !name.startsWith('.')) {
        imports.push({ specifier: name, line: token.line });
      }
      i = j; // skip the `import` keyword so it is not parsed as a new statement
      continue;
    }

    if (token.value === 'import') {
      const { line } = token;
      let j = i + 1;
      let current = '';
      while (j < tokens.length) {
        const ahead = tokens[j]!;
        if (ahead.line !== line) break; // statement ends at the line break
        if (ahead.kind === 'word' && ahead.value === 'as') {
          j += 2; // skip the alias
          continue;
        }
        if (ahead.kind === 'word' || (ahead.kind === 'punct' && ahead.value === '.')) {
          current += ahead.value;
          j++;
          continue;
        }
        if (ahead.kind === 'punct' && ahead.value === ',') {
          if (current) imports.push({ specifier: current, line });
          current = '';
          j++;
          continue;
        }
        break;
      }
      if (current) imports.push({ specifier: current, line });
      i = j - 1;
    }
  }

  return imports;
}
