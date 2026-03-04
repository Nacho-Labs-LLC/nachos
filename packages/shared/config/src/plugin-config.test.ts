/**
 * Tests for the Plugin Configuration System
 *
 * Covers:
 * - Schema registration and validation
 * - Config value validation against schemas
 * - Default value application
 * - Unknown plugin rejection
 * - validateAll across multiple plugins
 * - Integration with config loading (plugins section in NachosConfig)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PluginConfigRegistry,
  PluginConfigError,
  validatePluginConfig,
  applyDefaults,
  isValidPluginId,
} from './plugin-config.js';
import type { PluginConfigSchema } from './plugin-config.js';
import { parseToml } from './loader.js';
import { validateConfig } from './validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple schema for a hypothetical "my-channel" plugin. */
const myChannelSchema: PluginConfigSchema = {
  type: 'object',
  properties: {
    api_key: { type: 'string', minLength: 1 },
    timeout: { type: 'number', minimum: 0, maximum: 300, default: 30 },
    verbose: { type: 'boolean', default: false },
    tags: { type: 'array', items: { type: 'string' } },
    advanced: {
      type: 'object',
      properties: {
        retries: { type: 'number', default: 3 },
        mode: { type: 'string', enum: ['fast', 'safe'], default: 'safe' },
      },
    },
  },
  required: ['api_key'],
};

/** A minimal valid config for the my-channel schema. */
const validConfig = (): Record<string, unknown> => ({
  api_key: 'sk-test-123',
});

// ---------------------------------------------------------------------------
// isValidPluginId
// ---------------------------------------------------------------------------

