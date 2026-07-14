import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import micromatch from 'micromatch';
import type { GraphProvider, ParsedDiff, SymbolRef, AnchorResolution, CodeContext } from './provider.js';

/** Fallback provider — no external backend needed.
 *  Blast radius = files in diff. Context = raw file reads. */
export class NullProvider implements GraphProvider {
  readonly name = 'null';

  async available(_repoRoot: string): Promise<boolean> {
    return true; // always available
  }

  async affectedSymbols(diff: ParsedDiff): Promise<SymbolRef[]> {
    return diff.files.map((f) => ({ kind: 'path' as const, value: f }));
  }

  async resolveAnchor(anchor: { type: 'symbol' | 'path'; value: string }): Promise<AnchorResolution> {
    if (anchor.type === 'symbol') {
      // Cannot resolve symbols without a graph — mark as found to avoid false stale
      return { found: true };
    }
    // For path anchors, we could check existence but keep it simple
    return { found: true };
  }

  async contextFor(symbols: SymbolRef[], budgetTokens: number): Promise<CodeContext> {
    const snippets: Record<string, string> = {};
    let usedTokens = 0;
    const tokensPerChar = 0.25; // rough estimate: 4 chars per token

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
        // file not readable — skip
      }
    }

    return { estimatedTokens: usedTokens, snippets };
  }
}

/** Read source files matching glob patterns for context */
export async function readFilesMatchingGlobs(
  repoRoot: string,
  globs: string[],
  budgetTokens: number,
): Promise<CodeContext> {
  const snippets: Record<string, string> = {};
  let usedTokens = 0;
  const tokensPerChar = 0.25;

  async function walk(dir: string): Promise<void> {
    if (usedTokens >= budgetTokens) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (usedTokens >= budgetTokens) break;
      const full = join(dir, entry);
      const rel = relative(repoRoot, full);
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const isMatch = micromatch([rel], globs).length > 0;
      if (isMatch) {
        try {
          const content = await readFile(full, 'utf-8');
          const remaining = budgetTokens - usedTokens;
          const maxChars = Math.floor(remaining / tokensPerChar);
          const snippet = content.slice(0, maxChars);
          snippets[rel] = snippet;
          usedTokens += Math.ceil(snippet.length * tokensPerChar);
        } catch {
          // skip unreadable
        }
      } else {
        // recurse into subdirs that might match
        await walk(full);
      }
    }
  }

  await walk(resolve(repoRoot));
  return { estimatedTokens: usedTokens, snippets };
}
