/**
 * GitHub Copilot CLI Tool Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { CopilotTool } from './copilot-tool.js';

export { CopilotTool } from './copilot-tool.js';
export { CLIExecutor } from './cli-executor.js';
export * from './types.js';

async function main() {
  console.log('Starting GitHub Copilot CLI tool...');

  // Connect to NATS
  const nats = await connectToNats();

  // Create tool instance
  const tool = new CopilotTool();

  // Setup graceful shutdown
  setupShutdownHandlers(nats, async () => {
    await tool.stop();
  });

  // Get configuration from environment
  const secrets: Record<string, string> = {};
  if (process.env.GH_TOKEN) {
    secrets.ghToken = process.env.GH_TOKEN;
  }

  const config = {
    nats,
    config: {
      maxPromptLength: parseInt(process.env.MAX_PROMPT_LENGTH ?? '4000', 10),
      maxOutputSize: parseInt(process.env.MAX_OUTPUT_SIZE ?? '50000', 10),
      defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT_SEC ?? '30', 10),
      maxTimeout: parseInt(process.env.MAX_TIMEOUT_SEC ?? '60', 10),
    },
    secrets,
    securityMode: (process.env.SECURITY_MODE as 'strict' | 'standard' | 'permissive') ?? 'standard',
  };

  // Start the tool
  await tool.start(config);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
