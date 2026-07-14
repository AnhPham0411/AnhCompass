/** A reference to a symbol or file path in a codebase */
export interface SymbolRef {
  kind: 'symbol' | 'path';
  value: string;
}

/** Parsed git/unified diff */
export interface ParsedDiff {
  /** Files changed (relative paths) */
  files: string[];
  /** Raw hunks per file */
  hunks: Record<string, string[]>;
}

/** Result of resolving an intent anchor against the graph */
export interface AnchorResolution {
  found: boolean;
  location?: { file: string; line?: number };
}

/** Source code context for an intent semantic check */
export interface CodeContext {
  /** Approximate token count */
  estimatedTokens: number;
  /** Map of file path → relevant snippet */
  snippets: Record<string, string>;
}

/** The core adapter interface — all graph backends implement this */
export interface GraphProvider {
  readonly name: string;
  /** Is this backend available and indexed for this repo? */
  available(repoRoot: string): Promise<boolean>;
  /** Which symbols/files are affected by this diff (blast radius) */
  affectedSymbols(diff: ParsedDiff): Promise<SymbolRef[]>;
  /** Does this anchor still exist? Where? */
  resolveAnchor(anchor: { type: 'symbol' | 'path'; value: string }): Promise<AnchorResolution>;
  /** Get source snippets for semantic check (budget in tokens) */
  contextFor(symbols: SymbolRef[], budgetTokens: number): Promise<CodeContext>;
}
