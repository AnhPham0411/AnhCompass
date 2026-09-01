import { describe, it, expect } from 'vitest';
import { renderTerminal, renderBaselineDiff } from '../src/report/terminal.js';
import type { Verdict } from '../src/intent/schema.js';
import type { BaselineDiff } from '../src/baseline/baseline.js';

/** picocolors emits escapes only when it believes it is talking to a terminal,
 *  which under vitest it is not. Assertions therefore read the text, and the
 *  one test that cares about colour checks the structure instead. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    intentId: 'no-lodash',
    status: 'pass',
    confidence: 1,
    evidence: [],
    checkedAtCommit: 'abc',
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
    ...over,
  });

const emptyDiff: BaselineDiff = {
  regressions: [],
  improvements: [],
  otherChanges: [],
  changedIntents: [],
  newIntents: [],
  removedIntents: [],
};

describe('renderTerminal', () => {
  it('says so when nothing was in scope', () => {
    expect(stripAnsi(renderTerminal([]))).toContain('No intents in scope');
  });

  it('gives each status its own icon', () => {
    expect(stripAnsi(renderTerminal([verdict({ status: 'pass' })]))).toContain('✓');
    expect(stripAnsi(renderTerminal([violation()]))).toContain('✗');
    expect(stripAnsi(renderTerminal([verdict({ status: 'uncertain' })]))).toContain('?');
  });

  it('names the intent, status, confidence and engine', () => {
    const out = stripAnsi(renderTerminal([verdict({ confidence: 0.5, engine: 'semantic' })]));
    expect(out).toContain('[no-lodash]');
    expect(out).toContain('PASS');
    expect(out).toContain('50%');
    expect(out).toContain('semantic');
  });

  it('distinguishes a blocking violation from a warning', () => {
    expect(stripAnsi(renderTerminal([violation({ enforcement: 'block' })]))).toContain('[BLOCK]');
    expect(stripAnsi(renderTerminal([violation({ enforcement: 'warn' })]))).toContain('[WARN]');
  });

  it('labels enforcement only on violations', () => {
    const out = stripAnsi(renderTerminal([verdict()]));
    expect(out).not.toContain('[BLOCK]');
    expect(out).not.toContain('[WARN]');
  });

  it('prints evidence with its line number', () => {
    const out = stripAnsi(renderTerminal([violation()]));
    expect(out).toContain('src/a.ts:3');
    expect(out).toContain("import _ from 'lodash';");
    expect(out).toContain('direct import');
  });

  it('drops the colon when the evidence has no line', () => {
    const out = stripAnsi(
      renderTerminal([violation({ evidence: [{ file: 'src/a.ts', excerpt: 'x', reason: 'y' }] })]),
    );
    expect(out).toContain('src/a.ts');
    expect(out).not.toContain('src/a.ts:');
  });

  it('shows a suggestion when there is one, and nothing when there is not', () => {
    expect(stripAnsi(renderTerminal([violation({ suggestion: 'Remove it' })]))).toContain(
      'Remove it',
    );
    expect(stripAnsi(renderTerminal([violation()]))).not.toContain('💡');
  });

  it('counts the four outcomes', () => {
    const out = stripAnsi(
      renderTerminal([
        verdict({ intentId: 'p' }),
        violation({ intentId: 'b', enforcement: 'block' }),
        violation({ intentId: 'w', enforcement: 'warn' }),
        verdict({ intentId: 'u', status: 'uncertain' }),
      ]),
    );
    expect(out).toContain('1 pass');
    expect(out).toContain('1 blocking');
    expect(out).toContain('1 warning');
    expect(out).toContain('1 uncertain');
  });
});

describe('renderBaselineDiff', () => {
  it('reports a clean comparison when no verdict moved', () => {
    expect(stripAnsi(renderBaselineDiff(emptyDiff))).toContain('No verdict changes');
  });

  it('calls out a regression by name and direction', () => {
    const out = stripAnsi(
      renderBaselineDiff({
        ...emptyDiff,
        regressions: [{ intentId: 'a', from: 'pass', to: 'violation', ruleChanged: false }],
      }),
    );
    expect(out).toContain('REGRESSION');
    expect(out).toContain('[a]');
    expect(out).toContain('pass → violation');
  });

  it('marks a change that followed a rule edit, so it is not read as drift', () => {
    const out = stripAnsi(
      renderBaselineDiff({
        ...emptyDiff,
        regressions: [{ intentId: 'a', from: 'pass', to: 'violation', ruleChanged: true }],
      }),
    );
    expect(out).toContain('(rule changed)');
  });

  it('leaves the note off when the rule did not change', () => {
    const out = stripAnsi(
      renderBaselineDiff({
        ...emptyDiff,
        regressions: [{ intentId: 'a', from: 'pass', to: 'violation', ruleChanged: false }],
      }),
    );
    expect(out).not.toContain('(rule changed)');
  });

  it('reports improvements and other changes distinctly', () => {
    const out = stripAnsi(
      renderBaselineDiff({
        ...emptyDiff,
        improvements: [{ intentId: 'i', from: 'violation', to: 'pass', ruleChanged: false }],
        otherChanges: [{ intentId: 'o', from: 'pass', to: 'uncertain', ruleChanged: false }],
      }),
    );
    expect(out).toContain('improved [i]');
    expect(out).toContain('changed [o]');
    expect(out).not.toContain('No verdict changes');
  });

  it('lists edited, new and removed intents', () => {
    const out = stripAnsi(
      renderBaselineDiff({
        ...emptyDiff,
        changedIntents: ['edited'],
        newIntents: ['fresh'],
        removedIntents: ['gone'],
      }),
    );
    expect(out).toContain('rules edited since baseline: edited');
    expect(out).toContain('new intents (not in baseline): fresh');
    expect(out).toContain('removed intents: gone');
  });

  it('stays quiet about intent lists that are empty', () => {
    const out = stripAnsi(renderBaselineDiff(emptyDiff));
    expect(out).not.toContain('rules edited');
    expect(out).not.toContain('new intents');
    expect(out).not.toContain('removed intents');
  });
});
