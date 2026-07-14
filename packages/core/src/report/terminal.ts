import pc from 'picocolors';
import type { Verdict } from '../intent/schema.js';

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
    lines.push(colorFn(`${icon} [${v.intentId}] ${v.status.toUpperCase()} (confidence: ${(v.confidence * 100).toFixed(0)}%, engine: ${v.engine})`));

    for (const ev of v.evidence) {
      lines.push(`    ${pc.dim(ev.file)}${ev.line ? `:${ev.line}` : ''}`);
      lines.push(`    ${pc.dim(ev.excerpt)}`);
      lines.push(`    ${pc.italic(ev.reason)}`);
    }

    if (v.suggestion) {
      lines.push(`    💡 ${v.suggestion}`);
    }
  }

  const violations = verdicts.filter((v) => v.status === 'violation').length;
  const uncertain = verdicts.filter((v) => v.status === 'uncertain').length;
  const passed = verdicts.filter((v) => v.status === 'pass').length;

  lines.push('');
  lines.push(`Summary: ${pc.green(String(passed))} pass · ${pc.red(String(violations))} violation · ${pc.yellow(String(uncertain))} uncertain`);

  return lines.join('\n');
}
