import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import { createLogger, type ChannelAdapterConfig } from '@nachos/types';
import { DiscordChannelAdapter } from './index.js';

const logger = createLogger('channel-discord');

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
  if (process.env.DISCORD_BOT_TOKEN) {
    secrets.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  }
  return secrets;
}

async function main(): Promise<void> {
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.warn('DISCORD_BOT_TOKEN not configured — channel disabled. Set the env var and restart to enable.');
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
    return;
  }

  const config = loadConfigSafe();
  const channelConfig = (config?.channels?.discord ?? {}) as Record<string, unknown>;
  const securityMode = config?.security?.mode ?? 'standard';

  const busClient = createBusClient({
    servers: process.env.NATS_URL ?? 'nats://bus:4222',
    name: 'channel-discord',
    token: process.env.NATS_TOKEN,
  });
  await busClient.connect();

  const adapter = new DiscordChannelAdapter();
  const adapterConfig: ChannelAdapterConfig = {
    config: channelConfig,
    secrets: buildSecrets(),
    bus: createChannelBus(busClient),
    securityMode,
  };

  await adapter.initialize(adapterConfig);
  logger.info('Starting adapter');
  await adapter.start();
  logger.info('Adapter started — bot should be online');

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

// Always run main — tsx watch doesn't set argv[1] in a way that matches import.meta.url
main().catch((error) => {
  logger.fatal({ err: error }, 'Discord channel startup failed');
  process.exit(1);
});
