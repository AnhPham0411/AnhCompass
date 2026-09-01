import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Indexer } from '../src/index/indexer.js';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  }
}));

describe('Indexer', () => {
  const repoRoot = process.cwd();
  let indexer: Indexer;

  beforeEach(() => {
    vi.resetAllMocks();
    indexer = new Indexer(repoRoot);
    
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.endsWith('.ts') || pathStr.endsWith('.json')) return true;
      return false;
    });
    vi.mocked(fs.statSync).mockImplementation(() => ({ isFile: () => true } as any));
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.includes('tsconfig.json')) return '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}';
      if (pathStr.includes('a.ts')) return 'import { x } from "./b";';
      return '';
    });

    vi.spyOn(ts.sys, 'fileExists').mockImplementation((p) => {
      if (p.includes('tsconfig.json')) return true;
      if (p.endsWith('math.ts') || p.includes('a.ts') || p.includes('b.ts') || p.includes('b.tsx') || p.includes('b.d.ts')) return true;
      return false;
    });
    vi.spyOn(ts.sys, 'readFile').mockImplementation((p) => {
      if (p.includes('tsconfig.json')) return '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}';
      if (p.includes('a.ts')) return 'import { x } from "./b";';
      return '';
    });
  });

  describe('resolveImport', () => {
    it('resolves relative imports', () => {
      const result = (indexer as any).resolveImport(path.join(repoRoot, 'src', 'main.ts'), './utils/math');
      // resolveModuleName should find it using ts.sys.fileExists
      expect(result.replace(/\\/g, '/')).toContain('src/utils/math.ts');
    });

    it('falls back to index files if TS API misses', () => {
      const result = (indexer as any).resolveImport(path.join(repoRoot, 'src', 'main.ts'), './utils');
      // it should append .ts since we mocked fs.existsSync to return true for .ts
      expect(result.replace(/\\/g, '/')).toBe('src/utils.ts');
    });

    it('returns bare specifier if not relative and not resolved by TS', () => {
      
      const result = (indexer as any).resolveImport(path.join(repoRoot, 'src', 'main.ts'), 'lodash');
      expect(result).toBe('lodash');
    });
  });

  describe('index', () => {
    it('returns empty for no files', () => {
      const data = indexer.index([]);
      expect(data.nodes).toHaveLength(0);
      expect(data.edges).toHaveLength(0);
    });

    it('extracts imports from files', () => {
      const aPath = path.join(repoRoot, 'a.ts');
      const posixPath = aPath.replace(/\\/g, '/');
      const data = indexer.index([aPath]);
      
      expect(data.nodes).toContain(posixPath);
      expect(data.edges.some(e => e.from === posixPath && e.to.replace(/\\/g, '/') === 'b.ts')).toBe(true);
    });
  });
});
