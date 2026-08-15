import { describe, it, expect } from 'vitest';
import { SemanticVerdictResponseSchema } from '../src/engine/semantic.js';

describe('SemanticVerdictResponseSchema (LLM output tolerance)', () => {
  it('accepts explicit null for line (gpt json mode emits nulls)', () => {
    const result = SemanticVerdictResponseSchema.safeParse({
      status: 'pass',
      confidence: 1,
      evidence: [{ file: 'a.py', line: null, excerpt: 'x', reason: 'ok' }],
      suggestion: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence[0]?.line).toBeUndefined();
    }
  });

  it('truncates over-long excerpts instead of rejecting', () => {
    const result = SemanticVerdictResponseSchema.safeParse({
      status: 'violation',
      confidence: 0.9,
      evidence: [{ file: 'a.py', line: 3, excerpt: 'x'.repeat(500), reason: 'r' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence[0]?.excerpt.length).toBe(300);
    }
  });

  it('still rejects a malformed status', () => {
    const result = SemanticVerdictResponseSchema.safeParse({
      status: 'maybe',
      confidence: 1,
      evidence: [],
    });
    expect(result.success).toBe(false);
  });
});
