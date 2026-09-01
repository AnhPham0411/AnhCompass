import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TsGraphProvider } from '@anhcompass/graph';
import { runDeterministicCheck } from '../src/engine/deterministic.js';
import type { Intent, DeterministicRule } from '../src/intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

/** The graph half of the deterministic engine: transitive dependencies, layer
 *  boundaries and cycles. The benchmark exercises these, but the benchmark is
 *  not the test suite — a mutant that survives here ships. */
let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'anhcompass-det-graph-'));
  await writeFile(join(repo, 'package.json'), '{"name":"t"}', 'utf-8');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const full = join(repo, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

function intent(rule: DeterministicRule, scope = ['src/**']): Intent {
  return {
    filePath: '/r.md',
    body: '',
    frontmatter: {
      schema_version: 1,
      id: 'r',
      title: 'r',
      scope,
      anchors: [],
      check: 'deterministic',
      rule: 'rule text',
      deterministic: rule,
      severity: 'error',
      status: 'active',
      created: '2026-01-01',
    },
  } as Intent;
}

const touch = (file: string): ParsedDiff => ({
  files: [file],
  hunks: { [file]: ['+export const touched = true;'] },
});

async function check(rule: DeterministicRule, diff: ParsedDiff, scope?: string[]) {
  const provider = new TsGraphProvider();
  await provider.available(repo);
  const { verdict } = await runDeterministicCheck(
    intent(rule, scope),
    diff,
    'abc',
    provider,
    repo,
  );
  return verdict;
}

const NO_LODASH: DeterministicRule = { kind: 'no-import', from: ['src/**'], to: ['lodash'] };
const LAYERS: DeterministicRule = {
  kind: 'layer-boundary',
  layers: { api: ['src/api/**'], service: ['src/services/**'], infra: ['src/infra/**'] },
  allow: ['api -> service', 'service -> infra'],
};
const NO_CYCLE: DeterministicRule = { kind: 'no-cycle', from: ['src/**'] };

describe('no-import through the graph', () => {
  it('finds a forbidden dependency two hops away', async () => {
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', "import _ from 'lodash';\nexport const b = _;\n");
    const v = await check(NO_LODASH, touch('src/a.ts'));
    expect(v.status).toBe('violation');
  });

  it('reports the path it found as evidence, not just the fact', async () => {
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', "import _ from 'lodash';\nexport const b = _;\n");
    const v = await check(NO_LODASH, touch('src/a.ts'));
    const text = JSON.stringify(v.evidence);
    expect(text).toContain('src/b.ts');
    expect(text).toContain('lodash');
  });

  it('finds a violation the diff never touched', async () => {
    // The failure an added-lines-only checker cannot see: the forbidden path
    // already exists and the diff adds no import at all.
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', "import _ from 'lodash';\nexport const b = _;\n");
    const v = await check(NO_LODASH, {
      files: ['src/a.ts'],
      hunks: { 'src/a.ts': ['+export const unrelated = 1;'] },
    });
    expect(v.status).toBe('violation');
  });

  it('passes a chain that never reaches the forbidden module', async () => {
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', 'export const b = 1;\n');
    expect((await check(NO_LODASH, touch('src/a.ts'))).status).toBe('pass');
  });

  it('ignores a dependency that starts outside the rule scope', async () => {
    await write('src/a.ts', 'export const a = 1;\n');
    await write('tools/t.ts', "import _ from 'lodash';\n");
    expect((await check(NO_LODASH, touch('src/a.ts'))).status).toBe('pass');
  });
});

describe('layer-boundary', () => {
  it('reports a breach reached through a directory in no layer', async () => {
    await write('src/api/o.ts', "import { s } from '../shared/p';\nexport const o = s;\n");
    await write('src/shared/p.ts', "import { db } from '../infra/db';\nexport const s = db;\n");
    await write('src/infra/db.ts', 'export const db = 1;\n');
    expect((await check(LAYERS, touch('src/api/o.ts'))).status).toBe('violation');
  });

  it('allows a dependency that follows the declared direction', async () => {
    await write('src/api/o.ts', "import { s } from '../services/o';\nexport const o = s;\n");
    await write('src/services/o.ts', "import { db } from '../infra/db';\nexport const s = db;\n");
    await write('src/infra/db.ts', 'export const db = 1;\n');
    expect((await check(LAYERS, touch('src/api/o.ts'))).status).toBe('pass');
  });

  it('reports the reverse direction, which is not allowed', async () => {
    await write('src/infra/db.ts', "import { s } from '../services/o';\nexport const db = s;\n");
    await write('src/services/o.ts', 'export const s = 1;\n');
    expect((await check(LAYERS, touch('src/infra/db.ts'))).status).toBe('violation');
  });

  it('leaves a dependency inside one layer alone', async () => {
    await write('src/api/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/api/b.ts', 'export const b = 1;\n');
    expect((await check(LAYERS, touch('src/api/a.ts'))).status).toBe('pass');
  });

  it('answers uncertain when the index holds none of the layered files', async () => {
    // The dependency-cruiser failure: a graph of 584 nodes, none of them the
    // ones the rule governs, reporting a confident pass.
    await write('src/other/x.ts', 'export const x = 1;\n');
    const v = await check(LAYERS, touch('src/other/x.ts'));
    expect(v.status).toBe('uncertain');
    expect(v.confidence).toBe(0);
  });
});

describe('no-cycle', () => {
  it('reports a two-file cycle', async () => {
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', "import { a } from './a';\nexport const b = a;\n");
    expect((await check(NO_CYCLE, touch('src/a.ts'))).status).toBe('violation');
  });

  it('reports a three-file cycle', async () => {
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', "import { c } from './c';\nexport const b = c;\n");
    await write('src/c.ts', "import { a } from './a';\nexport const c = a;\n");
    expect((await check(NO_CYCLE, touch('src/a.ts'))).status).toBe('violation');
  });

  it('passes an acyclic graph', async () => {
    await write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
    await write('src/b.ts', 'export const b = 1;\n');
    expect((await check(NO_CYCLE, touch('src/a.ts'))).status).toBe('pass');
  });

  it('ignores a cycle outside the rule scope', async () => {
    await write('src/a.ts', 'export const a = 1;\n');
    await write('tools/x.ts', "import { y } from './y';\nexport const x = y;\n");
    await write('tools/y.ts', "import { x } from './x';\nexport const y = x;\n");
    expect((await check(NO_CYCLE, touch('src/a.ts'))).status).toBe('pass');
  });

  it('answers uncertain when no file in scope is indexed', async () => {
    await write('other/a.py', 'x = 1\n');
    const v = await check(NO_CYCLE, { files: ['other/a.py'], hunks: { 'other/a.py': ['+x = 1'] } });
    expect(v.status).toBe('uncertain');
  });
});

describe('without a graph backend', () => {
  it('answers uncertain for a rule only the graph can evaluate', async () => {
    const { verdict } = await runDeterministicCheck(
      intent(NO_CYCLE),
      touch('src/a.ts'),
      'abc',
      undefined,
      repo,
    );
    expect(verdict.status).toBe('uncertain');
    expect(verdict.suggestion).toMatch(/graph engine/i);
  });

  it('still evaluates a no-import rule lexically', async () => {
    const { verdict } = await runDeterministicCheck(
      intent(NO_LODASH),
      { files: ['src/a.ts'], hunks: { 'src/a.ts': ["+import _ from 'lodash';"] } },
      'abc',
      undefined,
      repo,
    );
    expect(verdict.status).toBe('violation');
  });

  it('passes a rule with no deterministic clause at all', async () => {
    const bare = intent(NO_LODASH);
    delete (bare.frontmatter as { deterministic?: unknown }).deterministic;
    const { verdict } = await runDeterministicCheck(bare, touch('src/a.ts'), 'abc');
    expect(verdict.status).toBe('pass');
    expect(verdict.confidence).toBe(1);
  });
});

describe('the two engines are additive', () => {
  it('honours a line waiver even when a graph backend is attached', async () => {
    await write('src/a.ts', "import _ from 'lodash'; // anhcompass-disable-line r\n");
    const v = await check(NO_LODASH, {
      files: ['src/a.ts'],
      hunks: { 'src/a.ts': ["+import _ from 'lodash'; // anhcompass-disable-line r"] },
    });
    expect(v.status).toBe('pass');
  });

  it('reports a Python violation the graph cannot see', async () => {
    // The bug that shipped three times: attaching a graph backend used to
    // replace the lexical scanner, and the indexer reads no Python.
    await write('src/app.py', 'import requests\n');
    const v = await check({ kind: 'no-import', from: ['src/**'], to: ['requests'] }, {
      files: ['src/app.py'],
      hunks: { 'src/app.py': ['+import requests'] },
    });
    expect(v.status).toBe('violation');
  });

  it('does not report the same edge twice', async () => {
    await write('src/a.ts', "import _ from 'lodash';\nexport const a = _;\n");
    const v = await check(NO_LODASH, {
      files: ['src/a.ts'],
      hunks: { 'src/a.ts': ["+import _ from 'lodash';"] },
    });
    const files = v.evidence.map((e) => `${e.file}:${e.excerpt}`);
    expect(new Set(files).size).toBe(files.length);
  });
});
