import { z } from 'zod';

export const IntentAnchorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('symbol'), value: z.string().min(1) }),
  z.object({ type: z.literal('path'), value: z.string().min(1) }),
]);

export type IntentAnchor = z.infer<typeof IntentAnchorSchema>;

export const DeterministicRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('no-import'),
    from: z.array(z.string().min(1)),
    to: z.array(z.string().min(1)),
  }),
  z.object({
    kind: z.literal('no-cycle'),
    from: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    kind: z.literal('layer-boundary'),
    layers: z.record(z.array(z.string().min(1))),
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
]);

export type DeterministicRule = z.infer<typeof DeterministicRuleSchema>;

export const IntentFrontmatterSchema = z.object({
  schema_version: z.literal(1),
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'id must be kebab-case'),
  title: z.string().min(1),
  scope: z.array(z.string().min(1)).min(1),
  anchors: z.array(IntentAnchorSchema).optional().default([]),
  check: z.enum(['deterministic', 'semantic', 'both']),
  rule: z.string().min(1),
  deterministic: DeterministicRuleSchema.optional(),
  severity: z.enum(['warn', 'error']).default('warn'),
  status: z.enum(['proposed', 'active', 'deprecated']).default('proposed'),
  owner: z.string().optional(),
  created: z.preprocess(
    (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'created must be YYYY-MM-DD'),
  ),
  verified_at_commit: z.string().optional(),
  supersedes: z.array(z.string()).optional(),
  conflicts_with: z.array(z.string()).optional(),
  review_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'review_after must be YYYY-MM-DD').optional(),
  exceptions: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
      expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expires must be YYYY-MM-DD'),
      approved_by: z.string()
    })
  ).optional(),
});

export type IntentFrontmatter = z.infer<typeof IntentFrontmatterSchema>;

/** Parsed intent - frontmatter + body markdown + source path */
export interface Intent {
  frontmatter: IntentFrontmatter;
  body: string;
  filePath: string;
}

/** How a violation should be enforced in CI.
 *  `block` - fail the pipeline. Only deterministic evidence can block.
 *  `warn`  - surface but never fail. All LLM (semantic) verdicts are warn-only. */
export const EnforcementSchema = z.enum(['block', 'warn']);
export type Enforcement = z.infer<typeof EnforcementSchema>;

export const VerdictSchema = z.object({
  intentId: z.string(),
  status: z.enum(['pass', 'violation', 'uncertain', 'stale-intent']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      excerpt: z.string().max(300),
      reason: z.string(),
    }),
  ),
  suggestion: z.string().optional(),
  checkedAtCommit: z.string(),
  engine: z.enum(['deterministic', 'semantic']),
  /** Set on violations only. Resolved by the pipeline - see resolveEnforcement. */
  enforcement: EnforcementSchema.optional(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

