import { z } from 'zod';

export const IntentAnchorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('symbol'), value: z.string().min(1) }),
  z.object({ type: z.literal('path'), value: z.string().min(1) }),
]);

export type IntentAnchor = z.infer<typeof IntentAnchorSchema>;

export const DeterministicRuleSchema = z.object({
  kind: z.enum(['no-import']),
  from: z.array(z.string().min(1)),
  to: z.array(z.string().min(1)),
});

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
});

export type IntentFrontmatter = z.infer<typeof IntentFrontmatterSchema>;

/** Parsed intent — frontmatter + body markdown + source path */
export interface Intent {
  frontmatter: IntentFrontmatter;
  body: string;
  filePath: string;
}

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
});

export type Verdict = z.infer<typeof VerdictSchema>;
