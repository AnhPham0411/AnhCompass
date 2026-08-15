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

  lines.push('| Intent | Status | Enforcement | Engine | Confidence |');
  lines.push('|--------|--------|-------------|--------|------------|');

  for (const v of verdicts) {
    const emoji = STATUS_EMOJI[v.status];
    const enforcement =
      v.status === 'violation' ? (v.enforcement === 'block' ? '🚫 block' : '⚠️ warn') : '—';
    lines.push(`| \`${v.intentId}\` | ${emoji} ${v.status} | ${enforcement} | ${v.engine} | ${(v.confidence * 100).toFixed(0)}% |`);
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

  const all_violations = verdicts.filter((v) => v.status === 'violation');
  const blocking_n = all_violations.filter((v) => v.enforcement === 'block').length;
  const warning_n = all_violations.length - blocking_n;
  const uncertain_n = verdicts.filter((v) => v.status === 'uncertain').length;
  const pass_n = verdicts.filter((v) => v.status === 'pass').length;

  lines.push(
    '',
    `---`,
    `_${pass_n} pass · ${blocking_n} blocking · ${warning_n} warning · ${uncertain_n} uncertain — only deterministic violations with severity \`error\` block CI_`,
  );

  return lines.join('\n');
}
