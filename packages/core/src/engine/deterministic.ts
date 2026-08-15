import micromatch from 'micromatch';
import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

export interface DeterministicResult {
  verdict: Verdict;
}

/** Run deterministic (import pattern) check against diff files. */
export async function runDeterministicCheck(
  intent: Intent,
  diff: ParsedDiff,
  checkedAtCommit: string,
): Promise<DeterministicResult> {
  const rule = intent.frontmatter.deterministic;
  const intentId = intent.frontmatter.id;

  if (!rule) {
    return {
      verdict: {
        intentId,
        status: 'pass',
        confidence: 1,
        evidence: [],
        checkedAtCommit,
        engine: 'deterministic',
      },
    };
  }

  const fromFiles = micromatch(diff.files, rule.from);
  const evidence: Verdict['evidence'] = [];

  for (const file of fromFiles) {
    const hunks = diff.hunks[file] ?? [];
    const addedLines = hunks.filter((l) => l.startsWith('+'));

    for (const forbidden of rule.to) {
      const importPattern = buildImportPattern(forbidden);

      for (let i = 0; i < addedLines.length; i++) {
        const line = addedLines[i]!;
        if (importPattern.test(line)) {
          // Check inline comment: e.g. // anhcompass-disable-line [intentId]
          const inlineMatch = line.match(/anhcompass-disable-line(?:\s+(\S+))?/);
          if (inlineMatch) {
            const target = inlineMatch[1];
            if (!target || target === intentId) {
              continue; // skipped via inline comment
            }
          }

          // Check if previous line in diff has next-line comment
          if (i > 0) {
            const prevLine = addedLines[i - 1]!;
            const nextLineMatch = prevLine.match(/anhcompass-disable-next-line(?:\s+(\S+))?/);
            if (nextLineMatch) {
              const target = nextLineMatch[1];
              if (!target || target === intentId) {
                continue; // skipped via next-line comment
              }
            }
          }

          evidence.push({
            file,
            excerpt: line.slice(0, 300),
            reason: `File matching "${rule.from}" imports forbidden "${forbidden}"`,
          });
        }
      }
    }
  }

  if (evidence.length > 0) {
    return {
      verdict: {
        intentId,
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
      intentId,
      status: 'pass',
      confidence: 1,
      evidence: [],
      checkedAtCommit,
      engine: 'deterministic',
    },
  };
}

/** Match an import of `forbidden` in JS/TS or Python syntax.
 *  Lines carry the leading '+' diff marker. */
function buildImportPattern(forbidden: string): RegExp {
  const esc = escapeRegex(forbidden);
  // JS/TS: import x from 'pkg' | import 'pkg' | require('pkg') | import('pkg/sub')
  const js = `(?:import|require)\\s*\\(?\\s*(?:[^'"]*from\\s*)?['"]${esc}(?:\\/[^'"]*)?['"]`;
  // Python: import pkg [as x] | from pkg[.sub] import y
  const py = `^\\+\\s*(?:import\\s+${esc}\\b|from\\s+${esc}(?:\\.[\\w.]+)?\\s+import\\b)`;
  return new RegExp(`${js}|${py}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
