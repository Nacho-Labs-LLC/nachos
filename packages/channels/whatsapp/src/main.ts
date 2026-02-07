import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import type { ChannelAdapterConfig } from '@nachos/types';
import { WhatsappChannelAdapter } from './index.js';

function loadConfigSafe(): NachosConfig | undefined {
  try {
    return loadAndValidateConfig({ configPath: process.env.NACHOS_CONFIG_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[WhatsApp] Failed to load config: ${message}`);
    return undefined;
  }
}

function buildSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (process.env.WHATSAPP_TOKEN) {
    secrets.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  }
  if (process.env.WHATSAPP_PHONE_NUMBER_ID) {
    secrets.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
  if (process.env.WHATSAPP_VERIFY_TOKEN) {
    secrets.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  }
  if (process.env.WHATSAPP_APP_SECRET) {
    secrets.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
  }
  return secrets;
}

async function main(): Promise<void> {
  const config = loadConfigSafe();
  const channelConfig = (config?.channels?.whatsapp ?? {}) as Record<string, unknown>;
  const securityMode = config?.security?.mode ?? 'standard';

  const busClient = createBusClient({
    servers: process.env.NATS_URL ?? 'nats://bus:4222',
    name: 'channel-whatsapp',
  });
  await busClient.connect();

  const adapter = new WhatsappChannelAdapter();
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('WhatsApp channel startup failed:', error);
    process.exit(1);
  });
}
