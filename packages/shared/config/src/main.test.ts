import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAndValidateConfig } from './main.js';
import { ConfigLoadError, ConfigValidationError } from './index.js';

describe('Main Configuration Loading', () => {
  const originalEnv = process.env;
  const testDir = '/tmp/nachos-config-test';

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadAndValidateConfig', () => {
    it('should load, overlay, and validate config', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const toml = `
[nachos]
name = "test-assistant"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude"

[security]
mode = "standard"
      `;
      fs.writeFileSync(configPath, toml);

      process.env.LLM_MODEL = 'gpt-4';
      process.env.SECURITY_MODE = 'strict';

      const config = loadAndValidateConfig({ configPath });

      expect(config.nachos.name).toBe('test-assistant');
      expect(config.llm.model).toBe('gpt-4'); // From env
      expect(config.security.mode).toBe('strict'); // From env
    });

    it('should skip env overlay when applyEnv is false', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const toml = `
[nachos]
name = "test"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude"

[security]
mode = "standard"
      `;
      fs.writeFileSync(configPath, toml);

      process.env.LLM_MODEL = 'gpt-4';

      const config = loadAndValidateConfig({ configPath, applyEnv: false });

      expect(config.llm.model).toBe('claude'); // Not overridden
    });

    it('should skip validation when validate is false', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const toml = `
[nachos]
name = ""
version = "1.0"

[llm]
provider = "invalid"
model = "test"

[security]
mode = "standard"
      `;
      fs.writeFileSync(configPath, toml);

      // Should not throw despite invalid config
      const config = loadAndValidateConfig({ configPath, validate: false });
      expect(config).toBeDefined();
    });

    it('should throw for missing config file', () => {
      expect(() => {
        loadAndValidateConfig({ configPath: '/nonexistent/nachos.toml' });
      }).toThrow(ConfigLoadError);
    });

    it('should throw for invalid config', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const toml = `
[nachos]
name = ""
version = "1.0"

[llm]
provider = "anthropic"
model = "claude"

[security]
mode = "standard"
      `;
      fs.writeFileSync(configPath, toml);

      expect(() => {
        loadAndValidateConfig({ configPath });
      }).toThrow(ConfigValidationError);
    });

    it('should apply environment variables correctly', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const toml = `
[nachos]
name = "test"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude"
max_tokens = 4096

[security]
mode = "standard"

[security.rate_limits]
messages_per_minute = 30
      `;
      fs.writeFileSync(configPath, toml);

      process.env.LLM_MAX_TOKENS = '8192';
      process.env.SECURITY_RATE_LIMIT_MESSAGES = '50';
      process.env.RUNTIME_REDIS_URL = 'redis://localhost:6379';

      const config = loadAndValidateConfig({ configPath });

      expect(config.llm.max_tokens).toBe(8192);
      expect(config.security.rate_limits?.messages_per_minute).toBe(50);
      expect(config.runtime?.redis_url).toBe('redis://localhost:6379');
    });
  });
});
