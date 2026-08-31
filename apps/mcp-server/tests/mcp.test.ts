import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'dist', 'index.js');

const INTENT = `---
schema_version: 1
id: no-lodash
title: No lodash
scope: ["src/**"]
check: deterministic
rule: Do not import lodash directly.
deterministic:
  kind: no-import
  from: ["src/**"]
  to: ["lodash"]
severity: error
status: active
created: 2026-09-01
---

Lodash bloats the bundle and every helper we use has a native equivalent.
`;

/** Minimal JSON-RPC-over-stdio client, enough to drive the tools. */
class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private nextId = 1;

  constructor(cwd: string) {
    this.proc = spawn(process.execPath, [SERVER], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
            this.pending.get(msg.id)!(msg as Record<string, unknown>);
            this.pending.delete(msg.id);
          }
        } catch {
          // not a JSON-RPC frame
        }
      }
    });
  }

  send(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 30000);
    });
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async callTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
    const res = (await this.send('tools/call', { name, arguments: args })) as {
      result?: { content?: { text?: string }[]; isError?: boolean };
    };
    const content = res.result?.content ?? [];
    return {
      text: content.map((c) => c.text ?? '').join('\n'),
      isError: res.result?.isError === true,
    };
  }

  /** Windows keeps a handle on the child's working directory until it has
   *  actually exited, so cleanup has to wait rather than just signalling. */
  async stop(): Promise<void> {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => this.proc.once('exit', () => resolve()));
    this.proc.kill();
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 5000))]);
  }
}

// The server is driven as a built artifact; `pnpm -r build` runs before tests
// in CI, but a bare `pnpm test` on a clean tree has nothing to spawn.
const describeIfBuilt = existsSync(SERVER) ? describe : describe.skip;

describeIfBuilt('MCP server tools', () => {
  let repo: string;
  let client: McpClient;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'anhcompass-mcp-'));
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(repo, '.agent', 'intent'), { recursive: true });
    await writeFile(join(repo, '.agent', 'intent', 'no-lodash.md'), INTENT, 'utf-8');
    await writeFile(join(repo, 'src', 'seed.ts'), 'export const seed = 1;\n', 'utf-8');

    // check_drift reads a working-tree diff, which needs a repository with a base
    execFileSync('git', ['init', '-q', '.'], { cwd: repo });
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync(
      'git',
      ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'base'],
      { cwd: repo },
    );

    await writeFile(
      join(repo, 'src', 'utils.ts'),
      "import _ from 'lodash';\nexport const x = _.chunk([1, 2], 1);\n",
      'utf-8',
    );

    client = new McpClient(repo);
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    client.notify('notifications/initialized', {});
  }, 60000);

  afterAll(async () => {
    await client?.stop();
    // A temp directory that outlives the run is untidy, not a test failure.
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
      () => undefined,
    );
  }, 30000);

  it('advertises the full toolset', async () => {
    const res = (await client.send('tools/list', {})) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (res.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_intents',
        'check_drift',
        'get_architecture_context',
        'check_plan',
        'explain_violation',
        'verify_fix',
      ]),
    );
  });

  it('check_drift finds the violation and returns no terminal escape codes', async () => {
    const { text, isError } = await client.callTool('check_drift', {
      repoRoot: '.',
      intentDir: '.agent/intent',
    });
    expect(isError).toBe(false);
    expect(text).toContain('VIOLATION [BLOCK] no-lodash');
    expect(text).toContain('src/utils.ts');
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\[/);
  }, 60000);

  it('get_architecture_context returns only the intents whose scope covers the file', async () => {
    const covered = await client.callTool('get_architecture_context', {
      repoRoot: '.',
      intentDir: '.agent/intent',
      files: ['src/utils.ts'],
    });
    expect(covered.text).toContain('no-lodash');

    const uncovered = await client.callTool('get_architecture_context', {
      repoRoot: '.',
      intentDir: '.agent/intent',
      files: ['docs/readme.md'],
    });
    expect(uncovered.text).toContain('No active intent covers these files');
  }, 60000);

  it('explain_violation reports the rule, the rationale and the waiver syntax', async () => {
    const { text } = await client.callTool('explain_violation', {
      repoRoot: '.',
      intentDir: '.agent/intent',
      intentId: 'no-lodash',
      diff_text:
        "diff --git a/src/utils.ts b/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,2 +1,3 @@\n+import _ from 'lodash';\n",
    });
    expect(text).toContain('Do not import lodash directly.');
    expect(text).toContain('bloats the bundle');
    expect(text).toContain('anhcompass-disable-next-line no-lodash');
  }, 60000);

  it('explain_violation refuses an unreadable diff instead of answering pass', async () => {
    const { text, isError } = await client.callTool('explain_violation', {
      repoRoot: '.',
      intentDir: '.agent/intent',
      intentId: 'no-lodash',
      diff_text: "+import _ from 'lodash';",
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/no recognisable file headers/i);
  }, 60000);

  it('explain_violation names the known ids when the intent does not exist', async () => {
    const { text, isError } = await client.callTool('explain_violation', {
      repoRoot: '.',
      intentDir: '.agent/intent',
      intentId: 'does-not-exist',
      diff_text: 'diff --git a/src/utils.ts b/src/utils.ts\n+++ b/src/utils.ts\n+const a = 1;\n',
    });
    expect(isError).toBe(true);
    expect(text).toContain('no-lodash');
  }, 60000);

  it('check_plan reviews without an API key rather than claiming the plan is fine', async () => {
    const { text } = await client.callTool('check_plan', {
      repoRoot: '.',
      intentDir: '.agent/intent',
      plan_text: 'Add lodash to src/utils.ts for chunking.',
    });
    // The suite must not depend on a key being present; either answer is valid,
    // but neither may be a silent "ok".
    expect(text).toMatch(/UNCERTAIN no-lodash|AT-RISK no-lodash/);
    expect(text).toMatch(/nothing here blocks/i);
  }, 60000);

  it('check_plan rejects an empty plan', async () => {
    const { isError } = await client.callTool('check_plan', {
      intentDir: '.agent/intent',
      plan_text: '   ',
    });
    expect(isError).toBe(true);
  }, 60000);
});
