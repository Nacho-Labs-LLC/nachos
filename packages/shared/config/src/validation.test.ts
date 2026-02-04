import { describe, it, expect } from 'vitest';
import { validateConfig, validateConfigOrThrow, ConfigValidationError } from './validation.js';
import type { NachosConfig } from './schema.js';

describe('Configuration Validation', () => {
  const minimalValidConfig: NachosConfig = {
    nachos: { name: 'test', version: '1.0' },
    llm: { provider: 'anthropic', model: 'claude' },
    security: { mode: 'standard' },
  };

  describe('validateConfig', () => {
    it('should validate minimal valid config', () => {
      const result = validateConfig(minimalValidConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject config without nachos section', () => {
      const config = {
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      } as unknown as NachosConfig;

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required [nachos] section');
    });

    it('should reject config without name', () => {
      const config: NachosConfig = {
        nachos: { name: '', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('nachos.name is required and cannot be empty');
    });

    it('should reject config without llm section', () => {
      const config = {
        nachos: { name: 'test', version: '1.0' },
        security: { mode: 'standard' },
      } as unknown as NachosConfig;

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required [llm] section');
    });

    it('should reject invalid LLM provider', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'invalid' as 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid llm.provider'))).toBe(true);
    });

    it('should reject invalid max_tokens', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude', max_tokens: 2000000 },
        security: { mode: 'standard' },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('llm.max_tokens'))).toBe(true);
    });

    it('should reject invalid temperature', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude', temperature: 5.0 },
        security: { mode: 'standard' },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('llm.temperature'))).toBe(true);
    });

    it('should reject config without security section', () => {
      const config = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
      } as unknown as NachosConfig;

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required [security] section');
    });

    it('should reject invalid security mode', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'invalid' as 'standard' },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid security.mode'))).toBe(true);
    });

    it('should reject permissive mode without acknowledgment', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'permissive' },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('i_understand_the_risks'))).toBe(true);
    });

    it('should accept permissive mode with acknowledgment', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'permissive', i_understand_the_risks: true },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('should reject shell tool without permissive mode', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
        tools: { shell: { enabled: true } },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('tools.shell.enabled'))).toBe(true);
    });

    it('should accept shell tool with permissive mode', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'permissive', i_understand_the_risks: true },
        tools: { shell: { enabled: true } },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid DLP action', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          dlp: { enabled: true, action: 'invalid' as 'warn' },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('security.dlp.action'))).toBe(true);
    });

    it('should reject invalid rate limits', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          rate_limits: { messages_per_minute: 0 },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('messages_per_minute'))).toBe(true);
    });

    it('should reject invalid audit retention days', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          audit: { enabled: true, retention_days: 500 },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('retention_days'))).toBe(true);
    });

    it('should reject invalid audit provider config', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          audit: { enabled: true, provider: 'sqlite', path: '' }
        }
      };

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('security.audit.path'))).toBe(true);
    });

    it('should reject unknown config keys', () => {
      const config = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
        channels: { discord: { token: 'x', unknown: true } },
      } as unknown as NachosConfig;

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Unknown config key: channels.discord.unknown'))).toBe(true);
    });
       
    it('should reject invalid redis url', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
        runtime: {
          redis_url: 'not-a-url',
        },
      };

      const result = validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('runtime.redis_url must be a valid URL');
    });

    it('should reject missing custom audit provider path', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          audit: { enabled: true, provider: 'custom' },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('custom_path'))).toBe(true);
    });

    it('should reject missing composite audit providers', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: {
          mode: 'standard',
          audit: { enabled: true, provider: 'composite', providers: [] },
        },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('security.audit.providers'))).toBe(true);
    });

    it('should reject invalid webchat port', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
        channels: { webchat: { enabled: true, port: 70000 } },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('webchat.port'))).toBe(true);
    });

    it('should warn when no channels are configured', () => {
      const result = validateConfig(minimalValidConfig);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('No channels'))).toBe(true);
    });

    it('should warn for filesystem write enabled', () => {
      const config: NachosConfig = {
        nachos: { name: 'test', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
        tools: { filesystem: { enabled: true, write: true } },
      };

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('filesystem.write'))).toBe(true);
    });
  });

  describe('validateConfigOrThrow', () => {
    it('should not throw for valid config', () => {
      expect(() => validateConfigOrThrow(minimalValidConfig)).not.toThrow();
    });

    it('should throw ConfigValidationError for invalid config', () => {
      const config = {
        nachos: { name: '', version: '1.0' },
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      } as NachosConfig;

      expect(() => validateConfigOrThrow(config)).toThrow(ConfigValidationError);
    });

    it('should include error details in thrown exception', () => {
      const config = {
        llm: { provider: 'anthropic', model: 'claude' },
        security: { mode: 'standard' },
      } as unknown as NachosConfig;

      try {
        validateConfigOrThrow(config);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        if (error instanceof ConfigValidationError) {
          expect(error.errors.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
