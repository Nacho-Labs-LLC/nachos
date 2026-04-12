import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { addToolCommand } from './tool.js';

describe('addToolCommand', () => {
  const originalEnv = process.env.NACHOS_CONFIG_PATH;
  let tempDir: string;
  let configPath: string;
  let mockExit: ReturnType<typeof vi.spyOn>;

  function captureJsonOutput() {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    return {
      parse() {
        spy.mockRestore();
        const raw = logs.join('\n').trim();
        return raw.length > 0 ? JSON.parse(raw) : null;
      },
    };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'nachos-cli-'));
    configPath = path.join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalEnv;
    }

    rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
    vi.restoreAllMocks();
  });

  it('adds browser tool config in JSON mode', async () => {
    const out = captureJsonOutput();
    await addToolCommand('browser', { json: true, timeout: '30', domains: 'example.com' });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.tool).toBe('browser');
    expect(result.data.action).toBe('added');

    const config = TOML.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const tools = config.tools as Record<string, Record<string, unknown>>;
    expect(tools.browser.timeout).toBe(30);
    expect(tools.browser.allowed_domains).toEqual(['example.com']);
  });

  it('rejects invalid timeout values', async () => {
    for (const timeout of ['0', '-1', '601', 'abc']) {
      const out = captureJsonOutput();
      await addToolCommand('browser', { json: true, timeout });
      const result = out.parse();

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('INVALID_TIMEOUT');
    }
  });

  it('rejects unknown tool names', async () => {
    const out = captureJsonOutput();
    await addToolCommand('unknown_tool', { json: true });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UNKNOWN_TOOL');
  });
});
