import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import type { ChannelAdapterConfig } from '@nachos/types';
import { DiscordChannelAdapter } from './index.js';

function loadConfigSafe(): NachosConfig | undefined {
  try {
    return loadAndValidateConfig({ configPath: process.env.NACHOS_CONFIG_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Discord] Failed to load config: ${message}`);
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
  console.log('[Discord] main() called');
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn(
      '[Discord] DISCORD_BOT_TOKEN not configured — channel disabled. Set the env var and restart to enable.'
    );
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
  console.log('[Discord] Starting adapter...');
  await adapter.start();
  console.log('[Discord] Adapter started — bot should be online!');

  const shutdown = async () => {
    await adapter.stop();
    await busClient.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

// Always run main — tsx watch doesn't set argv[1] in a way that matches import.meta.url
main().catch((error) => {
  console.error('Discord channel startup failed:', error);
  process.exit(1);
});
