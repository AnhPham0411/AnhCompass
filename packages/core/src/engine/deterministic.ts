import micromatch from 'micromatch';
import type { Intent, Verdict } from '../intent/schema.js';
import type { ParsedDiff, GraphProvider } from '@anhcompass/graph';

export interface DeterministicResult {
  verdict: Verdict;
}

export async function runDeterministicCheck(
  intent: Intent,
  diff: ParsedDiff,
  checkedAtCommit: string,
  provider?: GraphProvider,
  repoRoot?: string
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

  const evidence: Verdict['evidence'] = [];

  if (provider?.name === 'ts-graph' && provider.getQueryEngine) {
    const query = await provider.getQueryEngine();

    if (rule.kind === 'no-import') {
      const fromPatterns = rule.from || ['**/*'];
      const toPatterns = rule.to || [];
      
      const fromNodes = micromatch(query.data.nodes, fromPatterns);
      const toNodes = micromatch(query.data.nodes, toPatterns);

      for (const from of fromNodes) {
        for (const to of toNodes) {
           const paths = query.paths(from, to, 10);
           for (const path of paths) {
             const intersectsDiff = path.some(p => diff.files.includes(p));
             if (intersectsDiff) {
               evidence.push({
                 file: path[0],
                 excerpt: path.join(' -> '),
                 reason: `Path exists from ${from} to forbidden ${to}`,
               });
             }
           }
        }
      }
    } else if (rule.kind === 'no-cycle') {
      const scopePatterns = rule.from || ['**/*'];
      const scopeNodes = micromatch(query.data.nodes, scopePatterns);
      const cycles = query.cycles(scopeNodes);

      for (const cycle of cycles) {
        const intersectsDiff = cycle.some(p => diff.files.includes(p));
        if (intersectsDiff) {
          evidence.push({
            file: cycle[0],
            excerpt: cycle.join(' -> '),
            reason: `Dependency cycle detected`,
          });
        }
      }
    } else if (rule.kind === 'layer-boundary') {
      const layers = rule.layers || {};
      const layerNodes: Record<string, string[]> = {};
      for (const [layerName, patterns] of Object.entries(layers)) {
        layerNodes[layerName] = micromatch(query.data.nodes, patterns);
      }
      
      const allows = rule.allow || [];
      
      for (const [fromLayer, fNodes] of Object.entries(layerNodes)) {
        for (const [toLayer, tNodes] of Object.entries(layerNodes)) {
          if (fromLayer === toLayer) continue;
          
          const isAllowed = allows.includes(`${fromLayer} -> ${toLayer}`);
          if (!isAllowed) {
            for (const from of fNodes) {
              for (const to of tNodes) {
                const paths = query.paths(from, to, 1);
                for (const path of paths) {
                  const intersectsDiff = path.some(p => diff.files.includes(p));
                  if (intersectsDiff) {
                    evidence.push({
                      file: path[0],
                      excerpt: path.join(' -> '),
                      reason: `Layer boundary violation: ${fromLayer} cannot import ${toLayer}`,
                    });
                  }
                }
              }
            }
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
          evidence: evidence.slice(0, 10),
          suggestion: `Fix graph violations for ${rule.kind}`,
          checkedAtCommit,
          engine: 'deterministic',
        },
      };
    }
  } else {
    if (rule.kind === 'no-import' && rule.from && 'to' in rule && rule.to) {
      const fromFiles = micromatch(diff.files, rule.from);
      for (const file of fromFiles) {
        const hunks = diff.hunks[file] ?? [];
        const addedLines = hunks.filter((l) => l.startsWith('+'));
        for (const forbidden of (rule as any).to) {
          const importPattern = buildImportPattern(forbidden);
          for (let i = 0; i < addedLines.length; i++) {
            const line = addedLines[i]!;
            if (importPattern.test(line)) {
              const inlineMatch = line.match(/anhcompass-disable-line(?:\s+(\S+))?/);
              if (inlineMatch) {
                const target = inlineMatch[1];
                if (!target || target === intentId) continue;
              }

              if (i > 0) {
                const prevLine = addedLines[i - 1]!;
                const nextLineMatch = prevLine.match(/anhcompass-disable-next-line(?:\s+(\S+))?/);
                if (nextLineMatch) {
                  const target = nextLineMatch[1];
                  if (!target || target === intentId) continue;
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
    }
    
    if (evidence.length > 0) {
      return {
        verdict: {
          intentId,
          status: 'violation',
          confidence: 0.95,
          evidence,
          suggestion: `Remove direct imports of ${(rule as any).to?.join(', ')}`,
          checkedAtCommit,
          engine: 'deterministic',
        },
      };
    }
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

function buildImportPattern(forbidden: string): RegExp {
  const esc = escapeRegex(forbidden);
  const js = `(?:import|require)\\s*\\(?\\s*(?:[^'"]*from\\s*)?['"]${esc}(?:\\/[^'"]*)?['"]`;
  const py = `^\\+\\s*(?:import\\s+${esc}\\b|from\\s+${esc}(?:\\.[\\w.]+)?\\s+import\\b)`;
  return new RegExp(`${js}|${py}`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
