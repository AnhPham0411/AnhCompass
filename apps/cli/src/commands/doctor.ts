import type { Command } from 'commander';
import { resolve } from 'node:path';
import { parseIntentDir, runDoctor } from '@anhcompass/core';
import pc from 'picocolors';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check intent store health')
    .option('--intent-dir <dir>', 'Path to intent directory', '.agent/intent')
    .action(async (opts: { intentDir: string }) => {
      const intentDir = resolve(opts.intentDir);

      console.log(pc.cyan('anhcompass doctor'));
      console.log(`  Intent dir: ${intentDir}`);

      const { intents, errors } = await parseIntentDir(intentDir);

      if (errors.length > 0) {
        console.error(pc.red(`\n  ${errors.length} parse error(s) found:`));
        for (const e of errors) {
          console.error(pc.red(`  x ${e.message}`));
        }
      }

      const issues = runDoctor(intents);
      if (issues.length > 0) {
        console.log(pc.yellow(`\n  ${issues.length} logic issue(s) found:`));
        for (const issue of issues) {
          const color = issue.type === 'error' ? pc.red : pc.yellow;
          const icon = issue.type === 'error' ? 'x' : '!';
          console.log(color(`  ${icon} [${issue.intentId}] ${issue.message}`));
        }
      }

      const active = intents.filter((i) => i.frontmatter.status === 'active');
      const proposed = intents.filter((i) => i.frontmatter.status === 'proposed');
      const deprecated = intents.filter((i) => i.frontmatter.status === 'deprecated');

      console.log(`\n  Intents: ${intents.length} total`);
      console.log(`    ${pc.green(String(active.length))} active`);
      console.log(`    ${pc.yellow(String(proposed.length))} proposed`);
      console.log(`    ${pc.dim(String(deprecated.length))} deprecated`);

      const hasErrors = errors.length > 0 || issues.some(i => i.type === 'error');
      if (hasErrors) {
        process.exit(1);
      } else if (issues.length === 0) {
        console.log(pc.green('\n  v No issues found'));
      }
    });
}
