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
    // src/services/payment.ts is NOT in src/api/**
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
});