describe('isValidPluginId', () => {
  it('accepts valid slugs', () => {
    expect(isValidPluginId('a')).toBe(true);
    expect(isValidPluginId('my-channel')).toBe(true);
    expect(isValidPluginId('slack')).toBe(true);
    expect(isValidPluginId('a1b2c3')).toBe(true);
    expect(isValidPluginId('ab')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidPluginId('')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidPluginId('MyChannel')).toBe(false);
  });

  it('rejects leading hyphens', () => {
    expect(isValidPluginId('-abc')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(isValidPluginId('my_channel')).toBe(false);
    expect(isValidPluginId('my.channel')).toBe(false);
    expect(isValidPluginId('my channel')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PluginConfigRegistry
// ---------------------------------------------------------------------------

describe('PluginConfigRegistry', () => {
  let registry: PluginConfigRegistry;

  beforeEach(() => {
    registry = new PluginConfigRegistry();
  });

  // -- Registration --

  describe('register', () => {
    it('registers a valid schema', () => {
      registry.register('my-channel', myChannelSchema);
      expect(registry.hasPlugin('my-channel')).toBe(true);
      expect(registry.getRegisteredPlugins()).toContain('my-channel');
    });

    it('throws on invalid plugin ID', () => {
      expect(() => registry.register('My_Channel', myChannelSchema)).toThrow(PluginConfigError);
    });

    it('throws on duplicate registration', () => {
      registry.register('my-channel', myChannelSchema);
      expect(() => registry.register('my-channel', myChannelSchema)).toThrow(PluginConfigError);
      expect(() => registry.register('my-channel', myChannelSchema)).toThrow(/already registered/);
    });

    it('throws on invalid schema (bad type)', () => {
      const badSchema = {
        type: 'object' as const,
        properties: {
          foo: { type: 'invalid' as 'string' },
        },
      };
      expect(() => registry.register('bad-schema', badSchema)).toThrow(PluginConfigError);
    });

    it('returns the schema via getSchema', () => {
      registry.register('my-channel', myChannelSchema);
      const schema = registry.getSchema('my-channel');
      expect(schema).toBe(myChannelSchema);
    });

    it('returns undefined for unregistered plugin', () => {
      expect(registry.getSchema('nonexistent')).toBeUndefined();
    });

    it('clears all registrations', () => {
      registry.register('my-channel', myChannelSchema);
      registry.clear();
      expect(registry.hasPlugin('my-channel')).toBe(false);
      expect(registry.getRegisteredPlugins()).toHaveLength(0);
    });
  });

  // -- Validation --

  describe('validate', () => {
    beforeEach(() => {
      registry.register('my-channel', myChannelSchema);
    });

    it('validates a valid config', () => {
      const result = registry.validate('my-channel', validConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a full config with all fields', () => {
      const result = registry.validate('my-channel', {
        api_key: 'sk-test-123',
        timeout: 60,
        verbose: true,
        tags: ['production', 'v2'],
        advanced: { retries: 5, mode: 'fast' },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing required fields', () => {
      const result = registry.validate('my-channel', {});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('api_key'))).toBe(true);
    });

    it('rejects wrong types', () => {
      const result = registry.validate('my-channel', {
        api_key: 123,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('string'))).toBe(true);
    });

    it('rejects values below minimum', () => {
      const result = registry.validate('my-channel', {
        api_key: 'sk-test',
        timeout: -5,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('>= 0'))).toBe(true);
    });

    it('rejects values above maximum', () => {
      const result = registry.validate('my-channel', {
        api_key: 'sk-test',
        timeout: 999,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('<= 300'))).toBe(true);
    });

    it('rejects invalid enum values', () => {
      const result = registry.validate('my-channel', {
        api_key: 'sk-test',
        advanced: { mode: 'turbo' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('one of'))).toBe(true);
    });

    it('rejects string below minLength', () => {
      const result = registry.validate('my-channel', {
        api_key: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least 1'))).toBe(true);
    });

    it('rejects unknown properties by default', () => {
      const result = registry.validate('my-channel', {
        api_key: 'sk-test',
        unknown_field: 'oops',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unknown_field') || e.includes('Unknown'))).toBe(
        true
      );
    });

    it('rejects array items of wrong type', () => {
      const result = registry.validate('my-channel', {
        api_key: 'sk-test',
        tags: ['ok', 123, 'also-ok'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('string'))).toBe(true);
    });

    it('throws for unregistered plugins', () => {
      expect(() => registry.validate('unknown-plugin', {})).toThrow(PluginConfigError);
      expect(() => registry.validate('unknown-plugin', {})).toThrow(/No schema registered/);
    });
  });

  // -- Default Application --

  describe('applyDefaults', () => {
    beforeEach(() => {
      registry.register('my-channel', myChannelSchema);
    });

    it('applies top-level defaults for missing keys', () => {
      const result = registry.applyDefaults('my-channel', { api_key: 'sk-test' });
      expect(result.timeout).toBe(30);
      expect(result.verbose).toBe(false);
      expect(result.api_key).toBe('sk-test');
    });

    it('does not override provided values', () => {
      const result = registry.applyDefaults('my-channel', {
        api_key: 'sk-test',
        timeout: 120,
        verbose: true,
      });
      expect(result.timeout).toBe(120);
      expect(result.verbose).toBe(true);
    });

    it('applies nested object defaults', () => {
      const result = registry.applyDefaults('my-channel', {
        api_key: 'sk-test',
        advanced: {},
      });
      const advanced = result.advanced as Record<string, unknown>;
      expect(advanced.retries).toBe(3);
      expect(advanced.mode).toBe('safe');
    });

    it('does not override nested provided values', () => {
      const result = registry.applyDefaults('my-channel', {
        api_key: 'sk-test',
        advanced: { retries: 10 },
      });
      const advanced = result.advanced as Record<string, unknown>;
      expect(advanced.retries).toBe(10);
      expect(advanced.mode).toBe('safe');
    });

    it('does not mutate the original config', () => {
      const original = { api_key: 'sk-test' };
      const result = registry.applyDefaults('my-channel', original);
      expect(original).not.toHaveProperty('timeout');
      expect(result).toHaveProperty('timeout', 30);
    });

    it('throws for unregistered plugins', () => {
      expect(() => registry.applyDefaults('unknown-plugin', {})).toThrow(PluginConfigError);
    });
  });

  // -- validateAll --

  describe('validateAll', () => {
    it('validates all registered plugins at once', () => {
      const otherSchema: PluginConfigSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      registry.register('my-channel', myChannelSchema);
      registry.register('other-plugin', otherSchema);

      const result = registry.validateAll({
        'my-channel': { api_key: 'sk-test' },
        'other-plugin': { name: 'test' },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports errors from multiple plugins', () => {
      const otherSchema: PluginConfigSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      registry.register('my-channel', myChannelSchema);
      registry.register('other-plugin', otherSchema);

      const result = registry.validateAll({
        'my-channel': {}, // missing api_key
        'other-plugin': {}, // missing name
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.includes('plugins.my-channel'))).toBe(true);
      expect(result.errors.some((e) => e.includes('plugins.other-plugin'))).toBe(true);
    });

    it('rejects unknown (unregistered) plugin sections', () => {
      registry.register('my-channel', myChannelSchema);

      const result = registry.validateAll({
        'my-channel': { api_key: 'sk-test' },
        'typo-plugin': { foo: 'bar' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('typo-plugin') && e.includes('no schema'))).toBe(
        true
      );
    });

    it('returns valid when plugins map is empty', () => {
      const result = registry.validateAll({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Standalone validatePluginConfig / applyDefaults
// ---------------------------------------------------------------------------

describe('validatePluginConfig (standalone)', () => {
  it('validates a config against a schema', () => {
    const schema: PluginConfigSchema = {
      type: 'object',
      properties: {
        port: { type: 'number', minimum: 1, maximum: 65535 },
      },
      required: ['port'],
    };

    expect(validatePluginConfig(schema, { port: 8080 }).valid).toBe(true);
    expect(validatePluginConfig(schema, {}).valid).toBe(false);
    expect(validatePluginConfig(schema, { port: 0 }).valid).toBe(false);
    expect(validatePluginConfig(schema, { port: 70000 }).valid).toBe(false);
    expect(validatePluginConfig(schema, { port: 'hello' }).valid).toBe(false);
  });
});

describe('applyDefaults (standalone)', () => {
  it('applies defaults from a schema', () => {
    const schema: PluginConfigSchema = {
      type: 'object',
      properties: {
        host: { type: 'string', default: 'localhost' },
        port: { type: 'number', default: 3000 },
      },
    };

    const result = applyDefaults(schema, {});
    expect(result.host).toBe('localhost');
    expect(result.port).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// Integration: plugins section in TOML config loading
// ---------------------------------------------------------------------------

describe('config integration with plugins section', () => {
  it('parses a TOML config with [plugins.x] sections', () => {
    const toml = `
[nachos]
name = "test-bot"
version = "1.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"

[plugins.my-channel]
api_key = "sk-test-123"
timeout = 60

[plugins.other-plugin]
name = "hello"
`;

    const config = parseToml(toml);
    expect(config.plugins).toBeDefined();
    expect(config.plugins!['my-channel']).toEqual({
      api_key: 'sk-test-123',
      timeout: 60,
    });
    expect(config.plugins!['other-plugin']).toEqual({
      name: 'hello',
    });
  });

  it('validates config without plugins section (backward compat)', () => {
    const toml = `
[nachos]
name = "test-bot"
version = "1.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"
`;

    const config = parseToml(toml);
    expect(config.plugins).toBeUndefined();

    const result = validateConfig(config);
    expect(result.valid).toBe(true);
  });

  it('does not flag plugins section as unknown key', () => {
    const toml = `
[nachos]
name = "test-bot"
version = "1.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"

[plugins.my-channel]
api_key = "sk-test-123"
`;

    const config = parseToml(toml);
    const result = validateConfig(config);

    // Should not have any "Unknown config key: plugins" errors
    const pluginErrors = result.errors.filter((e) => e.includes('plugins'));
    expect(pluginErrors).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('end-to-end: parse, validate base config, then validate plugins via registry', () => {
    const toml = `
[nachos]
name = "test-bot"
version = "1.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"

[plugins.my-channel]
api_key = "sk-test-123"
timeout = 60
`;

    // 1. Parse TOML
    const config = parseToml(toml);

    // 2. Validate base config
    const baseResult = validateConfig(config);
    expect(baseResult.valid).toBe(true);

    // 3. Register plugin schema and validate plugin sections
    const registry = new PluginConfigRegistry();
    registry.register('my-channel', myChannelSchema);

    const pluginResult = registry.validateAll(config.plugins ?? {});
    expect(pluginResult.valid).toBe(true);

    // 4. Apply defaults
    const withDefaults = registry.applyDefaults('my-channel', config.plugins!['my-channel']);
    expect(withDefaults.api_key).toBe('sk-test-123');
    expect(withDefaults.timeout).toBe(60);
    expect(withDefaults.verbose).toBe(false); // default
  });

  it('end-to-end: rejects invalid plugin config via registry', () => {
    const toml = `
[nachos]
name = "test-bot"
version = "1.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"

[plugins.my-channel]
timeout = 60
`;

    const config = parseToml(toml);

    const registry = new PluginConfigRegistry();
    registry.register('my-channel', myChannelSchema);

    // Missing required api_key
    const pluginResult = registry.validateAll(config.plugins ?? {});
    expect(pluginResult.valid).toBe(false);
    expect(pluginResult.errors.some((e) => e.includes('api_key'))).toBe(true);
  });
});
