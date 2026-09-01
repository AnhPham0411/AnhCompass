import { describe, it, expect } from 'vitest';
import { renderPlain, renderExplanation } from '../src/report/plain.js';
import { renderMarkdown } from '../src/report/markdown.js';
import type { Intent, Verdict } from '../src/intent/schema.js';

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    intentId: 'no-lodash',
    status: 'pass',
    confidence: 1,
    evidence: [],
    checkedAtCommit: 'abc123',
    engine: 'deterministic',
    ...over,
  };
}

const violation = (over: Partial<Verdict> = {}): Verdict =>
  verdict({
    status: 'violation',
    confidence: 0.95,
    enforcement: 'block',
    evidence: [
      { file: 'src/a.ts', line: 3, excerpt: "import _ from 'lodash';", reason: 'direct import' },
    ],
    suggestion: 'Remove direct imports of lodash',
    ...over,
  });

function intent(over: Partial<Intent['frontmatter']> = {}): Intent {
  return {
    filePath: '/no-lodash.md',
    body: 'Lodash duplicates the standard library and grows the bundle.',
    frontmatter: {
      schema_version: 1,
      id: 'no-lodash',
      title: 'No direct lodash imports',
      scope: ['src/**'],
      anchors: [],
      check: 'deterministic',
      rule: 'Application code must not depend on lodash.',
      severity: 'error',
      status: 'active',
      created: '2026-01-01',
      ...over,
    },
  } as Intent;
}

describe('renderPlain', () => {
  it('says so when nothing was in scope', () => {
    expect(renderPlain([])).toContain('No intents in scope');
  });

  it('emits no ANSI escape codes — an MCP client is a program', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderPlain([violation()])).not.toMatch(/\[/);
  });

  it('names the status, the intent, the confidence and the engine', () => {
    const out = renderPlain([verdict({ confidence: 0.5, engine: 'semantic' })]);
    expect(out).toContain('PASS');
    expect(out).toContain('no-lodash');
    expect(out).toContain('50%');
    expect(out).toContain('semantic');
  });

  it('marks a blocking violation BLOCK and a warning WARN', () => {
    expect(renderPlain([violation({ enforcement: 'block' })])).toContain('[BLOCK]');
    expect(renderPlain([violation({ enforcement: 'warn' })])).toContain('[WARN]');
  });

  it('does not label enforcement on a verdict that is not a violation', () => {
    expect(renderPlain([verdict()])).not.toContain('[BLOCK]');
    expect(renderPlain([verdict()])).not.toContain('[WARN]');
  });

  it('prints the evidence: file, line, excerpt and reason', () => {
    const out = renderPlain([violation()]);
    expect(out).toContain('src/a.ts:3');
    expect(out).toContain("import _ from 'lodash';");
    expect(out).toContain('direct import');
  });

  it('omits the line number when the evidence has none', () => {
    const out = renderPlain([
      violation({ evidence: [{ file: 'src/a.ts', excerpt: 'x', reason: 'y' }] }),
    ]);
    expect(out).toContain('src/a.ts');
    expect(out).not.toContain('src/a.ts:');
  });

  it('counts pass, blocking, warning and uncertain separately', () => {
    const out = renderPlain([
      verdict({ intentId: 'p' }),
      violation({ intentId: 'b', enforcement: 'block' }),
      violation({ intentId: 'w', enforcement: 'warn' }),
      verdict({ intentId: 'u', status: 'uncertain' }),
    ]);
    expect(out).toContain('1 pass');
    expect(out).toContain('1 blocking');
    expect(out).toContain('1 warning');
    expect(out).toContain('1 uncertain');
  });
});

