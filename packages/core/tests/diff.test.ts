import { describe, it, expect } from 'vitest';
import { parseDiff } from '../src/diff/parse.js';

const SAMPLE_DIFF = `diff --git a/src/api/order.ts b/src/api/order.ts
index abc1234..def5678 100644
--- a/src/api/order.ts
+++ b/src/api/order.ts
@@ -1,3 +1,5 @@
+import Stripe from 'stripe';
+
 export async function createOrder() {
-  // old
+  // new
 }
`;

describe('parseDiff', () => {
  it('extracts files from git diff', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.files).toContain('src/api/order.ts');
  });

  it('extracts added lines in hunks', () => {
    const result = parseDiff(SAMPLE_DIFF);
    const hunks = result.hunks['src/api/order.ts'] ?? [];
    const addedLines = hunks.filter((l) => l.startsWith('+'));
    expect(addedLines.some((l) => l.includes("import Stripe from 'stripe'"))).toBe(true);
  });

  it('returns empty for empty diff', () => {
    const result = parseDiff('');
    expect(result.files).toHaveLength(0);
  });

  it('handles multiple files', () => {
    const multi = `diff --git a/foo.ts b/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
+const x = 1;
diff --git a/bar.ts b/bar.ts
+++ b/bar.ts
@@ -1 +1 @@
+const y = 2;
`;
    const result = parseDiff(multi);
    expect(result.files.length).toBeGreaterThanOrEqual(1);
  });

  it('does not treat "--- a/..." headers as removed lines', () => {
    const result = parseDiff(SAMPLE_DIFF);
    const hunks = result.hunks['src/api/order.ts'] ?? [];
    expect(hunks.some((l) => l.startsWith('--- a/'))).toBe(false);
    // real removed body lines are still captured
    expect(hunks.some((l) => l === '-  // old')).toBe(true);
  });

  it('parses synthesized untracked-file diffs (new file, /dev/null header)', () => {
    const synthesized = `diff --git a/src/new-service.ts b/src/new-service.ts
new file mode 100644
--- /dev/null
+++ b/src/new-service.ts
@@ -0,0 +1 @@
+import _ from 'lodash';
+export const x = 1;`;
    const result = parseDiff(synthesized);
    expect(result.files).toContain('src/new-service.ts');
    const hunks = result.hunks['src/new-service.ts'] ?? [];
    expect(hunks.some((l) => l.includes("import _ from 'lodash'"))).toBe(true);
    expect(hunks.some((l) => l.startsWith('--- '))).toBe(false);
  });
});

describe('getUntrackedFilesDiff', () => {
  it('includes untracked text files as added lines', async () => {
    const { getUntrackedFilesDiff } = await import('../src/diff/parse.js');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const repo = await mkdtemp(join(tmpdir(), 'anhcompass-test-'));
    try {
      await exec('git', ['init'], { cwd: repo });
      await writeFile(join(repo, 'brand-new.ts'), "import _ from 'lodash';\n", 'utf-8');

      const diff = await getUntrackedFilesDiff(repo);
      expect(diff).toContain('+++ b/brand-new.ts');
      expect(diff).toContain("+import _ from 'lodash';");

      const parsed = parseDiff(diff);
      expect(parsed.files).toContain('brand-new.ts');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('never includes .env / .env.* files (secrets must not reach LLM prompts)', async () => {
    const { getUntrackedFilesDiff } = await import('../src/diff/parse.js');
    const { mkdtemp, writeFile, rm, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);

    const repo = await mkdtemp(join(tmpdir(), 'anhcompass-env-'));
    try {
      await exec('git', ['init'], { cwd: repo });
      await mkdir(join(repo, 'frontend'), { recursive: true });
      await writeFile(join(repo, '.env'), 'OPENAI_API_KEY=sk-super-secret\n', 'utf-8');
      await writeFile(join(repo, 'frontend', '.env.local'), 'TOKEN=abc123\n', 'utf-8');
      await writeFile(join(repo, 'app.ts'), 'export const x = 1;\n', 'utf-8');

      const diff = await getUntrackedFilesDiff(repo);
      expect(diff).toContain('+++ b/app.ts');
      expect(diff).not.toContain('sk-super-secret');
      expect(diff).not.toContain('abc123');
      expect(diff).not.toContain('.env');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('returns empty string outside a git repo', async () => {
    const { getUntrackedFilesDiff } = await import('../src/diff/parse.js');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'anhcompass-nogit-'));
    try {
      const diff = await getUntrackedFilesDiff(dir);
      expect(diff).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
