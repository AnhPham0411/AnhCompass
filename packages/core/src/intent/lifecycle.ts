import type { Intent } from './schema.js';

/** Transitions allowed per lifecycle rules */
export type StatusTransition = {
  from: Intent['frontmatter']['status'];
  to: Intent['frontmatter']['status'];
};

const ALLOWED: StatusTransition[] = [
  { from: 'proposed', to: 'active' },
  { from: 'active', to: 'deprecated' },
  { from: 'proposed', to: 'deprecated' },
];

export function canTransition(
  from: Intent['frontmatter']['status'],
  to: Intent['frontmatter']['status'],
): boolean {
  return ALLOWED.some((t) => t.from === from && t.to === to);
}

export class LifecycleTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid lifecycle transition: ${from} → ${to}`);
    this.name = 'LifecycleTransitionError';
  }
}

export function assertTransition(
  from: Intent['frontmatter']['status'],
  to: Intent['frontmatter']['status'],
): void {
  if (!canTransition(from, to)) {
    throw new LifecycleTransitionError(from, to);
  }
}
