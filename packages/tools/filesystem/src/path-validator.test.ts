import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PathValidator } from './path-validator.js';

describe('PathValidator', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Use realpathSync to get the canonical path on all platforms (e.g.
    // Windows where os.tmpdir() may return a short-name or symlinked path)
    const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-path-validator-'));
    tempDir = fsSync.realpathSync(raw);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Original tests (preserved for regression safety)
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Symlink traversal tests
  // -------------------------------------------------------------------------

  describe('symlink traversal protection', () => {
    let outsideDir: string;

    beforeEach(async () => {
      const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-outside-'));
      outsideDir = fsSync.realpathSync(raw);
      // Create a file outside the allowed directory for symlink targets
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'sensitive data', 'utf-8');
    });

    afterEach(async () => {
      await fs.rm(outsideDir, { recursive: true, force: true });
    });

    it('rejects a symlink inside allowed dir pointing outside it', async () => {
      // Create symlink: <tempDir>/escape -> <outsideDir>
      const symlinkPath = path.join(tempDir, 'escape');
      await fs.symlink(outsideDir, symlinkPath, 'junction');

      const validator = new PathValidator({ allowedPaths: [tempDir] });

      // Without the fix, this would pass because path.resolve() does not
      // follow symlinks and would see the path as inside tempDir.
      const result = validator.validate(path.join(symlinkPath, 'secret.txt'));

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('not in allowed directories');
    });

    it('rejects a symlink to a file outside the allowed dir', async () => {
      // Create symlink: <tempDir>/linked-secret.txt -> <outsideDir>/secret.txt
      const symlinkPath = path.join(tempDir, 'linked-secret.txt');
      await fs.symlink(path.join(outsideDir, 'secret.txt'), symlinkPath, 'file');

      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(symlinkPath);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('not in allowed directories');
    });

    it('allows a symlink inside allowed dir pointing to another allowed location', async () => {
      // Create a subdirectory and a symlink to it within the same allowed tree
      const subDir = path.join(tempDir, 'subdir');
      await fs.mkdir(subDir);
      await fs.writeFile(path.join(subDir, 'ok.txt'), 'allowed content', 'utf-8');

      // Symlink within the same allowed directory tree
      const symlinkPath = path.join(tempDir, 'link-to-subdir');
      await fs.symlink(subDir, symlinkPath, 'junction');

      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(path.join(symlinkPath, 'ok.txt'));

      expect(result.valid).toBe(true);
    });

    it('allows a symlink when both source and target are in allowed paths', async () => {
      // Create a non-sensitive file in outsideDir for this test (avoid
      // triggering the blocked pattern for "secret")
      await fs.writeFile(path.join(outsideDir, 'data.txt'), 'allowed data', 'utf-8');

      // Both outsideDir and tempDir are allowed
      const symlinkPath = path.join(tempDir, 'cross-link');
      await fs.symlink(outsideDir, symlinkPath, 'junction');

      const validator = new PathValidator({ allowedPaths: [tempDir, outsideDir] });
      const result = validator.validate(path.join(symlinkPath, 'data.txt'));

      expect(result.valid).toBe(true);
    });

    it('rejects nested symlinks that escape the allowed dir', async () => {
      // Create chain: <tempDir>/level1/ (real dir) -> <tempDir>/level1/hop -> <outsideDir>
      const level1 = path.join(tempDir, 'level1');
      await fs.mkdir(level1);

      const hop = path.join(level1, 'hop');
      await fs.symlink(outsideDir, hop, 'junction');

      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(path.join(hop, 'secret.txt'));

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('not in allowed directories');
    });
  });

  // -------------------------------------------------------------------------
  // Non-existent path handling (write operations)
  // -------------------------------------------------------------------------

  describe('non-existent path handling for write operations', () => {
    it('validates parent dir when target file does not exist', () => {
      // The file does not exist, but the parent (tempDir) does and is allowed
      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(path.join(tempDir, 'new-file.txt'));

      expect(result.valid).toBe(true);
    });

    it('validates parent dir when nested target does not exist', async () => {
      // Create intermediate directory
      const subDir = path.join(tempDir, 'sub');
      await fs.mkdir(subDir);

      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(path.join(subDir, 'deep', 'new-file.txt'));

      expect(result.valid).toBe(true);
    });

    it('rejects non-existent path when parent resolves outside allowlist', async () => {
      const outsideRaw = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-outside-write-'));
      const outsideDir = fsSync.realpathSync(outsideRaw);

      try {
        // Create symlink inside allowed dir pointing outside
        const symlinkPath = path.join(tempDir, 'escape');
        await fs.symlink(outsideDir, symlinkPath, 'junction');

        const validator = new PathValidator({ allowedPaths: [tempDir] });

        // Target does not exist, but parent resolves to outsideDir (outside allowlist)
        const result = validator.validate(path.join(symlinkPath, 'new-file.txt'));

        expect(result.valid).toBe(false);
        expect(result.errors?.[0]).toContain('not in allowed directories');
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Normal (non-symlink) paths still work
  // -------------------------------------------------------------------------

  describe('normal path operations', () => {
    it('allows reading existing files in allowed dirs', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'content', 'utf-8');

      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(path.join(tempDir, 'test.txt'));

      expect(result.valid).toBe(true);
    });

    it('allows subdirectory paths', async () => {
      const subDir = path.join(tempDir, 'a', 'b', 'c');
      await fs.mkdir(subDir, { recursive: true });

      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const result = validator.validate(path.join(subDir, 'file.txt'));

      expect(result.valid).toBe(true);
    });

    it('isAllowed resolves symlinks', async () => {
      const outsideRaw = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-isallowed-'));
      const outsideDir = fsSync.realpathSync(outsideRaw);

      try {
        const symlinkPath = path.join(tempDir, 'escape');
        await fs.symlink(outsideDir, symlinkPath, 'junction');

        const validator = new PathValidator({ allowedPaths: [tempDir] });
        expect(validator.isAllowed(path.join(symlinkPath, 'file.txt'))).toBe(false);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('addAllowedPath resolves symlinks', async () => {
      const outsideRaw = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-addpath-'));
      const outsideDir = fsSync.realpathSync(outsideRaw);

      try {
        // Create symlink inside tempDir pointing to outsideDir
        const symlinkPath = path.join(tempDir, 'linked');
        await fs.symlink(outsideDir, symlinkPath, 'junction');

        const validator = new PathValidator({ allowedPaths: [tempDir] });

        // Adding the symlink path should resolve to the real path
        validator.addAllowedPath(symlinkPath);

        // Now outsideDir should be allowed via the resolved real path
        const allowedPaths = validator.getAllowedPaths();
        expect(allowedPaths).toContain(outsideDir);
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('blocks exact allowed path prefix collision (path separator boundary)', () => {
      // Ensure that /allowed-dir does not match /allowed-dir-extended/file.txt
      const validator = new PathValidator({ allowedPaths: [tempDir] });
      const trickPath = tempDir + '-extended';

      // Create the trick directory so realpath can resolve it
      fsSync.mkdirSync(trickPath, { recursive: true });

      try {
        const result = validator.validate(path.join(trickPath, 'file.txt'));
        expect(result.valid).toBe(false);
      } finally {
        fsSync.rmSync(trickPath, { recursive: true, force: true });
      }
    });
  });
});
