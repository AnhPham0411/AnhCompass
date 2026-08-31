/** AnhCompass benchmark runner.
 *
 *  Usage:
 *    pnpm bench                 # deterministic cases only (free, offline)
 *    pnpm bench -- --semantic   # also run semantic cases (needs an LLM API key)
 *    pnpm bench -- --graph      # also run graph cases (needs the graph engine, Phase 1)
 *    pnpm bench -- --only <id>  # run a single case by id
 *
 *  Outputs a console summary and writes results/report.{json,md}.
 */
import { readdir, readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDiff,
  runDeterministicCheck,
  runSemanticCheck,
  type Intent,
  type Verdict,
} from '@anhcompass/core';
import { TsGraphProvider } from '@anhcompass/graph'; import { resolveLlmApiKey } from '@anhcompass/llm';
import { BenchCaseFileSchema, type BenchCase } from './case-schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, '..', 'cases');
const RESULTS_DIR = join(HERE, '..', 'results');
const SEMANTIC_CONCURRENCY = 4;

interface CaseResult {
  case: BenchCase;
  verdict: Verdict;
  latencyMs: number;
  outcome: 'TP' | 'TN' | 'FP' | 'FN';
  uncertain: boolean;
  /** Set when the case was re-run under a non-default engine configuration */
  variant?: string;
  /** False for arms that exist only as a comparison baseline: they are
   *  measured and reported, but a known-worse baseline losing is the expected
   *  result, not a broken build. */
  gating?: boolean;
}

interface EngineMetrics {
  total: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  uncertain: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  latency: { mean: number; p50: number; p95: number };
}

async function loadCases(): Promise<BenchCase[]> {
  let entries: string[];
  try {
    entries = await readdir(CASES_DIR, { recursive: true });
  } catch {
    console.error(`No cases directory at ${CASES_DIR}`);
    process.exit(1);
  }

  const cases: BenchCase[] = [];
  const seen = new Set<string>();
  for (const entry of entries.filter((e) => e.endsWith('.json'))) {
    const raw = JSON.parse(await readFile(join(CASES_DIR, entry), 'utf-8'));
    const parsed = BenchCaseFileSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`Invalid case file ${entry}:\n${parsed.error.message}`);
      process.exit(1);
    }
    for (const c of parsed.data) {
      if (seen.has(c.id)) {
        console.error(`Duplicate case id: ${c.id} (in ${entry})`);
        process.exit(1);
      }
      seen.add(c.id);
      cases.push(c);
    }
  }
  return cases;
}

function toIntent(c: BenchCase): Intent {
  return { frontmatter: c.intentFrontmatter, body: c.intentBody, filePath: `bench:${c.id}` };
}

function classify(c: BenchCase, verdict: Verdict): { outcome: CaseResult['outcome']; uncertain: boolean } {
  const predictedViolation = verdict.status === 'violation';
  const uncertain = verdict.status === 'uncertain';
  if (c.expected === 'violation') {
    return { outcome: predictedViolation ? 'TP' : 'FN', uncertain };
  }
  return { outcome: predictedViolation ? 'FP' : 'TN', uncertain };
}

/** Every case gets its own root under a per-arm namespace. Isolation matters
 *  twice over: one case's fixture must not appear in another's retrieved
 *  context, and each arm's LLM log has to be attributable to that arm alone. */
