import { describe, it, expect } from 'vitest';
import { runDeterministicCheck } from '../src/engine/deterministic.js';
import type { Intent } from '../src/intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

const COMMIT = 'abc1234';

const makeIntent = (overrides: Partial<Intent['frontmatter']> = {}): Intent => ({
  filePath: '/path/test.md',
  body: '',
  frontmatter: {
    schema_version: 1,
    id: 'test-rule',
    title: 'Test rule',
    scope: ['src/**'],
    anchors: [],
    check: 'deterministic',
    rule: 'No direct stripe imports',
    deterministic: {
      kind: 'no-import',
      from: ['src/api/**'],
      to: ['stripe'],
    },
    severity: 'warn',
    status: 'active',
    created: '2026-07-14',
    ...overrides,
  },
});

const makeDiff = (file: string, addedLines: string[]): ParsedDiff => ({
  files: [file],
  hunks: { [file]: addedLines.map((l) => `+${l}`) },
});

describe('runDeterministicCheck', () => {
  it('detects violation when forbidden import added', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', ["import Stripe from 'stripe';"]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('violation');
    expect(result.verdict.evidence.length).toBeGreaterThan(0);
    expect(result.verdict.engine).toBe('deterministic');
  });

  it('passes when no forbidden import in diff', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', ['const x = 1;']);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('pass');
  });

  it('passes when file is not in "from" scope', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/services/payment.ts', ["import Stripe from 'stripe';"]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('pass');
  });

  it('returns pass when no deterministic rule defined', async () => {
    const intent = makeIntent({ check: 'semantic', deterministic: undefined });
    const diff = makeDiff('src/api/order.ts', ["import Stripe from 'stripe';"]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('pass');
  });

  it('includes file in evidence', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', ["import Stripe from 'stripe';"]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.evidence[0]?.file).toBe('src/api/order.ts');
  });

  it('skips via inline anhcompass-disable comment', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', ["import Stripe from 'stripe'; // anhcompass-disable-line"]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('pass');
  });

  it('skips via general disable-next-line comment', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', [
      "// anhcompass-disable-next-line",
      "import Stripe from 'stripe';"
    ]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('pass');
  });

  it('skips via targeted disable-next-line comment', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', [
      "// anhcompass-disable-next-line test-rule",
      "import Stripe from 'stripe';"
    ]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('pass');
  });

  it('does not skip if targeted comment is for different rule', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', [
      "// anhcompass-disable-next-line other-rule",
      "import Stripe from 'stripe';"
    ]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('violation');
  });

  describe('Python import syntax', () => {
    const pyIntent = (to: string[] = ['openai']) =>
      makeIntent({
        scope: ['backend/**'],
        deterministic: { kind: 'no-import', from: ['backend/app/**/*.py'], to },
      });

    it('detects "from pkg import X"', async () => {
      const diff = makeDiff('backend/app/services/report.py', ['from openai import OpenAI']);
      const result = await runDeterministicCheck(pyIntent(), diff, COMMIT);
      expect(result.verdict.status).toBe('violation');
    });

    it('detects "import pkg"', async () => {
      const diff = makeDiff('backend/app/services/report.py', ['import openai']);
      const result = await runDeterministicCheck(pyIntent(), diff, COMMIT);
      expect(result.verdict.status).toBe('violation');
    });

    it('detects "from pkg.submodule import X"', async () => {
      const diff = makeDiff('backend/app/services/report.py', ['from openai.types import Model']);
      const result = await runDeterministicCheck(pyIntent(), diff, COMMIT);
      expect(result.verdict.status).toBe('violation');
    });

    it('does not flag a different package with the same prefix', async () => {
      const diff = makeDiff('backend/app/services/report.py', ['import openai_helpers']);
      const result = await runDeterministicCheck(pyIntent(), diff, COMMIT);
      expect(result.verdict.status).toBe('pass');
    });

    it('respects negated "from" globs (allowed module)', async () => {
      const intent = makeIntent({
        scope: ['backend/**'],
        deterministic: {
          kind: 'no-import',
          from: ['backend/app/**/*.py', '!backend/app/services/nlp.py'],
          to: ['openai'],
        },
      });
      const diff = makeDiff('backend/app/services/nlp.py', ['from openai import OpenAI']);
      const result = await runDeterministicCheck(intent, diff, COMMIT);
      expect(result.verdict.status).toBe('pass');
    });
  });

  describe('engine composition', () => {
    /** A graph backend that indexes nothing — what TsGraphProvider effectively
     *  is for a Python file, or for any package no indexed file imports. */
    const emptyGraphProvider = {
      name: 'ts-graph',
      available: async () => true,
      affectedSymbols: async () => [],
      resolveAnchor: async () => ({ found: true }),
      contextFor: async () => ({ estimatedTokens: 0, snippets: {} }),
      getQueryEngine: async () => ({
        data: { nodes: [] as string[] },
        paths: () => [],
        cycles: () => [],
      }),
    };

    it('still reports a lexical violation when a graph provider is attached', async () => {
      const intent = makeIntent();
      const diff = makeDiff('src/api/order.ts', ["import Stripe from 'stripe';"]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runDeterministicCheck(intent, diff, COMMIT, emptyGraphProvider as any, '/tmp/x');
      expect(result.verdict.status).toBe('violation');
    });

    it('honors a suppression comment when a graph provider is attached', async () => {
      const intent = makeIntent();
      const diff = makeDiff('src/api/order.ts', [
        "import Stripe from 'stripe'; // anhcompass-disable-line test-rule",
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runDeterministicCheck(intent, diff, COMMIT, emptyGraphProvider as any, '/tmp/x');
      expect(result.verdict.status).toBe('pass');
    });

    it('returns uncertain — not pass — for a rule no available engine can evaluate', async () => {
      const intent = makeIntent({
        deterministic: { kind: 'no-cycle', from: ['src/**'] },
      });
      const diff = makeDiff('src/api/order.ts', ['export const a = 1;']);
      const result = await runDeterministicCheck(intent, diff, COMMIT);
      expect(result.verdict.status).toBe('uncertain');
      expect(result.verdict.suggestion).toMatch(/graph engine/i);
    });
  });

  it('detects JS subpath imports (pkg/submodule)', async () => {
    const intent = makeIntent();
    const diff = makeDiff('src/api/order.ts', ["import { Webhook } from 'stripe/webhooks';"]);
    const result = await runDeterministicCheck(intent, diff, COMMIT);
    expect(result.verdict.status).toBe('violation');
  });
});
