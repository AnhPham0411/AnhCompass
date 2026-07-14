import type { Command } from 'commander';
import { resolve } from 'node:path';
import { parseIntentDir } from '@anhcompass/core';
import pc from 'picocolors';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check intent store health (parse-only in Phase 0)')
    .option('--intent-dir <dir>', 'Path to intent directory', '.agent/intent')
    .action(async (opts: { intentDir: string }) => {
      const intentDir = resolve(opts.intentDir);

      console.log(pc.cyan('anhcompass doctor'));
      console.log(`  Intent dir: ${intentDir}`);

      const { intents, errors } = await parseIntentDir(intentDir);

      if (errors.length > 0) {
        console.error(pc.red(`\n  ${errors.length} parse error(s) found:`));
        for (const e of errors) {
          console.error(pc.red(`  ✗ ${e.message}`));
        }
      }

      const active = intents.filter((i) => i.frontmatter.status === 'active');
      const proposed = intents.filter((i) => i.frontmatter.status === 'proposed');
      const deprecated = intents.filter((i) => i.frontmatter.status === 'deprecated');

      console.log(`\n  Intents: ${intents.length} total`);
      console.log(`    ${pc.green(String(active.length))} active`);
      console.log(`    ${pc.yellow(String(proposed.length))} proposed`);
      console.log(`    ${pc.dim(String(deprecated.length))} deprecated`);

      if (errors.length > 0) {
        process.exit(1);
      } else {
        console.log(pc.green('\n  ✓ No issues found'));
      }
    });
}
