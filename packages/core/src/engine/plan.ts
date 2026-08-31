import { z } from 'zod';
import {
  LlmClient,
  PLAN_REVIEW_SYSTEM_PROMPT_V1,
  buildPlanPrompt,
  routeModel,
  VERDICT_MAX_OUTPUT_TOKENS,
} from '@anhcompass/llm';
import type { Intent } from '../intent/schema.js';

export const PlanFindingSchema = z.object({
  intentId: z.string(),
  status: z.enum(['ok', 'at-risk', 'uncertain']),
  quote: z.string().nullish(),
  reason: z.string(),
});

export const PlanReviewResponseSchema = z.object({
  findings: z.array(PlanFindingSchema),
});

export type PlanFinding = z.infer<typeof PlanFindingSchema>;

export interface PlanCheckOpts {
  intents: Intent[];
  planText: string;
  apiKey?: string;
  model?: string;
}

export interface PlanCheckResult {
  findings: PlanFinding[];
  /** Rules that were considered, in the order they were sent */
  checkedIntentIds: string[];
}

/** Review a plan against the active intents before any code is written.
 *
 *  This is the cheap end of the loop: catching a boundary breach while it is
 *  still a sentence costs one call, catching it after the code exists costs a
 *  review cycle. Findings are advisory by construction — a plan cannot violate
 *  anything yet, so nothing here blocks. */
export async function checkPlan(opts: PlanCheckOpts): Promise<PlanCheckResult> {
  const active = opts.intents.filter((i) => i.frontmatter.status === 'active');
  const checkedIntentIds = active.map((i) => i.frontmatter.id);

  if (active.length === 0) {
    return { findings: [], checkedIntentIds };
  }

  if (!opts.apiKey) {
    // A plan is prose and the rules are prose; without a model there is nothing
    // to compare them with. Saying so beats returning a confident "ok".
    return {
      findings: active.map((i) => ({
        intentId: i.frontmatter.id,
        status: 'uncertain' as const,
        quote: null,
        reason: 'No LLM API key available, so the plan could not be reviewed against this rule.',
      })),
      checkedIntentIds,
    };
  }

  const userPrompt = buildPlanPrompt({
    planText: opts.planText,
    intents: active.map((i) => ({
      id: i.frontmatter.id,
      title: i.frontmatter.title,
      rule: i.frontmatter.rule,
      scope: i.frontmatter.scope,
    })),
  });

  const model = opts.model ?? routeModel(Math.ceil(userPrompt.length / 4));
  const client = new LlmClient({ apiKey: opts.apiKey, model });

  let findings: PlanFinding[];
  try {
    const { result } = await client.callWithSchema({
      intentId: 'plan-review',
      systemPrompt: PLAN_REVIEW_SYSTEM_PROMPT_V1,
      userPrompt,
      schema: PlanReviewResponseSchema,
      maxTokens: VERDICT_MAX_OUTPUT_TOKENS,
      model,
    });
    findings = result.findings;
  } catch (err) {
    return {
      findings: active.map((i) => ({
        intentId: i.frontmatter.id,
        status: 'uncertain' as const,
        quote: null,
        reason: `Plan review failed: ${String(err)}`,
      })),
      checkedIntentIds,
    };
  }

  // The model may drop or invent ids; report against the rules we actually sent
  const byId = new Map(findings.map((f) => [f.intentId, f]));
  return {
    findings: checkedIntentIds.map(
      (id) =>
        byId.get(id) ?? {
          intentId: id,
          status: 'uncertain' as const,
          quote: null,
          reason: 'The review returned no finding for this rule.',
        },
    ),
    checkedIntentIds,
  };
}

/** Plain-text rendering of a plan review. */
export function renderPlanReview(result: PlanCheckResult): string {
  if (result.checkedIntentIds.length === 0) {
    return 'No active intents to review this plan against.';
  }

  const lines: string[] = [];
  const atRisk = result.findings.filter((f) => f.status === 'at-risk');

  for (const f of result.findings) {
    lines.push(`${f.status.toUpperCase()} ${f.intentId}`);
    if (f.quote) lines.push(`  plan says: "${f.quote}"`);
    lines.push(`  ${f.reason}`);
  }

  lines.push('');
  lines.push(
    `Reviewed ${result.checkedIntentIds.length} rule(s): ${atRisk.length} at risk, ` +
      `${result.findings.filter((f) => f.status === 'uncertain').length} uncertain.`,
  );
  lines.push(
    'This is a plan review, not a verdict on code — nothing here blocks. Re-run check_drift once the code exists.',
  );

  return lines.join('\n');
}
