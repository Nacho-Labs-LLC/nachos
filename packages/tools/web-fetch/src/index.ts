/**
 * Web Fetch Tool Entry Point
 */

import { connectToNats, setupShutdownHandlers } from '@nachos/tool-base';
import { WebFetchTool } from './web-fetch-tool.js';

// Export for testing
export { WebFetchTool } from './web-fetch-tool.js';
export { SSRFProtection } from './ssrf-protection.js';

async function main() {
  console.log('Starting web_fetch tool...');

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
      firecrawl: {
        enabled: process.env.WEB_FETCH_FIRECRAWL_ENABLED === 'true',
        api_key: process.env.FIRECRAWL_API_KEY,
        base_url: process.env.FIRECRAWL_BASE_URL,
        only_main_content: process.env.FIRECRAWL_ONLY_MAIN_CONTENT
          ? process.env.FIRECRAWL_ONLY_MAIN_CONTENT === 'true'
          : undefined,
        max_age_ms: process.env.FIRECRAWL_MAX_AGE_MS
          ? parseInt(process.env.FIRECRAWL_MAX_AGE_MS, 10)
          : undefined,
        timeout_seconds: process.env.FIRECRAWL_TIMEOUT_SECONDS
          ? parseInt(process.env.FIRECRAWL_TIMEOUT_SECONDS, 10)
          : undefined,
      },
    },
    secrets: {},
    securityMode: (process.env.SECURITY_MODE as 'strict' | 'standard' | 'permissive') ?? 'standard',
  };

  await tool.start(config);
}

// tsx watch compat: always run main
{
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
