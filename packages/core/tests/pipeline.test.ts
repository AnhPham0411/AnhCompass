import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '../src/engine/pipeline.js';
import type { Intent } from '../src/intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

/** A repository on disk, because the pipeline detects a graph backend from one
 *  and caches verdicts into one. */
let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'anhcompass-pipeline-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

function intent(over: Partial<Intent['frontmatter']> & { id: string }): Intent {
  return {
    filePath: `/${over.id}.md`,
    body: 'rule body',
    frontmatter: {
      schema_version: 1,
      title: over.id,
      scope: ['src/**'],
      anchors: [],
      check: 'deterministic',
      rule: 'no lodash',
      severity: 'error',
      status: 'active',
      created: '2026-01-01',
      deterministic: { kind: 'no-import', from: ['src/**'], to: ['lodash'] },
      ...over,
    },
  } as Intent;
}

const violatingDiff: ParsedDiff = {
  files: ['src/a.ts'],
  hunks: { 'src/a.ts': ["+import _ from 'lodash';"] },
};

const cleanDiff: ParsedDiff = {
  files: ['src/a.ts'],
  hunks: { 'src/a.ts': ['+export const a = 1;'] },
};

const run = (intents: Intent[], diff: ParsedDiff, extra: Record<string, unknown> = {}) =>
  runPipeline({
    intents,
    diff,
    diffText: Object.values(diff.hunks).flat().join('\n'),
    repoRoot,
    checkedAtCommit: 'abc123',
    ...extra,
  });

