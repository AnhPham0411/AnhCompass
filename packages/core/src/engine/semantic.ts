import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff, GraphProvider } from '@anhcompass/graph';
import { readFilesMatchingGlobs, readFilesInOrder } from '@anhcompass/graph';
import micromatch from 'micromatch';

/** Token budget for retrieved code context. Both retrieval strategies spend
 *  the same budget, so a comparison between them measures the choice of files
 *  rather than the size of the prompt. */
export const CONTEXT_TOKEN_BUDGET = 6000;
import {
  LlmClient,
  CONFORMANCE_SYSTEM_PROMPT_V2,
  buildSemanticPrompt,
  routeModel,
  VERDICT_MAX_OUTPUT_TOKENS,
  DIFF_PROMPT_CHAR_LIMIT,
  CONTEXT_PROMPT_CHAR_LIMIT,
  logLlmCall,
} from '@anhcompass/llm';
import { z } from 'zod';

export const SemanticVerdictResponseSchema = z.object({
  status: z.enum(['pass', 'violation', 'uncertain']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      file: z.string(),
      line: z
        .number()
        .nullish()
        .transform((v) => v ?? undefined),
      excerpt: z.string().transform((s) => s.slice(0, 300)),
      reason: z.string(),
    }),
  ),
  suggestion: z.string().nullish(),
});

type SemanticVerdictResponse = z.infer<typeof SemanticVerdictResponseSchema>;

interface CallResult {
  result: SemanticVerdictResponse;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface SemanticCheckOpts {
  intent: Intent;
  diff: ParsedDiff;
  diffText: string;
  repoRoot: string;
  apiKey: string;
  checkedAtCommit: string;
  cacheKey: string;
  provider?: GraphProvider;
  useGraphRetrieval?: boolean;
  /** Pin the model instead of routing by context size */
  model?: string;
}

export async function runSemanticCheck(opts: SemanticCheckOpts): Promise<Verdict> {
  const { intent, diff, diffText, repoRoot, apiKey, checkedAtCommit, provider, useGraphRetrieval } = opts;

  let context: { snippets: Record<string, string>; estimatedTokens: number };

  if (useGraphRetrieval && provider && provider.name.includes('graph') && provider.getQueryEngine) {
    const query = await provider.getQueryEngine();
    
    // Find all neighbors within 2 hops of changed files
    const changedFiles = diff.files.filter(f => query.data.nodes.includes(f));
    const neighbors = query.neighbors(changedFiles, 2);
    
    // Prioritize neighbors that match intent scope
    const scopeNeighbors = micromatch(neighbors, intent.frontmatter.scope);
    const otherNeighbors = neighbors.filter((n) => !scopeNeighbors.includes(n));
    // changed files first — they are the reason the check is running at all —
    // then their in-scope neighbours, then the rest
    const rankedFiles = [
      ...changedFiles,
      ...scopeNeighbors.filter((n) => !changedFiles.includes(n)),
      ...otherNeighbors,
    ];

    // read in rank order: a budget spent in directory order discards the rank
    context = await readFilesInOrder(repoRoot, rankedFiles, CONTEXT_TOKEN_BUDGET);

    // The index covers TypeScript and JavaScript only. In a repository written
    // in anything else the neighbourhood comes back empty, and an empty context
    // is strictly worse than the walk it replaced — fall back rather than ask
    // the model to judge a rule with nothing to read.
    if (Object.keys(context.snippets).length === 0) {
      context = await readFilesMatchingGlobs(
        repoRoot,
        intent.frontmatter.scope,
        CONTEXT_TOKEN_BUDGET,
      );
    }
  } else {
    // Gather context from files matching intent scope
    context = await readFilesMatchingGlobs(repoRoot, intent.frontmatter.scope, CONTEXT_TOKEN_BUDGET);
  }

  // Also include files in the diff
  const diffContext: Record<string, string> = {};
  for (const file of diff.files) {
    const hunks = diff.hunks[file];
    if (hunks && hunks.length > 0) {
      diffContext[file] = hunks.join('\n');
    }
  }

  const allContext = { ...context.snippets, ...diffContext };
  const estimatedTokens =
    Math.min(context.estimatedTokens, CONTEXT_PROMPT_CHAR_LIMIT / 4) +
    Math.min(diffText.length, DIFF_PROMPT_CHAR_LIMIT) / 4;

  const model = opts.model ?? routeModel(Math.ceil(estimatedTokens));
  const client = new LlmClient({ apiKey, model });

  const userPrompt = buildSemanticPrompt({
    intentId: intent.frontmatter.id,
    intentTitle: intent.frontmatter.title,
    rule: intent.frontmatter.rule,
    diffText,
    codeContext: allContext,
  });

  const startMs = Date.now();
  let callResult: CallResult;

  try {
    callResult = await client.callWithSchema({
      intentId: intent.frontmatter.id,
      systemPrompt: CONFORMANCE_SYSTEM_PROMPT_V2,
      userPrompt,
      schema: SemanticVerdictResponseSchema,
      maxTokens: VERDICT_MAX_OUTPUT_TOKENS,
      model,
    });
  } catch (err) {
    await logLlmCall(repoRoot, {
      timestamp: new Date().toISOString(),
      intentId: intent.frontmatter.id,
      model,
      promptHash: opts.cacheKey,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - startMs,
      status: 'error',
      engine: 'semantic',
    });

    return {
      intentId: intent.frontmatter.id,
      status: 'uncertain',
      confidence: 0,
      evidence: [],
      suggestion: `LLM call failed: ${String(err)}`,
      checkedAtCommit,
      engine: 'semantic',
    };
  }

  const latencyMs = Date.now() - startMs;
  const { result, usage } = callResult;

  await logLlmCall(repoRoot, {
    timestamp: new Date().toISOString(),
    intentId: intent.frontmatter.id,
    model: callResult.model,
    promptHash: opts.cacheKey,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs,
    status: result.status,
    engine: 'semantic',
  });

  const hasEvidence = result.evidence.length > 0;
  const status = result.status === 'violation' && !hasEvidence ? 'uncertain' : result.status;
  const suggestion =
    status === result.status
      ? (result.suggestion ?? undefined)
      : 'Model reported a violation without evidence - downgraded to uncertain';

  return {
    intentId: intent.frontmatter.id,
    status,
    confidence: status === result.status ? result.confidence : Math.min(result.confidence, 0.5),
    evidence: result.evidence,
    suggestion,
    checkedAtCommit,
    engine: 'semantic',
  };
}
