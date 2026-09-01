import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The client is the only thing here that would talk to a network. Everything
 *  else — retrieval, ranking, the evidence rule — is local logic, and it is
 *  what these tests are about. */
const callWithSchema = vi.fn();

vi.mock('@anhcompass/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anhcompass/llm')>()),
  LlmClient: class {
    constructor(public opts: { apiKey: string; provider: string; model?: string }) {
      lastClientOpts = opts;
    }
    callWithSchema = callWithSchema;
  },
}));

let lastClientOpts: { apiKey: string; provider: string; model?: string } | undefined;

const { runSemanticCheck } = await import('../src/engine/semantic.js');
import type { Intent } from '../src/intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'anhcompass-semantic-'));
  callWithSchema.mockReset();
  lastClientOpts = undefined;
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const full = join(repo, rel);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf-8');
}

function intent(over: Partial<Intent['frontmatter']> = {}): Intent {
  return {
    filePath: '/r.md',
    body: 'why',
    frontmatter: {
      schema_version: 1,
      id: 'r',
      title: 'Rule',
      scope: ['src/**'],
      anchors: [],
      check: 'semantic',
      rule: 'Controllers delegate to services.',
      severity: 'warn',
      status: 'active',
      created: '2026-01-01',
      ...over,
    },
  } as Intent;
}

const diff: ParsedDiff = {
  files: ['src/a.ts'],
  hunks: { 'src/a.ts': ['+const x = 1;'] },
};

function reply(over: Record<string, unknown> = {}) {
  return {
    result: { status: 'pass', confidence: 0.9, evidence: [], suggestion: null, ...over },
    usage: { inputTokens: 10, outputTokens: 5 },
    model: 'test-model',
  };
}

const run = (extra: Record<string, unknown> = {}) =>
  runSemanticCheck({
    intent: intent(),
    diff,
    diffText: '+const x = 1;',
    repoRoot: repo,
    apiKey: 'sk-test',
    checkedAtCommit: 'abc',
    cacheKey: 'key',
    ...extra,
  } as Parameters<typeof runSemanticCheck>[0]);

describe('runSemanticCheck — the verdict it returns', () => {
  it('passes a verdict through with its confidence and evidence', async () => {
    callWithSchema.mockResolvedValue(
      reply({
        status: 'violation',
        confidence: 0.8,
        evidence: [{ file: 'src/a.ts', line: 1, excerpt: 'x', reason: 'r' }],
        suggestion: 'fix it',
      }),
    );
    const v = await run();
    expect(v).toMatchObject({
      intentId: 'r',
      status: 'violation',
      confidence: 0.8,
      engine: 'semantic',
      checkedAtCommit: 'abc',
      suggestion: 'fix it',
    });
  });

  it('downgrades a violation with no evidence to uncertain', async () => {
    // The project's fifth architectural rule: a verdict without evidence
    // cannot carry a `violation` status.
    callWithSchema.mockResolvedValue(reply({ status: 'violation', confidence: 0.99, evidence: [] }));
    const v = await run();
    expect(v.status).toBe('uncertain');
    expect(v.suggestion).toMatch(/without evidence/i);
  });

  it('caps the confidence of a downgraded verdict', async () => {
    callWithSchema.mockResolvedValue(reply({ status: 'violation', confidence: 0.99, evidence: [] }));
    expect((await run()).confidence).toBeLessThanOrEqual(0.5);
  });

  it('leaves a pass with no evidence alone — absence of evidence is the point', async () => {
    callWithSchema.mockResolvedValue(reply({ status: 'pass', evidence: [] }));
    expect((await run()).status).toBe('pass');
  });

  it('answers uncertain when the call fails, never pass', async () => {
    callWithSchema.mockRejectedValue(new Error('429 rate limited'));
    const v = await run();
    expect(v.status).toBe('uncertain');
    expect(v.confidence).toBe(0);
    expect(v.suggestion).toContain('429');
  });
});