describe('runPipeline', () => {
  describe('which intents it considers', () => {
    it('skips intents that are not active, and counts them as skipped', async () => {
      const result = await run(
        [intent({ id: 'a', status: 'proposed' }), intent({ id: 'b', status: 'deprecated' })],
        violatingDiff,
      );
      expect(result.verdicts).toEqual([]);
      expect(result.skippedIntents).toBe(2);
    });

    it('skips intents whose scope does not cover any changed file', async () => {
      const result = await run([intent({ id: 'a', scope: ['other/**'] })], violatingDiff);
      expect(result.verdicts).toEqual([]);
      expect(result.skippedIntents).toBe(1);
    });

    it('reports a verdict per in-scope intent', async () => {
      const result = await run(
        [intent({ id: 'a' }), intent({ id: 'b', deterministic: undefined })],
        violatingDiff,
      );
      expect(result.verdicts.map((v) => v.intentId)).toEqual(['a', 'b']);
      expect(result.skippedIntents).toBe(0);
    });
  });

  describe('verdicts', () => {
    it('reports a violation the deterministic engine finds', async () => {
      const { verdicts } = await run([intent({ id: 'a' })], violatingDiff);
      expect(verdicts[0]).toMatchObject({ status: 'violation', engine: 'deterministic' });
    });

    it('passes clean code', async () => {
      const { verdicts } = await run([intent({ id: 'a' })], cleanDiff);
      expect(verdicts[0]!.status).toBe('pass');
    });

    it('stamps the commit it checked onto every verdict', async () => {
      const { verdicts } = await run([intent({ id: 'a' })], violatingDiff);
      expect(verdicts[0]!.checkedAtCommit).toBe('abc123');
    });

    it('attaches enforcement, so a caller can tell blocking from advisory', async () => {
      const { verdicts } = await run([intent({ id: 'a', severity: 'error' })], violatingDiff);
      expect(verdicts[0]!.enforcement).toBe('block');
    });

    it('never blocks on a warn-severity rule', async () => {
      const { verdicts } = await run([intent({ id: 'a', severity: 'warn' })], violatingDiff);
      expect(verdicts[0]!.enforcement).toBe('warn');
    });
  });

  describe('without an API key', () => {
    it('answers uncertain for a semantic rule rather than pass', async () => {
      const { verdicts } = await run(
        [intent({ id: 'a', check: 'semantic', deterministic: undefined })],
        violatingDiff,
      );
      expect(verdicts[0]).toMatchObject({ status: 'uncertain', engine: 'semantic' });
      expect(verdicts[0]!.confidence).toBe(0);
    });

    it('still reports a deterministic violation on a `both` rule', async () => {
      const { verdicts } = await run([intent({ id: 'a', check: 'both' })], violatingDiff);
      expect(verdicts[0]).toMatchObject({ status: 'violation', engine: 'deterministic' });
    });

    it('answers uncertain on a clean `both` rule, since half of it never ran', async () => {
      const { verdicts } = await run([intent({ id: 'a', check: 'both' })], cleanDiff);
      expect(verdicts[0]!.status).toBe('uncertain');
    });
  });

  describe('caching', () => {
    it('reports no cache hit on the first run', async () => {
      const result = await run([intent({ id: 'a' })], violatingDiff);
      expect(result.cacheHits).toBe(0);
    });

    it('serves the second identical run from cache', async () => {
      await run([intent({ id: 'a' })], violatingDiff);
      const second = await run([intent({ id: 'a' })], violatingDiff);
      expect(second.cacheHits).toBe(1);
      expect(second.verdicts[0]!.status).toBe('violation');
    });

    it('re-runs when the rule text changes', async () => {
      await run([intent({ id: 'a' })], violatingDiff);
      const second = await run([intent({ id: 'a', rule: 'a different rule' })], violatingDiff);
      expect(second.cacheHits).toBe(0);
    });

    it('re-runs when the diff changes', async () => {
      await run([intent({ id: 'a' })], violatingDiff);
      const second = await run([intent({ id: 'a' })], cleanDiff);
      expect(second.cacheHits).toBe(0);
    });

    it('keeps enforcement on a cached verdict', async () => {
      await run([intent({ id: 'a' })], violatingDiff);
      const second = await run([intent({ id: 'a' })], violatingDiff);
      expect(second.verdicts[0]!.enforcement).toBe('block');
    });

    it('does not cache an uncertain verdict, since nothing was decided', async () => {
      await run([intent({ id: 'a', check: 'semantic', deterministic: undefined })], violatingDiff);
      const second = await run(
        [intent({ id: 'a', check: 'semantic', deterministic: undefined })],
        violatingDiff,
      );
      expect(second.cacheHits).toBe(0);
    });
  });

  describe('progress reporting', () => {
    it('names how many intents loaded and how many survived scoping', async () => {
      const messages: string[] = [];
      await run([intent({ id: 'a' }), intent({ id: 'b', scope: ['other/**'] })], violatingDiff, {
        onProgress: (m: string) => messages.push(m),
      });
      expect(messages[0]).toContain('2');
      expect(messages[1]).toContain('1');
    });

    it('says which intent is being checked', async () => {
      const messages: string[] = [];
      await run([intent({ id: 'a' })], violatingDiff, {
        onProgress: (m: string) => messages.push(m),
      });
      expect(messages.join('\n')).toContain('[a]');
    });

    it('runs without a progress callback', async () => {
      await expect(run([intent({ id: 'a' })], violatingDiff)).resolves.toBeDefined();
    });
  });

  describe('the graph backend', () => {
    it('answers uncertain for a graph-only rule when the repo has no backend', async () => {
      // No package.json and no tsconfig: nothing for the indexer to attach to.
      const { verdicts } = await run(
        [
          intent({
            id: 'a',
            deterministic: { kind: 'no-cycle', from: ['src/**'] },
          }),
        ],
        cleanDiff,
      );
      expect(verdicts[0]!.status).toBe('uncertain');
    });

    it('evaluates a graph-only rule once the repo looks like a JS project', async () => {
      await writeFile(join(repoRoot, 'package.json'), '{"name":"t"}', 'utf-8');
      await writeFile(join(repoRoot, 'src', 'a.ts'), "import { b } from './b';\n", 'utf-8');
      await writeFile(join(repoRoot, 'src', 'b.ts'), "import { a } from './a';\n", 'utf-8');

      const { verdicts } = await run(
        [intent({ id: 'a', deterministic: { kind: 'no-cycle', from: ['src/**'] } })],
        cleanDiff,
      );
      expect(verdicts[0]!.status).toBe('violation');
    });
  });
});
