import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import { createLogger, type ChannelAdapterConfig } from '@nachos/types';
import { WhatsappChannelAdapter } from './index.js';

const logger = createLogger('channel-whatsapp');

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
  if (
    !process.env.WHATSAPP_TOKEN ||
    !process.env.WHATSAPP_PHONE_NUMBER_ID ||
    !process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    logger.warn(
      'WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_VERIFY_TOKEN are required — channel disabled. Set the env vars and restart to enable.'
    );
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
    return;
  }

  const config = loadConfigSafe();
  const channelConfig = (config?.channels?.whatsapp ?? {}) as Record<string, unknown>;
  const securityMode = config?.security?.mode ?? 'standard';

  const busClient = createBusClient({
    servers: process.env.NATS_URL ?? 'nats://bus:4222',
    name: 'channel-whatsapp',
    token: process.env.NATS_TOKEN,
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
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
}

// tsx watch compat: always run main
{
  main().catch((error) => {
    logger.fatal({ err: error }, 'WhatsApp channel startup failed');
    process.exit(1);
  });
}
