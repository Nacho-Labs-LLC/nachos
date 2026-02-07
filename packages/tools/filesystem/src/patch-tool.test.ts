import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemPatchTool } from './patch-tool.js';

describe('FilesystemPatchTool', () => {
  const noopLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  let tempDir: string;
  let tool: FilesystemPatchTool;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-patch-tool-'));
    filePath = path.join(tempDir, 'sample.txt');
    await fs.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8');

    tool = new FilesystemPatchTool();
    (tool as { logger: typeof noopLogger }).logger = noopLogger;
    await tool.initialize({
      config: { paths: [tempDir] },
      secrets: {},
      securityMode: 'standard',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('applies a unified diff patch', async () => {
    const patch = ['@@ -1,3 +1,3 @@', ' one', '-two', '+two-updated', ' three', ''].join('\n');

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      path: filePath,
      patch,
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(filePath, 'utf-8');
    expect(updated).toContain('two-updated');
  });

  it('supports dry run without writing', async () => {
    const patch = ['@@ -1,3 +1,3 @@', ' one', '-two', '+two-dry', ' three', ''].join('\n');

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      path: filePath,
      patch,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    const unchanged = await fs.readFile(filePath, 'utf-8');
    expect(unchanged).toContain('two');
    expect(unchanged).not.toContain('two-dry');
  });

  it('applies patches in reverse', async () => {
    const patch = ['@@ -1,3 +1,3 @@', ' one', '-two', '+two-updated', ' three', ''].join('\n');

    await tool.execute({
      sessionId: 'session',
      callId: 'call',
      path: filePath,
      patch,
    });

    const reverseResult = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      path: filePath,
      patch,
      reverse: true,
    });

    expect(reverseResult.success).toBe(true);
    const restored = await fs.readFile(filePath, 'utf-8');
    expect(restored).toContain('two');
    expect(restored).not.toContain('two-updated');
  });

  it('returns error for invalid patch content', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      path: filePath,
      patch: 'not-a-hunk',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PATCH');
  });

  it('fails when hunk does not match file contents', async () => {
    const patch = ['@@ -1,3 +1,3 @@', ' one', '-four', '+four-updated', ' three', ''].join('\n');

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      path: filePath,
      patch,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PATCH_FAILED');
  });
});
