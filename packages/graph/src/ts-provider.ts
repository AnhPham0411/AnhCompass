import { join, relative } from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import { Indexer } from './index/indexer.js';
import { QueryEngine } from './query/query.js';
import type { GraphProvider, ParsedDiff, SymbolRef, AnchorResolution, CodeContext } from './provider.js';
import { NullProvider } from './null-provider.js';

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

  public async getQueryEngine(): Promise<QueryEngine> {
    if (this.query) return this.query;
    if (!this.indexer) {
      this.indexer = new Indexer(this.repoRoot);
    }
    
    // Walk to find all TS/JS files
    const allFiles: string[] = [];
    const walk = async (dir: string) => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
        const full = join(dir, entry);
        const s = await stat(full).catch(() => null);
        if (!s) continue;
        if (s.isDirectory()) {
          await walk(full);
        } else if (s.isFile()) {
          const ext = entry.slice(entry.lastIndexOf('.'));
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
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
