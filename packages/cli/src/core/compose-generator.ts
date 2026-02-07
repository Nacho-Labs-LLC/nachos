/**
 * Docker Compose generator
 * Programmatically generates docker-compose.yml from nachos.toml configuration
 */

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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

    // Add tools (conditional - skip if Dockerfile doesn't exist)
    // Tools are Phase 6, so they may not be implemented yet
    if (config.tools?.filesystem?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/filesystem/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.filesystem = buildFilesystemService(config, projectRoot);
      } else {
        console.warn('⚠️  Filesystem tool is enabled but not yet implemented (Phase 6)');
      }
    }

    if (config.tools?.browser?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/browser/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.browser = buildBrowserService(config, projectRoot);
      } else {
        console.warn('⚠️  Browser tool is enabled but not yet implemented (Phase 6)');
      }
    }

    if (config.tools?.code_runner?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/code_runner/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services['code-runner'] = buildCodeRunnerService(config, projectRoot);
      } else {
        console.warn('⚠️  Code runner tool is enabled but not yet implemented (Phase 6)');
      }
    }

    if (config.tools?.shell?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/shell/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services.shell = buildShellService(config, projectRoot);
      } else {
        console.warn('⚠️  Shell tool is enabled but not yet implemented (Phase 6)');
      }
    }

    if (config.tools?.web_search?.enabled) {
      const dockerfilePath = join(projectRoot, 'packages/tools/web_search/Dockerfile');
      if (existsSync(dockerfilePath)) {
        compose.services['web-search'] = buildWebSearchService(config, projectRoot);
      } else {
        console.warn('⚠️  Web search tool is enabled but not yet implemented (Phase 6)');
      }
    }

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
 * Build Gateway service (with embedded Salsa)
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

// Placeholder service builders for channels/tools not yet implemented
// These will be expanded as those components are built

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

function buildBrowserService(_config: NachosConfig, projectRoot: string): Service {
  return {
    container_name: 'nachos-browser',
    build: {
      context: projectRoot,
      dockerfile: 'packages/tools/browser/Dockerfile',
    },
    image: 'nachos-browser:dev',
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
        labels: 'service=browser',
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
