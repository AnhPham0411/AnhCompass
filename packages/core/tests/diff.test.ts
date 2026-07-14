import { describe, it, expect } from 'vitest';
import { parseDiff } from '../src/diff/parse.js';

const SAMPLE_DIFF = `diff --git a/src/api/order.ts b/src/api/order.ts
index abc1234..def5678 100644
--- a/src/api/order.ts
+++ b/src/api/order.ts
@@ -1,3 +1,5 @@
+import Stripe from 'stripe';
+
 export async function createOrder() {
-  // old
+  // new
 }
`;

describe('parseDiff', () => {
  it('extracts files from git diff', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.files).toContain('src/api/order.ts');
  });

  it('extracts added lines in hunks', () => {
    const result = parseDiff(SAMPLE_DIFF);
    const hunks = result.hunks['src/api/order.ts'] ?? [];
    const addedLines = hunks.filter((l) => l.startsWith('+'));
    expect(addedLines.some((l) => l.includes("import Stripe from 'stripe'"))).toBe(true);
  });

  it('returns empty for empty diff', () => {
    const result = parseDiff('');
    expect(result.files).toHaveLength(0);
  });

  it('handles multiple files', () => {
    const multi = `diff --git a/foo.ts b/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
+const x = 1;
diff --git a/bar.ts b/bar.ts
+++ b/bar.ts
@@ -1 +1 @@
+const y = 2;
`;
    const result = parseDiff(multi);
    expect(result.files.length).toBeGreaterThanOrEqual(1);
  });
});
