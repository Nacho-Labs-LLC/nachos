/**
 * Claude Code MCP Tool Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { createLogger } from '@nachos/types';
import { ClaudeCodeMcpTool } from './claude-code-mcp-tool.js';

const logger = createLogger('claude-code-mcp');

export { ClaudeCodeMcpTool } from './claude-code-mcp-tool.js';

async function main(): Promise<void> {
  logger.info('Starting Claude Code MCP tool...');

  const nats = await connectToNats();
  const tool = new ClaudeCodeMcpTool();

  setupShutdownHandlers(nats, async () => {
    await tool.stop();
  });

  const config = {
    nats,
    config: {
      maxPromptLength: parseInt(process.env.MAX_PROMPT_LENGTH ?? '4000', 10),
    },
    secrets: {},
    securityMode: (process.env.SECURITY_MODE as 'strict' | 'standard' | 'permissive') ?? 'standard',
  };

  await tool.start(config);
}

// tsx watch compat: always run main
{
  main().catch((error) => {
    logger.fatal({ err: error }, 'Fatal error');
    process.exit(1);
  });
}
