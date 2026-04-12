/**
 * Gateway Configuration
 *
 * Environment-based configuration with sensible defaults.
 */
import type { DLPConfig } from './security/dlp.js';
import {
  ConfigLoadError,
  ConfigValidationError,
  listEnabledChannels,
  loadAndValidateConfig,
} from '@nachos/config';
import type { AssistantConfig } from '@nachos/config';
import { createValidationError } from '@nachos/types';
import { createDefaultRateLimiterConfig, type RateLimiterConfig } from './security/rate-limiter.js';
import type { PolicyEngineConfig } from './cheese/types/index.js';

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
  /** Assistant name from nachos.toml [assistant] section */
  assistantName?: string;
  /** Channels to subscribe to */
  channels: string[];
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** DLP (Data Loss Prevention) configuration */
  dlp?: DLPConfig;
  /** Policy engine (Cheese) configuration */
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
 * Resolve the [assistant] section from nachos.toml, if available.
 */
function resolveAssistantFromConfig(): AssistantConfig | undefined {
  try {
    const configPath = process.env.NACHOS_CONFIG_PATH;
    const config = loadAndValidateConfig({ configPath });
    return config.assistant;
  } catch (error) {
    if (error instanceof ConfigLoadError || error instanceof ConfigValidationError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): GatewayConfig {
  const securityMode = parseSecurityMode(process.env.SECURITY_MODE);
  const rateLimiterDefaults = defaults.rateLimiter ?? createDefaultRateLimiterConfig();
  const modeDefaults = rateLimiterDefaults.presets?.[securityMode] ?? rateLimiterDefaults.limits;
  const envChannels = process.env.GATEWAY_CHANNELS?.split(',').filter(Boolean);

  // Resolve assistant config from nachos.toml (used as fallback for env vars)
  const assistant = resolveAssistantFromConfig();

  return {
    dbPath: process.env.GATEWAY_DB_PATH ?? defaults.dbPath,
    healthPort: parseInt(process.env.GATEWAY_HEALTH_PORT ?? String(defaults.healthPort), 10),
    natsServers: process.env.NATS_SERVERS?.split(',') ?? defaults.natsServers,
    // Priority: env var > nachos.toml [assistant].system_prompt > default
    defaultSystemPrompt:
      process.env.GATEWAY_SYSTEM_PROMPT ?? assistant?.system_prompt ?? defaults.defaultSystemPrompt,
    assistantName: assistant?.name,
    channels: envChannels ?? resolveChannelsFromConfig(),
    logLevel: (process.env.GATEWAY_LOG_LEVEL as GatewayConfig['logLevel']) ?? defaults.logLevel,
    streamingPassthrough:
      parseBoolean(
        process.env.GATEWAY_STREAMING_PASSTHROUGH ??
          process.env.RUNTIME_GATEWAY_STREAMING_PASSTHROUGH
      ) ?? defaults.streamingPassthrough,
    streamingChunkSize:
      parseOptionalInt(
        process.env.GATEWAY_STREAMING_CHUNK_SIZE ?? process.env.RUNTIME_GATEWAY_STREAMING_CHUNK_SIZE
      ) ?? defaults.streamingChunkSize,
    streamingMinIntervalMs:
      parseOptionalInt(
        process.env.GATEWAY_STREAMING_MIN_INTERVAL_MS ??
          process.env.RUNTIME_GATEWAY_STREAMING_MIN_INTERVAL_MS
      ) ?? defaults.streamingMinIntervalMs,
    rateLimiter: {
      enabled: process.env.GATEWAY_RATE_LIMIT_ENABLED
        ? process.env.GATEWAY_RATE_LIMIT_ENABLED === 'true'
        : (defaults.rateLimiter?.enabled ?? true),
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
    if (error instanceof ConfigLoadError || error instanceof ConfigValidationError) {
      return defaults.channels;
    }
    throw error;
  }
}

function parseSecurityMode(value: string | undefined): 'strict' | 'standard' | 'permissive' {
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
    throw createValidationError(`Invalid health port: ${config.healthPort}`, {
      component: 'gateway',
    });
  }

  if (!config.dbPath) {
    throw createValidationError('Database path is required', { component: 'gateway' });
  }

  if (
    !config.natsServers ||
    (Array.isArray(config.natsServers) && config.natsServers.length === 0)
  ) {
    throw createValidationError('At least one NATS server is required', { component: 'gateway' });
  }

  if (config.rateLimiter?.limits) {
    const { messagesPerMinute, toolCallsPerMinute, llmRequestsPerMinute } =
      config.rateLimiter.limits;

    if (messagesPerMinute !== undefined && messagesPerMinute < 1) {
      throw createValidationError('Rate limiter messagesPerMinute must be at least 1', {
        component: 'gateway',
      });
    }

    if (toolCallsPerMinute !== undefined && toolCallsPerMinute < 1) {
      throw createValidationError('Rate limiter toolCallsPerMinute must be at least 1', {
        component: 'gateway',
      });
    }

    if (llmRequestsPerMinute !== undefined && llmRequestsPerMinute < 1) {
      throw createValidationError('Rate limiter llmRequestsPerMinute must be at least 1', {
        component: 'gateway',
      });
    }
  }

  if (config.streamingChunkSize !== undefined && config.streamingChunkSize < 1) {
    throw createValidationError('Streaming chunk size must be at least 1', {
      component: 'gateway',
    });
  }

  if (config.streamingMinIntervalMs !== undefined && config.streamingMinIntervalMs < 0) {
    throw createValidationError('Streaming min interval must be non-negative', {
      component: 'gateway',
    });
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
