import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NullProvider,
  readFilesInOrder,
  readFilesMatchingGlobs,
} from '../src/null-provider.js';

let repo: string;

/** Roughly the token accounting the retrieval functions use: four characters
 *  to a token. Tests state budgets in tokens and sizes in characters. */
const CHARS_PER_TOKEN = 4;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'anhcompass-null-'));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const full = join(repo, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

describe('NullProvider', () => {
  const provider = new NullProvider();

  it('is available for any repository, since it needs no backend', async () => {
    await expect(provider.available(repo)).resolves.toBe(true);
    await expect(provider.available('/no/such/path')).resolves.toBe(true);
  });

  it('treats the changed files themselves as the blast radius', async () => {
    const symbols = await provider.affectedSymbols({
      files: ['src/a.ts', 'src/b.ts'],
      hunks: {},
    });
    expect(symbols).toEqual([
      { kind: 'path', value: 'src/a.ts' },
      { kind: 'path', value: 'src/b.ts' },
    ]);
  });

  it('reports no blast radius for an empty diff', async () => {
    expect(await provider.affectedSymbols({ files: [], hunks: {} })).toEqual([]);
  });

  it('claims every anchor still exists, because it cannot check', async () => {
    // Documented weakness, not an oversight: without an index there is nothing
    // to resolve against, which is why `stale-intent` needs a real backend.
    expect(await provider.resolveAnchor({ type: 'path', value: 'nope' })).toEqual({ found: true });
    expect(await provider.resolveAnchor({ type: 'symbol', value: 'Nope' })).toEqual({
      found: true,
    });
  });

  describe('contextFor', () => {
    it('ignores symbol references, having no symbol index', async () => {
      const ctx = await provider.contextFor([{ kind: 'symbol', value: 'Foo' }], 1000);
      expect(ctx.snippets).toEqual({});
      expect(ctx.estimatedTokens).toBe(0);
    });

    it('skips a path it cannot read instead of failing the run', async () => {
      const ctx = await provider.contextFor(
        [{ kind: 'path', value: join(repo, 'missing.ts') }],
        1000,
      );
      expect(ctx.snippets).toEqual({});
    });

    it('reads a file it can find and counts what it spent', async () => {
      await write('a.ts', 'x'.repeat(40));
      const ctx = await provider.contextFor([{ kind: 'path', value: join(repo, 'a.ts') }], 1000);
      expect(Object.values(ctx.snippets)[0]).toHaveLength(40);
      expect(ctx.estimatedTokens).toBe(10);
    });

    it('stops once the budget is spent', async () => {
      await write('a.ts', 'x'.repeat(40));
      await write('b.ts', 'y'.repeat(40));
      const ctx = await provider.contextFor(
        [
          { kind: 'path', value: join(repo, 'a.ts') },
          { kind: 'path', value: join(repo, 'b.ts') },
        ],
        10,
      );
      expect(Object.keys(ctx.snippets)).toHaveLength(1);
    });
  });
});

describe('readFilesInOrder', () => {
  it('spends the budget in the order it was given, not in directory order', async () => {
    await write('z.ts', 'z'.repeat(20));
    await write('a.ts', 'a'.repeat(20));
    const ctx = await readFilesInOrder(repo, ['z.ts', 'a.ts'], 1000);
    // Rank is the whole point of this function: a caller that ranked its
    // candidates must see them spent in that order.
    expect(Object.keys(ctx.snippets)).toEqual(['z.ts', 'a.ts']);
  });

  it('skips a graph node that is a package name rather than a file', async () => {
    await write('a.ts', 'a'.repeat(20));
    const ctx = await readFilesInOrder(repo, ['lodash', '@acme/db', 'a.ts'], 1000);
    expect(Object.keys(ctx.snippets)).toEqual(['a.ts']);
  });

  it('skips a file with an extension it does not read', async () => {
    await write('image.png', 'binary');
    const ctx = await readFilesInOrder(repo, ['image.png'], 1000);
    expect(ctx.snippets).toEqual({});
  });

  it('skips a listed file that does not exist', async () => {
    const ctx = await readFilesInOrder(repo, ['gone.ts'], 1000);
    expect(ctx.snippets).toEqual({});
  });

  it('truncates the last file rather than overspending the budget', async () => {
    await write('a.ts', 'a'.repeat(400));
    const ctx = await readFilesInOrder(repo, ['a.ts'], 10);
    expect(Object.values(ctx.snippets)[0]).toHaveLength(10 * CHARS_PER_TOKEN);
  });

  it('stops at the file cap even with budget to spare', async () => {
    const names: string[] = [];
    for (let i = 0; i < 20; i++) {
      names.push(`f${i}.ts`);
      await write(`f${i}.ts`, 'x');
    }
    const ctx = await readFilesInOrder(repo, names, 1_000_000);
    expect(Object.keys(ctx.snippets)).toHaveLength(15);
  });

  it('honours a caller-supplied file cap', async () => {
    for (let i = 0; i < 5; i++) await write(`f${i}.ts`, 'x');
    const ctx = await readFilesInOrder(
      repo,
      ['f0.ts', 'f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'],
      1_000_000,
      2,
    );
    expect(Object.keys(ctx.snippets)).toHaveLength(2);
  });

  it('reads nothing when given nothing', async () => {
    expect(await readFilesInOrder(repo, [], 1000)).toEqual({ estimatedTokens: 0, snippets: {} });
  });
});

describe('readFilesMatchingGlobs', () => {
  it('reads the files a glob matches', async () => {
    await write('src/a.ts', 'a');
    await write('src/b.ts', 'b');
    await write('other/c.ts', 'c');
    const ctx = await readFilesMatchingGlobs(repo, ['src/**'], 1000);
    expect(Object.keys(ctx.snippets).sort()).toEqual(['src/a.ts', 'src/b.ts'].map(toPlatform));
  });

  it('descends into subdirectories', async () => {
    await write('src/deep/nested/a.ts', 'a');
    const ctx = await readFilesMatchingGlobs(repo, ['**/*.ts'], 1000);
    expect(Object.keys(ctx.snippets)).toHaveLength(1);
  });

  it('never walks into node_modules, .git, dist, .agent or coverage', async () => {
    for (const dir of ['node_modules', '.git', 'dist', '.agent', 'coverage']) {
      await write(`${dir}/a.ts`, 'x');
    }
    await write('src/a.ts', 'x');
    const ctx = await readFilesMatchingGlobs(repo, ['**/*.ts'], 1000);
    expect(Object.keys(ctx.snippets)).toEqual([toPlatform('src/a.ts')]);
  });

  it('skips files whose extension is not source', async () => {
    await write('src/a.png', 'x');
    const ctx = await readFilesMatchingGlobs(repo, ['**'], 1000);
    expect(ctx.snippets).toEqual({});
  });

  it('stops at fifteen files', async () => {
    for (let i = 0; i < 25; i++) await write(`src/f${i}.ts`, 'x');
    const ctx = await readFilesMatchingGlobs(repo, ['src/**'], 1_000_000);
    expect(Object.keys(ctx.snippets)).toHaveLength(15);
  });

  it('truncates to the remaining budget', async () => {
    await write('src/a.ts', 'a'.repeat(400));
    const ctx = await readFilesMatchingGlobs(repo, ['src/**'], 10);
    expect(Object.values(ctx.snippets)[0]).toHaveLength(10 * CHARS_PER_TOKEN);
  });

  it('returns empty for a repository that does not exist', async () => {
    const ctx = await readFilesMatchingGlobs(join(repo, 'nope'), ['**'], 1000);
    expect(ctx).toEqual({ estimatedTokens: 0, snippets: {} });
  });

  it('returns empty when no file matches', async () => {
    await write('src/a.ts', 'a');
    const ctx = await readFilesMatchingGlobs(repo, ['nothing/**'], 1000);
    expect(ctx.snippets).toEqual({});
  });
});

/** The walk reports paths as `relative()` returns them, which is
 *  backslash-separated on Windows. */
function toPlatform(posix: string): string {
  return join(...posix.split('/'));
}
