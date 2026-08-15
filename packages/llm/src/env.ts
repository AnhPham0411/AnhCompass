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
