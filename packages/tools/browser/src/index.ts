/**
 * Browser Tool Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { BrowserTool } from './browser-tool.js';

// Export for testing
export { BrowserTool } from './browser-tool.js';
export { SSRFProtection } from './ssrf-protection.js';
export { PlaywrightWrapper } from './playwright-wrapper.js';

/**
 * Main entry point
 */
async function main() {
  console.log('Starting browser tool...');

  // Connect to NATS
  const nats = await connectToNats();

  // Create tool instance
  const tool = new BrowserTool();

  // Setup graceful shutdown
  setupShutdownHandlers(nats, async () => {
    await tool.stop();
  });

  // Get configuration from environment
  const config = {
    nats,
    config: {
      allowed_domains: process.env.ALLOWED_DOMAINS?.split(',') ?? ['*'],
      headless: process.env.BROWSER_HEADLESS !== 'false',
      timeout: parseInt(process.env.BROWSER_TIMEOUT_MS ?? '30000', 10),
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
