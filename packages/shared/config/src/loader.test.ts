import { describe, it, expect } from 'vitest';
import { parseToml, ConfigLoadError } from './loader.js';

describe('TOML Loader', () => {
  describe('parseToml', () => {
    it('should parse valid TOML', () => {
      const toml = `
[nachos]
name = "test-assistant"
version = "1.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

[security]
mode = "standard"
      `;

      const config = parseToml(toml);

      expect(config.nachos.name).toBe('test-assistant');
      expect(config.nachos.version).toBe('1.0');
      expect(config.llm.provider).toBe('anthropic');
      expect(config.llm.model).toBe('claude-sonnet-4-20250514');
      expect(config.security.mode).toBe('standard');
    });

    it('should parse TOML with all sections', () => {
      const toml = `
[nachos]
name = "full-assistant"
version = "2.0"

[llm]
provider = "openai"
model = "gpt-4"
max_tokens = 4096
temperature = 0.7

[channels.webchat]
enabled = true
port = 8080

[tools.filesystem]
enabled = true
write = false

[security]
mode = "strict"

[runtime]
log_level = "info"

[assistant]
name = "Helper"
      `;

      const config = parseToml(toml);

      expect(config.llm.max_tokens).toBe(4096);
      expect(config.llm.temperature).toBe(0.7);
      expect(config.channels?.webchat?.enabled).toBe(true);
      expect(config.channels?.webchat?.port).toBe(8080);
      expect(config.tools?.filesystem?.enabled).toBe(true);
      expect(config.runtime?.log_level).toBe('info');
    });

    it('should throw ConfigLoadError for invalid TOML', () => {
      const invalidToml = `
[nachos
name = "broken"
      `;

      expect(() => parseToml(invalidToml)).toThrow(ConfigLoadError);
    });

    it('should parse arrays correctly', () => {
      const toml = `
[nachos]
name = "test"
version = "1.0"

[llm]
provider = "anthropic"
model = "test"

[security]
mode = "standard"

[tools.filesystem]
enabled = true
paths = ["./workspace", "/tmp"]

[channels.discord]
enabled = true
allowed_users = ["user1", "user2"]
      `;

      const config = parseToml(toml);

      expect(config.tools?.filesystem?.paths).toEqual(['./workspace', '/tmp']);
      expect(config.channels?.discord?.allowed_users).toEqual(['user1', 'user2']);
    });

    it('should parse nested objects', () => {
      const toml = `
[nachos]
name = "test"
version = "1.0"

[llm]
provider = "anthropic"
model = "test"

[security]
mode = "standard"

[security.dlp]
enabled = true
action = "warn"
patterns = ["api_key", "password"]

[security.rate_limits]
messages_per_minute = 30
tool_calls_per_minute = 15

[runtime]
redis_url = "redis://localhost:6379"
      `;

      const config = parseToml(toml);

      expect(config.security.dlp?.enabled).toBe(true);
      expect(config.security.dlp?.action).toBe('warn');
      expect(config.security.dlp?.patterns).toEqual(['api_key', 'password']);
      expect(config.security.rate_limits?.messages_per_minute).toBe(30);
      expect(config.runtime?.redis_url).toBe('redis://localhost:6379');
    });
  });
});
