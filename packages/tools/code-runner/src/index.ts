/**
 * Code Runner Tool Entry Point
 *
 * Uses LANGUAGE env var to determine which executor to run:
 * - LANGUAGE=python → Python executor
 * - LANGUAGE=javascript → JavaScript executor
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { PythonExecutor } from './python-executor.js';
import { JavaScriptExecutor } from './javascript-executor.js';

// Export for testing
export { PythonExecutor } from './python-executor.js';
export { JavaScriptExecutor } from './javascript-executor.js';
export { OutputFormatter } from './output-formatter.js';

/**
 * Main entry point
 */
async function main() {
  const language = process.env.LANGUAGE ?? 'python';

  console.log(`Starting code runner tool (language: ${language})...`);

  // Connect to NATS
  const nats = await connectToNats();

  // Create tool instance based on language
  let tool;
  switch (language.toLowerCase()) {
    case 'python':
      tool = new PythonExecutor();
      break;
    case 'javascript':
    case 'js':
    case 'node':
      tool = new JavaScriptExecutor();
      break;
    default:
      throw new Error(`Unknown language: ${language}`);
  }

  // Setup graceful shutdown
  setupShutdownHandlers(nats, async () => {
    await tool.stop();
  });

  // Get configuration from environment
  const config = {
    nats,
    config: {
      executionTimeout: parseInt(process.env.EXECUTION_TIMEOUT ?? '30', 10),
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
