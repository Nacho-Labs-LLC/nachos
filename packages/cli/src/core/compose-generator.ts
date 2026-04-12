/**
 * Docker Compose generator
 * Programmatically generates docker-compose.yml from nachos.toml configuration
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import type { NachosConfig } from '@nachos/config';
import { ComposeGenerationError } from './errors.js';

/**
 * Docker Compose file structure (programmatic representation)
 */
interface ComposeFile {
  networks: Record<string, Network>;
  volumes: Record<string, Volume>;
  services: Record<string, Service>;
}

interface Network {
  driver: string;
  internal?: boolean;
  ipam?: {
    config: Array<{ subnet: string }>;
  };
}

type Volume = Record<string, never>;

interface Service {
  container_name: string;
  image?: string;
  build?: {
    context: string;
    dockerfile: string;
  };
  restart: string;
  depends_on?: Record<string, { condition: string }>;
  networks: string[];
  ports?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
  command?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period: string;
  };
  logging?: {
    driver: string;
    options: Record<string, string>;
  };
}

/**
 * Plugin manifest as declared in nachos-plugin.json.
 * Matches the schema in docs/design/plugin-discovery.md.
 */
interface PluginManifest {
  name: string;
  version: string;
  type: 'channel' | 'tool';
  capabilities: {
    network?: {
      egress?: string[];
      ports?: number[];
    };
    secrets?: string[];
    volumes?: string[];
    permissions?: string[];
  };
  provides: {
    channel?: string;
    tool?: string;
    securityTier?: number;
  };
  entry: {
    dockerfile: string;
    context: string;
  };
  configSchema?: Record<string, unknown>;
  configDefaults?: Record<string, unknown>;
  securityTier?: number;
  dependencies?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period?: string;
  };
  nachos?: {
    minVersion?: string;
    apiVersion: string;
  };
}

/**
 * Plugin source configuration as stored in [plugins.*] of nachos.toml.
 */
interface PluginSourceConfig {
  source: 'path' | 'npm' | 'image';
  path?: string;
  package?: string;
  version?: string;
  image?: string;
  manifest?: string;
}

/**
 * Maximum security tier allowed for each security mode.
 * Plugins with a tier above the allowed maximum are skipped.
 *
 * | Tier | Name       | Allowed in                          |
 * |------|------------|-------------------------------------|
 * | 0    | Safe       | strict, standard, permissive        |
 * | 1    | Standard   | standard, permissive                |
 * | 2    | Elevated   | standard, permissive (with audit)   |
 * | 3    | Restricted | permissive only                     |
 */
const SECURITY_MODE_MAX_TIER: Record<string, number> = {
  strict: 0,
  standard: 2,
  permissive: 3,
};

/**
 * Generate docker-compose.yml structure from Nachos configuration
 */
