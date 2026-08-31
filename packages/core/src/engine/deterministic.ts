import micromatch from 'micromatch';
import type { Intent, Verdict, DeterministicRule } from '../intent/schema.js';
import type { ParsedDiff, GraphProvider } from '@anhcompass/graph';
import { scanSource, languageForPath, specifierMatchesPackage } from './scanner.js';

export interface DeterministicResult {
  verdict: Verdict;
}

type NoImportRule = Extract<DeterministicRule, { kind: 'no-import' }>;

/** How far a layer violation may hide behind unlayered helper modules.
 *  Bounded because the underlying search enumerates paths; it also returns
 *  only the shortest few, so a violation reachable *only* by a long detour
 *  past a layered file can still be missed. */
const LAYER_MAX_HOPS = 6;

/** Minimal shape this module needs from the graph backend. */
interface GraphQuery {
  data: { nodes: string[] };
  paths(from: string, to: string, maxHops?: number): string[][];
  cycles(nodes?: string[]): string[][];
}

interface LexicalHit {
  file: string;
  pkg: string;
  evidence: Verdict['evidence'][number];
}

/** Runs both deterministic engines and unions their findings.
 *
 *  The lexical pass always runs; the graph pass only adds to it. Making them
 *  additive rather than exclusive keeps the guarantee monotonic — attaching a
 *  graph backend can only surface more violations, never hide one. They see
 *  different things: the lexical pass reads the diff in any supported language
 *  and finds direct dependencies; the graph pass reads the whole repository and
 *  finds transitive and structural ones, but only indexes TypeScript/JavaScript.
 */
export async function runDeterministicCheck(
  intent: Intent,
  diff: ParsedDiff,
  checkedAtCommit: string,
  provider?: GraphProvider,
  repoRoot?: string,
): Promise<DeterministicResult> {
  const rule = intent.frontmatter.deterministic;
  const intentId = intent.frontmatter.id;

  if (!rule) {
    return { verdict: passVerdict(intentId, checkedAtCommit) };
  }

  const evidence: Verdict['evidence'] = [];
  /** `file::package` edges already reported, or explicitly waived, by the
   *  lexical pass — the graph pass must agree with both. */
  const reportedEdges = new Set<string>();
  const waivedEdges = new Set<string>();

  if (rule.kind === 'no-import') {
    const { hits, waived } = scanDiffForImports(intent, rule, diff);
    for (const hit of hits) {
      reportedEdges.add(`${hit.file}::${hit.pkg}`);
      evidence.push(hit.evidence);
    }
    for (const edge of waived) waivedEdges.add(edge);
  }

  const query = await openQuery(provider, repoRoot);

  if (query) {
    evidence.push(...graphEvidence(rule, diff, query, reportedEdges, waivedEdges));
  } else if (rule.kind !== 'no-import') {
    // Only the graph engine can evaluate this rule. Reporting `pass` would
    // claim the rule was checked when nothing checked it.
    return {
      verdict: {
        intentId,
        status: 'uncertain',
        confidence: 0,
        evidence: [],
        suggestion: `Rule kind "${rule.kind}" requires the graph engine, which is unavailable for this repository`,
        checkedAtCommit,
        engine: 'deterministic',
      },
    };
  }

  if (evidence.length > 0) {
    return {
      verdict: {
        intentId,
        status: 'violation',
        confidence: 0.95,
        evidence: evidence.slice(0, 20),
        suggestion: suggestionFor(rule),
        checkedAtCommit,
        engine: 'deterministic',
      },
    };
  }

  return { verdict: passVerdict(intentId, checkedAtCommit) };
}

function passVerdict(intentId: string, checkedAtCommit: string): Verdict {
  return {
    intentId,
    status: 'pass',
    confidence: 1,
    evidence: [],
    checkedAtCommit,
    engine: 'deterministic',
  };
}

function suggestionFor(rule: DeterministicRule): string {
  switch (rule.kind) {
    case 'no-import':
      return `Remove direct imports of ${rule.to.join(', ')}`;
    case 'no-cycle':
      return 'Break the dependency cycle by extracting the shared code';
    case 'layer-boundary':
      return 'Route the dependency through an allowed layer';
  }
}

async function openQuery(
  provider?: GraphProvider,
  repoRoot?: string,
): Promise<GraphQuery | null> {
  if (!provider?.getQueryEngine) return null;
  try {
    // binds the provider to the repo before it indexes
    if (repoRoot) await provider.available(repoRoot);
    return (await provider.getQueryEngine()) as GraphQuery;
  } catch {
    return null; // an unusable index must not mask the lexical result
  }
}

/** Direct dependencies added by the diff, in any language the scanner reads.
 *  Waived edges are returned too: a suppression comment has to hold whether or
 *  not a graph backend happens to be available. */
