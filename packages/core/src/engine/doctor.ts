import { Intent } from '../intent/schema.js';

export interface DoctorIssue {
  intentId: string;
  type: 'warning' | 'error';
  message: string;
}

export function runDoctor(intents: Intent[]): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  const now = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    const { id, review_after, exceptions, scope } = intent.frontmatter;

    // 1. Expired review_after
    if (review_after && review_after < now) {
      issues.push({
        intentId: id,
        type: 'warning',
        message: `Intent has passed its review date (${review_after}) and should be reviewed.`,
      });
    }

    // 2. Expired exceptions
    if (exceptions) {
      for (const exc of exceptions) {
        if (exc.expires && exc.expires < now) {
          issues.push({
            intentId: id,
            type: 'error',
            message: `Exception for path '${exc.path}' expired on ${exc.expires}.`,
          });
        }
      }
    }

    // 3. Scope overlaps (naive check if scopes intersect heavily)
    for (let j = i + 1; j < intents.length; j++) {
      const other = intents[j];
      // If one scope includes another exactly, or they are identical
      const isIdentical = scope.length === other.frontmatter.scope.length &&
        scope.every((s, idx) => s === other.frontmatter.scope[idx]);
      if (isIdentical) {
        issues.push({
          intentId: id,
          type: 'warning',
          message: `Scope is identical to intent '${other.frontmatter.id}'. Consider merging them.`,
        });
      }
    }
  }

  return issues;
}
