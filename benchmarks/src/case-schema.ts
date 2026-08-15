import { z } from 'zod';
import { IntentFrontmatterSchema } from '@anhcompass/core';

/** A single benchmark case: an intent + a diff + the ground-truth verdict.
 *  `expected` is assigned by the case author from RULE SEMANTICS,
 *  never from observed engine behavior. */
export const BenchCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['correct', 'wrong', 'edge', 'ai-generated']),
  engine: z.enum(['deterministic', 'semantic']),
  expected: z.enum(['violation', 'pass']),
  intentFrontmatter: IntentFrontmatterSchema,
  intentBody: z.string().default(''),
  diff: z.string().min(1),
  notes: z.string().default(''),
});

export type BenchCase = z.infer<typeof BenchCaseSchema>;

export const BenchCaseFileSchema = z.array(BenchCaseSchema);
