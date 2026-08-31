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

export class Indexer {
  private repoRoot: string;
  private cacheDir: string;
  private memoryCache: Map<string, { mtime: number; edges: string[] }> = new Map();

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.cacheDir = path.join(repoRoot, '.anhcompass', 'cache');
    this.loadCache();
  }

  private loadCache() {
    try {
      const cacheFile = path.join(this.cacheDir, 'graph.json');
      if (fs.existsSync(cacheFile)) {
        const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          this.memoryCache.set(k, v as any);
        }
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
      const data = Object.fromEntries(this.memoryCache.entries());
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

  private tsconfigPaths: Record<string, string[]> | null = null;
  private resolveImport(fromPath: string, specifier: string): string {
    if (this.tsconfigPaths === null) {
      this.tsconfigPaths = {};
      try {
        
        
        const tsconfigPath = path.join(this.repoRoot, "tsconfig.json");
        if (fs.existsSync(tsconfigPath)) {
          const tsconfigStr = fs.readFileSync(tsconfigPath, "utf-8");
          // remove comments
          const cleaned = tsconfigStr.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
          const tsconfig = JSON.parse(cleaned);
          if (tsconfig.compilerOptions?.paths) {
            this.tsconfigPaths = tsconfig.compilerOptions.paths;
          }
        }
      } catch {}
    }
    
    // try to apply tsconfig paths
    if (!specifier.startsWith(".")) {
      for (const [alias, targets] of Object.entries(this.tsconfigPaths || {})) {
        if (alias.endsWith("/*") && specifier.startsWith(alias.slice(0, -2))) {
          for (const target of targets) {
            if (target.endsWith("/*")) {
              const mapped = target.slice(0, -2) + specifier.slice(alias.length - 2);
              const resolved = path.resolve(this.repoRoot, mapped);
              // Extensions in priority order
              const extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];
              for (const ext of extensions) {
                const withExt = resolved + ext;
                try {
                  if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
                    return path.relative(this.repoRoot, withExt).replace(/\\/g, "/");
                  }
                } catch {}
              }
            }
          }
        }
      }
    }
    if (!specifier.startsWith('.')) {
      return specifier;
    }

    const fromDir = path.dirname(path.resolve(this.repoRoot, fromPath));
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
