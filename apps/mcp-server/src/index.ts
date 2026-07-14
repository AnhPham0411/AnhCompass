import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/common/mcp.js';
import { resolve } from 'node:path';
import {
  parseIntentDir,
  parseDiff,
  getWorkingTreeDiff,
  getCurrentCommit,
  runPipeline,
  renderTerminal,
} from '@anhcompass/core';

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
            intentDir: {
              type: 'string',
              description: 'Path to intent directory, default: .agent/intent',
            },
          },
        },
      },
      {
        name: 'check_drift',
        description: 'Run the drift detection pipeline on the current working tree changes',
        inputSchema: {
          type: 'object',
          properties: {
            repoRoot: {
              type: 'string',
              description: 'Absolute path to repository root, default: current directory',
            },
            intentDir: {
              type: 'string',
              description: 'Path to intent directory, default: .agent/intent',
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const typedArgs = (args ?? {}) as Record<string, string>;

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
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to list intents: ${String(err)}` }],
      };
    }
  }

  if (name === 'check_drift') {
    const repoRoot = resolve(typedArgs['repoRoot'] || '.');
    const intentDir = resolve(typedArgs['intentDir'] || '.agent/intent');

    try {
      const { intents, errors } = await parseIntentDir(intentDir);
      if (errors.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Intent parse errors:\n${errors.map((e) => e.message).join('\n')}`,
            },
          ],
        };
      }

      const diffText = await getWorkingTreeDiff(repoRoot);
      if (!diffText.trim()) {
        return {
          content: [{ type: 'text', text: 'No local changes to check.' }],
        };
      }

      const parsedDiff = parseDiff(diffText);
      const commit = await getCurrentCommit(repoRoot);
      const apiKey = process.env['ANTHROPIC_API_KEY'];

      const result = await runPipeline({
        intents,
        diff: parsedDiff,
        diffText,
        repoRoot,
        checkedAtCommit: commit,
        apiKey,
      });

      const output = renderTerminal(result.verdicts);
      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to run drift check: ${String(err)}` }],
      };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
