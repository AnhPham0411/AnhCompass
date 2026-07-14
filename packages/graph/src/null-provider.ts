import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import micromatch from 'micromatch';
import type {
  GraphProvider,
  ParsedDiff,
  SymbolRef,
  AnchorResolution,
  CodeContext,
} from './provider.js';

/** Fallback provider — no external backend needed.
 *  Blast radius = files in diff. Context = raw file reads. */
export class NullProvider implements GraphProvider {
  readonly name = 'null';

  async available(_repoRoot: string): Promise<boolean> {
    return true;
  }

  async affectedSymbols(diff: ParsedDiff): Promise<SymbolRef[]> {
    return diff.files.map((f): SymbolRef => ({ kind: 'path', value: f }));
  }

  async resolveAnchor(anchor: {
    type: 'symbol' | 'path';
    value: string;
  }): Promise<AnchorResolution> {
    if (anchor.type === 'symbol') {
      return { found: true };
    }
    return { found: true };
  }

  async contextFor(symbols: SymbolRef[], budgetTokens: number): Promise<CodeContext> {
    const snippets: Record<string, string> = {};
    let usedTokens = 0;
    const tokensPerChar = 0.25;

    for (const sym of symbols) {
      if (sym.kind !== 'path') continue;
      if (usedTokens >= budgetTokens) break;

      try {
        const content = await readFile(sym.value, 'utf-8');
        const remainingTokens = budgetTokens - usedTokens;
        const maxChars = Math.floor(remainingTokens / tokensPerChar);
        const snippet = content.slice(0, maxChars);
        snippets[sym.value] = snippet;
        usedTokens += Math.ceil(snippet.length * tokensPerChar);
      } catch {
        // skip
      }
    }

    return { estimatedTokens: usedTokens, snippets };
  }
}

// Supported code extensions for context gathering
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rs', '.php', '.rb', '.cs', '.sh', '.md'
]);

/** Read source files matching glob patterns for context */
export async function readFilesMatchingGlobs(
  repoRoot: string,
  globs: string[],
  budgetTokens: number,
): Promise<CodeContext> {
  const snippets: Record<string, string> = {};
  let usedTokens = 0;
  const tokensPerChar = 0.25;
  let fileCount = 0;
  const maxFiles = 15; // Limit to maximum of 15 context files

  async function walk(dir: string): Promise<void> {
    if (usedTokens >= budgetTokens || fileCount >= maxFiles) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (usedTokens >= budgetTokens || fileCount >= maxFiles) break;
      if (
        entry === 'node_modules' ||
        entry === '.git' ||
        entry === 'dist' ||
        entry === '.agent' ||
        entry === 'coverage'
      ) {
        continue;
      }
      const full = join(dir, entry);
      const rel = relative(repoRoot, full);

      let stats;
      try {
        stats = await stat(full);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        await walk(full);
      } else if (stats.isFile()) {
        // Check extension
        const extIndex = entry.lastIndexOf('.');
        const ext = extIndex !== -1 ? entry.slice(extIndex).toLowerCase() : '';
        if (!CODE_EXTENSIONS.has(ext)) {
          continue; // Skip non-code/binary files
        }

        const isMatch = micromatch([rel], globs).length > 0;
        if (isMatch) {
          try {
            const content = await readFile(full, 'utf-8');
            const remaining = budgetTokens - usedTokens;
            const maxChars = Math.floor(remaining / tokensPerChar);
            const snippet = content.slice(0, maxChars);
            snippets[rel] = snippet;
            usedTokens += Math.ceil(snippet.length * tokensPerChar);
            fileCount++;
          } catch {
            // skip unreadable
          }
        }
      }
    }
  }

  await walk(resolve(repoRoot));
  return { estimatedTokens: usedTokens, snippets };
}