export function generateComposeFile(config: NachosConfig, projectRoot: string): ComposeFile {
  try {
    const compose: ComposeFile = {
      networks: buildNetworks(),
      volumes: buildVolumes(),
      services: {},
    };

    // Add core services (always present)
    compose.services.bus = buildBusService(projectRoot);
    compose.services.redis = buildRedisService();
    compose.services.gateway = buildGatewayService(config, projectRoot);
    compose.services['llm-proxy'] = buildLLMProxyService(config, projectRoot);

    // Add channels (conditional)
    if (config.channels?.webchat?.enabled) {
      compose.services.webchat = buildWebchatService(config, projectRoot);
    }

    if (config.channels?.slack?.enabled) {
      compose.services.slack = buildSlackService(config, projectRoot);
    }

    if (config.channels?.discord?.enabled) {
      compose.services.discord = buildDiscordService(config, projectRoot);
    }

    if (config.channels?.telegram?.enabled) {
      compose.services.telegram = buildTelegramService(config, projectRoot);
    }

    if (config.channels?.whatsapp?.enabled) {
      compose.services.whatsapp = buildWhatsappService(config, projectRoot);
    }

    if (config.channels?.matrix?.enabled) {
      compose.services.matrix = buildMatrixService(config, projectRoot);
    }

    // Add tools (conditional - skip if Dockerfile doesn't exist)
    if (config.tools?.filesystem?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/filesystem/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.filesystem = buildFilesystemService(config, projectRoot);
      }
    }

    if (config.tools?.browser?.enabled) {
      // Browser tool runs locally in the gateway via @playwright/mcp — no separate container needed.
      // The gateway handles browser tool execution in-process.
    }

    if (config.tools?.code_runner?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/code_runner/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services['code-runner'] = buildCodeRunnerService(config, projectRoot);
      }
    }

    if (config.tools?.shell?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/shell/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.shell = buildShellService(config, projectRoot);
      }
    }

    if (config.tools?.web_search?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/web_search/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services['web-search'] = buildWebSearchService(config, projectRoot);
      }
    }

    if (config.tools?.copilot?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/copilot/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.copilot = buildCopilotService(config, projectRoot);
      }
    }

    // Add admin UI (conditional)
    if (config.admin?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/core/admin/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.admin = buildAdminService(config, projectRoot);
      }
    }

    // Add plugin services from [plugins] registry
    generatePluginServices(config, projectRoot, compose);

    return compose;
  } catch (error) {
    throw new ComposeGenerationError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Build networks configuration
 */
function buildNetworks(): Record<string, Network> {
  return {
    'nachos-internal': {
      driver: 'bridge',
      internal: true,
      ipam: {
        config: [{ subnet: '172.20.0.0/16' }],
      },
    },
    'nachos-egress': {
      driver: 'bridge',
      ipam: {
        config: [{ subnet: '172.21.0.0/16' }],
      },
    },
  };
}

/**
 * Build volumes configuration
 */
function buildVolumes(): Record<string, Volume> {
  return {
    'nats-data': {},
    'redis-data': {},
    'nachos-logs': {},
  };
}

/**
 * Build NATS bus service
 */
function buildBusService(projectRoot: string): Service {
  return {
    container_name: 'nachos-bus',
    build: {
      context: projectRoot,
      dockerfile: 'packages/core/bus/Dockerfile',
    },
    image: 'nachos-bus:dev',
    restart: 'unless-stopped',
    networks: ['nachos-internal'],
    ports: ['4222:4222', '8222:8222'],
    volumes: [
      'nats-data:/data',
      `${projectRoot}/docker/nats/nats-server.conf:/etc/nats/nats-server.conf:ro`,
      'nachos-logs:/var/log/nachos',
    ],
    command: ['-c', '/etc/nats/nats-server.conf'],
    healthcheck: {
      test: [
        'CMD',
        'wget',
        '--no-verbose',
        '--tries=1',
        '--spider',
        'http://localhost:8222/healthz',
      ],
      interval: '10s',
      timeout: '3s',
      retries: 3,
      start_period: '5s',
    },
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=bus',
      },
    },
  };
}

/**
 * Build Redis service
 */
function buildRedisService(): Service {
  return {
    container_name: 'nachos-redis',
    image: 'redis:7-alpine',
    restart: 'unless-stopped',
    networks: ['nachos-internal'],
    ports: ['6379:6379'],
    volumes: ['redis-data:/data'],
    command: ['redis-server', '--appendonly', 'yes'],
    healthcheck: {
      test: ['CMD', 'redis-cli', 'ping'],
      interval: '10s',
      timeout: '3s',
      retries: 3,
      start_period: '5s',
    },
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=redis',
      },
    },
  };
}

/**
 * Build Gateway service (with embedded Cheese)
 */
