import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathValidator } from './path-validator.js';

describe('PathValidator', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-path-validator-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows paths within allowed directories', () => {
    const validator = new PathValidator({ allowedPaths: [tempDir] });
    const result = validator.validate(path.join(tempDir, 'file.txt'));

    expect(result.valid).toBe(true);
  });

  it('blocks path traversal when disabled', () => {
    const validator = new PathValidator({ allowedPaths: [tempDir], allowTraversal: false });
    const traversalPath = `${tempDir}${path.sep}..${path.sep}${path.basename(tempDir)}${path.sep}file.txt`;
    const result = validator.validate(traversalPath);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Path traversal detected');
  });

  it('blocks paths outside allowed directories', () => {
    const validator = new PathValidator({ allowedPaths: [tempDir] });
    const outsidePath = path.join(os.tmpdir(), 'outside.txt');
    const result = validator.validate(outsidePath);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('not in allowed directories');
  });

  it('allows traversal when explicitly enabled and resolved path is allowed', () => {
    const validator = new PathValidator({ allowedPaths: [tempDir], allowTraversal: true });
    const traversalPath = path.join(tempDir, 'subdir', '..', 'file.txt');
    const result = validator.validate(traversalPath);

    expect(result.valid).toBe(true);
  });

  it('blocks sensitive file patterns', () => {
    const validator = new PathValidator({ allowedPaths: [tempDir] });
    const result = validator.validate(path.join(tempDir, '.env'));

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('matches blocked pattern');
  });
});
