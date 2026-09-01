import { describe, it, expect } from 'vitest';
import { buildIndex } from '../src/compile/index-builder.js';
import type { Intent } from '../src/intent/schema.js';

function intent(id: string, status: 'active' | 'proposed' | 'deprecated'): Intent {
  return {
    filePath: `/${id}.md`,
    body: '',
    frontmatter: {
      schema_version: 1,
      id,
      title: `Title of ${id}`,
      scope: ['src/**'],
      anchors: [],
      check: 'deterministic',
      rule: 'r',
      severity: 'error',
      status,
      created: '2026-01-01',
    },
  } as Intent;
}

describe('buildIndex', () => {
  it('marks itself generated, so nobody edits it by hand', () => {
    expect(buildIndex([])).toContain('do not edit manually');
  });

  it('counts every intent, whatever its status', () => {
    const out = buildIndex([
      intent('a', 'active'),
      intent('p', 'proposed'),
      intent('d', 'deprecated'),
    ]);
    expect(out).toContain('_Total: 3 intent(s)_');
  });

  it('reports zero for an empty store', () => {
    expect(buildIndex([])).toContain('_Total: 0 intent(s)_');
  });

  it('omits a section that has no intents', () => {
    const out = buildIndex([intent('a', 'active')]);
    expect(out).toContain('## Active');
    expect(out).not.toContain('## Proposed');
    expect(out).not.toContain('## Deprecated');
  });

  it('links each intent to its own file', () => {
    expect(buildIndex([intent('no-lodash', 'active')])).toContain(
      '[no-lodash](no-lodash.md)',
    );
  });

  it('carries the title beside the link', () => {
    expect(buildIndex([intent('a', 'active')])).toContain('Title of a');
  });

  it('bolds an active rule and leaves a proposed one plain', () => {
    const out = buildIndex([intent('a', 'active'), intent('p', 'proposed')]);
    expect(out).toContain('**[a](a.md)**');
    expect(out).toContain('- [p](p.md)');
    expect(out).not.toContain('**[p](p.md)**');
  });

  it('strikes through a deprecated rule', () => {
    expect(buildIndex([intent('d', 'deprecated')])).toContain('~~[d](d.md)~~');
  });

  it('groups intents under the right heading', () => {
    const out = buildIndex([
      intent('a', 'active'),
      intent('p', 'proposed'),
      intent('d', 'deprecated'),
    ]);
    const order = ['## Active', '## Proposed', '## Deprecated'].map((h) => out.indexOf(h));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every((i) => i > -1)).toBe(true);
  });

  it('lists every intent in a section, not just the first', () => {
    const out = buildIndex([intent('a', 'active'), intent('b', 'active')]);
    expect(out).toContain('[a](a.md)');
    expect(out).toContain('[b](b.md)');
  });

  it('keeps the order it was given', () => {
    const out = buildIndex([intent('z', 'active'), intent('a', 'active')]);
    expect(out.indexOf('[z](z.md)')).toBeLessThan(out.indexOf('[a](a.md)'));
  });
});
