import type { GraphProvider } from './provider.js';
import { NullProvider } from './null-provider.js';
import { TsGraphProvider } from './ts-provider.js';

export async function detectProvider(repoRoot: string): Promise<GraphProvider> {
  const tsProvider = new TsGraphProvider();
  if (await tsProvider.available(repoRoot)) {
    return tsProvider;
  }
  
  const nullProvider = new NullProvider();
  if (await nullProvider.available(repoRoot)) {
    return nullProvider;
  }
  return nullProvider;
}
