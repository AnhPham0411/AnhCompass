import micromatch from 'micromatch';
import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

export interface DeterministicResult {
  verdict: Verdict;
}

/** Run deterministic (import pattern) check against diff files.
 *  In Phase 1 we do a simple glob-based import scan.
 *  Phase 2 will use dependency-cruiser compiled config. */
export async function runDeterministicCheck(
  intent: Intent,
  diff: ParsedDiff,
  checkedAtCommit: string,
): Promise<DeterministicResult> {
  const rule = intent.frontmatter.deterministic;
  if (!rule) {
    // No deterministic rule — treat as pass
    return {
      verdict: {
        intentId: intent.frontmatter.id,
        status: 'pass',
        confidence: 1,
        evidence: [],
        checkedAtCommit,
        engine: 'deterministic',
      },
    };
  }

  // Files in diff that match "from" pattern
  const fromFiles = micromatch(diff.files, rule.from);

  const evidence: Verdict['evidence'] = [];

  // For each "from" file in the diff, check if it imports forbidden "to" patterns
  for (const file of fromFiles) {
    const hunks = diff.hunks[file] ?? [];
    const addedLines = hunks.filter((l) => l.startsWith('+')).join('\n');

    for (const forbidden of rule.to) {
      // Simple regex check: does any added line import the forbidden module?
      const importPattern = new RegExp(
        `(?:import|require)\\s*(?:[^'"]*from\\s*)?['"]${escapeRegex(forbidden)}['"]`,
      );
      const matchLine = addedLines.split('\n').find((l) => importPattern.test(l));

      if (matchLine) {
        evidence.push({
          file,
          excerpt: matchLine.slice(0, 300),
          reason: `File matching "${rule.from}" imports forbidden "${forbidden}"`,
        });
      }
    }
  }

  if (evidence.length > 0) {
    return {
      verdict: {
        intentId: intent.frontmatter.id,
        status: 'violation',
        confidence: 0.95,
        evidence,
        suggestion: `Remove direct imports of ${rule.to.join(', ')} from ${rule.from.join(', ')}`,
        checkedAtCommit,
        engine: 'deterministic',
      },
    };
  }

  return {
    verdict: {
      intentId: intent.frontmatter.id,
      status: 'pass',
      confidence: 1,
      evidence: [],
      checkedAtCommit,
      engine: 'deterministic',
    },
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
