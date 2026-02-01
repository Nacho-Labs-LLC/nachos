import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

      const config = loadConfig();

      expect(config.dbPath).toBe('/app/data/gateway.db');
      expect(config.healthPort).toBe(3000);
      expect(config.natsServers).toBe('nats://nats:4222');
      expect(config.defaultSystemPrompt).toBeUndefined();
      expect(config.channels).toEqual([]);
      expect(config.logLevel).toBe('info');
    });

    it('should load values from environment variables', () => {
      process.env.GATEWAY_DB_PATH = '/custom/path/gateway.db';
      process.env.GATEWAY_HEALTH_PORT = '8080';
      process.env.NATS_SERVERS = 'nats://localhost:4222,nats://localhost:4223';
      process.env.GATEWAY_SYSTEM_PROMPT = 'You are a helpful assistant';
      process.env.GATEWAY_CHANNELS = 'slack,discord';
      process.env.GATEWAY_LOG_LEVEL = 'debug';

      const config = loadConfig();

      expect(config.dbPath).toBe('/custom/path/gateway.db');
      expect(config.healthPort).toBe(8080);
      expect(config.natsServers).toEqual(['nats://localhost:4222', 'nats://localhost:4223']);
      expect(config.defaultSystemPrompt).toBe('You are a helpful assistant');
      expect(config.channels).toEqual(['slack', 'discord']);
      expect(config.logLevel).toBe('debug');
    });

    it('should filter empty channel names', () => {
      process.env.GATEWAY_CHANNELS = 'slack,,discord,';

      const config = loadConfig();

      expect(config.channels).toEqual(['slack', 'discord']);
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
  });
});