function buildGatewayService(config: NachosConfig, projectRoot: string): Service {
  const securityMode = config.security?.mode ?? 'standard';
  const messagesLimit = config.security?.rate_limits?.messages_per_minute ?? 30;
  const toolsLimit = config.security?.rate_limits?.tool_calls_per_minute ?? 15;
  const llmLimit = config.security?.rate_limits?.llm_requests_per_minute ?? 30;

  return {
    container_name: 'nachos-gateway',
    build: {
      context: projectRoot,
      dockerfile: 'packages/core/gateway/Dockerfile',
    },
    image: 'nachos-gateway:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
      redis: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal'],
    ports: ['3000:3000'],
    environment: {
      NODE_ENV: 'development',
      NATS_URL: 'nats://bus:4222',
      REDIS_URL: 'redis://redis:6379',
      PORT: '3000',
      LOG_LEVEL: 'debug',
      SECURITY_MODE: securityMode,
      SECURITY_RATE_LIMIT_MESSAGES: String(messagesLimit),
      SECURITY_RATE_LIMIT_TOOLS: String(toolsLimit),
      SECURITY_RATE_LIMIT_LLM: String(llmLimit),
    },
    volumes: [
      `${projectRoot}/packages/core/gateway/src:/app/packages/core/gateway/src:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      `${projectRoot}/policies:/app/policies:ro`,
      `${projectRoot}/data/gateway:/app/data`,
      '/app/node_modules',
      '/app/packages/core/gateway/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    healthcheck: {
      test: ['CMD', 'node', '-e', 'process.exit(0)'],
      interval: '30s',
      timeout: '3s',
      retries: 3,
      start_period: '5s',
    },
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=gateway',
      },
    },
  };
}

/**
 * Build LLM Proxy service
 */
function buildLLMProxyService(_config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    PORT: '3001',
    LOG_LEVEL: 'debug',
  };

  // API keys should be provided via environment variables
  // Pass them through if they exist
  if (process.env.ANTHROPIC_API_KEY) {
    environment.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    environment.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  }

  return {
    container_name: 'nachos-llm-proxy',
    build: {
      context: projectRoot,
      dockerfile: 'packages/core/llm-proxy/Dockerfile',
    },
    image: 'nachos-llm-proxy:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    ports: ['3001:3001'],
    environment,
    volumes: [
      `${projectRoot}/packages/core/llm-proxy/src:/app/packages/core/llm-proxy/src:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      '/app/node_modules',
      '/app/packages/core/llm-proxy/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    healthcheck: {
      test: ['CMD', 'node', '-e', 'process.exit(0)'],
      interval: '30s',
      timeout: '3s',
      retries: 3,
      start_period: '5s',
    },
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=llm-proxy',
      },
    },
  };
}

/**
 * Build Webchat service
 */
function buildWebchatService(config: NachosConfig, projectRoot: string): Service {
  const port = config.channels?.webchat?.port ?? 8080;

  return {
    container_name: 'nachos-webchat',
    build: {
      context: projectRoot,
      dockerfile: 'packages/channels/webchat/Dockerfile',
    },
    image: 'nachos-webchat:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal'],
    ports: [`${port}:${port}`],
    environment: {
      NODE_ENV: 'development',
      NATS_URL: 'nats://bus:4222',
      PORT: String(port),
      LOG_LEVEL: 'debug',
    },
    volumes: [
      `${projectRoot}/packages/channels/webchat/src:/app/packages/channels/webchat/src:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      '/app/node_modules',
      '/app/packages/channels/webchat/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    healthcheck: {
      test: ['CMD', 'node', '-e', 'process.exit(0)'],
      interval: '30s',
      timeout: '3s',
      retries: 3,
      start_period: '5s',
    },
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=webchat',
      },
    },
  };
}

// Service builders for channels and tools

function buildSlackService(_config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: 'debug',
    NACHOS_STATE_DIR: '/app/state',
    SLACK_HTTP_PORT: '3005',
  };

  if (process.env.NACHOS_PAIRING_TOKEN) {
    environment.NACHOS_PAIRING_TOKEN = process.env.NACHOS_PAIRING_TOKEN;
  }
  if (process.env.SLACK_APP_TOKEN) {
    environment.SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
  }
  if (process.env.SLACK_BOT_TOKEN) {
    environment.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  }
  if (process.env.SLACK_SIGNING_SECRET) {
    environment.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  }

  return {
    container_name: 'nachos-slack',
    build: {
      context: projectRoot,
      dockerfile: 'packages/channels/slack/Dockerfile',
    },
    image: 'nachos-slack:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    ports: ['3005:3005'],
    environment,
    volumes: [
      `${projectRoot}/packages/channels/slack/src:/app/packages/channels/slack/src:ro`,
      `${projectRoot}/packages/channels/base:/app/packages/channels/base:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/packages/core/bus:/app/packages/core/bus:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      `${projectRoot}/data/channels:/app/state`,
      '/app/node_modules',
      '/app/packages/channels/slack/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=slack',
      },
    },
  };
}

