import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import {
  parseIntentDir,
  parseDiff,
  getWorkingTreeDiff,
  getCurrentCommit,
  runPipeline,
  runDeterministicCheck,
  withEnforcement,
  checkPlan,
  renderPlanReview,
  renderPlain,
  renderExplanation,
} from '@anhcompass/core';
import { detectProvider } from '@anhcompass/graph';
import { resolveLlmApiKey, resolveLlmProvider } from '@anhcompass/llm';
import micromatch from 'micromatch';

const server = new Server(
  {
    name: 'anhcompass-mcp-server',
    version: '0.0.1',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_intents',
        description: 'List all intent-based rules defined in the workspace (.agent/intent/)',
        inputSchema: {
          type: 'object',
          properties: {
            intentDir: { type: 'string', description: 'Path to intent directory, default: .agent/intent' },
          },
        },
      },
      {
        name: 'check_drift',
        description: 'Run the drift detection pipeline on the current working tree changes',
        inputSchema: {
          type: 'object',
          properties: {
            repoRoot: { type: 'string', description: 'Absolute path to repository root, default: current directory' },
            intentDir: { type: 'string', description: 'Path to intent directory, default: .agent/intent' },
          },
        },
      },
      {
        name: 'get_architecture_context',
        description: 'Get architecture context (intents and graph context) around specific files',
        inputSchema: {
          type: 'object',
          properties: {
            repoRoot: { type: 'string', description: 'Absolute path to repository root, default: current directory' },
            intentDir: { type: 'string', description: 'Path to intent directory, default: .agent/intent' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files to get context for',
            },
          },
          required: ['files'],
        },
      },
      {
        name: 'check_plan',
        description: 'Validate an implementation plan against architecture intents',
        inputSchema: {
          type: 'object',
          properties: {
            repoRoot: { type: 'string', description: 'Absolute path to repository root, default: current directory' },
            intentDir: { type: 'string', description: 'Path to intent directory, default: .agent/intent' },
            plan_text: { type: 'string', description: 'The markdown text of the implementation plan' },
          },
          required: ['plan_text'],
        },
      },
      {
        name: 'explain_violation',
        description: 'Explain a specific architecture violation in detail',
        inputSchema: {
          type: 'object',
          properties: {
            repoRoot: { type: 'string', description: 'Absolute path to repository root, default: current directory' },
            intentId: { type: 'string', description: 'The ID of the violated intent' },
            diff_text: { type: 'string', description: 'The diff text causing the violation' },
          },
          required: ['intentId', 'diff_text'],
        },
      },
      {
        name: 'verify_fix',
        description: 'Re-run drift check on specific files to confirm a fix',
        inputSchema: {
          type: 'object',
          properties: {
            repoRoot: { type: 'string', description: 'Absolute path to repository root, default: current directory' },
            intentDir: { type: 'string', description: 'Path to intent directory, default: .agent/intent' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files that were fixed',
            },
          },
          required: ['files'],
        },
      },
    ],
  };
});

/** MCP arguments arrive from another program over stdio, so they are external
 *  data and are read, never trusted: a value of the wrong shape is dropped and
 *  the default applies, rather than reaching the pipeline as a bad type. */
