import type { ParsedDiff } from '@anhcompass/graph';

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
    const { stdout } = await exec('git', ['diff', ref, '--', '.'], { cwd: repoRoot });
    return stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git diff failed: ${msg}`);
  }
}

/** Get working tree diff (unstaged + staged) */
export async function getWorkingTreeDiff(repoRoot: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  try {
    const [staged, unstaged] = await Promise.all([
      exec('git', ['diff', '--cached'], { cwd: repoRoot }),
      exec('git', ['diff'], { cwd: repoRoot }),
    ]);
    return staged.stdout + '\n' + unstaged.stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git diff failed: ${msg}`);
  }
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
