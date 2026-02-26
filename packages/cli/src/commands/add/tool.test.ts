import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { addToolCommand } from './tool.js';

describe('addToolCommand', () => {
  const originalEnv = process.env.NACHOS_CONFIG_PATH;
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'nachos-cli-'));
    configPath = path.join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalEnv;
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds claude_code_mcp tool stub', async () => {
    await addToolCommand('claude_code_mcp', {});

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { tools?: Record<string, unknown> };

    expect(config.tools).toBeDefined();
    const tools = config.tools as Record<string, unknown>;
    expect(tools.claude_code_mcp).toEqual({
      enabled: true,
      max_prompt_length: 4000,
    });
  });
});
