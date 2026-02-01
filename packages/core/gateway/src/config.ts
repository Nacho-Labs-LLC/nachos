/**
 * Gateway Configuration
 *
 * Environment-based configuration with sensible defaults.
 */

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
};

/**
 * Load configuration from environment variables
 */
export function loadConfig(): GatewayConfig {
  return {
    dbPath: process.env.GATEWAY_DB_PATH ?? defaults.dbPath,
    healthPort: parseInt(process.env.GATEWAY_HEALTH_PORT ?? String(defaults.healthPort), 10),
    natsServers: process.env.NATS_SERVERS?.split(',') ?? defaults.natsServers,
    defaultSystemPrompt: process.env.GATEWAY_SYSTEM_PROMPT ?? defaults.defaultSystemPrompt,
    channels: process.env.GATEWAY_CHANNELS?.split(',').filter(Boolean) ?? defaults.channels,
    logLevel: (process.env.GATEWAY_LOG_LEVEL as GatewayConfig['logLevel']) ?? defaults.logLevel,
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
}
