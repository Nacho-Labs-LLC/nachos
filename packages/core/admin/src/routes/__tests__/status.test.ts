import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StatusResponse } from '../../types.js';

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-status-test-'));
  configPath = path.join(tempDir, 'nachos.toml');
});

afterEach(async () => {
  try {
    await fsp.rm(tempDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

async function createStatusApp(opts: { configFilePath: string; gatewayHealthUrl?: string }) {
  process.env['NACHOS_CONFIG_PATH'] = opts.configFilePath;
  process.env['GATEWAY_HEALTH_URL'] = opts.gatewayHealthUrl ?? 'http://localhost:1/health';

  vi.resetModules();

  // Mock @nachos/config
  vi.mock('@nachos/config', () => ({
    loadTomlFile: (filePath: string) => {
      // Read the actual file content and return a mock NachosConfig object
      const content = fs.readFileSync(filePath, 'utf-8');

      // Return a minimal config object based on the file content
      if (content.includes('provider = "anthropic"')) {
        return {
          llm: { provider: 'anthropic', model: 'claude-3' },
          channels: {
            slack: { enabled: true },
            discord: { enabled: false },
          },
          tools: {
            filesystem: { enabled: true },
            code_runner: { enabled: false },
          },
          security: { mode: 'standard' },
        };
      }
      return {};
    },
    parseToml: (_content: string) => ({}),
  }));

  // Mock @nachos/types
  vi.mock('@nachos/types', () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }));

  const { statusRouter } = await import('../status.js');

  const app = new Hono();
  app.route('/api/status', statusRouter);
  return app;
}

describe('statusRouter', () => {
  describe('GET /api/status', () => {
    it('returns status response with gateway unreachable when gateway is down', async () => {
      const tomlContent = `[llm]
provider = "anthropic"
model = "claude-3"

[channels.slack]
enabled = true

[channels.discord]
enabled = false

[tools.filesystem]
enabled = true

[tools.code_runner]
enabled = false

[security]
mode = "standard"
`;
      await fsp.writeFile(configPath, tomlContent, 'utf-8');

      const app = await createStatusApp({
        configFilePath: configPath,
        // Use an unreachable URL
        gatewayHealthUrl: 'http://localhost:1/health',
      });

      const res = await app.request('/api/status');
      expect(res.status).toBe(200);

      const body = (await res.json()) as StatusResponse;

      // Gateway should be unreachable since we pointed to a dead URL
      expect(body.gateway).toEqual({ status: 'unreachable' });

      // Config status should be populated
      expect(body.config).toBeDefined();
      const config = body.config!;
      expect(config.llm.provider).toBe('anthropic');
      expect(config.llm.model).toBe('claude-3');
      expect(config.channels.slack).toEqual({ enabled: true });
      expect(config.channels.discord).toEqual({ enabled: false });
      expect(config.tools.filesystem).toEqual({ enabled: true });
      expect(config.tools.code_runner).toEqual({ enabled: false });
      expect(config.security.mode).toBe('standard');

      // Timestamp should be present
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('returns null config when nachos.toml does not exist', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.toml');

      const app = await createStatusApp({
        configFilePath: nonExistentPath,
      });

      const res = await app.request('/api/status');
      expect(res.status).toBe(200);

      const body = (await res.json()) as StatusResponse;
      expect(body.config).toBeNull();
      expect(body.gateway).toEqual({ status: 'unreachable' });
      expect(body.timestamp).toBeDefined();
    });

    it('response has the correct StatusResponse shape', async () => {
      const tomlContent = `[llm]
provider = "anthropic"
model = "claude-3"

[security]
mode = "strict"
`;
      await fsp.writeFile(configPath, tomlContent, 'utf-8');

      const app = await createStatusApp({ configFilePath: configPath });
      const res = await app.request('/api/status');
      const body = (await res.json()) as StatusResponse;

      // Verify required top-level fields
      expect(body).toHaveProperty('gateway');
      expect(body).toHaveProperty('config');
      expect(body).toHaveProperty('timestamp');

      // Gateway should have status
      expect(body.gateway).toHaveProperty('status');
    });
  });
});
