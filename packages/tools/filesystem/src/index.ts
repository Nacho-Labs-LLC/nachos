/**
 * Filesystem Tools Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { createLogger } from '@nachos/types';
import { FilesystemReadTool } from './read-tool.js';
import { FilesystemWriteTool } from './write-tool.js';
import { FilesystemEditTool } from './edit-tool.js';
import { FilesystemPatchTool } from './patch-tool.js';
import { ConfigPatchTool } from './config-tool.js';

const logger = createLogger('filesystem-tool');

// Export tools for testing
export { FilesystemReadTool } from './read-tool.js';
export { FilesystemWriteTool } from './write-tool.js';
export { FilesystemEditTool } from './edit-tool.js';
export { FilesystemPatchTool } from './patch-tool.js';
export { ConfigPatchTool } from './config-tool.js';
export { PathValidator } from './path-validator.js';

/**
 * Main entry point
 */
async function main() {
  // Determine which tool to run based on TOOL_MODE env var
  const toolMode = process.env.TOOL_MODE ?? 'read';

  logger.info({ mode: toolMode }, 'Starting filesystem tool');

  // Connect to NATS
  const nats = await connectToNats();

  // Get configuration from environment
  const config = {
    nats,
    config: {
      paths: process.env.ALLOWED_PATHS?.split(',') ?? ['./workspace'],
      config_path: process.env.NACHOS_CONFIG_PATH ?? process.env.CONFIG_PATH,
    },
    secrets: {},
    securityMode: (process.env.SECURITY_MODE as 'strict' | 'standard' | 'permissive') ?? 'standard',
  };

  // Create tool instance(s) based on mode
  // 'readwrite' runs write+edit+patch in a single container (SecurityTier 2)
  const tools: Array<{ start(config: unknown): Promise<void>; stop(): Promise<void> }> = [];

  switch (toolMode) {
    case 'read':
      tools.push(new FilesystemReadTool());
      break;
    case 'write':
      tools.push(new FilesystemWriteTool());
      break;
    case 'edit':
      tools.push(new FilesystemEditTool());
      break;
    case 'patch':
      tools.push(new FilesystemPatchTool());
      break;
    case 'readwrite':
      tools.push(new FilesystemWriteTool());
      tools.push(new FilesystemEditTool());
      tools.push(new FilesystemPatchTool());
      break;
    case 'config':
    case 'config_patch':
      tools.push(new ConfigPatchTool());
      break;
    default:
      logger.error({ mode: toolMode }, 'Unknown tool mode');
      process.exit(1);
  }

  // Setup graceful shutdown
  setupShutdownHandlers(nats, async () => {
    await Promise.all(tools.map((t) => t.stop()));
  });

  // Start all tools (each subscribes to its own NATS topic)
  await Promise.all(tools.map((t) => t.start(config)));
}

// Run if this is the main module
// tsx watch compat: always run main
{
  main().catch((error) => {
    logger.fatal({ err: error }, 'Fatal error');
    process.exit(1);
  });
}
