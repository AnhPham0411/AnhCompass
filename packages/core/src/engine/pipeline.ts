import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';
import { filterByScope } from './scope.js';
import { getCachedVerdict, setCachedVerdict, buildCacheKey } from './cache.js';
import { runDeterministicCheck } from './deterministic.js';
import { runSemanticCheck } from './semantic.js';
import { join } from 'node:path';

export interface PipelineOpts {
  intents: Intent[];
  diff: ParsedDiff;
  diffText: string;
  repoRoot: string;
  checkedAtCommit: string;
  apiKey?: string;
  onProgress?: (msg: string) => void;
}

export interface PipelineResult {
  verdicts: Verdict[];
  skippedIntents: number;
  cacheHits: number;
}

/** Run the 6-step drift detection pipeline */
export async function runPipeline(opts: PipelineOpts): Promise<PipelineResult> {
  const { intents, diff, diffText, repoRoot, checkedAtCommit, apiKey, onProgress } = opts;
  const cacheDir = join(repoRoot, '.agent', 'cache');

  onProgress?.(`Loaded ${intents.length} intent(s)`);

  // Step 1: Parse already done (intents passed in)
  // Step 2: Scope filter
  const activeIntents = intents.filter((i) => i.frontmatter.status === 'active');
  const candidates = filterByScope(activeIntents, diff);

  onProgress?.(`${candidates.length} intent(s) in scope after filtering`);

  if (candidates.length === 0) {
    return { verdicts: [], skippedIntents: intents.length - candidates.length, cacheHits: 0 };
  }

  // Step 3: Blast radius (Phase 1: skip — scope already narrows well enough)

  const verdicts: Verdict[] = [];
  let cacheHits = 0;

  for (const intent of candidates) {
    const id = intent.frontmatter.id;
    const check = intent.frontmatter.check;

    // Step 4: Cache
    const intentContent = JSON.stringify(intent.frontmatter) + intent.body;
    const relevantHunks = Object.entries(diff.hunks)
      .filter(([file]) =>
        diff.files.some((f) => f === file),
      )
      .flatMap(([, hunks]) => hunks);

    const modelId = apiKey ? 'semantic' : 'deterministic-only';
    const cacheKey = buildCacheKey(intentContent, relevantHunks, modelId);
    const cached = await getCachedVerdict(cacheDir, cacheKey);

    if (cached) {
      onProgress?.(`  [${id}] cache hit`);
      verdicts.push(cached);
      cacheHits++;
      continue;
    }

    let verdict: Verdict;

    // Step 5a: Deterministic
    if (check === 'deterministic' || check === 'both') {
      onProgress?.(`  [${id}] running deterministic check`);
      const result = await runDeterministicCheck(intent, diff, checkedAtCommit);
      verdict = result.verdict;

      // If violation found deterministically, no need for semantic
      if (verdict.status === 'violation' || check === 'deterministic') {
        await setCachedVerdict(cacheDir, cacheKey, verdict);
        verdicts.push(verdict);
        continue;
      }
    }

    // Step 5b: Semantic
    if ((check === 'semantic' || check === 'both') && apiKey) {
      onProgress?.(`  [${id}] running semantic check`);
      verdict = await runSemanticCheck({
        intent,
        diff,
        diffText,
        repoRoot,
        apiKey,
        checkedAtCommit,
        cacheKey,
      });
    } else if (!apiKey && (check === 'semantic' || check === 'both')) {
      // No API key — semantic intents become uncertain
      verdict = {
        intentId: id,
        status: 'uncertain',
        confidence: 0,
        evidence: [],
        suggestion: 'Set ANTHROPIC_API_KEY to enable semantic checks',
        checkedAtCommit,
        engine: 'semantic',
      };
    } else {
      // Deterministic passed and check === 'both'
      verdict = {
        intentId: id,
        status: 'pass',
        confidence: 1,
        evidence: [],
        checkedAtCommit,
        engine: 'deterministic',
      };
    }

    await setCachedVerdict(cacheDir, cacheKey, verdict);
    verdicts.push(verdict);
  }

  return { verdicts, skippedIntents: intents.length - candidates.length, cacheHits };
}
