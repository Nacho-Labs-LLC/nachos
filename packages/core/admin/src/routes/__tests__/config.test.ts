import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Mock @nachos/config to avoid actual TOML parsing dependencies
vi.mock('@nachos/config', () => ({
  parseToml: (content: string) => {
    // Simple validation: if content contains "INVALID", throw
    if (content.includes('INVALID_TOML')) {
      throw new Error('Invalid TOML');
    }
    return { parsed: true, raw: content };
  },
  loadTomlFile: () => ({}),
}));

vi.mock('@iarna/toml', () => ({
  default: {
    parse: (content: string) => {
      if (content.includes('INVALID_TOML')) {
        throw new Error('Invalid TOML');
      }
      return { section: { key: 'value' } };
    },
    stringify: (obj: unknown) => JSON.stringify(obj),
  },
}));

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-config-test-'));
  configPath = path.join(tempDir, 'nachos.toml');
});

afterEach(async () => {
  try {
    await fsp.rm(tempDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

/**
 * Create a fresh Hono app with configRouter, setting the config path
 * via env var before the module is loaded.
 */
async function createConfigApp(configFilePath: string) {
  // We need to set env before import, but since we dynamically import,
  // we'll work around by importing configRouter and patching the path.
  // Instead, let's mock the CONFIG_PATH via the env variable.
  process.env['NACHOS_CONFIG_PATH'] = configFilePath;

  // Clear module cache for fresh import
  vi.resetModules();

  // Re-mock dependencies after resetModules
  vi.mock('@nachos/config', () => ({
    parseToml: (content: string) => {
      if (content.includes('INVALID_TOML')) {
        throw new Error('Invalid TOML');
      }
      return { parsed: true, raw: content };
    },
    loadTomlFile: () => ({}),
  }));

  vi.mock('@iarna/toml', () => ({
    default: {
      parse: (content: string) => {
        if (content.includes('INVALID_TOML')) {
          throw new Error('Invalid TOML');
        }
        return { section: { key: 'value' } };
      },
      stringify: (obj: unknown) => JSON.stringify(obj),
    },
  }));

  const { configRouter } = await import('../config.js');

  const app = new Hono();
  app.route('/api/config', configRouter);
  return app;
}

describe('configRouter', () => {
  describe('GET /api/config', () => {
    it('returns 404 when nachos.toml does not exist', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.toml');
      const app = await createConfigApp(nonExistentPath);

      const res = await app.request('/api/config');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('nachos.toml not found');
    });

    it('returns config content and parsed data on success', async () => {
      const tomlContent = '[llm]\nprovider = "anthropic"\n';
      await fsp.writeFile(configPath, tomlContent, 'utf-8');

      const app = await createConfigApp(configPath);

      const res = await app.request('/api/config');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { content: string; parsed: unknown };
      expect(body.content).toBe(tomlContent);
      expect(body.parsed).toBeDefined();
    });
  });

  describe('PUT /api/config', () => {
    it('returns 400 when content is missing', async () => {
      await fsp.writeFile(configPath, '', 'utf-8');
      const app = await createConfigApp(configPath);

      const res = await app.request('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('content is required');
    });

    it('returns 400 when TOML is invalid', async () => {
      await fsp.writeFile(configPath, '', 'utf-8');
      const app = await createConfigApp(configPath);

      const res = await app.request('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'INVALID_TOML' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid TOML syntax');
    });

    it('writes valid TOML config and creates backup', async () => {
      const originalContent = '[original]\nkey = "value"\n';
      await fsp.writeFile(configPath, originalContent, 'utf-8');

      const app = await createConfigApp(configPath);

      const newContent = '[updated]\nkey = "new-value"\n';
      const res = await app.request('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Verify file was written
      const written = await fsp.readFile(configPath, 'utf-8');
      expect(written).toBe(newContent);

      // Verify backup was created
      const backup = await fsp.readFile(configPath + '.bak', 'utf-8');
      expect(backup).toBe(originalContent);
    });
  });

  describe('PATCH /api/config', () => {
    it('returns 400 when path or value is missing', async () => {
      await fsp.writeFile(configPath, '[section]\nkey = "val"\n', 'utf-8');
      const app = await createConfigApp(configPath);

      const res = await app.request('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'section.key' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('path and value are required');
    });

    it('returns 404 when config file does not exist', async () => {
      const nonExistent = path.join(tempDir, 'nope.toml');
      const app = await createConfigApp(nonExistent);

      const res = await app.request('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'llm.provider', value: 'openai' }),
      });

      expect(res.status).toBe(404);
    });

    it('patches a nested key in the config', async () => {
      const tomlContent = '[llm]\nprovider = "anthropic"\n';
      await fsp.writeFile(configPath, tomlContent, 'utf-8');

      const app = await createConfigApp(configPath);

      const res = await app.request('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'section.key', value: 'new-value' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; parsed: unknown };
      expect(body.ok).toBe(true);
      expect(body.parsed).toBeDefined();
    });
  });
});
