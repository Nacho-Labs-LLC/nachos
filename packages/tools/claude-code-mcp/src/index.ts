/**
 * Claude Code MCP Tool Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { ClaudeCodeMcpTool } from './claude-code-mcp-tool.js';

export { ClaudeCodeMcpTool } from './claude-code-mcp-tool.js';

async function main(): Promise<void> {
  console.log('Starting Claude Code MCP tool...');

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
