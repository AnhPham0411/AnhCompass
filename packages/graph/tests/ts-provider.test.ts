import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TsGraphProvider } from '../src/ts-provider.js';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

describe('TsGraphProvider', () => {
  const provider = new TsGraphProvider('/repo');

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('available', () => {
    it('returns true if tsconfig.base.json exists', async () => {
      vi.mocked(fsPromises.stat).mockResolvedValue({ isFile: () => true } as any);
      expect(await provider.available('/repo')).toBe(true);
    });

    it('returns true if package.json exists', async () => {
      vi.mocked(fsPromises.stat)
        .mockRejectedValueOnce(new Error('no tsconfig'))
        .mockResolvedValueOnce({ isFile: () => true } as any);
      expect(await provider.available('/repo')).toBe(true);
    });

    it('returns false if neither exist', async () => {
      vi.mocked(fsPromises.stat).mockRejectedValue(new Error('not found'));
      expect(await provider.available('/repo')).toBe(false);
    });
  });

  describe('getQueryEngine', () => {
    it('walks directory and respects ignore list', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('no .gitignore'));
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir) => {
        if (dir === '/repo') return ['src', 'node_modules', '.next', 'dist', 'build', 'coverage', 'vendor'];
        if (dir === '/repo/src') return ['main.ts', 'styles.css'];
        return [];
      });

      vi.mocked(fsPromises.stat).mockImplementation(async (full) => {
        const isDir = !full.toString().includes('.');
        return {
          isDirectory: () => isDir,
          isFile: () => !isDir,
        } as any;
      });

      // Avoid actual parsing inside getQueryEngine -> Indexer
      // Just let it return an empty graph for our mock files
      const engine = await provider.getQueryEngine();
      expect(engine).toBeDefined();
      
      // we could mock Indexer to check what files were passed, but we just verify it doesn't crash on ignore dirs.
      expect(fsPromises.readdir).toHaveBeenCalledWith('/repo');
      expect(fsPromises.readdir).toHaveBeenCalledWith(path.join('/repo', 'src'));
      expect(fsPromises.readdir).not.toHaveBeenCalledWith(path.join('/repo', 'node_modules'));
      expect(fsPromises.readdir).not.toHaveBeenCalledWith(path.join('/repo', '.next'));
      expect(fsPromises.readdir).not.toHaveBeenCalledWith(path.join('/repo', 'dist'));
    });
  });

  describe('.gitignore', () => {
    /** Walks a repo whose root .gitignore holds the given text, and reports
     *  which directories the walk descended into. */
    async function walkedDirs(gitignore: string, entries: string[]): Promise<string[]> {
      vi.mocked(fsPromises.readFile).mockResolvedValue(gitignore as never);
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir) =>
        dir === '/repo2' ? (entries as never) : ([] as never),
      );
      vi.mocked(fsPromises.stat).mockImplementation(
        async (full) =>
          ({
            isDirectory: () => !full.toString().includes('.ts'),
            isFile: () => full.toString().includes('.ts'),
          }) as never,
      );
      const p = new TsGraphProvider('/repo2');
      await p.getQueryEngine();
      return vi.mocked(fsPromises.readdir).mock.calls.map((c) => String(c[0]));
    }

    it('skips a directory named exactly in .gitignore', async () => {
      const dirs = await walkedDirs(['out', 'src-keep'].join(EOL), ['src', 'out']);
      expect(dirs).not.toContain(path.join('/repo2', 'out'));
      expect(dirs).toContain(path.join('/repo2', 'src'));
    });

    it('skips a directory matched by a trailing wildcard', async () => {
      const dirs = await walkedDirs(['real-demo*/'].join(EOL), [
        'src',
        'real-demo',
        'real-demo-10000',
      ]);
      expect(dirs).not.toContain(path.join('/repo2', 'real-demo'));
      expect(dirs).not.toContain(path.join('/repo2', 'real-demo-10000'));
      expect(dirs).toContain(path.join('/repo2', 'src'));
    });

    it('ignores negations and interior wildcards rather than half-applying them', async () => {
      const dirs = await walkedDirs(['!keep', 'a*b'].join(EOL), ['keep', 'aXb']);
      expect(dirs).toContain(path.join('/repo2', 'keep'));
      expect(dirs).toContain(path.join('/repo2', 'aXb'));
    });

    it('walks everything when there is no .gitignore', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir) =>
        dir === '/repo2' ? (['src', 'out'] as never) : ([] as never),
      );
      vi.mocked(fsPromises.stat).mockImplementation(
        async () => ({ isDirectory: () => true, isFile: () => false }) as never,
      );
      const p = new TsGraphProvider('/repo2');
      await p.getQueryEngine();
      const dirs = vi.mocked(fsPromises.readdir).mock.calls.map((c) => String(c[0]));
      expect(dirs).toContain(path.join('/repo2', 'out'));
    });
  });
});
