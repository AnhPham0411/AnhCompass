import type { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseIntentDir, buildIndex, buildManifest } from '@anhcompass/core';
import pc from 'picocolors';

export function registerCompile(program: Command): void {
  program
    .command('compile')
    .description('Compile intent store → _index.md + manifest.json')
    .option('--intent-dir <dir>', 'Path to intent directory', '.agent/intent')
    .option('--out-dir <dir>', 'Output directory for compiled files', '.agent/compiled')
    .action(async (opts: { intentDir: string; outDir: string }) => {
      const intentDir = resolve(opts.intentDir);
      const outDir = resolve(opts.outDir);

      console.log(pc.cyan('anhcompass compile'));
      console.log(`  Intent dir: ${intentDir}`);

      const { intents, errors } = await parseIntentDir(intentDir);

      if (errors.length > 0) {
        console.error(pc.red(`\n${errors.length} parse error(s):`));
        for (const e of errors) {
          console.error(pc.red(`  ✗ ${e.message}`));
        }
        process.exit(1);
      }

      if (intents.length === 0) {
        console.log(pc.yellow('  No intent files found. Run `anhcompass intent new <id>` first.'));
        return;
      }

      await mkdir(intentDir, { recursive: true });
      await mkdir(outDir, { recursive: true });

      const indexContent = buildIndex(intents);
      await writeFile(join(intentDir, '_index.md'), indexContent, 'utf-8');

      const manifest = buildManifest(intents);
      await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      console.log(pc.green(`\n  ✓ Compiled ${intents.length} intent(s)`));
      console.log(`    ${intentDir}/_index.md`);
      console.log(`    ${outDir}/manifest.json`);
    });
}
