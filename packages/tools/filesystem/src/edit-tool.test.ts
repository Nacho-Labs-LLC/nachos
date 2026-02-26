import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemEditTool } from './edit-tool.js';

describe('FilesystemEditTool', () => {
  const noopLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  let tempDir: string;
  let tool: FilesystemEditTool;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-edit-tool-'));
    filePath = path.join(tempDir, 'sample.txt');
    await fs.writeFile(filePath, ['one', 'two', 'three'].join('\n'), 'utf-8');

    tool = new FilesystemEditTool();
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

  it('replaces a line', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'replace',
      path: filePath,
      line: 2,
      content: 'two-updated',
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(filePath, 'utf-8');
    expect(updated.split('\n')[1]).toBe('two-updated');
  });

  it('inserts a line', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'insert',
      path: filePath,
      line: 2,
      content: 'inserted',
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(filePath, 'utf-8');
    const lines = updated.split('\n');
    expect(lines[1]).toBe('inserted');
  });

  it('deletes lines', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'delete',
      path: filePath,
      line: 1,
      count: 2,
    });

    expect(result.success).toBe(true);
    const updated = await fs.readFile(filePath, 'utf-8');
    expect(updated).toBe('three');
  });

  it('returns error for invalid line number', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'replace',
      path: filePath,
      line: 10,
      content: 'oops',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_LINE');
  });

  it('returns error for missing file', async () => {
    const missingPath = path.join(tempDir, 'missing.txt');
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'replace',
      path: missingPath,
      line: 1,
      content: 'oops',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_NOT_FOUND');
  });

  it('rejects line numbers less than 1 during validation', () => {
    const validation = tool.validate({
      sessionId: 'session',
      callId: 'call',
      action: 'delete',
      path: filePath,
      line: 0,
      count: 1,
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('Line number must be');
  });
});
