import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Indexer } from '../src/index/indexer.js';

/** These tests use real files rather than a mocked `fs`. The indexer's job is
 *  to agree with the filesystem and with the TypeScript resolver; a mock that
 *  answers `true` to every `existsSync` cannot tell whether it does. */
let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'anhcompass-indexer-'));
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const full = join(repo, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

/** Edges out of `from`, as the graph records them. */
function edgesFrom(repoRoot: string, files: string[], from: string): string[] {
  const data = new Indexer(repoRoot).index(files);
  return data.edges.filter((e) => e.from === from).map((e) => e.to);
}

describe('Indexer — import forms', () => {
  const cases: [string, string, string][] = [
    ['default import', "import _ from 'lodash';", 'lodash'],
    ['named import', "import { chunk } from 'lodash';", 'lodash'],
    ['namespace import', "import * as _ from 'lodash';", 'lodash'],
    ['side-effect import', "import 'lodash';", 'lodash'],
    ['type-only import', "import type { X } from 'lodash';", 'lodash'],
    ['re-export', "export { chunk } from 'lodash';", 'lodash'],
    ['star re-export', "export * from 'lodash';", 'lodash'],
    ['require', "const _ = require('lodash');", 'lodash'],
    ['dynamic import', "const p = import('lodash');", 'lodash'],
    ['import equals', "import _ = require('lodash');", 'lodash'],
    ['subpath', "import fp from 'lodash/fp';", 'lodash/fp'],
    ['scoped package', "import { db } from '@acme/db';", '@acme/db'],
  ];

  for (const [name, source, expected] of cases) {
    it(`records a ${name}`, async () => {
      await write('src/a.ts', source);
      expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toContain(expected);
    });
  }

  it('records an import spanning several lines', async () => {
    await write('src/a.ts', "import {\n  chunk,\n  map,\n} from 'lodash';");
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toContain('lodash');
  });

  it('ignores an import inside a comment or a string', async () => {
    await write(
      'src/a.ts',
      ["// import _ from 'lodash';", "const s = \"import _ from 'lodash'\";", 'export const x = 1;'].join(
        '\n',
      ),
    );
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual([]);
  });

  it('records each distinct dependency once', async () => {
    await write('src/a.ts', "import _ from 'lodash';\nimport { map } from 'lodash';");
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['lodash']);
  });

  it('ignores a require with a computed argument, which it cannot resolve', async () => {
    await write('src/a.ts', 'const name = "lodash";\nconst _ = require(name);');
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual([]);
  });
});

describe('Indexer — resolution', () => {
  it('resolves a relative import to the file it names', async () => {
    await write('src/a.ts', "import { b } from './b';");
    await write('src/b.ts', 'export const b = 1;');
    expect(edgesFrom(repo, ['src/a.ts', 'src/b.ts'], 'src/a.ts')).toEqual(['src/b.ts']);
  });

  it('resolves a directory import to its index file', async () => {
    await write('src/a.ts', "import { b } from './lib';");
    await write('src/lib/index.ts', 'export const b = 1;');
    expect(edgesFrom(repo, ['src/a.ts', 'src/lib/index.ts'], 'src/a.ts')).toEqual([
      'src/lib/index.ts',
    ]);
  });

  it('resolves a parent-directory import', async () => {
    await write('src/deep/a.ts', "import { b } from '../b';");
    await write('src/b.ts', 'export const b = 1;');
    expect(edgesFrom(repo, ['src/deep/a.ts', 'src/b.ts'], 'src/deep/a.ts')).toEqual(['src/b.ts']);
  });

  it('keeps a bare specifier as the package it names', async () => {
    // Not the file the package ships: a rule names `lodash`, and a node called
    // node_modules/.pnpm/lodash@4/... is one no rule can match.
    await write('src/a.ts', "import _ from 'lodash';");
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['lodash']);
  });

  it('resolves a tsconfig path alias to first-party source', async () => {
    await write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
    );
    await write('src/a.ts', "import { db } from '@app/infra/db';");
    await write('src/infra/db.ts', 'export const db = 1;');
    expect(edgesFrom(repo, ['src/a.ts', 'src/infra/db.ts'], 'src/a.ts')).toEqual([
      'src/infra/db.ts',
    ]);
  });

  it('reads path aliases from tsconfig.base.json, the monorepo convention', async () => {
    await write(
      'tsconfig.base.json',
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
    );
    await write('src/a.ts', "import { db } from '@app/infra/db';");
    await write('src/infra/db.ts', 'export const db = 1;');
    expect(edgesFrom(repo, ['src/a.ts', 'src/infra/db.ts'], 'src/a.ts')).toEqual([
      'src/infra/db.ts',
    ]);
  });

  it('survives a tsconfig it cannot parse', async () => {
    await write('tsconfig.json', '{ not valid json');
    await write('src/a.ts', "import _ from 'lodash';");
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['lodash']);
  });

  it('records an unresolvable relative import as the path it would have been', async () => {
    await write('src/a.ts', "import { b } from './missing';");
    const edges = edgesFrom(repo, ['src/a.ts'], 'src/a.ts');
    expect(edges[0]).toContain('missing');
  });
});

