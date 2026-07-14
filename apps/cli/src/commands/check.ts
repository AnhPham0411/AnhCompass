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
} from '@anhcompass/core';
import pc from 'picocolors';

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Run drift detection pipeline on working tree or diff')
    .option('--diff <ref>', 'Git ref to diff against (e.g. origin/main)')
    .option('--intent-dir <dir>', 'Path to intent directory', '.agent/intent')
    .option('--repo-root <dir>', 'Repo root', '.')
    .option('--strict', 'Exit 1 on any violation (default: always exit 0 in v1)')
    .action(async (opts: { diff?: string; intentDir: string; repoRoot: string; strict?: boolean }) => {
      const repoRoot = resolve(opts.repoRoot);
      const intentDir = resolve(opts.intentDir);

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
      const apiKey = process.env['ANTHROPIC_API_KEY'];

      if (!apiKey) {
        console.log(pc.yellow('  ANTHROPIC_API_KEY not set — semantic checks will be skipped'));
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
        onProgress: (msg) => console.log(pc.dim(`  ${msg}`)),
      });

      console.log('');
      console.log(renderTerminal(result.verdicts));

      if (result.cacheHits > 0) {
        console.log(pc.dim(`  (${result.cacheHits} cache hit(s))`));
      }

      const hasViolation = result.verdicts.some((v) => v.status === 'violation');
      if (opts.strict && hasViolation) {
        process.exit(1);
      }
    });
}
