import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemReadTool } from './read-tool.js';

describe('FilesystemReadTool', () => {
  const noopLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  let tempDir: string;
  let outsideDir: string;
  let tool: FilesystemReadTool;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-read-tool-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-read-tool-outside-'));
    filePath = path.join(tempDir, 'sample.txt');
    await fs.writeFile(filePath, 'hello world', 'utf-8');

    tool = new FilesystemReadTool();
    (tool as { logger: typeof noopLogger }).logger = noopLogger;
    await tool.initialize({
      config: { paths: [tempDir] },
      secrets: {},
      securityMode: 'standard',
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('reads file contents', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'read',
      path: filePath,
    });

    expect(result.success).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toBe('hello world');
  });

  it('lists directory contents', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'list',
      path: tempDir,
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.path).toBe(tempDir);
    expect(payload.entries.length).toBeGreaterThan(0);
  });

  it('returns stats for file', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'stat',
      path: filePath,
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.type).toBe('file');
  });

  it('errors when listing a file as a directory', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'list',
      path: filePath,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_A_DIRECTORY');
  });

  it('rejects reads outside allowed paths', () => {
    const result = tool.validate({
      sessionId: 'session',
      callId: 'call',
      action: 'read',
      path: outsideDir,
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('not in allowed directories');
  });

  it('errors when reading a directory as a file', async () => {
    const result = await tool.execute({
      sessionId: 'session',
      callId: 'call',
      action: 'read',
      path: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_A_FILE');
  });

  it('rejects paths outside the allowlist during validation', () => {
    const outsidePath = path.join(os.tmpdir(), 'outside.txt');
    const validation = tool.validate({
      sessionId: 'session',
      callId: 'call',
      action: 'read',
      path: outsidePath,
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors?.[0]).toContain('not in allowed directories');
  });
});
