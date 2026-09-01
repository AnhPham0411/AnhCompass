import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export interface ImportEdge {
  from: string; // relative to repo root
  to: string; // resolved relative to repo root, or bare module specifier
}

export interface GraphData {
  nodes: string[];
  edges: ImportEdge[];
}

/** Is this repo-relative path source the walker would actually index?
 *
 *  Anything inside `node_modules` is a third-party file, and anything inside a
 *  build directory is a copy of source that already has a node of its own. An
 *  edge to either is an edge to a node that does not exist, which is worse than
 *  no edge: a layer rule evaluated over a graph full of dangling edges reports
 *  `pass` while the dependency it forbids sits there. */
function isFirstPartySource(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return !segments.some((s) => s === 'node_modules' || s === 'dist' || s === 'build');
}

/** Bumped whenever how an edge is derived changes.
 *
 *  The cache is keyed by file mtime, which answers "has this file changed" and
 *  not "would this file resolve differently now". After the resolver stopped
 *  expanding bare specifiers into node_modules paths, every unchanged file
 *  still served its old edges from disk and the fix appeared not to work. A
 *  cache that outlives the logic that filled it is a wrong answer with a fast
 *  path to it. */
const INDEX_FORMAT_VERSION = 2;

interface CacheFile {
  version: number;
  entries: Record<string, { mtime: number; edges: string[] }>;
}