async function materializeCaseRoot(
  benchRoot: string,
  c: BenchCase,
  namespace: string,
): Promise<string> {
  const caseRoot = join(benchRoot, namespace, c.id);
  await mkdir(caseRoot, { recursive: true });
  for (const [rel, content] of Object.entries(c.fixture ?? {})) {
    const target = join(caseRoot, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf-8');
  }
  return caseRoot;
}

interface RunOpts {
  namespace: string;
  apiKey?: string;
  model?: string;
  useGraphRetrieval?: boolean;
  variant?: string;
  gating?: boolean;
}

async function runCase(c: BenchCase, benchRoot: string, o: RunOpts): Promise<CaseResult> {
  const intent = toIntent(c);
  const diff = parseDiff(c.diff);
  const caseRoot = await materializeCaseRoot(benchRoot, c, o.namespace);
  const start = Date.now();

  let verdict: Verdict;
  if (c.engine === 'deterministic') {
    verdict = (await runDeterministicCheck(intent, diff, 'bench')).verdict;
  } else if (c.engine === 'graph') {
    verdict = (
      await runDeterministicCheck(intent, diff, 'bench', new TsGraphProvider(caseRoot), caseRoot)
    ).verdict;
  } else {
    verdict = await runSemanticCheck({
      intent,
      diff,
      diffText: c.diff,
      repoRoot: caseRoot,
      apiKey: o.apiKey!,
      checkedAtCommit: 'bench',
      cacheKey: `bench-${c.id}`,
      model: o.model,
      provider: o.useGraphRetrieval ? new TsGraphProvider(caseRoot) : undefined,
      useGraphRetrieval: o.useGraphRetrieval ?? false,
    });
  }

  const latencyMs = Date.now() - start;
  return {
    case: c,
    verdict,
    latencyMs,
    variant: o.variant,
    gating: o.gating,
    ...classify(c, verdict),
  };
}

/** Re-runs a deterministic case with a graph provider attached.
 *
 *  This is the configuration the CLI actually uses on any repository holding a
 *  package.json or tsconfig.json, so the labels must hold here too. Without
 *  this pass the corpus measures a code path real users never reach: a graph
 *  backend that indexes only TS/JS silently swallowed every Python violation,
 *  and every suppression comment, and the corpus reported 100%. */
async function runDeterministicWithProvider(c: BenchCase, benchRoot: string): Promise<CaseResult> {
  const intent = toIntent(c);
  const diff = parseDiff(c.diff);
  // isolated root — one case's fixture must not leak into another's graph
  const caseRoot = join(benchRoot, '__with_provider__', c.id);
  await mkdir(caseRoot, { recursive: true });
  for (const [rel, content] of Object.entries(c.fixture ?? {})) {
    const target = join(caseRoot, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf-8');
  }

  const start = Date.now();
  const verdict = (
    await runDeterministicCheck(intent, diff, 'bench', new TsGraphProvider(caseRoot), caseRoot)
  ).verdict;

  return {
    case: c,
    verdict,
    latencyMs: Date.now() - start,
    variant: 'with graph provider',
    ...classify(c, verdict),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const idx = next++;
        results[idx] = await fn(items[idx]!);
      }
    }),
  );
  return results;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function computeMetrics(results: CaseResult[]): EngineMetrics {
  const tp = results.filter((r) => r.outcome === 'TP').length;
  const tn = results.filter((r) => r.outcome === 'TN').length;
  const fp = results.filter((r) => r.outcome === 'FP').length;
  const fn = results.filter((r) => r.outcome === 'FN').length;
  const uncertain = results.filter((r) => r.uncertain).length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    total: results.length,
    tp,
    tn,
    fp,
    fn,
    uncertain,
    precision,
    recall,
    f1,
    accuracy: results.length === 0 ? 1 : (tp + tn) / results.length,
    latency: {
      mean: Math.round(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
  };
}

interface LlmCost {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

const PRICES_PER_MTOK: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
};

/** Sums every log under the bench root. Cases carrying a fixture run in their
 *  own root and write their own log — reading only the top-level one
 *  under-reports spend. */
async function readLlmCost(benchRoot: string): Promise<LlmCost> {
  const cost: LlmCost = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };

  let entries: string[] = [];
  try {
    entries = await readdir(benchRoot, { recursive: true });
  } catch {
    return cost;
  }

  for (const rel of entries.filter((e) => e.endsWith('llm-log.jsonl'))) {
    let raw: string;
    try {
      raw = await readFile(join(benchRoot, rel), 'utf-8');
    } catch {
      continue;
    }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const entry = JSON.parse(line) as {
        model: string;
        inputTokens: number;
        outputTokens: number;
      };
      cost.calls++;
      cost.inputTokens += entry.inputTokens;
      cost.outputTokens += entry.outputTokens;
      const price = PRICES_PER_MTOK[entry.model];
      if (price) {
        cost.usd += (entry.inputTokens * price.in + entry.outputTokens * price.out) / 1e6;
      }
    }
  }

  return cost;
}

