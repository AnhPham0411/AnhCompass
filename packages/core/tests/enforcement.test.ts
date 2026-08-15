import { describe, it, expect } from 'vitest';
import {
  resolveEnforcement,
  withEnforcement,
  blockingViolations,
  warningViolations,
} from '../src/engine/enforcement.js';
import type { Intent, Verdict } from '../src/intent/schema.js';

const makeIntent = (severity: 'warn' | 'error'): Intent => ({
  filePath: '/x.md',
  body: '',
  frontmatter: {
    schema_version: 1,
    id: 'x',
    title: 'x',
    scope: ['src/**'],
    anchors: [],
    check: 'both',
    rule: 'r',
    severity,
    status: 'active',
    created: '2026-08-13',
  },
});

const makeVerdict = (
  engine: 'deterministic' | 'semantic',
  status: Verdict['status'] = 'violation',
): Verdict => ({
  intentId: 'x',
  status,
  confidence: 1,
  evidence: [],
  checkedAtCommit: 'abc',
  engine,
});

describe('resolveEnforcement (hybrid enforcement)', () => {
  it('deterministic + severity error → block', () => {
    expect(resolveEnforcement(makeIntent('error'), makeVerdict('deterministic'))).toBe('block');
  });

  it('deterministic + severity warn → warn', () => {
    expect(resolveEnforcement(makeIntent('warn'), makeVerdict('deterministic'))).toBe('warn');
  });

  it('semantic NEVER blocks, even with severity error', () => {
    expect(resolveEnforcement(makeIntent('error'), makeVerdict('semantic'))).toBe('warn');
  });
});

describe('withEnforcement', () => {
  it('attaches enforcement to violations', () => {
    const v = withEnforcement(makeIntent('error'), makeVerdict('deterministic'));
    expect(v.enforcement).toBe('block');
  });

  it('leaves non-violations untouched', () => {
    const v = withEnforcement(makeIntent('error'), makeVerdict('deterministic', 'pass'));
    expect(v.enforcement).toBeUndefined();
  });
});

describe('blocking/warning filters', () => {
  it('splits violations by enforcement', () => {
    const verdicts: Verdict[] = [
      { ...makeVerdict('deterministic'), enforcement: 'block' },
      { ...makeVerdict('semantic'), enforcement: 'warn' },
      makeVerdict('deterministic', 'pass'),
    ];
    expect(blockingViolations(verdicts)).toHaveLength(1);
    expect(warningViolations(verdicts)).toHaveLength(1);
  });
});
