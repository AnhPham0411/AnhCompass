import { z } from 'zod';
import { IntentFrontmatterSchema } from '@anhcompass/core';

/** A single benchmark case: an intent + a diff + the ground-truth verdict.
 *  `expected` is assigned by the case author from RULE SEMANTICS,
 *  never from observed engine behavior. */
export const BenchCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['correct', 'wrong', 'edge', 'ai-generated']),
  /** `graph` cases need a real file tree and only run once the graph engine
   *  lands (Phase 1) — they are skipped, not failed, until then. */
  engine: z.enum(['deterministic', 'semantic', 'graph']),
  expected: z.enum(['violation', 'pass']),
  intentFrontmatter: IntentFrontmatterSchema,
  intentBody: z.string().default(''),
  diff: z.string().min(1),
  /** Repo files materialized into a temp root before the case runs, as
   *  `relative/path.ts` → file content. Required for `graph`, optional for
   *  `semantic` (without it the model only ever sees the diff). */
  fixture: z.record(z.string(), z.string()).optional(),
  notes: z.string().default(''),
});

export type BenchCase = z.infer<typeof BenchCaseSchema>;

export const BenchCaseFileSchema = z.array(BenchCaseSchema);
