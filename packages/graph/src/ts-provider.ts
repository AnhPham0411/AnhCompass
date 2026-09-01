import { join, relative } from 'node:path';
import { stat, readdir, readFile } from 'node:fs/promises';
import { Indexer } from './index/indexer.js';
import { QueryEngine } from './query/query.js';
import type { GraphProvider, ParsedDiff, SymbolRef, AnchorResolution, CodeContext } from './provider.js';
import { NullProvider } from './null-provider.js';

/** Splits on both line endings — a `.gitignore` written on Windows is still a
 *  `.gitignore`. */
const NEWLINE_RE = /\r?\n/;

/** Directory names, and name prefixes, the walk should not descend into. */
interface IgnoreRules {
  exact: Set<string>;
  prefixes: string[];
}

export class TsGraphProvider implements GraphProvider {
  readonly name = 'ts-graph';
  private repoRoot: string; constructor(repoRoot?: string) { this.repoRoot = repoRoot || ''; }
  private indexer: Indexer | null = null;
  public query: QueryEngine | null = null;

  async available(repoRoot: string): Promise<boolean> {
    this.repoRoot = repoRoot;
    try {
      const tsconfig = await stat(join(repoRoot, 'tsconfig.base.json')).catch(() => stat(join(repoRoot, 'tsconfig.json')));
      if (tsconfig.isFile()) {
        return true;
      }
    } catch {
      // ignore
    }
    try {
       const pkg = await stat(join(repoRoot, 'package.json'));
       if (pkg.isFile()) return true;
    } catch {
       // ignore
    }
    return false;
  }

  /** Directory names never worth indexing, whatever the repo says. Kept
   *  separate from `.gitignore` because a repo that commits its `dist/` still
   *  should not have build output in its dependency graph. */
  private static readonly ALWAYS_IGNORED = [
    'node_modules',
    '.git',
    'dist',
    '.next',
    'coverage',
    'build',
    'vendor',
    '.anhcompass',
  ];

  /** Directory patterns the repo's own root `.gitignore` excludes.
   *
   *  Deliberately a subset of gitignore semantics: a single path segment,
   *  optionally ending in one star — "dist", "out", "real-demo" plus a star.
   *  Negations, nested ignore files, and patterns with a slash or an interior
   *  wildcard are not honoured; a partial reading that silently dropped source
   *  files would be worse than indexing a few extra ones, and the graph only
   *  ever reports paths it actually found.
   *
   *  The trailing star earns its place: a generated fixture tree matched by one
   *  is the difference between indexing a repository and indexing a repository
   *  plus seventeen thousand files nobody committed. */
  private async ignoredDirsFromGitignore(): Promise<IgnoreRules> {
    const exact = new Set<string>();
    const prefixes: string[] = [];
    let text: string;
    try {
      text = await readFile(join(this.repoRoot, '.gitignore'), 'utf-8');
    } catch {
      return { exact, prefixes };
    }

    for (const raw of text.split(NEWLINE_RE)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      if (line.includes('?') || line.includes('[')) continue;

      const name = line.replace(/^\//, '').replace(/\/$/, '');
      if (!name || name.includes('/')) continue;

      const star = name.indexOf('*');
      if (star === -1) {
        exact.add(name);
      } else if (star === name.length - 1) {
        prefixes.push(name.slice(0, -1));
      }
      // an interior wildcard (`a*b`) is left alone
    }
    return { exact, prefixes };
  }

  private static isIgnored(entry: string, rules: IgnoreRules): boolean {
    if (rules.exact.has(entry)) return true;
    return rules.prefixes.some((prefix) => prefix !== '' && entry.startsWith(prefix));
  }

  public async getQueryEngine(): Promise<QueryEngine> {
    if (this.query) return this.query;
    if (!this.indexer) {
      this.indexer = new Indexer(this.repoRoot);
    }
    
    // Walk to find all TS/JS files
    const allFiles: string[] = [];
    const gitignored = await this.ignoredDirsFromGitignore();
    const walk = async (dir: string) => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (TsGraphProvider.ALWAYS_IGNORED.includes(entry)) continue;
        if (TsGraphProvider.isIgnored(entry, gitignored)) continue;
        const full = join(dir, entry);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        if (s.isDirectory()) {
          await walk(full);
        } else if (s.isFile()) {
          const ext = entry.slice(entry.lastIndexOf('.'));
          // Must match the lexical scanner's coverage. When the two engines
          // disagree about which files exist, the graph silently answers pass
          // for a language it cannot see.
          if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) {
            allFiles.push(relative(this.repoRoot, full).replace(/\\/g, '/'));
          }
        }
      }
    };
    
    await walk(this.repoRoot);
    const data = this.indexer.index(allFiles);
    this.query = new QueryEngine(data);
    return this.query;
  }

  async affectedSymbols(diff: ParsedDiff): Promise<SymbolRef[]> {
    return diff.files.map((f): SymbolRef => ({ kind: 'path', value: f }));
  }

  async resolveAnchor(anchor: { type: 'symbol' | 'path'; value: string }): Promise<AnchorResolution> {
    if (anchor.type === 'path') {
      try {
        const s = await stat(join(this.repoRoot, anchor.value));
        return { found: s.isFile() || s.isDirectory() };
      } catch {
        return { found: false };
      }
    }
    return { found: true }; // Not implemented for symbols yet
  }

  async contextFor(symbols: SymbolRef[], budgetTokens: number): Promise<CodeContext> {
    const nullP = new NullProvider();
    return nullP.contextFor(symbols, budgetTokens);
  }
}
