/** Token budget management and model routing */

export const HAIKU_TOKEN_BUDGET = 6000;
export const SONNET_TOKEN_BUDGET = 12000;

/** Models in priority order (cheapest first) */
export const HAIKU_MODEL = 'claude-haiku-4-5';
export const SONNET_MODEL = 'claude-sonnet-4-5';

/** Default model for a conformance judgment.
 *
 *  Routing by context size used to send small checks to the cheap tier. The
 *  benchmark says that trade is a bad one: on the semantic corpus the cheap
 *  tier scores 70% precision against 100% for the stronger tier, at identical
 *  recall — and it fails by misreading the rule, quoting a clause and then
 *  concluding the opposite of what it says (BENCHMARKS.md). False positives are
 *  what get a checker switched off, so accuracy is the default and cost is the
 *  opt-in: pin the cheap tier explicitly with `--model` when noise is
 *  acceptable.
 *
 *  `estimatedInputTokens` is retained because the caller has it and a future
 *  routing policy will need it; it does not affect the answer today. */
export function routeModel(_estimatedInputTokens: number): string {
  return defaultSemanticModel();
}

/** The model a semantic check uses when the caller pins nothing. Exposed so a
 *  cache key can name the model that produced a verdict without having to
 *  reproduce the routing decision. */
export function defaultSemanticModel(): string {
  return SONNET_MODEL;
}

/** Max output tokens for verdict response. JSON-only, but multiple evidence
 *  items can exceed 512 and a truncated response fails to parse. */
export const VERDICT_MAX_OUTPUT_TOKENS = 1024;
