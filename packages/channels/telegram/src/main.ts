import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import type { ChannelAdapterConfig } from '@nachos/types';
import { TelegramChannelAdapter } from './index.js';

function loadConfigSafe(): NachosConfig | undefined {
  try {
    return loadAndValidateConfig({ configPath: process.env.NACHOS_CONFIG_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Telegram] Failed to load config: ${message}`);
    return undefined;
  }
}

function buildSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (process.env.TELEGRAM_BOT_TOKEN) {
    secrets.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  }
  return secrets;
}

async function main(): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn(
      '[Telegram] TELEGRAM_BOT_TOKEN not configured — channel disabled. Set the env var and restart to enable.'
    );
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
    return;
  }

  const config = loadConfigSafe();
  const channelConfig = (config?.channels?.telegram ?? {}) as Record<string, unknown>;
  const securityMode = config?.security?.mode ?? 'standard';

  const busClient = createBusClient({
    servers: process.env.NATS_URL ?? 'nats://bus:4222',
    name: 'channel-telegram',
    token: process.env.NATS_TOKEN,
  });
  await busClient.connect();

  const adapter = new TelegramChannelAdapter();
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
}

// tsx watch compat: always run main
{
  main().catch((error) => {
    console.error('Telegram channel startup failed:', error);
    process.exit(1);
  });
}
