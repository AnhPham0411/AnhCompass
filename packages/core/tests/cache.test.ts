import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCacheKey, getCachedVerdict, setCachedVerdict } from '../src/engine/cache.js';
import type { Verdict } from '../src/intent/schema.js';

const VALID_VERDICT: Verdict = {
  intentId: 'test-intent',
  status: 'pass',
  confidence: 1,
  evidence: [],
  checkedAtCommit: 'abc1234',
  engine: 'deterministic',
};

describe('buildCacheKey', () => {
  it('is deterministic', () => {
    const a = buildCacheKey('intent', ['+foo'], 'model');
    const b = buildCacheKey('intent', ['+foo'], 'model');
    expect(a).toBe(b);
  });

  it('changes when hunks change', () => {
    const a = buildCacheKey('intent', ['+foo'], 'model');
    const b = buildCacheKey('intent', ['+bar'], 'model');
    expect(a).not.toBe(b);
  });

  it('changes when model changes', () => {
    const a = buildCacheKey('intent', ['+foo'], 'semantic');
    const b = buildCacheKey('intent', ['+foo'], 'deterministic-only');
    expect(a).not.toBe(b);
  });

  it('produces a 16-char hex key', () => {
    expect(buildCacheKey('x', [], 'y')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('getCachedVerdict / setCachedVerdict', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'anhcompass-cache-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('round-trips a valid verdict', async () => {
    await setCachedVerdict(cacheDir, 'key1', VALID_VERDICT);
    const cached = await getCachedVerdict(cacheDir, 'key1');
    expect(cached).toEqual(VALID_VERDICT);
  });

  it('returns null on miss', async () => {
    expect(await getCachedVerdict(cacheDir, 'missing')).toBeNull();
  });

  it('returns null for corrupt JSON', async () => {
    await writeFile(join(cacheDir, 'bad.json'), '{not json', 'utf-8');
    expect(await getCachedVerdict(cacheDir, 'bad')).toBeNull();
  });

  it('returns null for entries that fail schema validation (stale format)', async () => {
    await writeFile(
      join(cacheDir, 'stale.json'),
      JSON.stringify({ intentId: 'x', status: 'nonsense' }),
      'utf-8',
    );
    expect(await getCachedVerdict(cacheDir, 'stale')).toBeNull();
  });
});
