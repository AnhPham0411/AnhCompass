import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  parseIntentDir,
  parseDiff,
  getGitDiff,
  getCurrentCommit,
  runPipeline,
  renderMarkdown,
  blockingViolations,
  warningViolations,
} from '@anhcompass/core';
import { resolveLlmApiKey } from '@anhcompass/llm';
import { resolve } from 'node:path';

const MARKER = '<!-- anhcompass-drift-report -->';

async function upsertPRComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existing = comments.find((c) => c.body?.includes(MARKER));
  const fullBody = `${MARKER}\n\n${body}`;

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: fullBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: fullBody,
    });
  }
}

async function main(): Promise<void> {
  const intentDir = resolve(core.getInput('intent-dir') || '.agent/intent');
  const diffRef = core.getInput('diff-ref') || 'origin/main';
  const apiKey = resolveLlmApiKey(process.env);
  const repoRoot = process.cwd();

  const { intents, errors } = await parseIntentDir(intentDir);
  if (errors.length > 0) {
    core.setFailed(`Intent parse errors:\n${errors.map((e) => e.message).join('\n')}`);
    return;
  }

  const diffText = await getGitDiff(repoRoot, diffRef);
  if (!diffText.trim()) {
    core.info('No changes — nothing to check');
    return;
  }

  const diff = parseDiff(diffText);
  const commit = await getCurrentCommit(repoRoot);

  const result = await runPipeline({
    intents,
    diff,
    diffText,
    repoRoot,
    checkedAtCommit: commit,
    apiKey,
    onProgress: (msg) => core.info(msg),
  });

  const report = renderMarkdown(result.verdicts, commit);
  const blocking = blockingViolations(result.verdicts);
  const warnings = warningViolations(result.verdicts);

  core.setOutput('report', report);
  core.setOutput('violations', String(blocking.length + warnings.length));
  core.setOutput('blocking-violations', String(blocking.length));
  core.setOutput('warnings', String(warnings.length));

  // Post PR comment if in PR context
  const context = github.context;
  if (context.payload.pull_request) {
    const token = process.env['GITHUB_TOKEN'];
    if (token) {
      const octokit = github.getOctokit(token);
      const prNumber = context.payload.pull_request.number;
      await upsertPRComment(octokit, context.repo.owner, context.repo.repo, prNumber, report);
    }
  }

  core.info(report);

  // Hybrid enforcement: `block` (default) fails only on deterministic
  // violations with severity error — LLM verdicts alone never fail the job.
  const failOn = core.getInput('fail-on') || 'block';
  if (failOn === 'block' && blocking.length > 0) {
    core.setFailed(`${blocking.length} blocking violation(s) — deterministic evidence`);
  } else if (failOn === 'any' && blocking.length + warnings.length > 0) {
    core.setFailed(`${blocking.length + warnings.length} violation(s) (fail-on: any)`);
  }
}

main().catch((err: unknown) => {
  core.setFailed(String(err));
});
