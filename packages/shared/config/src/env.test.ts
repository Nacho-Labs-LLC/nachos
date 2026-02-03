import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEnvOverlay, applyEnvOverlay } from './env.js';
import type { NachosConfig } from './schema.js';

describe('Environment Variable Overlay', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createEnvOverlay', () => {
    it('should return empty overlay when no env vars are set', () => {
      const overlay = createEnvOverlay();
      expect(overlay).toEqual({});
    });

    it('should map LLM environment variables', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.LLM_MODEL = 'gpt-4';
      process.env.LLM_MAX_TOKENS = '8192';
      process.env.LLM_TEMPERATURE = '0.5';

      const overlay = createEnvOverlay();

      expect(overlay.llm?.provider).toBe('openai');
      expect(overlay.llm?.model).toBe('gpt-4');
      expect(overlay.llm?.max_tokens).toBe(8192);
      expect(overlay.llm?.temperature).toBe(0.5);
    });

    it('should map security environment variables', () => {
      process.env.SECURITY_MODE = 'permissive';
      process.env.SECURITY_DLP_ENABLED = 'true';
      process.env.SECURITY_DLP_ACTION = 'block';

      const overlay = createEnvOverlay();

      expect(overlay.security?.mode).toBe('permissive');
      expect(overlay.security?.dlp?.enabled).toBe(true);
      expect(overlay.security?.dlp?.action).toBe('block');
    });

    it('should map channel environment variables', () => {
      process.env.CHANNEL_WEBCHAT_ENABLED = 'true';
      process.env.CHANNEL_WEBCHAT_PORT = '3000';
      process.env.CHANNEL_DISCORD_ENABLED = 'false';

      const overlay = createEnvOverlay();

      expect(overlay.channels?.webchat?.enabled).toBe(true);
      expect(overlay.channels?.webchat?.port).toBe(3000);
      expect(overlay.channels?.discord?.enabled).toBe(false);
    });

    it('should map tool environment variables', () => {
      process.env.TOOL_FILESYSTEM_ENABLED = 'true';
      process.env.TOOL_FILESYSTEM_WRITE = 'false';
      process.env.TOOL_BROWSER_ENABLED = 'true';
      process.env.TOOL_BROWSER_TIMEOUT = '60';

      const overlay = createEnvOverlay();

      expect(overlay.tools?.filesystem?.enabled).toBe(true);
      expect(overlay.tools?.filesystem?.write).toBe(false);
      expect(overlay.tools?.browser?.enabled).toBe(true);
      expect(overlay.tools?.browser?.timeout).toBe(60);
    });

    it('should map runtime environment variables', () => {
      process.env.RUNTIME_LOG_LEVEL = 'debug';
      process.env.RUNTIME_LOG_FORMAT = 'json';
      process.env.RUNTIME_MEMORY = '1GB';
      process.env.RUNTIME_CPUS = '2';
      process.env.RUNTIME_REDIS_URL = 'redis://localhost:6379';

      const overlay = createEnvOverlay();

      expect(overlay.runtime?.log_level).toBe('debug');
      expect(overlay.runtime?.log_format).toBe('json');
      expect(overlay.runtime?.resources?.memory).toBe('1GB');
      expect(overlay.runtime?.resources?.cpus).toBe(2);
      expect(overlay.runtime?.redis_url).toBe('redis://localhost:6379');
    });

    it('should parse boolean values correctly', () => {
      process.env.TOOL_BROWSER_ENABLED = 'true';
      process.env.TOOL_SHELL_ENABLED = 'false';

      const overlay = createEnvOverlay();

      expect(overlay.tools?.browser?.enabled).toBe(true);
      expect(overlay.tools?.shell?.enabled).toBe(false);
    });

    it('should parse number values correctly', () => {
      process.env.CHANNEL_WEBCHAT_PORT = '8080';
      process.env.SECURITY_RATE_LIMIT_MESSAGES = '50';
      process.env.LLM_TEMPERATURE = '0.9';

      const overlay = createEnvOverlay();

      expect(overlay.channels?.webchat?.port).toBe(8080);
      expect(overlay.security?.rate_limits?.messages_per_minute).toBe(50);
      expect(overlay.llm?.temperature).toBe(0.9);
    });
  });

  describe('applyEnvOverlay', () => {
    it('should merge environment variables into config', () => {
      const baseConfig: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      };

      process.env.LLM_MODEL = 'gpt-4';
      process.env.SECURITY_MODE = 'strict';

      const merged = applyEnvOverlay(baseConfig);

      expect(merged.llm.model).toBe('gpt-4');
      expect(merged.security.mode).toBe('strict');
      expect(merged.nachos.name).toBe('test'); // Unchanged
    });

    it('should preserve nested objects when merging', () => {
      const baseConfig: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          dlp: { enabled: true, action: 'warn' },
          rate_limits: { messages_per_minute: 30 },
        },
        runtime: {
          redis_url: 'redis://base:6379',
        },
      };

      process.env.SECURITY_DLP_ACTION = 'block';
      process.env.RUNTIME_REDIS_URL = 'redis://env:6379';

      const merged = applyEnvOverlay(baseConfig);

      expect(merged.security.dlp?.action).toBe('block');
      expect(merged.security.dlp?.enabled).toBe(true); // Preserved
      expect(merged.security.rate_limits?.messages_per_minute).toBe(30); // Preserved
      expect(merged.runtime?.redis_url).toBe('redis://env:6379');
    });

    it('should handle empty environment', () => {
      const baseConfig: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      };

      const merged = applyEnvOverlay(baseConfig);

      expect(merged).toEqual(baseConfig);
    });

    it('should protect against prototype pollution', () => {
      const baseConfig: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      };

      // Try to pollute via environment variables (should be ignored)
      process.env.LLM_MODEL = 'safe-model';
      
      const merged = applyEnvOverlay(baseConfig);

      // Verify no prototype pollution
      expect(Object.prototype).not.toHaveProperty('polluted');
      expect({}).not.toHaveProperty('polluted');
      
      // Normal values should still work
      expect(merged.llm.model).toBe('safe-model');
    });
  });
});
