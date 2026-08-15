import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBaseline,
  saveBaseline,
  loadBaseline,
  compareBaseline,
  hashIntentContent,
} from '../src/baseline/baseline.js';
import type { Intent, Verdict } from '../src/intent/schema.js';

const makeIntent = (id: string, rule = 'default rule'): Intent => ({
  filePath: `/${id}.md`,
  body: 'ctx',
  frontmatter: {
    schema_version: 1,
    id,
    title: id,
    scope: ['src/**'],
    anchors: [],
    check: 'deterministic',
    rule,
    severity: 'error',
    status: 'active',
    created: '2026-08-13',
  },
});

const makeVerdict = (intentId: string, status: Verdict['status']): Verdict => ({
  intentId,
  status,
  confidence: 1,
  evidence: [],
  checkedAtCommit: 'abc',
  engine: 'deterministic',
});

describe('baseline save/load', () => {
  it('round-trips', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anhcompass-base-'));
    try {
      const path = join(dir, 'baseline.json');
      const baseline = buildBaseline(
        [makeIntent('a')],
        [makeVerdict('a', 'pass')],
        'abc',
        '2026-08-13T00:00:00Z',
      );
      await saveBaseline(path, baseline);
      const loaded = await loadBaseline(path);
      expect(loaded).toEqual(baseline);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null on missing or corrupt file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'anhcompass-base-'));
    try {
      expect(await loadBaseline(join(dir, 'missing.json'))).toBeNull();
      await writeFile(join(dir, 'bad.json'), '{oops', 'utf-8');
      expect(await loadBaseline(join(dir, 'bad.json'))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('compareBaseline', () => {
  it('detects regressions (non-violation → violation)', () => {
    const intents = [makeIntent('a')];
    const baseline = buildBaseline(intents, [makeVerdict('a', 'pass')], 'c1', 't1');
    const diff = compareBaseline(baseline, intents, [makeVerdict('a', 'violation')]);
    expect(diff.regressions).toHaveLength(1);
    expect(diff.regressions[0]).toMatchObject({ intentId: 'a', from: 'pass', to: 'violation' });
  });

  it('flags ruleChanged when the intent content differs', () => {
    const v1 = makeIntent('a', 'rule v1');
    const v2 = makeIntent('a', 'rule v2 — stricter');
    const baseline = buildBaseline([v1], [makeVerdict('a', 'pass')], 'c1', 't1');
    const diff = compareBaseline(baseline, [v2], [makeVerdict('a', 'violation')]);
    expect(diff.regressions[0]?.ruleChanged).toBe(true);
    expect(diff.changedIntents).toContain('a');
  });

  it('detects improvements (violation → pass)', () => {
    const intents = [makeIntent('a')];
    const baseline = buildBaseline(intents, [makeVerdict('a', 'violation')], 'c1', 't1');
    const diff = compareBaseline(baseline, intents, [makeVerdict('a', 'pass')]);
    expect(diff.improvements).toHaveLength(1);
    expect(diff.regressions).toHaveLength(0);
  });

  it('treats a violation with no baseline verdict as a regression', () => {
    const baseline = buildBaseline([makeIntent('a')], [], 'c1', 't1');
    const diff = compareBaseline(baseline, [makeIntent('a')], [makeVerdict('a', 'violation')]);
    expect(diff.regressions).toHaveLength(1);
    expect(diff.regressions[0]?.from).toBe('(not in baseline)');
  });

  it('reports new and removed intents', () => {
    const baseline = buildBaseline([makeIntent('old')], [makeVerdict('old', 'pass')], 'c1', 't1');
    const diff = compareBaseline(baseline, [makeIntent('brand-new')], []);
    expect(diff.newIntents).toContain('brand-new');
    expect(diff.removedIntents).toContain('old');
  });

  it('hashIntentContent is stable and sensitive to rule text', () => {
    expect(hashIntentContent(makeIntent('a', 'r'))).toBe(hashIntentContent(makeIntent('a', 'r')));
    expect(hashIntentContent(makeIntent('a', 'r1'))).not.toBe(
      hashIntentContent(makeIntent('a', 'r2')),
    );
  });
});
