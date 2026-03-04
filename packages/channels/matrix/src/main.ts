import { createBusClient } from '@nachos/bus';
import { createChannelBus } from '@nachos/channel-base';
import { loadAndValidateConfig, type NachosConfig } from '@nachos/config';
import { createLogger, type ChannelAdapterConfig } from '@nachos/types';
import { MatrixChannelAdapter } from './index.js';

const logger = createLogger('channel-matrix');

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
  if (process.env.MATRIX_ACCESS_TOKEN) {
    secrets.MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;
  }
  if (process.env.MATRIX_HOMESERVER_URL) {
    secrets.MATRIX_HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL;
  }
  if (process.env.MATRIX_USER_ID) {
    secrets.MATRIX_USER_ID = process.env.MATRIX_USER_ID;
  }
  return secrets;
}

/**
 * Merge CHANNEL_MATRIX_* env vars into channel config when TOML sections are missing.
 * TOML config always takes precedence -- env vars are only the fallback.
 */
export function applyEnvBridge(channelConfig: Record<string, unknown>): void {
  // Inject homeserver/token/userId from env if not set in TOML
  if (!channelConfig.homeserver_url && process.env.MATRIX_HOMESERVER_URL) {
    channelConfig.homeserver_url = process.env.MATRIX_HOMESERVER_URL;
  }
  if (!channelConfig.access_token && process.env.MATRIX_ACCESS_TOKEN) {
    channelConfig.access_token = process.env.MATRIX_ACCESS_TOKEN;
  }
  if (!channelConfig.user_id && process.env.MATRIX_USER_ID) {
    channelConfig.user_id = process.env.MATRIX_USER_ID;
  }
  if (!channelConfig.device_id && process.env.MATRIX_DEVICE_ID) {
    channelConfig.device_id = process.env.MATRIX_DEVICE_ID;
  }

  // Build server config from env vars if not set in TOML
  const servers = channelConfig.servers as Array<Record<string, unknown>> | undefined;
  if (!servers?.length) {
    const roomIds = process.env.CHANNEL_MATRIX_ROOM_IDS;
    if (roomIds) {
      channelConfig.servers = [
        {
          ids: roomIds.split(',').filter(Boolean),
          channel_ids: process.env.CHANNEL_MATRIX_CHANNEL_IDS?.split(',').filter(Boolean) ?? [],
          user_allowlist:
            process.env.CHANNEL_MATRIX_USER_ALLOWLIST?.split(',').filter(Boolean) ?? [],
          mention_gating: process.env.CHANNEL_MATRIX_MENTION_GATING !== 'false',
        },
      ];
      logger.info({ roomIds }, 'Built server config from CHANNEL_MATRIX_* env vars');
    }
  }

  // Build DM allowlist from env vars if not set in TOML
  const dm = channelConfig.dm as { user_allowlist?: string[] } | undefined;
  if (!dm?.user_allowlist?.length) {
    const dmAllowlist = process.env.CHANNEL_MATRIX_DM_ALLOWLIST;
    if (dmAllowlist) {
      channelConfig.dm = {
        ...dm,
        user_allowlist: dmAllowlist.split(',').filter(Boolean),
      };
      logger.info('Built DM allowlist from CHANNEL_MATRIX_DM_ALLOWLIST env var');
    }
  }
}

async function main(): Promise<void> {
  if (
    !process.env.MATRIX_ACCESS_TOKEN ||
    !process.env.MATRIX_HOMESERVER_URL ||
    !process.env.MATRIX_USER_ID
  ) {
    logger.warn(
      'MATRIX_ACCESS_TOKEN, MATRIX_HOMESERVER_URL, and MATRIX_USER_ID are required — channel disabled. Set the env vars and restart to enable.'
    );
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
    return;
  }

  const config = loadConfigSafe();
  const channelConfig = (config?.channels?.matrix ?? {}) as Record<string, unknown>;
  const securityMode = config?.security?.mode ?? 'standard';

  applyEnvBridge(channelConfig);

  const busClient = createBusClient({
    servers: process.env.NATS_URL ?? 'nats://bus:4222',
    name: 'channel-matrix',
    token: process.env.NATS_TOKEN,
  });
  await busClient.connect();

  const adapter = new MatrixChannelAdapter();
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

// tsx watch compat: always run main
{
  main().catch((error) => {
    logger.fatal({ err: error }, 'Matrix channel startup failed');
    process.exit(1);
  });
}