function buildDiscordService(_config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: 'debug',
    NACHOS_STATE_DIR: '/app/state',
  };

  if (process.env.NACHOS_PAIRING_TOKEN) {
    environment.NACHOS_PAIRING_TOKEN = process.env.NACHOS_PAIRING_TOKEN;
  }
  if (process.env.DISCORD_BOT_TOKEN) {
    environment.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  }

  return {
    container_name: 'nachos-discord',
    build: {
      context: projectRoot,
      dockerfile: 'packages/channels/discord/Dockerfile',
    },
    image: 'nachos-discord:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    environment,
    volumes: [
      `${projectRoot}/packages/channels/discord/src:/app/packages/channels/discord/src:ro`,
      `${projectRoot}/packages/channels/base:/app/packages/channels/base:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/packages/core/bus:/app/packages/core/bus:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      `${projectRoot}/data/channels:/app/state`,
      '/app/node_modules',
      '/app/packages/channels/discord/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=discord',
      },
    },
  };
}

function buildTelegramService(_config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: 'debug',
    NACHOS_STATE_DIR: '/app/state',
  };

  if (process.env.NACHOS_PAIRING_TOKEN) {
    environment.NACHOS_PAIRING_TOKEN = process.env.NACHOS_PAIRING_TOKEN;
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    environment.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  }

  return {
    container_name: 'nachos-telegram',
    build: {
      context: projectRoot,
      dockerfile: 'packages/channels/telegram/Dockerfile',
    },
    image: 'nachos-telegram:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    environment,
    volumes: [
      `${projectRoot}/packages/channels/telegram/src:/app/packages/channels/telegram/src:ro`,
      `${projectRoot}/packages/channels/base:/app/packages/channels/base:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/packages/core/bus:/app/packages/core/bus:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      `${projectRoot}/data/channels:/app/state`,
      '/app/node_modules',
      '/app/packages/channels/telegram/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=telegram',
      },
    },
  };
}

