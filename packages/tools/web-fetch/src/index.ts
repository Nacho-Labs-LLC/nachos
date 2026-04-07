/**
 * Web Fetch Tool Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { createLogger } from '@nachos/types';
import { WebFetchTool } from './web-fetch-tool.js';

const logger = createLogger('web-fetch');

// Export for testing
export { WebFetchTool } from './web-fetch-tool.js';
export { SSRFProtection } from './ssrf-protection.js';

async function main() {
  logger.info('Starting web_fetch tool...');

  const nats = await connectToNats();
  const tool = new WebFetchTool();

  setupShutdownHandlers(nats, async () => {
    await tool.stop();
  });

  const config = {
    nats,
    config: {
      allowed_domains: process.env.WEB_FETCH_ALLOWED_DOMAINS?.split(',') ??
        process.env.ALLOWED_DOMAINS?.split(',') ?? ['*'],
      max_chars: parseInt(process.env.WEB_FETCH_MAX_CHARS ?? '50000', 10),
      timeout_seconds: parseInt(process.env.WEB_FETCH_TIMEOUT_SECONDS ?? '30', 10),
      max_redirects: parseInt(process.env.WEB_FETCH_MAX_REDIRECTS ?? '3', 10),
      user_agent: process.env.WEB_FETCH_USER_AGENT,
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
