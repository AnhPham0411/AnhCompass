// Intent
export { parseIntentFile, parseIntentDir, IntentParseError } from './intent/parser.js';
export { canTransition, assertTransition, LifecycleTransitionError } from './intent/lifecycle.js';
export type {
  Intent,
  IntentFrontmatter,
  IntentAnchor,
  DeterministicRule,
  Verdict,
} from './intent/schema.js';
export {
  IntentFrontmatterSchema,
  IntentAnchorSchema,
  DeterministicRuleSchema,
  VerdictSchema,
} from './intent/schema.js';

// Compile
export { buildIndex } from './compile/index-builder.js';
export { buildManifest } from './compile/manifest.js';
export type { Manifest, ManifestEntry } from './compile/manifest.js';