function fmtPct(x: number): string {
  return (x * 100).toFixed(1) + '%';
}

function metricsTable(byKey: Record<string, EngineMetrics>): string {
  const lines = [
    '| Slice | Cases | TP | TN | FP | FN | Uncertain | Precision | Recall | F1 | Accuracy | Latency p50/p95 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [key, m] of Object.entries(byKey)) {
    lines.push(
      `| ${key} | ${m.total} | ${m.tp} | ${m.tn} | ${m.fp} | ${m.fn} | ${m.uncertain} | ${fmtPct(m.precision)} | ${fmtPct(m.recall)} | ${fmtPct(m.f1)} | ${fmtPct(m.accuracy)} | ${m.latency.p50}ms / ${m.latency.p95}ms |`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runSemantic = args.includes('--semantic');
  const runGraph = args.includes('--graph');
  const onlyIdx = args.indexOf('--only');
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const modelIdx = args.indexOf('--model');
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const compareRetrieval = args.includes('--compare-retrieval');

  let cases = await loadCases();
  if (onlyId) cases = cases.filter((c) => c.id === onlyId);

  const detCases = cases.filter((c) => c.engine === 'deterministic');
  let semCases = cases.filter((c) => c.engine === 'semantic');
  let graphCases = cases.filter((c) => c.engine === 'graph');
  const skippedGraph = runGraph ? 0 : graphCases.length;
  if (!runGraph) graphCases = [];

  const apiKey = resolveLlmApiKey(process.env);
  if (runSemantic && !apiKey) {
    console.error('--semantic requires an LLM API key (LLM_API_KEY / OPENAI_API_KEY / ...)');
    process.exit(1);
  }
  if (!runSemantic) semCases = [];

  console.log(
    `Loaded ${cases.length} case(s) — running ${detCases.length} deterministic, ${graphCases.length} graph, ${semCases.length} semantic`,
  );
  if (skippedGraph > 0) {
    console.log(`${skippedGraph} graph case(s) skipped — pass --graph to run them`);
  }
  console.log('');

  const semanticRoot = await mkdtemp(join(tmpdir(), 'anhcompass-bench-'));
  try {
    const detResults = await pool(detCases, 16, (c) =>
      runCase(c, semanticRoot, { namespace: 'det' }),
    );
    // The default arm mirrors the product default: graph-neighbourhood retrieval
    const semResults = await pool(semCases, SEMANTIC_CONCURRENCY, (c) =>
      runCase(c, semanticRoot, { namespace: 'sem-graph', apiKey, model, useGraphRetrieval: true }),
    );
    // Phase 2 comparison arm: the same cases retrieved by walking directories
    const semGlobResults = compareRetrieval
      ? await pool(semCases, SEMANTIC_CONCURRENCY, (c) =>
          runCase(c, semanticRoot, {
            namespace: 'sem-glob',
            apiKey,
            model,
            useGraphRetrieval: false,
            variant: 'glob-walk retrieval',
            gating: false,
          }),
        )
      : [];
    // graph cases index a real file tree per case — keep concurrency modest
    const graphResults = await pool(graphCases, 4, (c) =>
      runCase(c, semanticRoot, { namespace: 'graph' }),
    );
    // Same cases, the engine configuration the CLI actually uses
    const dualResults = await pool(detCases, 4, (c) =>
      runDeterministicWithProvider(c, semanticRoot),
    );
    const all = [
      ...detResults,
      ...semResults,
      ...semGlobResults,
      ...graphResults,
      ...dualResults,
    ];

    const slices: Record<string, EngineMetrics> = {};
    if (detResults.length > 0) slices['deterministic (all)'] = computeMetrics(detResults);
    if (dualResults.length > 0) {
      slices['deterministic + graph provider'] = computeMetrics(dualResults);
    }
    if (graphResults.length > 0) slices['graph (all)'] = computeMetrics(graphResults);
    if (semResults.length > 0) {
      slices[compareRetrieval ? 'semantic / graph retrieval (default)' : 'semantic (all)'] =
        computeMetrics(semResults);
    }
    if (semGlobResults.length > 0) {
      slices['semantic / glob-walk retrieval'] = computeMetrics(semGlobResults);
    }
    for (const engine of ['deterministic', 'graph', 'semantic'] as const) {
      for (const cat of ['correct', 'wrong', 'edge', 'ai-generated'] as const) {
        const slice = all.filter(
          (r) => !r.variant && r.case.engine === engine && r.case.category === cat,
        );
        if (slice.length > 0) slices[`${engine} / ${cat}`] = computeMetrics(slice);
      }
    }

    const failures = all.filter((r) => r.outcome === 'FP' || r.outcome === 'FN');
    const cost = await readLlmCost(semanticRoot);
    const retrievalCost = compareRetrieval
      ? {
          glob: await readLlmCost(join(semanticRoot, 'sem-glob')),
          graph: await readLlmCost(join(semanticRoot, 'sem-graph')),
        }
      : null;

    const table = metricsTable(slices);
    console.log(table);
    console.log('');
    if (cost.calls > 0) {
      console.log(
        `LLM: ${cost.calls} calls · ${cost.inputTokens} in / ${cost.outputTokens} out tokens · $${cost.usd.toFixed(4)}`,
      );
    }
    if (retrievalCost) {
      console.log('\nRetrieval comparison (same cases, same budget):');
      console.log('| Retrieval | Input tokens | Output tokens | Cost |');
      console.log('|---|---|---|---|');
      for (const [name, c] of Object.entries(retrievalCost)) {
        console.log(
          `| ${name} | ${c.inputTokens} | ${c.outputTokens} | $${c.usd.toFixed(4)} |`,
        );
      }
    }
    if (failures.length > 0) {
      const gating = failures.filter((f) => f.gating !== false).length;
      console.log(
        `\n${failures.length} mismatch(es)${gating < failures.length ? ` — ${failures.length - gating} in a comparison baseline, which does not fail the run` : ''}:`,
      );
      for (const f of failures) {
        const where = f.variant ? ` (${f.variant})` : '';
        console.log(
          `  ${f.outcome} [${f.case.id}]${where} expected=${f.case.expected} got=${f.verdict.status} — ${f.case.notes || '(no notes)'}`,
        );
      }
    }

    await mkdir(RESULTS_DIR, { recursive: true });
    const report = {
      generatedAt: new Date().toISOString(),
      totals: {
        cases: all.length,
        deterministic: detResults.length,
        semantic: semResults.length,
        graphPending: graphCases.length,
      },
      slices,
      cost,
      retrievalCost,
      failures: failures.map((f) => ({
        id: f.case.id,
        variant: f.variant ?? 'default',
        outcome: f.outcome,
        expected: f.case.expected,
        got: f.verdict.status,
        engine: f.case.engine,
        category: f.case.category,
        notes: f.case.notes,
        evidence: f.verdict.evidence,
      })),
    };
    await writeFile(join(RESULTS_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');
    await writeFile(
      join(RESULTS_DIR, 'report.md'),
      `# AnhCompass Benchmark Report\n\n_${report.generatedAt}_\n\n${table}\n\n` +
        (cost.calls > 0
          ? `LLM cost: ${cost.calls} calls, ${cost.inputTokens} input / ${cost.outputTokens} output tokens, $${cost.usd.toFixed(4)}\n`
          : ''),
      'utf-8',
    );
    console.log(`\nReport written to benchmarks/results/report.{json,md}`);

    // Comparison baselines are measured, not enforced
    const gatingFailures = failures.filter((f) => f.gating !== false);
    process.exit(gatingFailures.length > 0 ? 2 : 0);
  } finally {
    await rm(semanticRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

