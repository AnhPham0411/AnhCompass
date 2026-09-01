import { describe, it, expect, vi, beforeEach } from 'vitest';

/** `checkPlan` without a key is covered in plan.test.ts. This file covers the
 *  half that only runs when a key exists: what it sends, and what it does with
 *  what comes back — including a model that answers about rules nobody asked
 *  about, or forgets one. */
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

const { checkPlan, renderPlanReview } = await import('../src/engine/plan.js');
import type { Intent } from '../src/intent/schema.js';

function intent(id: string, status: 'active' | 'proposed' = 'active'): Intent {
  return {
    filePath: `/${id}.md`,
    body: '',
    frontmatter: {
      schema_version: 1,
      id,
      title: `Rule ${id}`,
      scope: ['src/**'],
      anchors: [],
      check: 'semantic',
      rule: `Rule text for ${id}`,
      severity: 'error',
      status,
      created: '2026-01-01',
    },
  } as Intent;
}

const reply = (findings: unknown[]) => ({
  result: { findings },
  usage: { inputTokens: 1, outputTokens: 1 },
  model: 'm',
});

beforeEach(() => {
  callWithSchema.mockReset();
  lastClientOpts = undefined;
});

describe('checkPlan with a key', () => {
  it('returns the finding the model gave for each rule', async () => {
    callWithSchema.mockResolvedValue(
      reply([{ intentId: 'a', status: 'at-risk', quote: 'call Stripe', reason: 'breaches it' }]),
    );
    const result = await checkPlan({
      intents: [intent('a')],
      planText: 'Call Stripe from the controller.',
      apiKey: 'sk-test',
    });
    expect(result.findings).toEqual([
      { intentId: 'a', status: 'at-risk', quote: 'call Stripe', reason: 'breaches it' },
    ]);
  });

  it('sends the plan and every active rule to the model', async () => {
    callWithSchema.mockResolvedValue(reply([]));
    await checkPlan({
      intents: [intent('a'), intent('b')],
      planText: 'A plan sentence.',
      apiKey: 'sk-test',
    });
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).toContain('A plan sentence.');
    expect(prompt).toContain('Rule text for a');
    expect(prompt).toContain('Rule text for b');
  });

  it('leaves an inactive rule out of the prompt', async () => {
    callWithSchema.mockResolvedValue(reply([]));
    await checkPlan({
      intents: [intent('a'), intent('draft', 'proposed')],
      planText: 'p',
      apiKey: 'sk-test',
    });
    const prompt = callWithSchema.mock.calls[0]?.[0].userPrompt as string;
    expect(prompt).not.toContain('Rule text for draft');
  });

  it('reports uncertain for a rule the model said nothing about', async () => {
    callWithSchema.mockResolvedValue(reply([{ intentId: 'a', status: 'ok', reason: 'fine' }]));
    const result = await checkPlan({
      intents: [intent('a'), intent('b')],
      planText: 'p',
      apiKey: 'sk-test',
    });
    expect(result.findings.map((f) => f.intentId)).toEqual(['a', 'b']);
    expect(result.findings[1]).toMatchObject({ intentId: 'b', status: 'uncertain' });
  });

  it('ignores a finding about a rule that was never sent', async () => {
    // Models invent ids. A review that reported them would be answering about
    // rules this repository does not have.
    callWithSchema.mockResolvedValue(
      reply([
        { intentId: 'a', status: 'ok', reason: 'fine' },
        { intentId: 'invented', status: 'at-risk', reason: 'made up' },
      ]),
    );
    const result = await checkPlan({ intents: [intent('a')], planText: 'p', apiKey: 'sk-test' });
    expect(result.findings.map((f) => f.intentId)).toEqual(['a']);
  });

  it('answers uncertain for every rule when the call fails', async () => {
    callWithSchema.mockRejectedValue(new Error('timed out'));
    const result = await checkPlan({
      intents: [intent('a'), intent('b')],
      planText: 'p',
      apiKey: 'sk-test',
    });
    expect(result.findings.map((f) => f.status)).toEqual(['uncertain', 'uncertain']);
    expect(result.findings[0]?.reason).toContain('timed out');
  });

  it('uses the declared provider, and infers one otherwise', async () => {
    callWithSchema.mockResolvedValue(reply([]));
    await checkPlan({
      intents: [intent('a')],
      planText: 'p',
      apiKey: 'sk-test',
      llmProvider: 'gemini',
    });
    expect(lastClientOpts?.provider).toBe('gemini');

    await checkPlan({ intents: [intent('a')], planText: 'p', apiKey: 'sk-ant-x' });
    expect(lastClientOpts?.provider).toBe('anthropic');
  });

  it('honours a pinned model', async () => {
    callWithSchema.mockResolvedValue(reply([]));
    await checkPlan({
      intents: [intent('a')],
      planText: 'p',
      apiKey: 'sk-test',
      model: 'pinned',
    });
    expect(lastClientOpts?.model).toBe('pinned');
  });

  it('never calls the model when no rule is active', async () => {
    const result = await checkPlan({
      intents: [intent('draft', 'proposed')],
      planText: 'p',
      apiKey: 'sk-test',
    });
    expect(callWithSchema).not.toHaveBeenCalled();
    expect(result.findings).toEqual([]);
  });
});

describe('renderPlanReview of a real review', () => {
  it('counts what is at risk and what could not be judged', async () => {
    callWithSchema.mockResolvedValue(
      reply([
        { intentId: 'a', status: 'at-risk', quote: 'q', reason: 'r' },
        { intentId: 'b', status: 'ok', reason: 'fine' },
      ]),
    );
    const result = await checkPlan({
      intents: [intent('a'), intent('b'), intent('c')],
      planText: 'p',
      apiKey: 'sk-test',
    });
    const text = renderPlanReview(result);
    expect(text).toContain('Reviewed 3 rule(s)');
    expect(text).toContain('1 at risk');
    expect(text).toContain('1 uncertain');
  });

  it('says a plan review is not a verdict on code', async () => {
    callWithSchema.mockResolvedValue(reply([{ intentId: 'a', status: 'ok', reason: 'fine' }]));
    const result = await checkPlan({ intents: [intent('a')], planText: 'p', apiKey: 'sk-test' });
    expect(renderPlanReview(result)).toMatch(/nothing here blocks/i);
  });
});
