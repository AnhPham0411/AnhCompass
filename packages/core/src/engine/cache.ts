import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { VerdictSchema, type Verdict } from '../intent/schema.js';

/** Read cached verdict. Returns null on miss or on a corrupt/stale entry. */
export async function getCachedVerdict(
  cacheDir: string,
  cacheKey: string,
): Promise<Verdict | null> {
  const path = join(cacheDir, `${cacheKey}.json`);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = VerdictSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Write verdict to cache */
export async function setCachedVerdict(
  cacheDir: string,
  cacheKey: string,
  verdict: Verdict,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${cacheKey}.json`), JSON.stringify(verdict, null, 2), 'utf-8');
  } catch {
    // non-fatal
  }
}

/** Bumped whenever an engine changes what it would conclude from the same
 *  input. A cached verdict is an answer from a particular version of the
 *  checker; serving it after the checker changed is serving a stale answer
 *  with full confidence.
 *
 *  2 — layer-boundary began following paths through unlayered modules.
 *  3 — the graph indexer covers .mjs/.cjs/.mts/.cts, and a graph-only rule over
 *      an empty index reports uncertain rather than pass. */
export const ENGINE_VERSION = 3;

/** Build cache key from intent content + relevant diff hunks.
 *  sha256 — a 32-bit hash collision would silently serve another intent's verdict. */
export function buildCacheKey(
  intentContent: string,
  diffHunks: string[],
  modelId: string,
): string {
  const input = [`engine:${ENGINE_VERSION}`, intentContent, diffHunks.join('\n'), modelId].join(
    '|||',
  );
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
