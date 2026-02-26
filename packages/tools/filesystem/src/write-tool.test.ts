import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemWriteTool } from './write-tool.js';

describe('FilesystemWriteTool', () => {
  const noopLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  let tempDir: string;
  let outsideDir: string;
  let tool: FilesystemWriteTool;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-write-tool-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-write-tool-outside-'));
    filePath = path.join(tempDir, 'sample.txt');

    tool = new FilesystemWriteTool();
    (tool as { logger: typeof noopLogger }).logger = noopLogger;
    await tool.initialize({
      config: { paths: [tempDir], max_file_size: '5B' },
      secrets: {},
      securityMode: 'standard',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('creates, writes, and deletes files', async () => {
    const createResult = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'create',
      path: filePath,
      content: 'hello',
    });

    expect(createResult.success).toBe(true);

    const writeResult = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'write',
      path: filePath,
      content: 'updated',
    });

    expect(writeResult.success).toBe(true);
    const updated = await fs.readFile(filePath, 'utf-8');
    expect(updated).toBe('updated');

    const deleteResult = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'delete',
      path: filePath,
    });

    expect(deleteResult.success).toBe(true);
  });

  it('returns error when creating an existing file', async () => {
    await fs.writeFile(filePath, 'exists', 'utf-8');

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'create',
      path: filePath,
      content: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_EXISTS');
  });

  it('creates directories recursively', async () => {
    const nestedDir = path.join(tempDir, 'a', 'b', 'c');

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'mkdir',
      path: nestedDir,
      recursive: true,
    });

    expect(result.success).toBe(true);
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('returns error when deleting a directory', async () => {
    const directoryPath = path.join(tempDir, 'dir');
    await fs.mkdir(directoryPath);

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'delete',
      path: directoryPath,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_A_FILE');
  });

  it('validates max file size', () => {
    const validation = tool.validate({
      sessionId: 'session',
      callId: 'call',
      action: 'create',
      path: filePath,
      content: 'too-long',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('exceeds maximum');
  });

  it('rejects writes outside allowed paths', () => {
    const validation = tool.validate({
      sessionId: 'session',
      callId: 'call',
      action: 'create',
      path: path.join(outsideDir, 'blocked.txt'),
      content: 'hello',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('not in allowed directories');
  });

  it('returns error when writing missing file', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'write',
      path: filePath,
      content: 'hello',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_NOT_FOUND');
  });

  it('rejects paths outside the allowlist during validation', () => {
    const outsidePath = path.join(os.tmpdir(), 'outside.txt');
    const validation = tool.validate({
      sessionId: 'session',
      callId: 'call',
      action: 'create',
      path: outsidePath,
      content: 'ok',
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('not in allowed directories');
  });

  it('returns error when creating existing file', async () => {
    await fs.writeFile(filePath, 'existing', 'utf-8');

    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'create',
      path: filePath,
      content: 'new',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_EXISTS');
  });
});
