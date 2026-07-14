import type { Command } from 'commander';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pc from 'picocolors';

const TEMPLATE = (id: string): string => `---
schema_version: 1
id: ${id}
title: TODO: Describe the intent
scope:
  - "src/**"
anchors: []
check: semantic
rule: |
  TODO: Write the normative rule here.
  Be specific — what MUST or MUST NOT happen?
severity: warn
status: proposed
owner: TODO
created: ${new Date().toISOString().slice(0, 10)}
---

## Context

TODO: Why does this rule exist? What problem does it prevent?
What incident or PR triggered this?

## Exceptions

None yet.
`;

export function registerIntentNew(program: Command): void {
  const intent = program.command('intent').description('Manage intents');

  intent
    .command('new <id>')
    .description('Scaffold a new intent file from template')
    .option('--intent-dir <dir>', 'Path to intent directory', '.agent/intent')
    .action(async (id: string, opts: { intentDir: string }) => {
      if (!/^[a-z0-9-]+$/.test(id)) {
        console.error(pc.red(`Error: id must be kebab-case (got "${id}")`));
        process.exit(1);
      }

      const intentDir = resolve(opts.intentDir);
      const filePath = join(intentDir, `${id}.md`);

      try {
        await access(filePath);
        console.error(pc.red(`Error: Intent "${id}" already exists at ${filePath}`));
        process.exit(1);
      } catch {
        // does not exist — good
      }

      await mkdir(intentDir, { recursive: true });
      await writeFile(filePath, TEMPLATE(id), 'utf-8');

      console.log(pc.green(`✓ Created ${filePath}`));
      console.log(`  Edit the file, set status: active, then run ${pc.cyan('anhcompass compile')}.`);
    });
}
