import micromatch from 'micromatch';
import type { Intent } from '../intent/schema.js';
import type { ParsedDiff } from '@anhcompass/graph';

/** Filter intents whose scope overlaps with the diff files */
export function filterByScope(intents: Intent[], diff: ParsedDiff): Intent[] {
  if (diff.files.length === 0) return [];
  return intents.filter((intent) => {
    const matches = micromatch(diff.files, intent.frontmatter.scope);
    return matches.length > 0;
  });
}
