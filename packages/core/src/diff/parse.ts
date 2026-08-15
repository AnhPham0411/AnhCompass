import type { ParsedDiff } from '@anhcompass/graph';

/** git diff of a huge monorepo PR can exceed Node's 1MB default stdout buffer */
const MAX_DIFF_BUFFER = 1024 * 1024 * 100;
/** Per-file and total caps when synthesizing diffs for untracked files */
const MAX_UNTRACKED_FILE_CHARS = 512 * 1024;
const MAX_UNTRACKED_TOTAL_CHARS = 5 * 1024 * 1024;
/** Env/secret files must never enter the diff — it may be sent to an LLM */
const SECRET_FILE_RE = /(^|\/)\.env(\.[\w.-]+)?$/;

/** Parse a unified diff string into structured form */
export function parseDiff(diffText: string): ParsedDiff {
  const files: string[] = [];
  const hunks: Record<string, string[]> = {};

  const lines = diffText.split('\n');
  let currentFile: string | null = null;

  for (const line of lines) {
    // Match "diff --git a/foo/bar.ts b/foo/bar.ts"
    const diffLine = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (diffLine && diffLine[1]) {
      currentFile = diffLine[1];
      if (!files.includes(currentFile)) {
        files.push(currentFile);
      }
      hunks[currentFile] = hunks[currentFile] ?? [];
      continue;
    }

    // Also match "--- a/foo" / "+++ b/foo" style
    const newFile = line.match(/^\+\+\+ b\/(.+)$/);
    if (newFile && newFile[1]) {
      currentFile = newFile[1];
      if (!files.includes(currentFile)) {
        files.push(currentFile);
      }
      hunks[currentFile] = hunks[currentFile] ?? [];
      continue;
    }

    // Old-file header, not a removed body line (those start with a single '-')
    if (/^--- (a\/|\/dev\/null)/.test(line)) {
      continue;
    }

    if (currentFile && (line.startsWith('+') || line.startsWith('-') || line.startsWith('@@'))) {
      hunks[currentFile]!.push(line);
    }
  }

  return { files, hunks };
}

/** Get the diff text between two git refs using child_process */
export async function getGitDiff(repoRoot: string, ref: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  try {
    const { stdout } = await exec('git', ['diff', ref, '--', '.'], {
      cwd: repoRoot,
      maxBuffer: MAX_DIFF_BUFFER,
    });
    return stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git diff failed: ${msg}`);
  }
}

/** Get working tree diff (staged + unstaged + untracked) */
export async function getWorkingTreeDiff(repoRoot: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  try {
    const [staged, unstaged, untracked] = await Promise.all([
      exec('git', ['diff', '--cached'], { cwd: repoRoot, maxBuffer: MAX_DIFF_BUFFER }),
      exec('git', ['diff'], { cwd: repoRoot, maxBuffer: MAX_DIFF_BUFFER }),
      getUntrackedFilesDiff(repoRoot),
    ]);
    return staged.stdout + '\n' + unstaged.stdout + '\n' + untracked;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git diff failed: ${msg}`);
  }
}

/** Synthesize a unified diff for untracked files.
 *  `git diff` never shows untracked files, so drift introduced in brand-new
 *  files (the common case for coding agents) would otherwise go unchecked. */
export async function getUntrackedFilesDiff(repoRoot: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const exec = promisify(execFile);

  let stdout: string;
  try {
    ({ stdout } = await exec('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      maxBuffer: MAX_DIFF_BUFFER,
    }));
  } catch {
    return '';
  }

  const files = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const parts: string[] = [];
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= MAX_UNTRACKED_TOTAL_CHARS) break;
    if (SECRET_FILE_RE.test(file)) continue;

    let content: string;
    try {
      content = await readFile(join(repoRoot, file), 'utf-8');
    } catch {
      continue; // unreadable — skip
    }
    if (content.includes('\u0000')) continue; // binary — skip
    if (content.length > MAX_UNTRACKED_FILE_CHARS) {
      content = content.slice(0, MAX_UNTRACKED_FILE_CHARS);
    }

    const added = content
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n');
    parts.push(
      `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1 @@\n${added}`,
    );
    totalChars += content.length;
  }

  return parts.join('\n');
}

/** Get current HEAD commit hash */
export async function getCurrentCommit(repoRoot: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  try {
    const { stdout } = await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}
