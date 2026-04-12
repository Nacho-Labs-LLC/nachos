import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureSubagentWorkspaceDir,
  listSubagentWorkspaceEntries,
  readSubagentWorkspaceFile,
} from './workspace-utils.js';

describe('subagent workspace utils', () => {
  let tempDir: string | undefined;

  const makeTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-subagent-'));
    tempDir = dir;
    return dir;
  };

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('creates a run workspace directory', async () => {
    const root = await makeTempDir();
    const runDir = await ensureSubagentWorkspaceDir(root, 'run-1');
    const stat = await fs.stat(runDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('lists workspace entries and supports recursion', async () => {
    const root = await makeTempDir();
    const runDir = await ensureSubagentWorkspaceDir(root, 'run-2');
    await fs.writeFile(path.join(runDir, 'note.txt'), 'hello', 'utf-8');
    await fs.mkdir(path.join(runDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(runDir, 'nested', 'inner.txt'), 'world', 'utf-8');

    const flat = await listSubagentWorkspaceEntries({ rootDir: runDir });
    expect(flat.some((entry) => entry.path === 'note.txt')).toBe(true);
    expect(flat.some((entry) => entry.path === 'nested')).toBe(true);
    expect(flat.some((entry) => entry.path === path.join('nested', 'inner.txt'))).toBe(false);

    const recursive = await listSubagentWorkspaceEntries({ rootDir: runDir, recursive: true });
    expect(recursive.some((entry) => entry.path === path.join('nested', 'inner.txt'))).toBe(true);
  });

  it('reads files with truncation', async () => {
    const root = await makeTempDir();
    const runDir = await ensureSubagentWorkspaceDir(root, 'run-3');
    const filePath = path.join(runDir, 'output.txt');
    await fs.writeFile(filePath, 'a'.repeat(100), 'utf-8');

    const result = await readSubagentWorkspaceFile({
      rootDir: runDir,
      relativePath: 'output.txt',
      maxBytes: 10,
    });

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(10);
  });
});
