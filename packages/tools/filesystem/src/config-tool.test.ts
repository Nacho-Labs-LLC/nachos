import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigPatchTool } from './config-tool.js';

describe('ConfigPatchTool', () => {
  const noopLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  let tempDir: string;
  let tool: ConfigPatchTool;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-config-tool-'));
    configPath = path.join(tempDir, 'nachos.toml');
    await fs.writeFile(configPath, ['[nachos]', 'name = "test"'].join('\n'), 'utf-8');

    tool = new ConfigPatchTool();
    (tool as { logger: typeof noopLogger }).logger = noopLogger;
    await tool.initialize({
      config: { config_path: configPath },
      secrets: {},
      securityMode: 'standard',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('applies a unified diff patch to nachos.toml', async () => {
    const patch = ['@@ -1,2 +1,2 @@', ' [nachos]', '-name = "test"', '+name = "updated"', ''].join(
      '\n'
    );

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      patch,
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(configPath, 'utf-8');
    expect(updated).toContain('name = "updated"');
  });

  it('supports dry run without writing', async () => {
    const patch = ['@@ -1,2 +1,2 @@', ' [nachos]', '-name = "test"', '+name = "dry-run"', ''].join(
      '\n'
    );

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      patch,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    const unchanged = await fs.readFile(configPath, 'utf-8');
    expect(unchanged).toContain('name = "test"');
    expect(unchanged).not.toContain('dry-run');
  });

  it('applies patches in reverse', async () => {
    const patch = ['@@ -1,2 +1,2 @@', ' [nachos]', '-name = "test"', '+name = "updated"', ''].join(
      '\n'
    );

    await tool.execute({
      sessionId: 'session',
      callId: 'call',
      patch,
    });

    const reverseResult = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      patch,
      reverse: true,
    });

    expect(reverseResult.success).toBe(true);
    const restored = await fs.readFile(configPath, 'utf-8');
    expect(restored).toContain('name = "test"');
    expect(restored).not.toContain('updated');
  });

  it('returns error for invalid patch content', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      patch: 'not-a-hunk',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PATCH');
  });
});
