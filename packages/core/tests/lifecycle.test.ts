import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, LifecycleTransitionError } from '../src/intent/lifecycle.js';

describe('canTransition', () => {
  it('allows proposed → active', () => {
    expect(canTransition('proposed', 'active')).toBe(true);
  });
  it('allows active → deprecated', () => {
    expect(canTransition('active', 'deprecated')).toBe(true);
  });
  it('allows proposed → deprecated', () => {
    expect(canTransition('proposed', 'deprecated')).toBe(true);
  });
  it('disallows deprecated → active', () => {
    expect(canTransition('deprecated', 'active')).toBe(false);
  });
  it('disallows active → proposed', () => {
    expect(canTransition('active', 'proposed')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('throws LifecycleTransitionError for invalid transition', () => {
    expect(() => assertTransition('deprecated', 'active')).toThrow(LifecycleTransitionError);
  });
  it('does not throw for valid transition', () => {
    expect(() => assertTransition('proposed', 'active')).not.toThrow();
  });
});