function argString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function argStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs: Record<string, unknown> = args ?? {};

  if (name === 'list_intents') {
    const intentDir = resolve(argString(typedArgs, 'intentDir') || '.agent/intent');
    try {
      const { intents, errors } = await parseIntentDir(intentDir);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ intents, errors }, null, 2),
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to list intents: ${String(err)}` }] };
    }
  }

  if (name === 'check_drift' || name === 'verify_fix') {
    const repoRoot = resolve(argString(typedArgs, 'repoRoot') || '.');
    const intentDir = resolve(argString(typedArgs, 'intentDir') || '.agent/intent');

    try {
      const { intents, errors } = await parseIntentDir(intentDir);
      if (errors.length > 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Intent parse errors:\n${errors.map((e) => e.message).join('\n')}` }],
        };
      }

      let diffText = await getWorkingTreeDiff(repoRoot);
      if (!diffText.trim()) {
        return { content: [{ type: 'text', text: 'No local changes to check.' }] };
      }

      const parsedDiff = parseDiff(diffText);
      
      const requestedFiles = argStringArray(typedArgs, 'files');
      if (name === 'verify_fix' && requestedFiles.length > 0) {
        const files = requestedFiles;
        parsedDiff.files = parsedDiff.files.filter(f => files.includes(f));
        for (const k of Object.keys(parsedDiff.hunks)) {
          if (!files.includes(k)) delete parsedDiff.hunks[k];
        }
      }

      const commit = await getCurrentCommit(repoRoot);
      const apiKey = resolveLlmApiKey(process.env);
      const llmProvider = apiKey ? resolveLlmProvider(process.env, apiKey) : undefined;

      const result = await runPipeline({
        intents,
        diff: parsedDiff,
        diffText,
        repoRoot,
        checkedAtCommit: commit,
        apiKey,
        llmProvider,
      });

      const output = renderPlain(result.verdicts);
      return { content: [{ type: 'text', text: output }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to run drift check: ${String(err)}` }] };
    }
  }

  if (name === 'get_architecture_context') {
    const repoRoot = resolve(argString(typedArgs, 'repoRoot') || '.');
    const intentDir = resolve(argString(typedArgs, 'intentDir') || '.agent/intent');
    const files = argStringArray(typedArgs, 'files');

    try {
      const { intents } = await parseIntentDir(intentDir);
      const provider = await detectProvider(repoRoot);

      // Only rules whose scope actually covers these files. Returning every
      // rule buries the two that matter and teaches the agent to skim.
      const relevant = intents.filter(
        (i) =>
          i.frontmatter.status === 'active' &&
          micromatch(files, i.frontmatter.scope).length > 0,
      );

      const lines = [`Architecture context for: ${files.join(', ')}`, ''];

      if (relevant.length === 0) {
        lines.push('No active intent covers these files.');
      } else {
        lines.push(`${relevant.length} active intent(s) apply here:`);
        for (const i of relevant) {
          lines.push(
            '',
            `- ${i.frontmatter.id} (${i.frontmatter.severity}, ${i.frontmatter.check})`,
            `  ${i.frontmatter.title}`,
            `  rule: ${i.frontmatter.rule.trim().replace(/\n/g, '\n        ')}`,
          );
        }
      }

      if (provider.getQueryEngine) {
        const query = await provider.getQueryEngine();
        const neighbors = query.neighbors(files, 1).filter((n) => !files.includes(n));
        lines.push(
          '',
          neighbors.length > 0
            ? `Direct dependencies and dependents: ${neighbors.join(', ')}`
            : 'No indexed dependencies or dependents for these files.',
        );
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to get context: ${String(err)}` }] };
    }
  }

  if (name === 'check_plan') {
    const intentDir = resolve(argString(typedArgs, 'intentDir') || '.agent/intent');
    const planText = argString(typedArgs, 'plan_text') ?? '';

    if (!planText.trim()) {
      return { isError: true, content: [{ type: 'text', text: 'plan_text is required.' }] };
    }

    try {
      const { intents, errors } = await parseIntentDir(intentDir);
      if (errors.length > 0) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Intent parse errors:\n${errors.map((e) => e.message).join('\n')}` }],
        };
      }

      const mcpApiKey = resolveLlmApiKey(process.env);
      const result = await checkPlan({
        intents,
        planText,
        apiKey: mcpApiKey,
        llmProvider: mcpApiKey ? resolveLlmProvider(process.env, mcpApiKey) : undefined,
      });
      return { content: [{ type: 'text', text: renderPlanReview(result) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to review plan: ${String(err)}` }] };
    }
  }

  if (name === 'explain_violation') {
    const repoRoot = resolve(argString(typedArgs, 'repoRoot') || '.');
    const intentDir = resolve(argString(typedArgs, 'intentDir') || '.agent/intent');
    const intentId = argString(typedArgs, 'intentId') ?? '';
    const diffText = argString(typedArgs, 'diff_text') ?? '';

    try {
      const { intents } = await parseIntentDir(intentDir);
      const intent = intents.find((i) => i.frontmatter.id === intentId);
      if (!intent) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No intent with id "${intentId}". Known ids: ${intents.map((i) => i.frontmatter.id).join(', ') || '(none)'}`,
            },
          ],
        };
      }

      const parsedDiff = parseDiff(diffText);
      if (parsedDiff.files.length === 0) {
        // Answering "pass" for input we could not read would be the worst
        // possible reply: a green light nobody checked.
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                'diff_text contained no recognisable file headers, so nothing could be attributed to a file.\n' +
                'Pass a unified diff, for example:\n' +
                '  diff --git a/src/utils.ts b/src/utils.ts\n' +
                '  +++ b/src/utils.ts\n' +
                '  @@ -1,2 +1,3 @@\n' +
                "  +import _ from 'lodash';",
            },
          ],
        };
      }
      const provider = await detectProvider(repoRoot);
      const { verdict } = await runDeterministicCheck(
        intent,
        parsedDiff,
        await getCurrentCommit(repoRoot),
        provider,
        repoRoot,
      );

      return {
        content: [{ type: 'text', text: renderExplanation(intent, withEnforcement(intent, verdict)) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to explain violation: ${String(err)}` }] };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
