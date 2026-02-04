import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, validateConfig, type GatewayConfig } from './config.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should return default values when no env vars are set', () => {
      // Clear relevant env vars
      delete process.env.GATEWAY_DB_PATH;
      delete process.env.GATEWAY_HEALTH_PORT;
      delete process.env.NATS_SERVERS;
      delete process.env.GATEWAY_SYSTEM_PROMPT;
      delete process.env.GATEWAY_CHANNELS;
      delete process.env.GATEWAY_LOG_LEVEL;
      delete process.env.GATEWAY_RATE_LIMIT_ENABLED;
      delete process.env.SECURITY_RATE_LIMIT_MESSAGES;
      delete process.env.SECURITY_RATE_LIMIT_TOOLS;
      delete process.env.SECURITY_RATE_LIMIT_LLM;
      delete process.env.SECURITY_MODE;
      delete process.env.REDIS_URL;

      const config = loadConfig();

      expect(config.dbPath).toBe('/app/data/gateway.db');
      expect(config.healthPort).toBe(3000);
      expect(config.natsServers).toBe('nats://nats:4222');
      expect(config.defaultSystemPrompt).toBeUndefined();
      expect(config.channels).toEqual([]);
      expect(config.logLevel).toBe('info');
      expect(config.rateLimiter?.enabled).toBe(true);
      expect(config.rateLimiter?.limits).toEqual({
        messagesPerMinute: 30,
        toolCallsPerMinute: 15,
        llmRequestsPerMinute: 30,
      });
    });

    it('should load values from environment variables', () => {
      process.env.GATEWAY_DB_PATH = '/custom/path/gateway.db';
      process.env.GATEWAY_HEALTH_PORT = '8080';
      process.env.NATS_SERVERS = 'nats://localhost:4222,nats://localhost:4223';
      process.env.GATEWAY_SYSTEM_PROMPT = 'You are a helpful assistant';
      process.env.GATEWAY_CHANNELS = 'slack,discord';
      process.env.GATEWAY_LOG_LEVEL = 'debug';
      process.env.GATEWAY_RATE_LIMIT_ENABLED = 'false';
      process.env.SECURITY_RATE_LIMIT_MESSAGES = '12';
      process.env.SECURITY_RATE_LIMIT_TOOLS = '8';
      process.env.SECURITY_RATE_LIMIT_LLM = '6';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.RUNTIME_REDIS_URL = 'redis://runtime:6379';

      const config = loadConfig();

      expect(config.dbPath).toBe('/custom/path/gateway.db');
      expect(config.healthPort).toBe(8080);
      expect(config.natsServers).toEqual(['nats://localhost:4222', 'nats://localhost:4223']);
      expect(config.defaultSystemPrompt).toBe('You are a helpful assistant');
      expect(config.channels).toEqual(['slack', 'discord']);
      expect(config.logLevel).toBe('debug');
      expect(config.rateLimiter?.enabled).toBe(false);
      expect(config.rateLimiter?.limits).toEqual({
        messagesPerMinute: 12,
        toolCallsPerMinute: 8,
        llmRequestsPerMinute: 6,
      });
      expect(config.rateLimiter?.redisUrl).toBe('redis://localhost:6379');
    });

    it('should filter empty channel names', () => {
      process.env.GATEWAY_CHANNELS = 'slack,,discord,';

      const config = loadConfig();

      expect(config.channels).toEqual(['slack', 'discord']);
    });

    it('should load channels from nachos.toml when env is unset', () => {
      delete process.env.GATEWAY_CHANNELS;

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-gateway-'));
      const configPath = path.join(tempDir, 'nachos.toml');
      fs.writeFileSync(
        configPath,
        `
[nachos]
name = "test"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude"

[security]
mode = "standard"

[channels.discord]
token = "test"

[[channels.discord.servers]]
id = "123"
channel_ids = ["C1"]
user_allowlist = ["U1"]
        `
      );

      process.env.NACHOS_CONFIG_PATH = configPath;

      const config = loadConfig();

      expect(config.channels).toEqual(['discord']);

      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NACHOS_CONFIG_PATH;
    });

    it('should apply security mode rate limit presets', () => {
      process.env.SECURITY_MODE = 'strict';

      const config = loadConfig();

      expect(config.rateLimiter?.limits).toEqual({
        messagesPerMinute: 20,
        toolCallsPerMinute: 5,
        llmRequestsPerMinute: 20,
      });
    });

    it('should default to standard mode for invalid security mode', () => {
      process.env.SECURITY_MODE = 'invalid';

      const config = loadConfig();

      expect(config.policy?.securityMode).toBe('standard');
    });

    it('should use runtime redis url when redis url is unset', () => {
      process.env.RUNTIME_REDIS_URL = 'redis://runtime:6379';

      const config = loadConfig();

      expect(config.rateLimiter?.redisUrl).toBe('redis://runtime:6379');
    });
  });

  describe('validateConfig', () => {
    it('should not throw for valid config', () => {
      const config: GatewayConfig = {
        dbPath: '/app/data/gateway.db',
        healthPort: 3000,
        natsServers: 'nats://nats:4222',
        channels: [],
        logLevel: 'info',
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should throw for invalid health port (too low)', () => {
      const config: GatewayConfig = {
        dbPath: '/app/data/gateway.db',
        healthPort: 0,
        natsServers: 'nats://nats:4222',
        channels: [],
        logLevel: 'info',
      };

      expect(() => validateConfig(config)).toThrow('Invalid health port');
    });

    it('should throw for invalid health port (too high)', () => {
      const config: GatewayConfig = {
        dbPath: '/app/data/gateway.db',
        healthPort: 70000,
        natsServers: 'nats://nats:4222',
        channels: [],
        logLevel: 'info',
      };

      expect(() => validateConfig(config)).toThrow('Invalid health port');
    });

    it('should throw for empty database path', () => {
      const config: GatewayConfig = {
        dbPath: '',
        healthPort: 3000,
        natsServers: 'nats://nats:4222',
        channels: [],
        logLevel: 'info',
      };

      expect(() => validateConfig(config)).toThrow('Database path is required');
    });

    it('should throw for empty NATS servers array', () => {
      const config: GatewayConfig = {
        dbPath: '/app/data/gateway.db',
        healthPort: 3000,
        natsServers: [],
        channels: [],
        logLevel: 'info',
      };

      expect(() => validateConfig(config)).toThrow('At least one NATS server is required');
    });

    it('should throw for invalid rate limiter configuration', () => {
      const config: GatewayConfig = {
        dbPath: '/app/data/gateway.db',
        healthPort: 3000,
        natsServers: 'nats://nats:4222',
        channels: [],
        logLevel: 'info',
        rateLimiter: {
          enabled: true,
          limits: {
            messagesPerMinute: 0,
          },
        },
      };

      expect(() => validateConfig(config)).toThrow(
        'Rate limiter messagesPerMinute must be at least 1'
      );
    });
  });
});