describe('renderExplanation', () => {
  it('leads with the rule and why it exists', () => {
    const out = renderExplanation(intent(), violation());
    expect(out).toContain('Application code must not depend on lodash.');
    expect(out).toContain('Why this rule exists');
    expect(out).toContain('duplicates the standard library');
  });

  it('omits the rationale section when the intent has no body', () => {
    const bodiless = { ...intent(), body: '   ' };
    expect(renderExplanation(bodiless, violation())).not.toContain('Why this rule exists');
  });

  it('states whether the verdict fails CI', () => {
    expect(renderExplanation(intent(), violation({ enforcement: 'block' }))).toContain(
      'this fails CI',
    );
    expect(renderExplanation(intent(), violation({ enforcement: 'warn' }))).toContain(
      'does not fail CI',
    );
  });

  it('says nothing about enforcement for a passing verdict', () => {
    expect(renderExplanation(intent(), verdict())).not.toContain('Enforcement');
  });

  it('admits when a violation carries no evidence', () => {
    const out = renderExplanation(intent(), violation({ evidence: [] }));
    expect(out).toContain('Evidence: none recorded');
  });

  it('offers the waiver syntax only for deterministic violations', () => {
    expect(renderExplanation(intent(), violation())).toContain(
      'anhcompass-disable-next-line no-lodash',
    );
    // A model's opinion is not grounds for a waiver a developer has to write.
    expect(renderExplanation(intent(), violation({ engine: 'semantic' }))).not.toContain(
      'anhcompass-disable-next-line',
    );
    expect(renderExplanation(intent(), verdict())).not.toContain('anhcompass-disable-next-line');
  });

  it('carries the suggestion when there is one', () => {
    expect(renderExplanation(intent(), violation())).toContain('Remove direct imports of lodash');
    expect(renderExplanation(intent(), violation({ suggestion: undefined }))).not.toContain(
      'How to fix',
    );
  });
});

describe('renderMarkdown', () => {
  it('records the commit it checked', () => {
    expect(renderMarkdown([], 'deadbeef')).toContain('deadbeef');
  });

  it('says so when nothing was in scope, and stops there', () => {
    const out = renderMarkdown([], 'abc');
    expect(out).toContain('No intents in scope');
    expect(out).not.toContain('| Intent |');
  });

  it('renders one table row per verdict', () => {
    const out = renderMarkdown([verdict({ intentId: 'a' }), verdict({ intentId: 'b' })], 'abc');
    expect(out).toContain('| `a` |');
    expect(out).toContain('| `b` |');
  });

  it('marks each status with its own emoji', () => {
    expect(renderMarkdown([verdict({ status: 'pass' })], 'c')).toContain('✅');
    expect(renderMarkdown([violation()], 'c')).toContain('❌');
    expect(renderMarkdown([verdict({ status: 'uncertain' })], 'c')).toContain('⚠️');
  });

  it('distinguishes a blocking violation from a warning', () => {
    expect(renderMarkdown([violation({ enforcement: 'block' })], 'c')).toContain('🚫 block');
    expect(renderMarkdown([violation({ enforcement: 'warn' })], 'c')).toContain('⚠️ warn');
  });

  it('adds a details section only when something was violated', () => {
    expect(renderMarkdown([verdict()], 'c')).not.toContain('### Violations');
    expect(renderMarkdown([violation()], 'c')).toContain('### Violations');
  });

  it('fences the offending excerpt', () => {
    const out = renderMarkdown([violation()], 'c');
    expect(out).toContain('```');
    expect(out).toContain("import _ from 'lodash';");
  });

  it('counts the four outcomes in its footer', () => {
    const out = renderMarkdown(
      [
        verdict({ intentId: 'p' }),
        violation({ intentId: 'b', enforcement: 'block' }),
        violation({ intentId: 'w', enforcement: 'warn' }),
        verdict({ intentId: 'u', status: 'uncertain' }),
      ],
      'c',
    );
    expect(out).toContain('1 pass · 1 blocking · 1 warning · 1 uncertain');
  });

  it('repeats the enforcement rule where a reviewer will read it', () => {
    expect(renderMarkdown([violation()], 'c')).toContain(
      'only deterministic violations with severity `error` block CI',
    );
  });
});