describe('Indexer — the graph it returns', () => {
  it('returns nothing for no files', () => {
    expect(new Indexer(repo).index([])).toEqual({ nodes: [], edges: [] });
  });

  it('includes every indexed file as a node', async () => {
    await write('src/a.ts', 'export const a = 1;');
    await write('src/b.ts', 'export const b = 1;');
    const data = new Indexer(repo).index(['src/a.ts', 'src/b.ts']);
    expect(data.nodes).toContain('src/a.ts');
    expect(data.nodes).toContain('src/b.ts');
  });

  it('includes an imported package as a node, so a rule can match it', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    expect(new Indexer(repo).index(['src/a.ts']).nodes).toContain('lodash');
  });

  it('lists each node once', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    await write('src/b.ts', "import _ from 'lodash';");
    const nodes = new Indexer(repo).index(['src/a.ts', 'src/b.ts']).nodes;
    expect(nodes.filter((n) => n === 'lodash')).toHaveLength(1);
  });

  it('skips a listed file that is not on disk', async () => {
    await write('src/a.ts', 'export const a = 1;');
    const data = new Indexer(repo).index(['src/a.ts', 'src/gone.ts']);
    expect(data.edges.filter((e) => e.from === 'src/gone.ts')).toEqual([]);
  });

  it('normalises backslash paths to posix', async () => {
    await write('src/a.ts', 'export const a = 1;');
    expect(new Indexer(repo).index(['src\\a.ts']).nodes).toContain('src/a.ts');
  });
});

describe('Indexer — cache', () => {
  const cacheFile = () => join(repo, '.anhcompass', 'cache', 'graph.json');

  it('writes a cache after indexing', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    new Indexer(repo).index(['src/a.ts']);
    expect(existsSync(cacheFile())).toBe(true);
  });

  it('stamps the cache with a format version', async () => {
    await write('src/a.ts', 'export const a = 1;');
    new Indexer(repo).index(['src/a.ts']);
    const cache = JSON.parse(readFileSync(cacheFile(), 'utf-8'));
    expect(typeof cache.version).toBe('number');
    expect(cache.entries['src/a.ts']).toBeDefined();
  });

  it('answers identically on a second run, from cache', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    await write('src/b.ts', "import { a } from './a';");
    const first = new Indexer(repo).index(['src/a.ts', 'src/b.ts']);
    const second = new Indexer(repo).index(['src/a.ts', 'src/b.ts']);
    expect(second).toEqual(first);
  });

  it('re-parses once the file actually changes', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    new Indexer(repo).index(['src/a.ts']);
    await new Promise((r) => setTimeout(r, 10));
    await writeFile(join(repo, 'src/a.ts'), "import axios from 'axios';", 'utf-8');
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['axios']);
  });

  it('discards a cache written by an older resolver', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    new Indexer(repo).index(['src/a.ts']);

    const cache = JSON.parse(readFileSync(cacheFile(), 'utf-8'));
    cache.version = 0;
    cache.entries['src/a.ts'].edges = ['stale-answer'];
    await writeFile(cacheFile(), JSON.stringify(cache), 'utf-8');

    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['lodash']);
  });

  it('ignores a corrupt cache file rather than failing', async () => {
    await mkdir(join(repo, '.anhcompass', 'cache'), { recursive: true });
    await writeFile(cacheFile(), 'not json at all', 'utf-8');
    await write('src/a.ts', "import _ from 'lodash';");
    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['lodash']);
  });

  it('drops a cache entry of the wrong shape', async () => {
    await write('src/a.ts', "import _ from 'lodash';");
    new Indexer(repo).index(['src/a.ts']);
    const cache = JSON.parse(readFileSync(cacheFile(), 'utf-8'));
    cache.entries['src/a.ts'] = { mtime: 'not a number', edges: 'not an array' };
    await writeFile(cacheFile(), JSON.stringify(cache), 'utf-8');

    expect(edgesFrom(repo, ['src/a.ts'], 'src/a.ts')).toEqual(['lodash']);
  });
});
