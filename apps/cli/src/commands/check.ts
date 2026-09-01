import type { Command } from 'commander';
import { resolve } from 'node:path';
import {
  parseIntentDir,
  parseDiff,
  getGitDiff,
  getWorkingTreeDiff,
  getCurrentCommit,
  runPipeline,
  renderTerminal,
  renderBaselineDiff,
  blockingViolations,
  buildBaseline,
  saveBaseline,
  loadBaseline,
  compareBaseline,
} from '@anhcompass/core';
import { resolveLlmApiKey, LLM_API_KEY_ENV_VARS, resolveLlmProvider, providerWasInferred } from '@anhcompass/llm';
import pc from 'picocolors';

interface CheckOpts {
  diff?: string;
  intentDir: string;
  repoRoot: string;
  strict?: boolean;
  strictAll?: boolean;
  saveBaseline?: boolean;
  compareBaseline?: boolean;
  baselinePath: string;
  model?: string;
  provider?: string;
  /** commander sets this false when --no-graph-retrieval is passed */
  graphRetrieval: boolean;
}

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Run drift detection pipeline on working tree or diff')
    .option('--diff <ref>', 'Git ref to diff against (e.g. origin/main)')
    .option('--intent-dir <dir>', 'Path to intent directory', '.agent/intent')
    .option('--repo-root <dir>', 'Repo root', '.')
    .option('--strict', 'Exit 1 on BLOCKING violations (deterministic + severity error)')
    .option('--strict-all', 'Exit 1 on any violation, including LLM warn-level (not recommended for CI)')
    .option('--save-baseline', 'Save verdicts as the regression baseline after this run')
    .option('--compare-baseline', 'Compare verdicts against the saved baseline and report changes')
    .option('--baseline-path <file>', 'Baseline file location', '.agent/baseline.json')
    .option(
      '--model <id>',
      'Pin the model for semantic checks (default: the accurate tier — see BENCHMARKS.md)',
    )
    .option(
      '--provider <name>',
      'LLM vendor for semantic checks: anthropic, openai or gemini (default: LLM_PROVIDER, else guessed from the key)',
    )
    .option(
      '--no-graph-retrieval',
      'Gather semantic context by walking directories instead of following the import graph',
    )
    .action(async (opts: CheckOpts) => {
      const repoRoot = resolve(opts.repoRoot);
      const intentDir = resolve(opts.intentDir);
      const baselinePath = resolve(opts.baselinePath);

      console.log(pc.cyan('anhcompass check'));

      // Load intents
      const { intents, errors } = await parseIntentDir(intentDir);
      if (errors.length > 0) {
        console.error(pc.red(`${errors.length} intent parse error(s):`));
        for (const e of errors) console.error(pc.red(`  ${e.message}`));
        process.exit(1);
      }

      if (intents.length === 0) {
        console.log(pc.yellow('No intents found. Run `anhcompass intent new <id>` first.'));
        return;
      }

      // Get diff
      let diffText: string;
      try {
        diffText = opts.diff
          ? await getGitDiff(repoRoot, opts.diff)
          : await getWorkingTreeDiff(repoRoot);
      } catch (err) {
        console.error(pc.red(`Failed to get diff: ${String(err)}`));
        process.exit(1);
      }

      if (!diffText.trim()) {
        console.log(pc.green('✓ No changes detected — nothing to check'));
        return;
      }

      const parsedDiff = parseDiff(diffText);
      const checkedAtCommit = await getCurrentCommit(repoRoot);
      const apiKey = resolveLlmApiKey(process.env);
      let llmProvider;
      try {
        llmProvider = apiKey ? resolveLlmProvider(process.env, apiKey, opts.provider) : undefined;
      } catch (err) {
        // A typo in --provider is a user mistake; the error class already says
        // what the valid values are, so print that rather than a stack trace.
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      if (apiKey && llmProvider && providerWasInferred(process.env, opts.provider)) {
        console.log(
          pc.dim(
            `  LLM provider guessed from the key shape: ${llmProvider}. Set --provider or LLM_PROVIDER to be explicit.`,
          ),
        );
      }

      if (!apiKey) {
        console.log(
          pc.yellow(
            `  No LLM API key found (checked ${LLM_API_KEY_ENV_VARS.join(', ')}) — semantic checks will be skipped`,
          ),
        );
      }

      console.log(`  Files in diff: ${parsedDiff.files.length}`);
      console.log(`  Active intents: ${intents.filter((i) => i.frontmatter.status === 'active').length}`);

      const result = await runPipeline({
        intents,
        diff: parsedDiff,
        diffText,
        repoRoot,
        checkedAtCommit,
        apiKey,
        llmProvider,
        model: opts.model,
        useGraphRetrieval: opts.graphRetrieval,
        onProgress: (msg) => console.log(pc.dim(`  ${msg}`)),
      });

      console.log('');
      console.log(renderTerminal(result.verdicts));

      if (result.cacheHits > 0) {
        console.log(pc.dim(`  (${result.cacheHits} cache hit(s))`));
      }

      let regressionCount = 0;
      if (opts.compareBaseline) {
        const baseline = await loadBaseline(baselinePath);
        console.log('');
        if (!baseline) {
          console.log(
            pc.yellow(`  No baseline at ${opts.baselinePath} — run with --save-baseline first`),
          );
        } else {
          const diff = compareBaseline(baseline, intents, result.verdicts);
          console.log(renderBaselineDiff(diff));
          regressionCount = diff.regressions.length;
        }
      }

      if (opts.saveBaseline) {
        const baseline = buildBaseline(
          intents,
          result.verdicts,
          checkedAtCommit,
          new Date().toISOString(),
        );
        await saveBaseline(baselinePath, baseline);
        console.log('');
        console.log(pc.dim(`  Baseline saved to ${opts.baselinePath}`));
      }

      // Hybrid enforcement: only deterministic violations with severity `error`
      // can fail the pipeline. LLM verdicts alone never block (use --strict-all
      // to opt out of that protection).
      const blocking = blockingViolations(result.verdicts);
      const anyViolation = result.verdicts.some((v) => v.status === 'violation');

      if (opts.strictAll && anyViolation) process.exit(1);
      if (opts.strict && (blocking.length > 0 || regressionCount > 0)) process.exit(1);
    });
}