describe('runSemanticCheck — the client it builds', () => {
  beforeEach(() => callWithSchema.mockResolvedValue(reply()));

  it('passes the declared provider straight through', async () => {
    await run({ llmProvider: 'openai' });
    expect(lastClientOpts?.provider).toBe('openai');
  });

  it('falls back to inferring the provider from the key', async () => {
    await run({ apiKey: 'sk-ant-xyz' });
    expect(lastClientOpts?.provider).toBe('anthropic');
  });

  it('uses a pinned model instead of routing by size', async () => {
    await run({ model: 'pinned-model' });
    expect(lastClientOpts?.model).toBe('pinned-model');
    expect(callWithSchema.mock.calls[0]?.[0].model).toBe('pinned-model');
  });

  it('sends the rule and the diff to the model', async () => {
    await run();
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).toContain('Controllers delegate to services.');
    expect(prompt).toContain('+const x = 1;');
  });
});

describe('runSemanticCheck — retrieval', () => {
  beforeEach(() => callWithSchema.mockResolvedValue(reply()));

  const graphProvider = (nodes: string[], neighbors: string[]) => ({
    name: 'ts-graph',
    getQueryEngine: async () => ({
      data: { nodes },
      neighbors: () => neighbors,
      reachable: () => false,
      paths: () => [],
      cycles: () => [],
    }),
  });

  it('walks the intent scope when no graph backend is attached', async () => {
    await write('src/a.ts', 'const inScope = 1;');
    await write('other/b.ts', 'const outOfScope = 1;');
    await run();
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).toContain('inScope');
    expect(prompt).not.toContain('outOfScope');
  });

  it('reads the graph neighbourhood when one is attached', async () => {
    await write('src/a.ts', 'const changed = 1;');
    await write('src/neighbour.ts', 'const neighbour = 1;');
    await run({
      provider: graphProvider(['src/a.ts', 'src/neighbour.ts'], ['src/a.ts', 'src/neighbour.ts']),
      useGraphRetrieval: true,
    });
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).toContain('neighbour');
  });

  it('honours --no-graph-retrieval', async () => {
    await write('src/a.ts', 'const inScope = 1;');
    await run({
      provider: graphProvider(['src/a.ts'], ['src/a.ts']),
      useGraphRetrieval: false,
    });
    expect(callWithSchema).toHaveBeenCalled();
  });

  it('falls back to the walk when the neighbourhood comes back empty', async () => {
    // A Python repository: the index holds none of its files, so graph
    // retrieval finds nothing and an empty context is worse than the walk.
    await write('src/a.py', 'x = 1  # pythonSource');
    await run({
      intent: intent({ scope: ['src/**'] }),
      provider: graphProvider([], []),
      useGraphRetrieval: true,
    });
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).toContain('pythonSource');
  });

  it('always includes the changed hunks, whatever retrieval found', async () => {
    await run({ provider: graphProvider([], []), useGraphRetrieval: true });
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).toContain('+const x = 1;');
  });
});

describe('runSemanticCheck — cost log', () => {
  it('records a successful call', async () => {
    callWithSchema.mockResolvedValue(reply());
    await run();
    const { readFile } = await import('node:fs/promises');
    const log = await readFile(join(repo, '.agent', 'cache', 'llm-log.jsonl'), 'utf-8').catch(() => '');
    expect(log).toContain('"intentId":"r"');
    expect(log).toContain('"engine":"semantic"');
  });

  it('records a failed call as an error, with no tokens spent', async () => {
    callWithSchema.mockRejectedValue(new Error('boom'));
    await run();
    const { readFile } = await import('node:fs/promises');
    const log = await readFile(join(repo, '.agent', 'cache', 'llm-log.jsonl'), 'utf-8').catch(() => '');
    expect(log).toContain('"status":"error"');
    expect(log).toContain('"inputTokens":0');
  });
});
