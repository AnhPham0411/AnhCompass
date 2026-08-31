import micromatch from 'micromatch';
import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff, GraphProvider } from '@anhcompass/graph';
import { detectProvider } from '@anhcompass/graph';
import { filterByScope } from './scope.js';
import { getCachedVerdict, setCachedVerdict, buildCacheKey } from './cache.js';
import { runDeterministicCheck } from './deterministic.js';
import { runSemanticCheck } from './semantic.js';
import { withEnforcement } from './enforcement.js';
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

  const activeIntents = intents.filter((i) => i.frontmatter.status === 'active');
  const candidates = filterByScope(activeIntents, diff);

  onProgress?.(`${candidates.length} intent(s) in scope after filtering`);

  if (candidates.length === 0) {
    return { verdicts: [], skippedIntents: intents.length - candidates.length, cacheHits: 0 };
  }

  const provider = await detectProvider(repoRoot);
  const verdicts: Verdict[] = [];
  let cacheHits = 0;

  for (const intent of candidates) {
    const id = intent.frontmatter.id;
    const check = intent.frontmatter.check;

    const intentContent = JSON.stringify(intent.frontmatter) + intent.body;
    const scopedFiles = micromatch(diff.files, intent.frontmatter.scope);
    const relevantHunks = scopedFiles.flatMap((file) => diff.hunks[file] ?? []);

    const modelId = apiKey ? 'semantic' : 'deterministic-only';
    const cacheKey = buildCacheKey(intentContent, relevantHunks, modelId);
    const cached = await getCachedVerdict(cacheDir, cacheKey);

    if (cached) {
      onProgress?.(`  [${id}] cache hit`);
      verdicts.push(withEnforcement(intent, cached));
      cacheHits++;
      continue;
    }

    let verdict: Verdict;

    if (check === 'deterministic' || check === 'both') {
      onProgress?.(`  [${id}] running deterministic check`);
      const result = await runDeterministicCheck(intent, diff, checkedAtCommit, provider, repoRoot);
      verdict = result.verdict;

      if (verdict.status === 'violation' || check === 'deterministic') {
        verdict = withEnforcement(intent, verdict);
        await setCachedVerdict(cacheDir, cacheKey, verdict);
        verdicts.push(verdict);
        continue;
      }
    }

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
        provider,
        useGraphRetrieval: process.env.ANHCOMPASS_GRAPH_RETRIEVAL === '1',
      });
    } else if (!apiKey && (check === 'semantic' || check === 'both')) {
      verdict = {
        intentId: id,
        status: 'uncertain',
        confidence: 0,
        evidence: [],
        suggestion: 'Set an LLM API key to enable semantic checks',
        checkedAtCommit,
        engine: 'semantic',
      };
    } else {
      verdict = {
        intentId: id,
        status: 'pass',
        confidence: 1,
        evidence: [],
        checkedAtCommit,
        engine: 'deterministic',
      };
    }

    verdict = withEnforcement(intent, verdict);

    if (verdict.status !== 'uncertain') {
      await setCachedVerdict(cacheDir, cacheKey, verdict);
    }
    verdicts.push(verdict);
  }

  return { verdicts, skippedIntents: intents.length - candidates.length, cacheHits };
}

