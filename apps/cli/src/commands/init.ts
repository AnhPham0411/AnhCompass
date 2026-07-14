import type { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pc from 'picocolors';

const DEMO_INTENT = `---
schema_version: 1
id: no-console-log
title: No console.log in source files
scope:
  - "src/**"
anchors: []
check: semantic
rule: |
  Do not use console.log in application code. Use a proper logging utility or logger instance.
severity: warn
status: active
owner: team
created: ${new Date().toISOString().slice(0, 10)}
---

## Context

console.log logs leak to stdout/stderr unnecessarily and can clutter server logs.

## Exceptions

- Allowed in \`src/bin/**\` scripts or testing setup files.
`;

const GITHUB_WORKFLOW = `name: AnhCompass Drift Check

on:
  pull_request:
    branches: [ main, master ]

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run AnhCompass Check
        uses: actions/github-script@v7
        env:
          ANTHROPIC_API_KEY: \`\${{ secrets.ANTHROPIC_API_KEY }}\`
        with:
          script: |
            // Composite action or inline script execution
            console.log("AnhCompass checking drift...");
`;

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize AnhCompass setup in the current workspace')
    .action(async () => {
      const root = resolve('.');
      const agentDir = join(root, '.agent');
      const intentDir = join(agentDir, 'intent');

      console.log(pc.cyan('Initializing AnhCompass...'));

      try {
        await mkdir(intentDir, { recursive: true });
        await writeFile(join(intentDir, 'no-console-log.md'), DEMO_INTENT, 'utf-8');
        console.log(pc.green('✓ Created .agent/intent/no-console-log.md'));

        await writeFile(join(root, '.env.example'), 'ANTHROPIC_API_KEY=\n', 'utf-8');
        console.log(pc.green('✓ Created .env.example'));

        const githubWorkflows = join(root, '.github', 'workflows');
        await mkdir(githubWorkflows, { recursive: true });
        await writeFile(join(githubWorkflows, 'anhcompass.yml'), GITHUB_WORKFLOW, 'utf-8');
        console.log(pc.green('✓ Created .github/workflows/anhcompass.yml'));

        console.log(pc.green('\nInitialization complete!'));
        console.log(`Run ${pc.cyan('anhcompass doctor')} to verify health status.`);
      } catch (err) {
        console.error(pc.red(`Failed to initialize: ${String(err)}`));
        process.exit(1);
      }
    });
}
