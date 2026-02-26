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
    delete process.env.NACHOS_ENV_PATH;
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
    it('should load and validate config from TOML', () => {
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

      const config = loadAndValidateConfig({ configPath });

      expect(config.nachos.name).toBe('test-assistant');
      expect(config.llm.model).toBe('claude');
      expect(config.security.mode).toBe('standard');
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

    it('should load .env secrets into process.env when applyDotenv is true', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const envPath = path.join(testDir, '.env');
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
      fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=test-key-from-dotenv\n');

      delete process.env.ANTHROPIC_API_KEY;
      loadAndValidateConfig({ configPath, envFilePath: envPath });

      // .env secrets are loaded into process.env for services that read them directly
      expect(process.env.ANTHROPIC_API_KEY).toBe('test-key-from-dotenv');
      // Config still comes from TOML only
    });

    it('should not load .env when applyDotenv is false', () => {
      const configPath = path.join(testDir, 'nachos.toml');
      const envPath = path.join(testDir, '.env');
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
      fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=should-not-load\n');

      delete process.env.ANTHROPIC_API_KEY;
      loadAndValidateConfig({ configPath, envFilePath: envPath, applyDotenv: false });

      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    });
  });
});
