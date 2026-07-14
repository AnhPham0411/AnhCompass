import type { GraphProvider } from './provider.js';
import { NullProvider } from './null-provider.js';

export async function detectProvider(repoRoot: string): Promise<GraphProvider> {
  const nullProvider = new NullProvider();
  if (await nullProvider.available(repoRoot)) {
    return nullProvider;
  }
  return nullProvider;
}
