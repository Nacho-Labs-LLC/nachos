import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import { createLogger, type ChannelAdapterConfig } from '@nachos/types';
import { SlackChannelAdapter } from './index.js';

const logger = createLogger('channel-slack');

function loadConfigSafe(): NachosConfig | undefined {
  try {
    return loadAndValidateConfig({ configPath: process.env.NACHOS_CONFIG_PATH });
  } catch (error) {
    logger.warn({ err: error }, 'Failed to load config');
    return undefined;
  }
}

function buildSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (process.env.SLACK_APP_TOKEN) {
    secrets.SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
  }
  if (process.env.SLACK_BOT_TOKEN) {
    secrets.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  }
  if (process.env.SLACK_SIGNING_SECRET) {
    secrets.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  }
  return secrets;
}

async function main(): Promise<void> {
  if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_APP_TOKEN) {
    logger.warn(
      'SLACK_BOT_TOKEN and SLACK_APP_TOKEN not configured — channel disabled. Set the env vars and restart to enable.'
    );
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
    return;
  }

  const config = loadConfigSafe();
  const channelConfig = (config?.channels?.slack ?? {}) as Record<string, unknown>;
  const securityMode = config?.security?.mode ?? 'standard';

  const busClient = createBusClient({
    servers: process.env.NATS_URL ?? 'nats://bus:4222',
    name: 'channel-slack',
    token: process.env.NATS_TOKEN,
  });
  await busClient.connect();

  const adapter = new SlackChannelAdapter();
  const adapterConfig: ChannelAdapterConfig = {
    config: channelConfig,
    secrets: buildSecrets(),
    bus: createChannelBus(busClient),
    securityMode,
  };

  await adapter.initialize(adapterConfig);
  await adapter.start();

  const shutdown = async () => {
    await adapter.stop();
    await busClient.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
}

// tsx watch compat: always run main
{
  main().catch((error) => {
    logger.fatal({ err: error }, 'Slack channel startup failed');
    process.exit(1);
  });
}
