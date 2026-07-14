/** Token budget management and model routing */

export const HAIKU_TOKEN_BUDGET = 6000;
export const SONNET_TOKEN_BUDGET = 12000;

/** Models in priority order (cheapest first) */
export const HAIKU_MODEL = 'claude-haiku-4-5';
export const SONNET_MODEL = 'claude-sonnet-4-5';

/** Decide which model to use based on context size */
export function routeModel(estimatedInputTokens: number): string {
  if (estimatedInputTokens <= HAIKU_TOKEN_BUDGET) {
    return HAIKU_MODEL;
  }
  return SONNET_MODEL;
}

/** Max output tokens for verdict response (small — JSON only) */
export const VERDICT_MAX_OUTPUT_TOKENS = 512;
