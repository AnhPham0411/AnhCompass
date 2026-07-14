import { describe, it, expect } from 'vitest';
import { buildIndex } from '../src/compile/index-builder.js';
import { buildManifest } from '../src/compile/manifest.js';
import type { Intent } from '../src/intent/schema.js';

const makeIntent = (
  id: string,
  status: 'proposed' | 'active' | 'deprecated',
): Intent => ({
  filePath: `/path/${id}.md`,
  body: 'body',
  frontmatter: {
    schema_version: 1,
    id,
    title: `Title ${id}`,
    scope: ['src/**'],
    anchors: [],
    check: 'semantic',
    rule: 'some rule',
    severity: 'warn',
    status,
    created: '2026-07-14',
  },
});

describe('buildIndex', () => {
  it('renders active intents in bold', () => {
    const intents = [makeIntent('my-rule', 'active')];
    const result = buildIndex(intents);
    expect(result).toContain('## Active');
    expect(result).toContain('**[my-rule]');
  });

  it('renders proposed intents without bold', () => {
    const intents = [makeIntent('draft-rule', 'proposed')];
    const result = buildIndex(intents);
    expect(result).toContain('## Proposed');
    expect(result).not.toContain('**[draft-rule]');
  });

  it('renders deprecated with strikethrough', () => {
    const intents = [makeIntent('old-rule', 'deprecated')];
    const result = buildIndex(intents);
    expect(result).toContain('~~[old-rule]');
  });

  it('includes total count', () => {
    const intents = [makeIntent('a', 'active'), makeIntent('b', 'proposed')];
    const result = buildIndex(intents);
    expect(result).toContain('Total: 2');
  });
});

describe('buildManifest', () => {
  it('produces correct entry count', () => {
    const intents = [makeIntent('rule-a', 'active'), makeIntent('rule-b', 'proposed')];
    const manifest = buildManifest(intents);
    expect(manifest.intentCount).toBe(2);
    expect(manifest.entries).toHaveLength(2);
  });

  it('maps id and title correctly', () => {
    const intents = [makeIntent('my-intent', 'active')];
    const manifest = buildManifest(intents);
    expect(manifest.entries[0]?.id).toBe('my-intent');
    expect(manifest.entries[0]?.title).toBe('Title my-intent');
  });
});