function scanDiffForImports(
  intent: Intent,
  rule: NoImportRule,
  diff: ParsedDiff,
): { hits: LexicalHit[]; waived: string[] } {
  const hits: LexicalHit[] = [];
  const waived: string[] = [];

  for (const file of micromatch(diff.files, rule.from)) {
    // Files we cannot parse (markdown, JSON manifests) hold text that may
    // look like an import but never creates a dependency.
    const language = languageForPath(file);
    if (!language) continue;

    const addedLines = (diff.hunks[file] ?? []).filter((l) => l.startsWith('+'));
    const source = addedLines.map((l) => l.slice(1)).join('\n');
    const { imports, comments } = scanSource(source, language);

    for (const imported of imports) {
      for (const forbidden of rule.to) {
        if (!specifierMatchesPackage(imported.specifier, forbidden, language)) continue;
        if (isSuppressed(comments, imported.line, intent.frontmatter.id)) {
          waived.push(`${file}::${forbidden}`);
          continue;
        }

        hits.push({
          file,
          pkg: forbidden,
          evidence: {
            file,
            excerpt: (addedLines[imported.line - 1] ?? imported.specifier).slice(0, 300),
            reason: `File matching "${rule.from}" imports forbidden "${forbidden}"`,
          },
        });
      }
    }
  }

  return { hits, waived };
}

/** Findings that need the whole-repository graph rather than the diff alone. */
function graphEvidence(
  rule: DeterministicRule,
  diff: ParsedDiff,
  query: GraphQuery,
  reportedEdges: Set<string>,
  waivedEdges: Set<string>,
): Verdict['evidence'] {
  const evidence: Verdict['evidence'] = [];

  if (rule.kind === 'no-import') {
    const fromNodes = micromatch(query.data.nodes, rule.from);
    const toNodes = micromatch(query.data.nodes, rule.to);

    for (const from of fromNodes) {
      for (const to of toNodes) {
        for (const path of query.paths(from, to, 10)) {
          if (!path.some((node) => diff.files.includes(node))) continue;

          // The edge that actually reaches the forbidden package. For a direct
          // path this is the importing file itself.
          const finalHop = `${path[path.length - 2]}::${to}`;
          if (waivedEdges.has(finalHop)) continue; // suppression comment
          const isDirect = path.length <= 2;
          if (isDirect && reportedEdges.has(finalHop)) continue; // already reported lexically

          evidence.push({
            file: path[0]!,
            excerpt: path.join(' -> '),
            reason: isDirect
              ? `Path exists from ${path[0]} to forbidden ${to}`
              : `Transitive path reaches forbidden "${to}" in ${path.length - 1} hop(s)`,
          });
        }
      }
    }
    return evidence;
  }

  if (rule.kind === 'no-cycle') {
    const scopeNodes = micromatch(query.data.nodes, rule.from ?? ['**/*']);
    for (const cycle of query.cycles(scopeNodes)) {
      if (!cycle.some((node) => diff.files.includes(node))) continue;
      evidence.push({
        file: cycle[0]!,
        excerpt: cycle.join(' -> '),
        reason: 'Dependency cycle detected',
      });
    }
    return evidence;
  }

  const layerNodes: Record<string, string[]> = {};
  for (const [layerName, patterns] of Object.entries(rule.layers)) {
    layerNodes[layerName] = micromatch(query.data.nodes, patterns);
  }
  // A file matching two layer globs belongs to the first one declared.
  const layerByNode = new Map<string, string>();
  for (const [layerName, nodes] of Object.entries(layerNodes)) {
    for (const node of nodes) if (!layerByNode.has(node)) layerByNode.set(node, layerName);
  }
  const allowed = new Set(rule.allow ?? []);

  for (const [fromLayer, fromNodes] of Object.entries(layerNodes)) {
    for (const [toLayer, toNodes] of Object.entries(layerNodes)) {
      if (fromLayer === toLayer) continue;
      if (allowed.has(`${fromLayer} -> ${toLayer}`)) continue;

      for (const from of fromNodes) {
        for (const to of toNodes) {
          for (const path of query.paths(from, to, LAYER_MAX_HOPS)) {
            if (!path.some((node) => diff.files.includes(node))) continue;

            // Routing a forbidden dependency through an unlayered helper must
            // not launder it — that is the whole reason to look past a direct
            // edge. But a path crossing another declared layer is just the
            // composition of hops that are each judged on their own, and
            // flagging it here would fail every legal layered architecture:
            // ui -> domain -> data is exactly what the allow list describes.
            const intermediates = path.slice(1, -1);
            if (intermediates.some((node) => layerByNode.has(node))) continue;

            const hops = intermediates.length;
            evidence.push({
              file: path[0]!,
              excerpt: path.join(' -> '),
              reason:
                hops === 0
                  ? `Layer boundary violation: ${fromLayer} cannot import ${toLayer}`
                  : `Layer boundary violation: ${fromLayer} reaches ${toLayer} through ${hops} unlayered module(s)`,
            });
          }
        }
      }
    }
  }

  return evidence;
}

/** A suppression directive on the statement's own line, or on the line above. */
function isSuppressed(comments: Map<number, string>, line: number, intentId: string): boolean {
  const own = comments.get(line);
  if (own && directiveApplies(own, 'anhcompass-disable-line', intentId)) return true;
  const above = comments.get(line - 1);
  if (above && directiveApplies(above, 'anhcompass-disable-next-line', intentId)) return true;
  return false;
}

/** A bare directive suppresses every intent; a named one only its own. */
function directiveApplies(commentText: string, directive: string, intentId: string): boolean {
  const match = commentText.match(new RegExp(`${directive}(?:\\s+(\\S+))?`));
  if (!match) return false;
  const target = match[1];
  return !target || target === intentId;
}
