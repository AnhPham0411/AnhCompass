import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';
import { readFilesMatchingGlobs } from '@anhcompass/graph';
import {
  LlmClient,
  CONFORMANCE_SYSTEM_PROMPT_V1,
  buildSemanticPrompt,
  routeModel,
  VERDICT_MAX_OUTPUT_TOKENS,
  logLlmCall,
} from '@anhcompass/llm';
import { z } from 'zod';

const SemanticVerdictResponseSchema = z.object({
  status: z.enum(['pass', 'violation', 'uncertain']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      excerpt: z.string().max(300),
      reason: z.string(),
    }),
  ),
  suggestion: z.string().nullable().optional(),
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
}

export async function runSemanticCheck(opts: SemanticCheckOpts): Promise<Verdict> {
  const { intent, diff, diffText, repoRoot, apiKey, checkedAtCommit } = opts;

  // Gather context from files matching intent scope
  const context = await readFilesMatchingGlobs(repoRoot, intent.frontmatter.scope, 6000);

  // Also include files in the diff
  const diffContext: Record<string, string> = {};
  for (const file of diff.files) {
    const hunks = diff.hunks[file];
    if (hunks && hunks.length > 0) {
      diffContext[file] = hunks.join('\n');
    }
  }

  const allContext = { ...context.snippets, ...diffContext };
  const estimatedTokens = context.estimatedTokens + diffText.length / 4;

  const model = routeModel(Math.ceil(estimatedTokens));
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
      systemPrompt: CONFORMANCE_SYSTEM_PROMPT_V1,
      userPrompt,
      schema: SemanticVerdictResponseSchema,
      maxTokens: VERDICT_MAX_OUTPUT_TOKENS,
      model,
    });
  } catch (err) {
    // LLM call failed — return uncertain
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
    model,
    promptHash: opts.cacheKey,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs,
    status: result.status,
    engine: 'semantic',
  });

  return {
    intentId: intent.frontmatter.id,
    status: result.status,
    confidence: result.confidence,
    evidence: result.evidence,
    suggestion: result.suggestion ?? undefined,
    checkedAtCommit,
    engine: 'semantic',
  };
}
