/**
 * Code Runner Tool Entry Point
 *
 * Uses LANGUAGE env var to determine which executor to run:
 * - LANGUAGE=python → Python executor
 * - LANGUAGE=javascript → JavaScript executor
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { createLogger, createValidationError } from '@nachos/types';
import { PythonExecutor } from './python-executor.js';
import { JavaScriptExecutor } from './javascript-executor.js';

const logger = createLogger('code-runner');

// Export for testing
export { PythonExecutor } from './python-executor.js';
export { JavaScriptExecutor } from './javascript-executor.js';
export { OutputFormatter } from './output-formatter.js';

/**
 * Main entry point
 */
async function main() {
  const language = process.env.LANGUAGE ?? 'python';

  logger.info({ language }, 'Starting code runner tool');

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
      throw createValidationError(`Unknown language: ${language}`, { component: 'code-runner' });
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
// tsx watch compat: always run main
{
  main().catch((error) => {
    logger.fatal({ err: error }, 'Fatal error');
    process.exit(1);
  });
}
