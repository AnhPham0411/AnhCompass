import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProvider } from '../src/detect.js';

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'anhcompass-detect-'));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('detectProvider', () => {
  it('picks the import graph for a repository with a tsconfig', async () => {
    await writeFile(join(repo, 'tsconfig.json'), '{}', 'utf-8');
    expect((await detectProvider(repo)).name).toBe('ts-graph');
  });

  it('picks it for a monorepo whose root holds only a base config', async () => {
    await writeFile(join(repo, 'tsconfig.base.json'), '{}', 'utf-8');
    expect((await detectProvider(repo)).name).toBe('ts-graph');
  });

  it('picks it for a JavaScript project with no tsconfig at all', async () => {
    await writeFile(join(repo, 'package.json'), '{"name":"t"}', 'utf-8');
    expect((await detectProvider(repo)).name).toBe('ts-graph');
  });

  it('falls back to the null provider when the repo is neither', async () => {
    // A Python or Go repository: the lexical engine still works, and the graph
    // rules that need an index answer `uncertain` rather than `pass`.
    expect((await detectProvider(repo)).name).toBe('null');
  });

  it('returns a provider rather than throwing for a path that does not exist', async () => {
    expect((await detectProvider(join(repo, 'nope'))).name).toBe('null');
  });

  it('always returns something a caller can use', async () => {
    const provider = await detectProvider(repo);
    expect(typeof provider.affectedSymbols).toBe('function');
    expect(typeof provider.contextFor).toBe('function');
    expect(await provider.available(repo)).toBe(true);
  });
});
