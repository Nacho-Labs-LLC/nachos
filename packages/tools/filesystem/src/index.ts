/**
 * Filesystem Tools Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { FilesystemReadTool } from './read-tool.js';
import { FilesystemWriteTool } from './write-tool.js';
import { FilesystemEditTool } from './edit-tool.js';
import { FilesystemPatchTool } from './patch-tool.js';
import { ConfigPatchTool } from './config-tool.js';

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

  console.log(`Starting filesystem tool in mode: ${toolMode}`);

  // Connect to NATS
  const nats = await connectToNats();

  // Create tool instance based on mode
  let tool;
  switch (toolMode) {
    case 'read':
      tool = new FilesystemReadTool();
      break;
    case 'write':
      tool = new FilesystemWriteTool();
      break;
    case 'edit':
      tool = new FilesystemEditTool();
      break;
    case 'patch':
      tool = new FilesystemPatchTool();
      break;
    case 'config':
    case 'config_patch':
      tool = new ConfigPatchTool();
      break;
    default:
      console.error(`Unknown tool mode: ${toolMode}`);
      process.exit(1);
  }

  // Setup graceful shutdown
  setupShutdownHandlers(nats, async () => {
    await tool.stop();
  });

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
