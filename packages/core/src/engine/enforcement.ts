import type { Intent, Verdict, Enforcement } from '../intent/schema.js';

/** Hybrid enforcement policy:
 *  - deterministic violation with severity `error` → block
 *  - everything else (all semantic violations, severity `warn`) → warn
 *  An LLM verdict can never block a pipeline on its own — semantic checks are
 *  probabilistic and must not gate merges without deterministic evidence. */
export function resolveEnforcement(intent: Intent, verdict: Verdict): Enforcement {
  if (verdict.engine === 'deterministic' && intent.frontmatter.severity === 'error') {
    return 'block';
  }
  return 'warn';
}

/** Attach enforcement to violation verdicts (no-op for other statuses). */
export function withEnforcement(intent: Intent, verdict: Verdict): Verdict {
  if (verdict.status !== 'violation') return verdict;
  return { ...verdict, enforcement: resolveEnforcement(intent, verdict) };
}

/** Blocking violations — the only verdicts that should fail CI. */
export function blockingViolations(verdicts: Verdict[]): Verdict[] {
  return verdicts.filter((v) => v.status === 'violation' && v.enforcement === 'block');
}

/** Warn-level violations — surfaced but never fail CI. */
export function warningViolations(verdicts: Verdict[]): Verdict[] {
  return verdicts.filter((v) => v.status === 'violation' && v.enforcement !== 'block');
}
