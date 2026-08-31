import type { Intent, Verdict } from '../intent/schema.js';

/** Plain-text rendering for consumers that are not terminals.
 *
 *  The terminal renderer emits ANSI colour codes. An MCP client is a program,
 *  and escape sequences in a tool result are noise an agent has to parse
 *  around. */
export function renderPlain(verdicts: Verdict[]): string {
  if (verdicts.length === 0) {
    return 'No intents in scope — nothing to check.';
  }

  const lines: string[] = [];

  for (const v of verdicts) {
    const enforcement =
      v.status === 'violation' ? ` [${v.enforcement === 'block' ? 'BLOCK' : 'WARN'}]` : '';
    lines.push(
      `${v.status.toUpperCase()}${enforcement} ${v.intentId} (confidence ${(v.confidence * 100).toFixed(0)}%, engine ${v.engine})`,
    );

    for (const ev of v.evidence) {
      lines.push(`  ${ev.file}${ev.line ? `:${ev.line}` : ''}`);
      lines.push(`    ${ev.excerpt}`);
      lines.push(`    reason: ${ev.reason}`);
    }

    if (v.suggestion) lines.push(`  suggestion: ${v.suggestion}`);
  }

  const violations = verdicts.filter((v) => v.status === 'violation');
  const blocking = violations.filter((v) => v.enforcement === 'block').length;

  lines.push('');
  lines.push(
    `Summary: ${verdicts.filter((v) => v.status === 'pass').length} pass, ${blocking} blocking, ` +
      `${violations.length - blocking} warning, ${verdicts.filter((v) => v.status === 'uncertain').length} uncertain.`,
  );

  return lines.join('\n');
}

/** A full account of one verdict: the rule, why it exists, what was found, and
 *  what to do about it. An agent acting on a violation needs the rationale, not
 *  just the string that matched. */
export function renderExplanation(intent: Intent, verdict: Verdict): string {
  const fm = intent.frontmatter;
  const lines: string[] = [
    `Intent: ${fm.id} — ${fm.title}`,
    `Severity: ${fm.severity} · Check: ${fm.check} · Status: ${fm.status}`,
    `Scope: ${fm.scope.join(', ')}`,
    '',
    'Rule:',
    ...fm.rule.trim().split('\n').map((l) => `  ${l}`),
  ];

  if (intent.body.trim()) {
    lines.push('', 'Why this rule exists:', ...intent.body.trim().split('\n').map((l) => `  ${l}`));
  }

  lines.push('', `Verdict: ${verdict.status.toUpperCase()} (engine ${verdict.engine}, confidence ${(verdict.confidence * 100).toFixed(0)}%)`);

  if (verdict.status === 'violation') {
    lines.push(
      `Enforcement: ${verdict.enforcement === 'block' ? 'block — this fails CI' : 'warn — this does not fail CI'}`,
    );
  }

  if (verdict.evidence.length > 0) {
    lines.push('', 'Evidence:');
    for (const ev of verdict.evidence) {
      lines.push(`  ${ev.file}${ev.line ? `:${ev.line}` : ''}`);
      lines.push(`    ${ev.excerpt}`);
      lines.push(`    ${ev.reason}`);
    }
  } else if (verdict.status === 'violation') {
    lines.push('', 'Evidence: none recorded.');
  }

  if (verdict.suggestion) lines.push('', `How to fix: ${verdict.suggestion}`);

  if (verdict.status === 'violation' && verdict.engine === 'deterministic') {
    lines.push(
      '',
      'If this instance is a deliberate exception, waive that line explicitly:',
      `  // anhcompass-disable-next-line ${fm.id}`,
      'An unexplained waiver is worse than the violation — say why in a comment beside it.',
    );
  }

  return lines.join('\n');
}
