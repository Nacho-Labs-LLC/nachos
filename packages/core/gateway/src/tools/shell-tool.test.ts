import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShellTool } from './shell-tool.js';

describe('ShellTool', () => {
  let shellTool: ShellTool;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    shellTool = new ShellTool({
      logger: mockLogger,
    });
  });

  describe('isCommandAllowed', () => {
    it('should allow commands from the allowlist', () => {
      expect(shellTool.isCommandAllowed('goplaces search "test"')).toBe(true);
      expect(shellTool.isCommandAllowed('gifgrep cats')).toBe(true);
      expect(shellTool.isCommandAllowed('summarize https://example.com')).toBe(true);
      expect(shellTool.isCommandAllowed('gog gmail search')).toBe(true);
    });

    it('should deny commands not in the allowlist', () => {
      expect(shellTool.isCommandAllowed('curl https://example.com')).toBe(false);
      expect(shellTool.isCommandAllowed('rm -rf /')).toBe(false);
      expect(shellTool.isCommandAllowed('wget https://evil.com')).toBe(false);
      expect(shellTool.isCommandAllowed('bash -c "malicious"')).toBe(false);
    });

    it('should handle empty commands', () => {
      expect(shellTool.isCommandAllowed('')).toBe(false);
      expect(shellTool.isCommandAllowed('   ')).toBe(false);
    });
  });

  describe('getToolGroup', () => {
    it('should return correct tool group for allowed commands', () => {
      expect(shellTool.getToolGroup('goplaces search "test"')).toBe('lookup');
      expect(shellTool.getToolGroup('gifgrep cats')).toBe('media');
      expect(shellTool.getToolGroup('summarize https://example.com')).toBe('summarize');
      expect(shellTool.getToolGroup('gog gmail search')).toBe('workspace');
    });

    it('should return undefined for disallowed commands', () => {
      expect(shellTool.getToolGroup('curl https://example.com')).toBeUndefined();
      expect(shellTool.getToolGroup('rm -rf /')).toBeUndefined();
    });

    it('should return undefined for empty commands', () => {
      expect(shellTool.getToolGroup('')).toBeUndefined();
      expect(shellTool.getToolGroup('   ')).toBeUndefined();
    });
  });

  describe('getAllowedBinaries', () => {
    it('should return list of allowed binaries', () => {
      const binaries = shellTool.getAllowedBinaries();
      expect(binaries).toContain('goplaces');
      expect(binaries).toContain('gifgrep');
      expect(binaries).toContain('summarize');
      expect(binaries).toContain('gog');
      expect(binaries).toHaveLength(4);
    });
  });

  describe('execute', () => {
    it('should reject commands not in allowlist', async () => {
      await expect(shellTool.execute({ command: 'curl https://example.com' })).rejects.toThrow(
        /not allowed/
      );
    });

    it('should reject empty commands', async () => {
      await expect(shellTool.execute({ command: '' })).rejects.toThrow('Empty command');
    });

    it('should throw error for missing required environment variables', async () => {
      // goplaces requires GOOGLE_PLACES_API_KEY
      const originalEnv = process.env.GOOGLE_PLACES_API_KEY;
      delete process.env.GOOGLE_PLACES_API_KEY;

      await expect(shellTool.execute({ command: 'goplaces search "test"' })).rejects.toThrow(
        /Missing required environment variable/
      );

      // Restore
      if (originalEnv !== undefined) {
        process.env.GOOGLE_PLACES_API_KEY = originalEnv;
      }
    });

    it('should log execution info', async () => {
      // Set required env for goplaces
      process.env.GOOGLE_PLACES_API_KEY = 'test-key';

      // Mock spawn to avoid actual execution
      vi.doMock('node:child_process', () => ({
        spawn: vi.fn(() => ({
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((event: string, callback: (code: number) => void) => {
            if (event === 'close') {
              setTimeout(() => callback(0), 10);
            }
          }),
        })),
      }));

      try {
        await shellTool.execute({ command: 'gifgrep cats' });
      } catch {
        // May fail due to mocking, that's okay - we're testing the logger
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Executing command'),
        expect.objectContaining({
          toolGroup: 'media',
        })
      );
    });
  });
});