export class Indexer {
  private repoRoot: string;
  private cacheDir: string;
  private memoryCache: Map<string, { mtime: number; edges: string[] }> = new Map();

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.cacheDir = path.join(repoRoot, '.anhcompass', 'cache');
    this.loadCache();
  }

  /** A cache entry the on-disk file has to produce before it is trusted.
   *  The file is ordinary user-writable JSON; a malformed entry must be
   *  dropped, not fed to the graph as if it were an index. */
  private static isCacheEntry(v: unknown): v is { mtime: number; edges: string[] } {
    if (typeof v !== 'object' || v === null) return false;
    const e = v as { mtime?: unknown; edges?: unknown };
    return (
      typeof e.mtime === 'number' &&
      Array.isArray(e.edges) &&
      e.edges.every((edge) => typeof edge === 'string')
    );
  }

  private loadCache() {
    try {
      const cacheFile = path.join(this.cacheDir, 'graph.json');
      if (!fs.existsSync(cacheFile)) return;

      const data: unknown = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (typeof data !== 'object' || data === null) return;

      const file = data as Partial<CacheFile>;
      if (file.version !== INDEX_FORMAT_VERSION) return; // written by an older resolver
      if (typeof file.entries !== 'object' || file.entries === null) return;

      for (const [k, v] of Object.entries(file.entries)) {
        if (Indexer.isCacheEntry(v)) this.memoryCache.set(k, v);
      }
    } catch {
      // ignore
    }
  }

  private saveCache() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      const data: CacheFile = {
        version: INDEX_FORMAT_VERSION,
        entries: Object.fromEntries(this.memoryCache.entries()),
      };
      fs.writeFileSync(path.join(this.cacheDir, 'graph.json'), JSON.stringify(data, null, 2));
    } catch {
      // ignore
    }
  }

  public index(filePaths: string[]): GraphData {
    const nodes: string[] = [];
    const edges: ImportEdge[] = [];
    let cacheUpdated = false;

    for (const filePath of filePaths) {
      // Use posix paths internally
      const posixFilePath = filePath.replace(/\\/g, '/');
      nodes.push(posixFilePath);

      const absPath = path.resolve(this.repoRoot, posixFilePath);
      if (!fs.existsSync(absPath)) continue;

      const stat = fs.statSync(absPath);
      const cached = this.memoryCache.get(posixFilePath);

      let fileEdges: string[] = [];

      if (cached && cached.mtime === stat.mtimeMs) {
        fileEdges = cached.edges;
      } else {
        fileEdges = this.parseFile(absPath, posixFilePath);
        this.memoryCache.set(posixFilePath, { mtime: stat.mtimeMs, edges: fileEdges });
        cacheUpdated = true;
      }

      for (const edge of fileEdges) {
        edges.push({ from: posixFilePath, to: edge });
      }
    }

    if (cacheUpdated) {
      this.saveCache();
    }

    const allNodes = Array.from(new Set([...nodes, ...edges.map(e => e.to)])); return { nodes: allNodes, edges };
  }

  private parseFile(absPath: string, posixFilePath: string): string[] {
    const content = fs.readFileSync(absPath, 'utf-8');
    const sourceFile = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true);
    const edges: string[] = [];

    const addEdge = (specifier: string) => {
      const resolved = this.resolveImport(posixFilePath, specifier);
      if (resolved && !edges.includes(resolved)) {
        edges.push(resolved);
      }
    };

    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          addEdge(node.moduleSpecifier.text);
        }
      } else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          addEdge(node.moduleSpecifier.text);
        }
      } else if (ts.isCallExpression(node)) {
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        if (isRequire || isDynamicImport) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg)) {
            addEdge(arg.text);
          }
        }
      } else if (ts.isImportEqualsDeclaration(node)) {
        if (ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
          addEdge(node.moduleReference.expression.text);
        }
      }
      ts.forEachChild(node, walk);
    };

    walk(sourceFile);
    return edges;
  }

  private compilerOptions: ts.CompilerOptions | null = null;

  /** The tsconfig whose `paths` govern this repository.
   *
   *  Deliberately not `ts.findConfigFile`, which walks *up* past the repo root
   *  when it finds nothing: a monorepo whose root holds only `tsconfig.base.json`
   *  would silently adopt the compiler options of whatever unrelated project
   *  happens to sit in a parent directory. The search stays inside the repo and
   *  knows about the base-config convention. */
  private findTsconfig(): string | undefined {
    for (const name of ['tsconfig.json', 'tsconfig.base.json']) {
      const candidate = path.join(this.repoRoot, name);
      // Forward slashes: TypeScript normalises paths internally and asserts
      // that the one it was handed matches, so a Windows path reaches its
      // diagnostic code and throws a Debug Failure instead of reporting the
      // syntax error it found.
      if (fs.existsSync(candidate)) return candidate.split(path.sep).join('/');
    }
    return undefined;
  }


  private resolveImport(fromPath: string, specifier: string): string {
    if (this.compilerOptions === null) {
      this.compilerOptions = {};
      const configPath = this.findTsconfig();
      if (configPath) {
        // A tsconfig is user-written and may be anything. Losing its `paths`
        // costs some alias edges; letting it throw costs the whole check.
        try {
          const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
          if (!configFile.error) {
            const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.repoRoot);
            this.compilerOptions = parsed.options;
          }
        } catch {
          // keep the empty options and resolve relatively
        }
      }
    }

    const absFromPath = path.resolve(this.repoRoot, fromPath);
    const result = ts.resolveModuleName(
      specifier,
      absFromPath,
      this.compilerOptions,
      ts.sys
    );

    if (result.resolvedModule) {
      const resolved = path
        .relative(this.repoRoot, result.resolvedModule.resolvedFileName)
        .replace(/\\/g, '/');

      // A dependency rule names packages — `lodash`, `@acme/db` — and matches
      // them against graph nodes. Resolving a bare specifier all the way to the
      // file it ships would turn that node into
      // `node_modules/.pnpm/lodash@4/node_modules/lodash/index.js`, which no
      // rule can name and which the walker never indexes anyway. So a bare
      // specifier stays the package it names; only a specifier that lands on
      // first-party source becomes a path, which is what makes a `paths` alias
      // a real edge instead of a dangling one.
      if (specifier.startsWith('.') || isFirstPartySource(resolved)) {
        return resolved;
      }
      return specifier;
    }

    if (!specifier.startsWith('.')) {
      return specifier;
    }

    const fromDir = path.dirname(absFromPath);
    const targetPath = path.resolve(fromDir, specifier);
    
    // Extensions in priority order
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
    
    for (const ext of extensions) {
      const withExt = targetPath + ext;
      try {
        if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
          return path.relative(this.repoRoot, withExt).replace(/\\/g, '/');
        }
      } catch {
        // ignore
      }
    }

    return path.relative(this.repoRoot, targetPath).replace(/\\/g, '/');
  }
}
