/** Which vendor a key and its endpoints belong to. */
export type LlmProvider = 'anthropic' | 'openai' | 'gemini';

export const LLM_PROVIDERS: readonly LlmProvider[] = ['anthropic', 'openai', 'gemini'] as const;

/** Resolve the LLM API key from an env-like map (pure — caller passes process.env).
 *  LLM_API_KEY is the explicit override; provider-specific vars follow for
 *  backward compatibility (ANTHROPIC_API_KEY was the only var in v0). */
export function resolveLlmApiKey(env: Record<string, string | undefined>): string | undefined {
  const key =
    env['LLM_API_KEY'] ?? env['ANTHROPIC_API_KEY'] ?? env['OPENAI_API_KEY'] ?? env['GEMINI_API_KEY'];
  return key && key.trim() !== '' ? key : undefined;
}

/** Env vars checked by resolveLlmApiKey, for user-facing hints */
export const LLM_API_KEY_ENV_VARS = [
  'LLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
] as const;

export class UnknownLlmProviderError extends Error {
  constructor(public readonly given: string) {
    super(
      `Unknown LLM provider "${given}". Expected one of: ${LLM_PROVIDERS.join(', ')}. ` +
        `Set it with --provider or LLM_PROVIDER.`,
    );
    this.name = 'UnknownLlmProviderError';
  }
}

function parseProvider(given: string): LlmProvider {
  const normalized = given.trim().toLowerCase();
  const match = LLM_PROVIDERS.find((p) => p === normalized);
  if (!match) throw new UnknownLlmProviderError(given);
  return match;
}

/** Best guess at the vendor from the shape of a key.
 *
 *  This is a fallback, not the contract. Key prefixes are the vendors' to
 *  change and they overlap: `sk-` covers OpenAI and anything that copied its
 *  format, and the `else` branch means an unrecognised key is *always* read as
 *  Gemini rather than reported as unknown. Callers that know the provider
 *  should say so — `resolveLlmProvider` prefers an explicit answer and only
 *  falls back to this. */
export function inferProviderFromKey(apiKey: string): LlmProvider {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  return 'gemini';
}

/** True when the provider had to be guessed from the key rather than declared.
 *  Surfaced so a caller can warn instead of silently routing to the wrong API. */
export function providerWasInferred(
  env: Record<string, string | undefined>,
  explicit?: string,
): boolean {
  // Mirrors resolveLlmProvider exactly: a blank value declares nothing there,
  // so it must not count as a declaration here either, or the warning that the
  // provider was guessed goes missing on the one input most likely to be wrong.
  const declared = explicit ?? env['LLM_PROVIDER'];
  return !declared || declared.trim() === '';
}

/** Resolve the provider: an explicit flag wins, then `LLM_PROVIDER`, then the
 *  key's shape. Throws on a declared provider that does not exist — a typo
 *  should fail loudly rather than route to a default vendor. */
export function resolveLlmProvider(
  env: Record<string, string | undefined>,
  apiKey: string,
  explicit?: string,
): LlmProvider {
  if (explicit) return parseProvider(explicit);
  const fromEnv = env['LLM_PROVIDER'];
  if (fromEnv && fromEnv.trim() !== '') return parseProvider(fromEnv);
  return inferProviderFromKey(apiKey);
}
