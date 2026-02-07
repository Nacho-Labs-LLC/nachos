/**
 * Gateway Service Entry Point
 */
import { createBusClient } from '@nachos/bus';
import { loadAndValidateConfig } from '@nachos/config';
import { createDefaultDLPConfig, type DLPConfig } from './security/dlp.js';
import {
  Gateway,
  loadConfig as loadGatewayConfig,
  validateConfig as validateGatewayConfig,
} from './index.js';
import { NatsBusAdapter } from './router.js';

async function buildDlpConfig(configPath?: string): Promise<DLPConfig | undefined> {
  const nachosConfig = loadAndValidateConfig({ configPath });
  const dlp = nachosConfig.security?.dlp;
  if (!dlp || dlp.enabled === false) {
    return undefined;
  }

  const base = createDefaultDLPConfig();
  const action = dlp.action ?? 'audit';
  const mappedAction =
    action === 'block'
      ? 'block'
      : action === 'redact'
        ? 'redact'
        : action === 'allow'
          ? 'allow'
          : 'alert';

  return {
    ...base,
    enabled: true,
    globalPolicy: {
      ...base.globalPolicy,
      action: mappedAction,
      patterns: dlp.patterns,
    },
  };
}

async function start(): Promise<void> {
  const gatewayConfig = loadGatewayConfig();
  validateGatewayConfig(gatewayConfig);

  const configPath = process.env.NACHOS_CONFIG_PATH ?? process.env.NACHOS_CONFIG;
  const dlpConfig = await buildDlpConfig(configPath);
  const nachosConfig = loadAndValidateConfig({ configPath });

  const busClient = createBusClient({
    servers: gatewayConfig.natsServers,
    name: 'gateway',
  });

  await busClient.connect();

  const busAdapter = new NatsBusAdapter(busClient);

  const gateway = new Gateway({
    dbPath: gatewayConfig.dbPath,
    healthPort: gatewayConfig.healthPort,
    bus: busAdapter,
    defaultSystemPrompt: gatewayConfig.defaultSystemPrompt,
    channels: gatewayConfig.channels,
    policyConfig: {
      policiesPath: gatewayConfig.policy?.policiesPath ?? '/app/policies',
      securityMode: gatewayConfig.policy?.securityMode ?? 'standard',
      enableHotReload: gatewayConfig.policy?.enableHotReload ?? true,
      defaultEffect: gatewayConfig.policy?.defaultEffect ?? 'deny',
    },
    auditConfig: nachosConfig.security?.audit,
    approvalAllowlist: nachosConfig.security?.approval?.approver_allowlist,
    rateLimiterConfig: gatewayConfig.rateLimiter,
    streamingPassthrough: gatewayConfig.streamingPassthrough,
    streamingChunkSize: gatewayConfig.streamingChunkSize,
    streamingMinIntervalMs: gatewayConfig.streamingMinIntervalMs,
    dlpConfig,
  });

  const shutdown = async (signal: string) => {
    console.log(`[Gateway] ${signal} received, shutting down...`);
    try {
      await gateway.stop();
    } finally {
      await busClient.disconnect();
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await gateway.start();
}

start().catch((error) => {
  console.error('[Gateway] Fatal error', error);
  process.exit(1);
});
