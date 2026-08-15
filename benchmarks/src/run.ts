/** AnhCompass benchmark runner.
 *
 *  Usage:
 *    pnpm bench                 # deterministic cases only (free, offline)
 *    pnpm bench -- --semantic   # also run semantic cases (needs an LLM API key)
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
import { resolveLlmApiKey } from '@anhcompass/llm';
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

async function runCase(c: BenchCase, semanticRoot: string, apiKey?: string): Promise<CaseResult> {
  const intent = toIntent(c);
  const diff = parseDiff(c.diff);
  const start = Date.now();

  let verdict: Verdict;
  if (c.engine === 'deterministic') {
    verdict = (await runDeterministicCheck(intent, diff, 'bench')).verdict;
  } else {
    verdict = await runSemanticCheck({
      intent,
      diff,
      diffText: c.diff,
      repoRoot: semanticRoot,
      apiKey: apiKey!,
      checkedAtCommit: 'bench',
      cacheKey: `bench-${c.id}`,
    });
  }

  const latencyMs = Date.now() - start;
  return { case: c, verdict, latencyMs, ...classify(c, verdict) };
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

async function readLlmCost(semanticRoot: string): Promise<LlmCost> {
  const cost: LlmCost = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  try {
    const raw = await readFile(join(semanticRoot, '.agent', 'cache', 'llm-log.jsonl'), 'utf-8');
    for (const line of raw.trim().split('\n')) {
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
  } catch {
    // no semantic calls made
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
  const onlyIdx = args.indexOf('--only');
  const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

  let cases = await loadCases();
  if (onlyId) cases = cases.filter((c) => c.id === onlyId);

  const detCases = cases.filter((c) => c.engine === 'deterministic');
  let semCases = cases.filter((c) => c.engine === 'semantic');

  const apiKey = resolveLlmApiKey(process.env);
  if (runSemantic && !apiKey) {
    console.error('--semantic requires an LLM API key (LLM_API_KEY / OPENAI_API_KEY / ...)');
    process.exit(1);
  }
  if (!runSemantic) semCases = [];

  console.log(`Loaded ${cases.length} case(s) — running ${detCases.length} deterministic, ${semCases.length} semantic\n`);

  const semanticRoot = await mkdtemp(join(tmpdir(), 'anhcompass-bench-'));
  try {
    const detResults = await pool(detCases, 16, (c) => runCase(c, semanticRoot));
    const semResults = await pool(semCases, SEMANTIC_CONCURRENCY, (c) => runCase(c, semanticRoot, apiKey));
    const all = [...detResults, ...semResults];

    const slices: Record<string, EngineMetrics> = {};
    if (detResults.length > 0) slices['deterministic (all)'] = computeMetrics(detResults);
    if (semResults.length > 0) slices['semantic (all)'] = computeMetrics(semResults);
    for (const engine of ['deterministic', 'semantic'] as const) {
      for (const cat of ['correct', 'wrong', 'edge', 'ai-generated'] as const) {
        const slice = all.filter((r) => r.case.engine === engine && r.case.category === cat);
        if (slice.length > 0) slices[`${engine} / ${cat}`] = computeMetrics(slice);
      }
    }

    const failures = all.filter((r) => r.outcome === 'FP' || r.outcome === 'FN');
    const cost = await readLlmCost(semanticRoot);

    const table = metricsTable(slices);
    console.log(table);
    console.log('');
    if (cost.calls > 0) {
      console.log(
        `LLM: ${cost.calls} calls · ${cost.inputTokens} in / ${cost.outputTokens} out tokens · $${cost.usd.toFixed(4)}`,
      );
    }
    if (failures.length > 0) {
      console.log(`\n${failures.length} mismatch(es):`);
      for (const f of failures) {
        console.log(
          `  ${f.outcome} [${f.case.id}] expected=${f.case.expected} got=${f.verdict.status} — ${f.case.notes || '(no notes)'}`,
        );
      }
    }

    await mkdir(RESULTS_DIR, { recursive: true });
    const report = {
      generatedAt: new Date().toISOString(),
      totals: { cases: all.length, deterministic: detResults.length, semantic: semResults.length },
      slices,
      cost,
      failures: failures.map((f) => ({
        id: f.case.id,
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

    process.exit(failures.length > 0 ? 2 : 0);
  } finally {
    await rm(semanticRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
