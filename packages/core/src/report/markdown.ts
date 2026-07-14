import type { Verdict } from '../intent/schema.js';

const STATUS_EMOJI: Record<Verdict['status'], string> = {
  pass: '✅',
  violation: '❌',
  uncertain: '⚠️',
  'stale-intent': '🔶',
};

export function renderMarkdown(verdicts: Verdict[], commitRef: string): string {
  const lines: string[] = [
    '## AnhCompass Drift Report',
    '',
    `> Checked at commit: \`${commitRef}\``,
    '',
  ];

  if (verdicts.length === 0) {
    lines.push('✅ No intents in scope for this diff.');
    return lines.join('\n');
  }

  lines.push('| Intent | Status | Engine | Confidence |');
  lines.push('|--------|--------|--------|------------|');

  for (const v of verdicts) {
    const emoji = STATUS_EMOJI[v.status];
    lines.push(`| \`${v.intentId}\` | ${emoji} ${v.status} | ${v.engine} | ${(v.confidence * 100).toFixed(0)}% |`);
  }

  const violations = verdicts.filter((v) => v.status === 'violation');

  if (violations.length > 0) {
    lines.push('', '### Violations', '');
    for (const v of violations) {
      lines.push(`#### \`${v.intentId}\``, '');
      for (const ev of v.evidence) {
        lines.push(`**${ev.file}**${ev.line ? `:${ev.line}` : ''}`, '');
        lines.push('```', ev.excerpt, '```', '');
        lines.push(`> ${ev.reason}`, '');
      }
      if (v.suggestion) {
        lines.push(`💡 **Suggestion:** ${v.suggestion}`, '');
      }
    }
  }

  const violations_n = verdicts.filter((v) => v.status === 'violation').length;
  const uncertain_n = verdicts.filter((v) => v.status === 'uncertain').length;
  const pass_n = verdicts.filter((v) => v.status === 'pass').length;

  lines.push('', `---`, `_${pass_n} pass · ${violations_n} violation · ${uncertain_n} uncertain_`);

  return lines.join('\n');
}