function buildWhatsappService(_config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: 'debug',
    NACHOS_STATE_DIR: '/app/state',
    WHATSAPP_HTTP_PORT: '3002',
  };

  if (process.env.NACHOS_PAIRING_TOKEN) {
    environment.NACHOS_PAIRING_TOKEN = process.env.NACHOS_PAIRING_TOKEN;
  }
  if (process.env.WHATSAPP_TOKEN) {
    environment.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  }
  if (process.env.WHATSAPP_PHONE_NUMBER_ID) {
    environment.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
  if (process.env.WHATSAPP_VERIFY_TOKEN) {
    environment.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  }
  if (process.env.WHATSAPP_APP_SECRET) {
    environment.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
  }

  return {
    container_name: 'nachos-whatsapp',
    build: {
      context: projectRoot,
      dockerfile: 'packages/channels/whatsapp/Dockerfile',
    },
    image: 'nachos-whatsapp:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    ports: ['3002:3002'],
    environment,
    volumes: [
      `${projectRoot}/packages/channels/whatsapp/src:/app/packages/channels/whatsapp/src:ro`,
      `${projectRoot}/packages/channels/base:/app/packages/channels/base:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/packages/core/bus:/app/packages/core/bus:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      `${projectRoot}/data/channels:/app/state`,
      '/app/node_modules',
      '/app/packages/channels/whatsapp/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=whatsapp',
      },
    },
  };
}

function buildMatrixService(_config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: 'debug',
    NACHOS_STATE_DIR: '/app/state',
  };

  if (process.env.NACHOS_PAIRING_TOKEN) {
    environment.NACHOS_PAIRING_TOKEN = process.env.NACHOS_PAIRING_TOKEN;
  }
  if (process.env.MATRIX_HOMESERVER_URL) {
    environment.MATRIX_HOMESERVER_URL = process.env.MATRIX_HOMESERVER_URL;
  }
  if (process.env.MATRIX_ACCESS_TOKEN) {
    environment.MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;
  }
  if (process.env.MATRIX_USER_ID) {
    environment.MATRIX_USER_ID = process.env.MATRIX_USER_ID;
  }

  return {
    container_name: 'nachos-matrix',
    build: {
      context: projectRoot,
      dockerfile: 'packages/channels/matrix/Dockerfile',
    },
    image: 'nachos-matrix:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    environment,
    volumes: [
      `${projectRoot}/packages/channels/matrix/src:/app/packages/channels/matrix/src:ro`,
      `${projectRoot}/packages/channels/base:/app/packages/channels/base:ro`,
      `${projectRoot}/packages/shared:/app/packages/shared:ro`,
      `${projectRoot}/packages/core/bus:/app/packages/core/bus:ro`,
      `${projectRoot}/tsconfig.base.json:/app/tsconfig.base.json:ro`,
      `${projectRoot}/tsconfig.json:/app/tsconfig.json:ro`,
      `${projectRoot}/data/channels:/app/state`,
      '/app/node_modules',
      '/app/packages/channels/matrix/node_modules',
      'nachos-logs:/var/log/nachos',
    ],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=matrix',
      },
    },
  };
}

function buildFilesystemService(_config: NachosConfig, projectRoot: string): Service {
  return {
    container_name: 'nachos-filesystem',
    build: {
      context: projectRoot,
      dockerfile: 'packages/tools/filesystem/Dockerfile',
    },
    image: 'nachos-filesystem:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal'],
    environment: {
      NODE_ENV: 'development',
      NATS_URL: 'nats://bus:4222',
      LOG_LEVEL: 'debug',
    },
    volumes: [`${projectRoot}/workspace:/workspace`, 'nachos-logs:/var/log/nachos'],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=filesystem',
      },
    },
  };
}

function buildCodeRunnerService(_config: NachosConfig, projectRoot: string): Service {
  return {
    container_name: 'nachos-code-runner',
    build: {
      context: projectRoot,
      dockerfile: 'packages/tools/code_runner/Dockerfile',
    },
    image: 'nachos-code-runner:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal'],
    environment: {
      NODE_ENV: 'development',
      NATS_URL: 'nats://bus:4222',
      LOG_LEVEL: 'debug',
    },
    volumes: ['nachos-logs:/var/log/nachos'],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=code-runner',
      },
    },
  };
}

function buildShellService(_config: NachosConfig, projectRoot: string): Service {
  return {
    container_name: 'nachos-shell',
    build: {
      context: projectRoot,
      dockerfile: 'packages/tools/shell/Dockerfile',
    },
    image: 'nachos-shell:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal'],
    environment: {
      NODE_ENV: 'development',
      NATS_URL: 'nats://bus:4222',
      LOG_LEVEL: 'debug',
    },
    volumes: [`${projectRoot}/workspace:/workspace`, 'nachos-logs:/var/log/nachos'],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=shell',
      },
    },
  };
}

function buildWebSearchService(_config: NachosConfig, projectRoot: string): Service {
  return {
    container_name: 'nachos-web-search',
    build: {
      context: projectRoot,
      dockerfile: 'packages/tools/web_search/Dockerfile',
    },
    image: 'nachos-web-search:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    environment: {
      NODE_ENV: 'development',
      NATS_URL: 'nats://bus:4222',
      LOG_LEVEL: 'debug',
    },
    volumes: ['nachos-logs:/var/log/nachos'],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=web-search',
      },
    },
  };
}

function buildCopilotService(config: NachosConfig, projectRoot: string): Service {
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: 'debug',
    MAX_PROMPT_LENGTH: String(config.tools?.copilot?.max_prompt_length ?? 4000),
    MAX_OUTPUT_SIZE: String(config.tools?.copilot?.max_output_size ?? 50000),
    DEFAULT_TIMEOUT_SEC: String(config.tools?.copilot?.default_timeout ?? 30),
    MAX_TIMEOUT_SEC: String(config.tools?.copilot?.max_timeout ?? 60),
  };

  if (process.env.GH_TOKEN) {
    environment.GH_TOKEN = process.env.GH_TOKEN;
  }

  return {
    container_name: 'nachos-copilot',
    build: {
      context: projectRoot,
      dockerfile: 'packages/tools/copilot/Dockerfile',
    },
    image: 'nachos-copilot:dev',
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal', 'nachos-egress'],
    environment,
    volumes: ['nachos-logs:/var/log/nachos'],
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=copilot',
      },
    },
  };
}

/**
 * Build Admin UI service
 */
function buildAdminService(config: NachosConfig, projectRoot: string): Service {
  const port = config.admin?.port ?? 8082;
  const adminToken = process.env['NACHOS_ADMIN_TOKEN'] ?? '';

  return {
    container_name: 'nachos-admin',
    build: {
      context: projectRoot,
      dockerfile: 'packages/core/admin/Dockerfile',
    },
    image: 'nachos-admin:dev',
    restart: 'unless-stopped',
    depends_on: {
      gateway: { condition: 'service_healthy' },
    },
    networks: ['nachos-internal'],
    ports: [`${port}:${port}`],
    environment: {
      NODE_ENV: 'development',
      PORT: String(port),
      NACHOS_CONFIG_PATH: '/app/nachos.toml',
      NACHOS_STATE_DIR: '/app/state',
      NACHOS_SKILLS_DIR: '/app/skills',
      GATEWAY_HEALTH_URL: 'http://gateway:3000/health',
      NACHOS_ADMIN_TOKEN: adminToken,
    },
    volumes: [
      `${projectRoot}/nachos.toml:/app/nachos.toml:rw`,
      `${projectRoot}/data/gateway:/app/state:ro`,
      `${projectRoot}/skills:/app/skills:ro`,
      '/var/run/docker.sock:/var/run/docker.sock:rw',
    ],
    healthcheck: {
      test: [
        'CMD',
        'node',
        '-e',
        `fetch('http://localhost:${port}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
      ],
      interval: '30s',
      timeout: '5s',
      retries: 3,
      start_period: '10s',
    },
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: 'service=admin',
      },
    },
  };
}

