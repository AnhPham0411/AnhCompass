import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Verdict } from '../intent/schema.js';

/** Read cached verdict. Returns null on miss. */
export async function getCachedVerdict(
  cacheDir: string,
  cacheKey: string,
): Promise<Verdict | null> {
  const path = join(cacheDir, `${cacheKey}.json`);
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Verdict;
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

/** Build cache key from intent content + relevant diff hunks */
export function buildCacheKey(
  intentContent: string,
  diffHunks: string[],
  modelId: string,
): string {
  const input = intentContent + '|||' + diffHunks.join('\n') + '|||' + modelId;
  // Simple djb2 hash
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
