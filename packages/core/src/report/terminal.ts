import pc from 'picocolors';
import type { Verdict } from '../intent/schema.js';
import type { BaselineDiff } from '../baseline/baseline.js';

const STATUS_ICON: Record<Verdict['status'], string> = {
  pass: '✓',
  violation: '✗',
  uncertain: '?',
  'stale-intent': '⚠',
};

const STATUS_COLOR: Record<Verdict['status'], (s: string) => string> = {
  pass: pc.green,
  violation: pc.red,
  uncertain: pc.yellow,
  'stale-intent': pc.yellow,
};

export function renderTerminal(verdicts: Verdict[]): string {
  if (verdicts.length === 0) {
    return pc.green('✓ No intents in scope — nothing to check');
  }

  const lines: string[] = [];

  for (const v of verdicts) {
    const icon = STATUS_ICON[v.status];
    const colorFn = STATUS_COLOR[v.status];
    const enforcement =
      v.status === 'violation' ? (v.enforcement === 'block' ? ' [BLOCK]' : ' [WARN]') : '';
    lines.push(colorFn(`${icon} [${v.intentId}] ${v.status.toUpperCase()}${enforcement} (confidence: ${(v.confidence * 100).toFixed(0)}%, engine: ${v.engine})`));

    for (const ev of v.evidence) {
      lines.push(`    ${pc.dim(ev.file)}${ev.line ? `:${ev.line}` : ''}`);
      lines.push(`    ${pc.dim(ev.excerpt)}`);
      lines.push(`    ${pc.italic(ev.reason)}`);
    }

    if (v.suggestion) {
      lines.push(`    💡 ${v.suggestion}`);
    }
  }

  const violations = verdicts.filter((v) => v.status === 'violation');
  const blocking = violations.filter((v) => v.enforcement === 'block').length;
  const warning = violations.length - blocking;
  const uncertain = verdicts.filter((v) => v.status === 'uncertain').length;
  const passed = verdicts.filter((v) => v.status === 'pass').length;

  lines.push('');
  lines.push(
    `Summary: ${pc.green(String(passed))} pass · ${pc.red(String(blocking))} blocking · ${pc.yellow(String(warning))} warning · ${pc.yellow(String(uncertain))} uncertain`,
  );

  return lines.join('\n');
}

export function renderBaselineDiff(diff: BaselineDiff): string {
  const lines: string[] = [pc.bold('Baseline comparison:')];

  const hasVerdictChanges =
    diff.regressions.length > 0 || diff.improvements.length > 0 || diff.otherChanges.length > 0;
  const ruleNote = (changed: boolean) => (changed ? pc.magenta(' (rule changed)') : '');

  for (const r of diff.regressions) {
    lines.push(pc.red(`  ✗ REGRESSION [${r.intentId}] ${r.from} → ${r.to}`) + ruleNote(r.ruleChanged));
  }
  for (const i of diff.improvements) {
    lines.push(pc.green(`  ✓ improved [${i.intentId}] ${i.from} → ${i.to}`) + ruleNote(i.ruleChanged));
  }
  for (const c of diff.otherChanges) {
    lines.push(pc.yellow(`  ~ changed [${c.intentId}] ${c.from} → ${c.to}`) + ruleNote(c.ruleChanged));
  }
  if (!hasVerdictChanges) {
    lines.push(pc.green('  ✓ No verdict changes vs baseline'));
  }

  if (diff.changedIntents.length > 0) {
    lines.push(pc.magenta(`  ⚠ rules edited since baseline: ${diff.changedIntents.join(', ')}`));
  }
  if (diff.newIntents.length > 0) {
    lines.push(pc.dim(`  + new intents (not in baseline): ${diff.newIntents.join(', ')}`));
  }
  if (diff.removedIntents.length > 0) {
    lines.push(pc.dim(`  - removed intents: ${diff.removedIntents.join(', ')}`));
  }

  return lines.join('\n');
}