/**
 * Resolve the path to a plugin's nachos-plugin.json manifest file.
 *
 * For "path" source: resolves relative to the project root.
 * For "npm" source: looks in node_modules at the project root.
 * For "image" source: uses the local manifest path from the plugin config.
 *
 * @returns Absolute path to the manifest file, or null if unresolvable.
 */
function resolveManifestPath(
  pluginName: string,
  pluginConfig: PluginSourceConfig,
  projectRoot: string
): string | null {
  switch (pluginConfig.source) {
    case 'path': {
      if (!pluginConfig.path) {
        console.warn(`[plugin] "${pluginName}": missing "path" field, skipping`);
        return null;
      }
      const pluginDir = resolve(projectRoot, pluginConfig.path);
      return join(pluginDir, 'nachos-plugin.json');
    }
    case 'npm': {
      if (!pluginConfig.package) {
        console.warn(`[plugin] "${pluginName}": missing "package" field, skipping`);
        return null;
      }
      const modulePath = join(projectRoot, 'node_modules', pluginConfig.package);
      return join(modulePath, 'nachos-plugin.json');
    }
    case 'image': {
      if (!pluginConfig.manifest) {
        console.warn(
          `[plugin] "${pluginName}": missing "manifest" field for image source, skipping`
        );
        return null;
      }
      return resolve(projectRoot, pluginConfig.manifest);
    }
    default: {
      console.warn(
        `[plugin] "${pluginName}": unknown source type "${String(pluginConfig.source)}", skipping`
      );
      return null;
    }
  }
}

/**
 * Read and parse a plugin manifest file.
 *
 * @returns The parsed manifest, or null if the file cannot be read/parsed.
 */
function readPluginManifest(manifestPath: string, pluginName: string): PluginManifest | null {
  if (!existsSync(manifestPath)) {
    console.warn(`[plugin] "${pluginName}": manifest not found at ${manifestPath}, skipping`);
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;

    // Basic validation: ensure required fields exist
    if (!raw.name || !raw.version || !raw.type || !raw.entry) {
      console.warn(
        `[plugin] "${pluginName}": manifest at ${manifestPath} is missing required fields (name, version, type, entry), skipping`
      );
      return null;
    }

    if (raw.type !== 'channel' && raw.type !== 'tool') {
      console.warn(
        `[plugin] "${pluginName}": manifest type "${raw.type}" is invalid (must be "channel" or "tool"), skipping`
      );
      return null;
    }

    return raw;
  } catch {
    console.warn(`[plugin] "${pluginName}": failed to parse manifest at ${manifestPath}, skipping`);
    return null;
  }
}

/**
 * Check whether a plugin is enabled based on its config section.
 *
 * Plugins of type "channel" are checked in config.channels[providerKey].enabled;
 * plugins of type "tool" are checked in config.tools[providerKey].enabled.
 */
function isPluginEnabled(config: NachosConfig, manifest: PluginManifest): boolean {
  const providerKey =
    manifest.type === 'channel'
      ? (manifest.provides.channel ?? manifest.name)
      : (manifest.provides.tool ?? manifest.name);

  if (manifest.type === 'channel') {
    const channelConfig = config.channels as Record<string, Record<string, unknown>> | undefined;
    return channelConfig?.[providerKey]?.enabled === true;
  }

  const toolConfig = config.tools as Record<string, Record<string, unknown>> | undefined;
  return toolConfig?.[providerKey]?.enabled === true;
}

/**
 * Build a Docker Compose service entry for a plugin.
 *
 * Follows the same patterns as built-in build*Service() functions:
 * - container_name: nachos-{providerKey}
 * - Standard depends_on bus
 * - Network assignment based on egress capabilities
 * - Environment: NODE_ENV, NATS_URL, LOG_LEVEL + secrets passthrough
 * - Standard logging configuration
 * - Optional healthcheck from manifest
 */
