// Intent
export { parseIntentFile, parseIntentDir, IntentParseError } from './intent/parser.js';
export { canTransition, assertTransition, LifecycleTransitionError } from './intent/lifecycle.js';
export type {
  Intent,
  IntentFrontmatter,
  IntentAnchor,
  DeterministicRule,
  Verdict,
  Enforcement,
} from './intent/schema.js';
export {
  IntentFrontmatterSchema,
  IntentAnchorSchema,
  DeterministicRuleSchema,
  VerdictSchema,
  EnforcementSchema,
} from './intent/schema.js';

// Compile
export { buildIndex } from './compile/index-builder.js';
export { buildManifest } from './compile/manifest.js';
export type { Manifest, ManifestEntry } from './compile/manifest.js';

// Diff
export { parseDiff, getGitDiff, getWorkingTreeDiff, getCurrentCommit } from './diff/parse.js';

// Engine
export { filterByScope } from './engine/scope.js';
export { getCachedVerdict, setCachedVerdict, buildCacheKey } from './engine/cache.js';
export { runDeterministicCheck } from './engine/deterministic.js';
export { runSemanticCheck, SemanticVerdictResponseSchema } from './engine/semantic.js';
export { runPipeline } from './engine/pipeline.js';
export type { PipelineOpts, PipelineResult } from './engine/pipeline.js';
export {
  resolveEnforcement,
  withEnforcement,
  blockingViolations,
  warningViolations,
} from './engine/enforcement.js';

// Baseline
export {
  buildBaseline,
  saveBaseline,
  loadBaseline,
  compareBaseline,
  hashIntentContent,
  BaselineSchema,
} from './baseline/baseline.js';
export type { Baseline, BaselineDiff, BaselineEntryDiff } from './baseline/baseline.js';

// Report
export { renderTerminal, renderBaselineDiff } from './report/terminal.js';
export { renderMarkdown } from './report/markdown.js';
