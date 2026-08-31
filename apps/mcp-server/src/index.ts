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
  renderTerminal,
} from '@anhcompass/core';
import { detectProvider } from '@anhcompass/graph';
import { resolveLlmApiKey } from '@anhcompass/llm';

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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = (args ?? {}) as Record<string, any>;

  if (name === 'list_intents') {
    const intentDir = resolve(typedArgs['intentDir'] || '.agent/intent');
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
    const repoRoot = resolve(typedArgs['repoRoot'] || '.');
    const intentDir = resolve(typedArgs['intentDir'] || '.agent/intent');

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
      
      if (name === 'verify_fix' && typedArgs['files']) {
        const files: string[] = typedArgs['files'];
        parsedDiff.files = parsedDiff.files.filter(f => files.includes(f));
        for (const k of Object.keys(parsedDiff.hunks)) {
          if (!files.includes(k)) delete parsedDiff.hunks[k];
        }
      }

      const commit = await getCurrentCommit(repoRoot);
      const apiKey = resolveLlmApiKey(process.env);

      const result = await runPipeline({
        intents,
        diff: parsedDiff,
        diffText,
        repoRoot,
        checkedAtCommit: commit,
        apiKey,
      });

      const output = renderTerminal(result.verdicts);
      return { content: [{ type: 'text', text: output }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to run drift check: ${String(err)}` }] };
    }
  }

  if (name === 'get_architecture_context') {
    const repoRoot = resolve(typedArgs['repoRoot'] || '.');
    const intentDir = resolve(typedArgs['intentDir'] || '.agent/intent');
    const files: string[] = typedArgs['files'] || [];

    try {
      const { intents } = await parseIntentDir(intentDir);
      const provider = await detectProvider(repoRoot);
      let contextStr = `Architecture Context for files: ${files.join(', ')}\n\n`;
      
      const relevantIntents = intents.filter(i => {
        // Simplified check, normally would use micromatch on i.frontmatter.scope
        return true; 
      });
      contextStr += `Relevant Intents: ${relevantIntents.map(i => i.frontmatter.id).join(', ')}\n`;

      if (provider.getQueryEngine) {
        const query = await provider.getQueryEngine();
        const neighbors = query.neighbors(files, 1);
        contextStr += `Graph Context (1 hop neighbors): ${neighbors.join(', ')}\n`;
      }

      return { content: [{ type: 'text', text: contextStr }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to get context: ${String(err)}` }] };
    }
  }

  if (name === 'check_plan') {
    const planText = typedArgs['plan_text'];
    return { content: [{ type: 'text', text: `[Not Implemented in Phase 3 yet] check_plan called with text length: ${planText?.length}` }] };
  }

  if (name === 'explain_violation') {
    return { content: [{ type: 'text', text: `[Not Implemented in Phase 3 yet] explain_violation for intent ${typedArgs['intentId']}` }] };
  }

  throw new Error(`Tool not found: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
