import { describe, it, expect } from 'vitest';
import { runDoctor } from '../src/engine/doctor.js';
import type { Intent } from '../src/intent/schema.js';

const YESTERDAY = '2020-01-01';
const FAR_FUTURE = '2999-12-31';

function intent(overrides: Partial<Intent['frontmatter']> & { id: string }): Intent {
  return {
    filePath: `/${overrides.id}.md`,
    body: '',
    frontmatter: {
      schema_version: 1,
      title: overrides.id,
      scope: ['src/**'],
      anchors: [],
      check: 'deterministic',
      rule: 'r',
      severity: 'error',
      status: 'active',
      created: '2026-01-01',
      ...overrides,
    },
  } as Intent;
}

describe('runDoctor', () => {
  it('reports nothing about a healthy intent set', () => {
    expect(runDoctor([intent({ id: 'a' })])).toEqual([]);
  });

  it('says nothing at all when there are no intents', () => {
    expect(runDoctor([])).toEqual([]);
  });

  describe('review dates', () => {
    it('warns once the review date has passed', () => {
      const issues = runDoctor([intent({ id: 'a', review_after: YESTERDAY })]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ intentId: 'a', type: 'warning' });
      // The date belongs in the message: a warning that does not say when the
      // rule was due tells the reader nothing they can act on.
      expect(issues[0]!.message).toContain(YESTERDAY);
    });

    it('stays quiet while the review date is still ahead', () => {
      expect(runDoctor([intent({ id: 'a', review_after: FAR_FUTURE })])).toEqual([]);
    });

    it('treats a review date of today as not yet due', () => {
      const today = new Date().toISOString().slice(0, 10);
      expect(runDoctor([intent({ id: 'a', review_after: today })])).toEqual([]);
    });
  });

  describe('exceptions', () => {
    it('errors on an expired exception, naming the path and the date', () => {
      const issues = runDoctor([
        intent({
          id: 'a',
          exceptions: [{ path: 'src/legacy/**', reason: 'migration', expires: YESTERDAY }],
        }),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('error');
      expect(issues[0]!.message).toContain('src/legacy/**');
      expect(issues[0]!.message).toContain(YESTERDAY);
    });

    it('accepts an exception that has not expired', () => {
      const issues = runDoctor([
        intent({
          id: 'a',
          exceptions: [{ path: 'src/legacy/**', reason: 'migration', expires: FAR_FUTURE }],
        }),
      ]);
      expect(issues).toEqual([]);
    });

    it('accepts an exception with no expiry', () => {
      const issues = runDoctor([
        intent({ id: 'a', exceptions: [{ path: 'src/legacy/**', reason: 'permanent' }] }),
      ]);
      expect(issues).toEqual([]);
    });

    it('reports every expired exception, not just the first', () => {
      const issues = runDoctor([
        intent({
          id: 'a',
          exceptions: [
            { path: 'one/**', reason: 'r', expires: YESTERDAY },
            { path: 'two/**', reason: 'r', expires: YESTERDAY },
          ],
        }),
      ]);
      expect(issues).toHaveLength(2);
      expect(issues.map((i) => i.message).join(' ')).toContain('two/**');
    });
  });

  describe('overlapping scope', () => {
    it('warns when two intents claim exactly the same scope', () => {
      const issues = runDoctor([
        intent({ id: 'a', scope: ['src/**'] }),
        intent({ id: 'b', scope: ['src/**'] }),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ intentId: 'a', type: 'warning' });
      expect(issues[0]!.message).toContain('b');
    });

    it('reports the pair once, not once from each side', () => {
      const issues = runDoctor([
        intent({ id: 'a', scope: ['src/**'] }),
        intent({ id: 'b', scope: ['src/**'] }),
      ]);
      expect(issues.filter((i) => i.intentId === 'b')).toHaveLength(0);
    });

    it('leaves different scopes alone', () => {
      const issues = runDoctor([
        intent({ id: 'a', scope: ['src/api/**'] }),
        intent({ id: 'b', scope: ['src/infra/**'] }),
      ]);
      expect(issues).toEqual([]);
    });

    it('does not call scopes identical when one is a prefix of the other', () => {
      const issues = runDoctor([
        intent({ id: 'a', scope: ['src/**'] }),
        intent({ id: 'b', scope: ['src/**', 'lib/**'] }),
      ]);
      expect(issues).toEqual([]);
    });

    it('compares scope entries in order rather than as sets', () => {
      // Documenting the current contract: ['a','b'] and ['b','a'] cover the
      // same files but are not reported. The check is a cheap exact match.
      const issues = runDoctor([
        intent({ id: 'a', scope: ['x/**', 'y/**'] }),
        intent({ id: 'b', scope: ['y/**', 'x/**'] }),
      ]);
      expect(issues).toEqual([]);
    });

    it('warns for each identical pair among three intents', () => {
      const issues = runDoctor([
        intent({ id: 'a', scope: ['src/**'] }),
        intent({ id: 'b', scope: ['src/**'] }),
        intent({ id: 'c', scope: ['src/**'] }),
      ]);
      expect(issues).toHaveLength(3);
    });
  });

  it('reports every kind of issue an intent has at once', () => {
    const issues = runDoctor([
      intent({
        id: 'a',
        scope: ['src/**'],
        review_after: YESTERDAY,
        exceptions: [{ path: 'p/**', reason: 'r', expires: YESTERDAY }],
      }),
      intent({ id: 'b', scope: ['src/**'] }),
    ]);
    expect(issues.map((i) => i.type).sort()).toEqual(['error', 'warning', 'warning']);
  });
});
