/**
 * Gateway Configuration
 *
 * Environment-based configuration with sensible defaults.
 */
import type { DLPConfig } from './security/dlp.js'
import { ConfigLoadError, listEnabledChannels, loadAndValidateConfig } from '@nachos/config';
import {
  createDefaultRateLimiterConfig,
  type RateLimiterConfig,
} from './security/rate-limiter.js'
import type { PolicyEngineConfig } from './salsa/types/index.js'

/**
 * Gateway configuration interface
 */
export interface GatewayConfig {
  /** Path to SQLite database file */
  dbPath: string;
  /** Port for health check endpoint */
  healthPort: number;
  /** NATS server URL(s) */
  natsServers: string | string[];
  /** Default system prompt for new sessions */
  defaultSystemPrompt?: string;
  /** Channels to subscribe to */
  channels: string[];
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** DLP (Data Loss Prevention) configuration */
  dlp?: DLPConfig;
  /** Policy engine (Salsa) configuration */
  policy?: Partial<PolicyEngineConfig>;
  /** Rate limiting configuration */
  rateLimiter?: RateLimiterConfig;
  /** Enable streaming passthrough to channels */
  streamingPassthrough?: boolean;
  /** Minimum characters between streaming updates */
  streamingChunkSize?: number;
  /** Minimum interval between streaming updates (ms) */
  streamingMinIntervalMs?: number;
}

/**
 * Default configuration values
 */
const defaults: GatewayConfig = {
  dbPath: '/app/data/gateway.db',
  healthPort: 3000,
  natsServers: 'nats://nats:4222',
  defaultSystemPrompt: undefined,
  channels: [],
  logLevel: 'info',
  rateLimiter: createDefaultRateLimiterConfig(),
  streamingPassthrough: false,
  streamingChunkSize: 200,
  streamingMinIntervalMs: 500,
};

/**
 * Load configuration from environment variables
 */
export function loadConfig(): GatewayConfig {
  const securityMode = parseSecurityMode(process.env.SECURITY_MODE);
  const rateLimiterDefaults = defaults.rateLimiter ?? createDefaultRateLimiterConfig();
  const modeDefaults = rateLimiterDefaults.presets?.[securityMode] ?? rateLimiterDefaults.limits;
  const envChannels = process.env.GATEWAY_CHANNELS?.split(',').filter(Boolean);

  return {
    dbPath: process.env.GATEWAY_DB_PATH ?? defaults.dbPath,
    healthPort: parseInt(process.env.GATEWAY_HEALTH_PORT ?? String(defaults.healthPort), 10),
    natsServers: process.env.NATS_SERVERS?.split(',') ?? defaults.natsServers,
    defaultSystemPrompt: process.env.GATEWAY_SYSTEM_PROMPT ?? defaults.defaultSystemPrompt,
    channels: envChannels ?? resolveChannelsFromConfig(),
    logLevel: (process.env.GATEWAY_LOG_LEVEL as GatewayConfig['logLevel']) ?? defaults.logLevel,
    streamingPassthrough:
      parseBoolean(
        process.env.GATEWAY_STREAMING_PASSTHROUGH ??
          process.env.RUNTIME_GATEWAY_STREAMING_PASSTHROUGH
      ) ?? defaults.streamingPassthrough,
    streamingChunkSize: parseOptionalInt(
      process.env.GATEWAY_STREAMING_CHUNK_SIZE ??
        process.env.RUNTIME_GATEWAY_STREAMING_CHUNK_SIZE
    ) ?? defaults.streamingChunkSize,
    streamingMinIntervalMs: parseOptionalInt(
      process.env.GATEWAY_STREAMING_MIN_INTERVAL_MS ??
        process.env.RUNTIME_GATEWAY_STREAMING_MIN_INTERVAL_MS
    ) ?? defaults.streamingMinIntervalMs,
    rateLimiter: {
      enabled: process.env.GATEWAY_RATE_LIMIT_ENABLED
        ? process.env.GATEWAY_RATE_LIMIT_ENABLED === 'true'
        : defaults.rateLimiter?.enabled ?? true,
      redisUrl:
        process.env.REDIS_URL ?? process.env.RUNTIME_REDIS_URL ?? rateLimiterDefaults.redisUrl,
      limits: {
        messagesPerMinute: process.env.SECURITY_RATE_LIMIT_MESSAGES
          ? Number(process.env.SECURITY_RATE_LIMIT_MESSAGES)
          : modeDefaults?.messagesPerMinute,
        toolCallsPerMinute: process.env.SECURITY_RATE_LIMIT_TOOLS
          ? Number(process.env.SECURITY_RATE_LIMIT_TOOLS)
          : modeDefaults?.toolCallsPerMinute,
        llmRequestsPerMinute: process.env.SECURITY_RATE_LIMIT_LLM
          ? Number(process.env.SECURITY_RATE_LIMIT_LLM)
          : modeDefaults?.llmRequestsPerMinute,
      },
      presets: rateLimiterDefaults.presets,
    },
    policy: {
      policiesPath: process.env.POLICY_PATH ?? '/app/policies',
      securityMode,
      enableHotReload: process.env.POLICY_HOT_RELOAD !== 'false',
      defaultEffect: 'deny',
    },
  };
}

function resolveChannelsFromConfig(): string[] {
  try {
    const configPath = process.env.NACHOS_CONFIG_PATH;
    const config = loadAndValidateConfig({ configPath });
    return listEnabledChannels(config);
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      return defaults.channels;
    }
    throw error;
  }
}

function parseSecurityMode(
  value: string | undefined
): 'strict' | 'standard' | 'permissive' {
  if (value === 'strict' || value === 'standard' || value === 'permissive') {
    return value;
  }
  return 'standard';
}

/**
 * Validate configuration
 */
export function validateConfig(config: GatewayConfig): void {
  if (config.healthPort < 1 || config.healthPort > 65535) {
    throw new Error(`Invalid health port: ${config.healthPort}`);
  }

  if (!config.dbPath) {
    throw new Error('Database path is required');
  }

  if (
    !config.natsServers ||
    (Array.isArray(config.natsServers) && config.natsServers.length === 0)
  ) {
    throw new Error('At least one NATS server is required');
  }

  if (config.rateLimiter?.limits) {
    const { messagesPerMinute, toolCallsPerMinute, llmRequestsPerMinute } =
      config.rateLimiter.limits;

    if (messagesPerMinute !== undefined && messagesPerMinute < 1) {
      throw new Error('Rate limiter messagesPerMinute must be at least 1');
    }

    if (toolCallsPerMinute !== undefined && toolCallsPerMinute < 1) {
      throw new Error('Rate limiter toolCallsPerMinute must be at least 1');
    }

    if (llmRequestsPerMinute !== undefined && llmRequestsPerMinute < 1) {
      throw new Error('Rate limiter llmRequestsPerMinute must be at least 1');
    }
  }

  if (config.streamingChunkSize !== undefined && config.streamingChunkSize < 1) {
    throw new Error('Streaming chunk size must be at least 1');
  }

  if (config.streamingMinIntervalMs !== undefined && config.streamingMinIntervalMs < 0) {
    throw new Error('Streaming min interval must be non-negative');
  }
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === 'true';
}