function buildPluginService(
  pluginName: string,
  pluginConfig: PluginSourceConfig,
  manifest: PluginManifest,
  config: NachosConfig,
  projectRoot: string
): Service {
  const providerKey =
    manifest.type === 'channel'
      ? (manifest.provides.channel ?? manifest.name)
      : (manifest.provides.tool ?? manifest.name);

  // --- Network assignment ---
  const networks: string[] = ['nachos-internal'];
  const egress = manifest.capabilities?.network?.egress ?? [];
  if (egress.length > 0) {
    networks.push('nachos-egress');
  }

  // --- Environment variables ---
  const logLevel = config.runtime?.log_level ?? 'debug';
  const environment: Record<string, string> = {
    NODE_ENV: 'development',
    NATS_URL: 'nats://bus:4222',
    LOG_LEVEL: logLevel,
  };

  // Pass through declared secrets from process.env
  const secrets = manifest.capabilities?.secrets ?? [];
  for (const secret of secrets) {
    if (process.env[secret]) {
      environment[secret] = process.env[secret] as string;
    }
  }

  // Convert plugin config section keys to NACHOS_PLUGIN_* environment variables
  const configSection = manifest.type === 'channel' ? 'channels' : 'tools';
  const sectionConfig = config[configSection] as
    | Record<string, Record<string, unknown>>
    | undefined;
  const pluginSectionConfig = sectionConfig?.[providerKey];
  if (pluginSectionConfig) {
    for (const [key, value] of Object.entries(pluginSectionConfig)) {
      if (key === 'enabled') continue; // Skip the enabled flag itself
      const envKey = `NACHOS_PLUGIN_${key.toUpperCase()}`;
      environment[envKey] = String(value);
    }
  }

  // --- Build or Image ---
  const service: Service = {
    container_name: `nachos-${providerKey}`,
    restart: 'unless-stopped',
    depends_on: {
      bus: { condition: 'service_healthy' },
    },
    networks,
    environment,
    logging: {
      driver: 'json-file',
      options: {
        'max-size': '10m',
        'max-file': '3',
        labels: `service=${providerKey}`,
      },
    },
  };

  // Set image or build context based on source type
  if (pluginConfig.source === 'image' && pluginConfig.image) {
    service.image = pluginConfig.image;
  } else {
    // Resolve build context from the plugin source directory
    let pluginDir: string;
    if (pluginConfig.source === 'path' && pluginConfig.path) {
      pluginDir = resolve(projectRoot, pluginConfig.path);
    } else if (pluginConfig.source === 'npm' && pluginConfig.package) {
      pluginDir = join(projectRoot, 'node_modules', pluginConfig.package);
    } else {
      // Fallback: use manifest location parent directory
      pluginDir = projectRoot;
    }

    const buildContext = resolve(pluginDir, manifest.entry.context ?? '.');
    const dockerfile = manifest.entry.dockerfile ?? './Dockerfile';

    service.build = {
      context: buildContext,
      dockerfile,
    };
  }

  // --- Volumes ---
  const volumes: string[] = ['nachos-logs:/var/log/nachos'];

  // Channel plugins get state directory mount
  if (manifest.type === 'channel') {
    volumes.push(`${projectRoot}/data/channels:/app/state`);
  }

  // Add declared volumes from capabilities (with path traversal protection)
  const declaredVolumes = manifest.capabilities?.volumes ?? [];
  for (const vol of declaredVolumes) {
    // Skip volumes referencing Docker socket or system directories
    if (
      vol.includes('/var/run/docker.sock') ||
      vol.startsWith('/etc') ||
      vol.startsWith('/proc') ||
      vol.startsWith('/sys') ||
      vol.startsWith('/dev')
    ) {
      console.warn(`[plugin] "${pluginName}": skipping unsafe volume mount "${vol}"`);
      continue;
    }
    // Skip volumes with path traversal
    if (vol.includes('..')) {
      console.warn(`[plugin] "${pluginName}": skipping volume with path traversal "${vol}"`);
      continue;
    }
    volumes.push(vol);
  }

  service.volumes = volumes;

  // --- Ports ---
  const ports = manifest.capabilities?.network?.ports;
  if (ports && ports.length > 0) {
    service.ports = ports.map((p) => `${p}:${p}`);
  }

  // --- Healthcheck ---
  if (manifest.healthcheck) {
    service.healthcheck = {
      test: manifest.healthcheck.test,
      interval: manifest.healthcheck.interval,
      timeout: manifest.healthcheck.timeout,
      retries: manifest.healthcheck.retries,
      start_period: manifest.healthcheck.start_period ?? '10s',
    };
  } else {
    // Default healthcheck matching built-in services
    service.healthcheck = {
      test: ['CMD', 'node', '-e', 'process.exit(0)'],
      interval: '30s',
      timeout: '3s',
      retries: 3,
      start_period: '10s',
    };
  }

  return service;
}

