/**
 * Gateway Configuration
 *
 * Environment-based configuration with sensible defaults.
 */
import type { DLPConfig } from './security/dlp.js'
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
};

/**
 * Load configuration from environment variables
 */
export function loadConfig(): GatewayConfig {
  const securityMode =
    (process.env.SECURITY_MODE as 'strict' | 'standard' | 'permissive') ?? 'standard';
  const rateLimiterDefaults = defaults.rateLimiter ?? createDefaultRateLimiterConfig();
  const modeDefaults = rateLimiterDefaults.presets?.[securityMode] ?? rateLimiterDefaults.limits;

  return {
    dbPath: process.env.GATEWAY_DB_PATH ?? defaults.dbPath,
    healthPort: parseInt(process.env.GATEWAY_HEALTH_PORT ?? String(defaults.healthPort), 10),
    natsServers: process.env.NATS_SERVERS?.split(',') ?? defaults.natsServers,
    defaultSystemPrompt: process.env.GATEWAY_SYSTEM_PROMPT ?? defaults.defaultSystemPrompt,
    channels: process.env.GATEWAY_CHANNELS?.split(',').filter(Boolean) ?? defaults.channels,
    logLevel: (process.env.GATEWAY_LOG_LEVEL as GatewayConfig['logLevel']) ?? defaults.logLevel,
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
}
