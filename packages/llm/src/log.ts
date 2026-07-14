import { appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface LlmLogEntry {
  timestamp: string;
  intentId: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'pass' | 'violation' | 'uncertain' | 'error';
  engine: 'semantic';
}

/** Append a log entry to .agent/cache/llm-log.jsonl */
export async function logLlmCall(repoRoot: string, entry: LlmLogEntry): Promise<void> {
  const logPath = join(repoRoot, '.agent', 'cache', 'llm-log.jsonl');
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Non-fatal — logging must not break the pipeline
  }
}

/** Simple deterministic hash for cache keys */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash = hash >>> 0; // convert to uint32
  }
  return hash.toString(16).padStart(8, '0');
}
