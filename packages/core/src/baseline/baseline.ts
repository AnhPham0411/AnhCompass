import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { z } from 'zod';
import { VerdictSchema, type Intent, type Verdict } from '../intent/schema.js';

/** Snapshot of verdicts + intent content hashes at a point in time.
 *  Enables regression detection when intents (or code) change:
 *  edit a rule → re-run → diff against baseline → see exactly what flipped. */
export const BaselineSchema = z.object({
  schema_version: z.literal(1),
  createdAt: z.string(),
  commit: z.string(),
  intents: z.record(z.object({ contentHash: z.string() })),
  verdicts: z.record(
    z.object({
      status: VerdictSchema.shape.status,
      confidence: z.number(),
      engine: VerdictSchema.shape.engine,
      enforcement: VerdictSchema.shape.enforcement,
      evidenceCount: z.number(),
    }),
  ),
});

export type Baseline = z.infer<typeof BaselineSchema>;

export interface BaselineEntryDiff {
  intentId: string;
  from: string;
  to: string;
  /** The intent's rule content changed since the baseline was taken */
  ruleChanged: boolean;
}

export interface BaselineDiff {
  /** non-violation → violation (the dangerous direction) */
  regressions: BaselineEntryDiff[];
  /** violation → non-violation */
  improvements: BaselineEntryDiff[];
  /** any other status change (e.g. pass → uncertain) */
  otherChanges: BaselineEntryDiff[];
  /** intents whose rule text changed since baseline (regardless of verdict) */
  changedIntents: string[];
  newIntents: string[];
  removedIntents: string[];
}

export function hashIntentContent(intent: Intent): string {
  const input = JSON.stringify(intent.frontmatter) + '|||' + intent.body;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export function buildBaseline(
  intents: Intent[],
  verdicts: Verdict[],
  commit: string,
  createdAt: string,
): Baseline {
  const intentMap: Baseline['intents'] = {};
  for (const intent of intents) {
    intentMap[intent.frontmatter.id] = { contentHash: hashIntentContent(intent) };
  }

  const verdictMap: Baseline['verdicts'] = {};
  for (const v of verdicts) {
    verdictMap[v.intentId] = {
      status: v.status,
      confidence: v.confidence,
      engine: v.engine,
      enforcement: v.enforcement,
      evidenceCount: v.evidence.length,
    };
  }

  return { schema_version: 1, createdAt, commit, intents: intentMap, verdicts: verdictMap };
}

export async function saveBaseline(path: string, baseline: Baseline): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(baseline, null, 2), 'utf-8');
}

/** Returns null when the file is missing or fails validation. */
export async function loadBaseline(path: string): Promise<Baseline | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = BaselineSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function compareBaseline(
  baseline: Baseline,
  intents: Intent[],
  verdicts: Verdict[],
): BaselineDiff {
  const diff: BaselineDiff = {
    regressions: [],
    improvements: [],
    otherChanges: [],
    changedIntents: [],
    newIntents: [],
    removedIntents: [],
  };

  const currentIds = new Set(intents.map((i) => i.frontmatter.id));
  for (const intent of intents) {
    const id = intent.frontmatter.id;
    const base = baseline.intents[id];
    if (!base) {
      diff.newIntents.push(id);
    } else if (base.contentHash !== hashIntentContent(intent)) {
      diff.changedIntents.push(id);
    }
  }
  for (const id of Object.keys(baseline.intents)) {
    if (!currentIds.has(id)) diff.removedIntents.push(id);
  }

  const ruleChangedSet = new Set(diff.changedIntents);
  for (const v of verdicts) {
    const base = baseline.verdicts[v.intentId];
    if (!base) {
      // no baseline verdict (intent newly in scope) — a violation appearing
      // out of nowhere is still a regression for gating purposes
      if (v.status === 'violation') {
        diff.regressions.push({
          intentId: v.intentId,
          from: '(not in baseline)',
          to: v.status,
          ruleChanged: ruleChangedSet.has(v.intentId),
        });
      }
      continue;
    }
    if (base.status === v.status) continue;

    const entry: BaselineEntryDiff = {
      intentId: v.intentId,
      from: base.status,
      to: v.status,
      ruleChanged: ruleChangedSet.has(v.intentId),
    };
    if (v.status === 'violation') diff.regressions.push(entry);
    else if (base.status === 'violation') diff.improvements.push(entry);
    else diff.otherChanges.push(entry);
  }

  return diff;
}
