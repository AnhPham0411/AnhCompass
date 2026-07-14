import { describe, it, expect } from 'vitest';
import { filterByScope } from '../src/engine/scope.js';
import type { Intent } from '../src/intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

const makeIntent = (id: string, scope: string[]): Intent => ({
  filePath: `/path/${id}.md`,
  body: '',
  frontmatter: {
    schema_version: 1,
    id,
    title: id,
    scope,
    anchors: [],
    check: 'semantic',
    rule: 'rule',
    severity: 'warn',
    status: 'active',
    created: '2026-07-14',
  },
});

const makeDiff = (files: string[]): ParsedDiff => ({ files, hunks: {} });

describe('filterByScope', () => {
  it('returns intents whose scope matches diff files', () => {
    const intents = [
      makeIntent('api-rule', ['src/api/**']),
      makeIntent('lib-rule', ['src/lib/**']),
    ];
    const diff = makeDiff(['src/api/order.ts']);
    const result = filterByScope(intents, diff);
    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.id).toBe('api-rule');
  });

  it('returns empty when no files match', () => {
    const intents = [makeIntent('lib-rule', ['src/lib/**'])];
    const diff = makeDiff(['src/api/order.ts']);
    expect(filterByScope(intents, diff)).toHaveLength(0);
  });

  it('returns empty for empty diff', () => {
    const intents = [makeIntent('any', ['src/**'])];
    expect(filterByScope(intents, makeDiff([]))).toHaveLength(0);
  });

  it('handles multiple matching intents', () => {
    const intents = [
      makeIntent('broad', ['src/**']),
      makeIntent('api', ['src/api/**']),
    ];
    const diff = makeDiff(['src/api/order.ts']);
    expect(filterByScope(intents, diff)).toHaveLength(2);
  });
});