/**
 * Generate Docker Compose service entries for all registered plugins.
 *
 * Iterates over config.plugins, reads each plugin's manifest, checks
 * enabled state and security tier, and adds services to the compose file.
 * Errors in individual plugins are logged as warnings and do not
 * block generation of other services.
 */
function generatePluginServices(
  config: NachosConfig,
  projectRoot: string,
  compose: ComposeFile
): void {
  const plugins = config.plugins;
  if (!plugins || Object.keys(plugins).length === 0) {
    return;
  }

  const securityMode = config.security?.mode ?? 'standard';
  const maxTier = SECURITY_MODE_MAX_TIER[securityMode] ?? 2;

  for (const [pluginName, rawPluginConfig] of Object.entries(plugins)) {
    try {
      const pluginConfig = rawPluginConfig as unknown as PluginSourceConfig;

      if (!pluginConfig.source) {
        console.warn(`[plugin] "${pluginName}": missing "source" field, skipping`);
        continue;
      }

      // Resolve and read the manifest
      const manifestPath = resolveManifestPath(pluginName, pluginConfig, projectRoot);
      if (!manifestPath) {
        continue;
      }

      const manifest = readPluginManifest(manifestPath, pluginName);
      if (!manifest) {
        continue;
      }

      // Check if plugin is enabled
      if (!isPluginEnabled(config, manifest)) {
        continue;
      }

      // Check security tier against current security mode
      const tier = manifest.securityTier ?? 2; // Default to elevated (2) per design
      if (tier > maxTier) {
        const tierNames = ['safe', 'standard', 'elevated', 'restricted'];
        console.warn(
          `[plugin] "${pluginName}": security tier ${tier} (${tierNames[tier] ?? 'unknown'}) ` +
            `exceeds maximum allowed tier ${maxTier} for ${securityMode} mode, skipping`
        );
        continue;
      }

      // Check for service name conflicts with already-generated services
      const providerKey =
        manifest.type === 'channel'
          ? (manifest.provides.channel ?? manifest.name)
          : (manifest.provides.tool ?? manifest.name);

      if (compose.services[providerKey]) {
        console.warn(
          `[plugin] "${pluginName}": service name "${providerKey}" conflicts with an existing service, skipping`
        );
        continue;
      }

      // Build and add the service
      const service = buildPluginService(pluginName, pluginConfig, manifest, config, projectRoot);
      compose.services[providerKey] = service;
    } catch (err) {
      console.warn(
        `[plugin] "${pluginName}": unexpected error during service generation, skipping: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

/**
 * Write compose file to disk
 *
 * @param compose Compose file structure
 * @param projectRoot Project root directory
 * @returns Path to generated compose file
 */
export function writeComposeFile(compose: ComposeFile, projectRoot: string): string {
  try {
    const composePath = join(projectRoot, 'docker-compose.generated.yml');
    const yamlContent = stringify(compose, {
      lineWidth: 0, // Don't wrap lines
      indent: 2,
    });

    // Add header comment
    const header = `# Generated by Nachos CLI
# DO NOT EDIT THIS FILE MANUALLY
# This file is automatically generated from nachos.toml
# To make changes, edit nachos.toml and run: nachos restart

`;

    writeFileSync(composePath, header + yamlContent, 'utf-8');
    return composePath;
  } catch (error) {
    throw new ComposeGenerationError(
      `Failed to write compose file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate and write docker-compose.yml from configuration
 *
 * @param config Nachos configuration
 * @param projectRoot Project root directory
 * @returns Path to generated compose file
 */
export function generateAndWriteComposeFile(config: NachosConfig, projectRoot: string): string {
  const compose = generateComposeFile(config, projectRoot);
  return writeComposeFile(compose, projectRoot);
}
