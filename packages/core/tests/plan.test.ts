import { describe, it, expect } from 'vitest';
import { checkPlan, renderPlanReview } from '../src/engine/plan.js';
import { renderPlain, renderExplanation } from '../src/report/plain.js';
import type { Intent, Verdict } from '../src/intent/schema.js';

const makeIntent = (id: string, status: 'active' | 'proposed' = 'active'): Intent => ({
  filePath: `/${id}.md`,
  body: 'Swapping the payment provider must stay a one-file change.',
  frontmatter: {
    schema_version: 1,
    id,
    title: `Rule ${id}`,
    scope: ['src/**'],
    anchors: [],
    check: 'semantic',
    rule: 'Stripe access belongs in the payment service.',
    severity: 'error',
    status,
    created: '2026-09-01',
  },
});

describe('checkPlan without an API key', () => {
  it('reports uncertain rather than a confident ok', async () => {
    const result = await checkPlan({
      intents: [makeIntent('a'), makeIntent('b')],
      planText: 'Call Stripe directly from the controller.',
    });
    expect(result.checkedIntentIds).toEqual(['a', 'b']);
    expect(result.findings.map((f) => f.status)).toEqual(['uncertain', 'uncertain']);
    expect(result.findings[0]?.reason).toMatch(/API key/i);
  });

  it('ignores intents that are not active', async () => {
    const result = await checkPlan({
      intents: [makeIntent('a'), makeIntent('draft', 'proposed')],
      planText: 'Anything.',
    });
    expect(result.checkedIntentIds).toEqual(['a']);
  });

  it('handles an empty intent set', async () => {
    const result = await checkPlan({ intents: [], planText: 'Anything.' });
    expect(result.findings).toEqual([]);
    expect(renderPlanReview(result)).toMatch(/No active intents/);
  });
});

describe('renderPlanReview', () => {
  it('states that a plan review never blocks', () => {
    const text = renderPlanReview({
      checkedIntentIds: ['a'],
      findings: [{ intentId: 'a', status: 'at-risk', quote: 'Call Stripe here.', reason: 'why' }],
    });
    expect(text).toContain('AT-RISK a');
    expect(text).toContain('Call Stripe here.');
    expect(text).toMatch(/nothing here blocks/i);
  });
});

const violation: Verdict = {
  intentId: 'a',
  status: 'violation',
  confidence: 0.95,
  evidence: [{ file: 'src/api/order.ts', excerpt: "+import Stripe from 'stripe';", reason: 'direct import' }],
  suggestion: 'Route through the payment service',
  checkedAtCommit: 'abc1234',
  engine: 'deterministic',
  enforcement: 'block',
};

describe('renderPlain', () => {
  it('emits no ANSI escape sequences', () => {
    const text = renderPlain([violation]);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\[/);
    expect(text).toContain('VIOLATION [BLOCK] a');
  });

  it('separates blocking from warning in the summary', () => {
    const warn: Verdict = { ...violation, intentId: 'b', enforcement: 'warn', engine: 'semantic' };
    expect(renderPlain([violation, warn])).toContain('1 blocking, 1 warning');
  });
});

describe('renderExplanation', () => {
  it('includes the rule, the rationale, the evidence and the waiver syntax', () => {
    const text = renderExplanation(makeIntent('a'), violation);
    expect(text).toContain('Stripe access belongs in the payment service.');
    expect(text).toContain('Swapping the payment provider must stay a one-file change.');
    expect(text).toContain('src/api/order.ts');
    expect(text).toContain('anhcompass-disable-next-line a');
    expect(text).toContain('block — this fails CI');
  });

  it('does not offer a waiver for a verdict that is not a deterministic violation', () => {
    const text = renderExplanation(makeIntent('a'), { ...violation, status: 'pass', evidence: [] });
    expect(text).not.toContain('anhcompass-disable-next-line');
  });
});
