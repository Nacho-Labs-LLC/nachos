/**
 * Tests for GitHub tool
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ToolCall } from '@nachos/types';

// Use vi.hoisted to ensure mockExecFile is available before mocking
const { mockExecFile } = vi.hoisted(() => {
  return {
    mockExecFile: vi.fn(),
  };
});

// Mock execFile before imports
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

// Import after mocking
import { executeGitHub, GitHubToolSchema, type GitHubConfig } from './github-tools.js';

describe('GitHubToolSchema', () => {
  it('should have correct schema properties', () => {
    expect(GitHubToolSchema.$id).toBe('github');
    expect(GitHubToolSchema.type).toBe('object');
    expect(GitHubToolSchema.required).toEqual(['action']);
    expect(GitHubToolSchema.properties.action).toBeDefined();
    expect(GitHubToolSchema.properties.action.enum).toContain('issue_list');
    expect(GitHubToolSchema.properties.action.enum).toContain('pr_create');
  });
});

describe('executeGitHub', () => {
  let config: GitHubConfig;
  let uniqueUserId: string;

  beforeEach(() => {
    mockExecFile.mockClear();
    mockExecFile.mockReset();

    // Use unique user ID for each test to avoid rate limit conflicts
    uniqueUserId = `user-${Date.now()}-${Math.random()}`;

    config = {
      enabled: true,
      default_repo: 'owner/repo',
      token_env: 'GITHUB_TOKEN',
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('parameter validation', () => {
    it('should require action parameter', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: {},
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });
      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ACTION');
    });

    it('should reject invalid action', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'invalid_action' },
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });
      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ACTION');
    });

    it('should require number for issue_view', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_view' },
      };

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAMETER');
      expect(result.error?.message).toContain('number is required');
    });

    it('should require title for issue_create', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_create' },
      };

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAMETER');
      expect(result.error?.message).toContain('title is required');
    });
  });

  describe('repository validation', () => {
    it('should use default_repo when repo not specified', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });
      await executeGitHub(call, config, uniqueUserId);

      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--repo', 'owner/repo']),
        expect.any(Object)
      );
    });

    it('should enforce repo_allowlist', async () => {
      config.repo_allowlist = ['allowed/repo'];

      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list', repo: 'blocked/repo' },
      };

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_REPOSITORY');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('should allow repo in allowlist', async () => {
      config.repo_allowlist = ['allowed/repo'];

      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list', repo: 'allowed/repo' },
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });
      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('should enforce rate limit (30 calls per minute)', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });

      // Use a fresh user ID for this test
      const testUserId = `rate-limit-test-${Date.now()}`;

      // Make 30 successful calls
      for (let i = 0; i < 30; i++) {
        const result = await executeGitHub(call, config, testUserId);
        expect(result.success).toBe(true);
      }

      // 31st call should be rate limited
      const result = await executeGitHub(call, config, testUserId);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should track rate limits per user', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });

      const user1 = `user-1-${Date.now()}`;
      const user2 = `user-2-${Date.now()}`;

      // User 1 makes 30 calls
      for (let i = 0; i < 30; i++) {
        await executeGitHub(call, config, user1);
      }

      // User 1 is rate limited
      const result1 = await executeGitHub(call, config, user1);
      expect(result1.success).toBe(false);

      // User 2 can still make calls
      const result2 = await executeGitHub(call, config, user2);
      expect(result2.success).toBe(true);
    });
  });

  describe('issue actions', () => {
    it('should list issues with filters', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: {
          action: 'issue_list',
          state: 'open',
          labels: ['bug', 'urgent'],
          assignee: 'testuser',
          limit: 10,
        },
      };

      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify([{ number: 1, title: 'Test Issue' }]),
        stderr: '',
      });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'issue',
          'list',
          '--state',
          'open',
          '--label',
          'bug,urgent',
          '--assignee',
          'testuser',
          '--limit',
          '10',
        ]),
        expect.any(Object)
      );
    });

    it('should view issue details', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: {
          action: 'issue_view',
          number: 42,
        },
      };

      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({ number: 42, title: 'Test Issue', body: 'Description' }),
        stderr: '',
      });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['issue', 'view', '42']),
        expect.any(Object)
      );
    });

    it('should create issue', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: {
          action: 'issue_create',
          title: 'New Issue',
          body: 'Issue description',
          labels: ['bug'],
          assignee: 'testuser',
        },
      };

      mockExecFile.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/issues/42',
        stderr: '',
      });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'issue',
          'create',
          '--title',
          'New Issue',
          '--body',
          'Issue description',
          '--label',
          'bug',
          '--assignee',
          'testuser',
        ]),
        expect.any(Object)
      );
    });
  });

  describe('PR actions', () => {
    it('should list PRs with filters', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: {
          action: 'pr_list',
          state: 'open',
          author: 'testuser',
          base: 'main',
        },
      };

      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify([{ number: 1, title: 'Test PR' }]),
        stderr: '',
      });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'pr',
          'list',
          '--state',
          'open',
          '--author',
          'testuser',
          '--base',
          'main',
        ]),
        expect.any(Object)
      );
    });

    it('should create PR', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: {
          action: 'pr_create',
          title: 'New Feature',
          body: 'Feature description',
          base: 'main',
          head: 'feature-branch',
        },
      };

      mockExecFile.mockResolvedValue({
        stdout: 'https://github.com/owner/repo/pull/42',
        stderr: '',
      });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'pr',
          'create',
          '--title',
          'New Feature',
          '--base',
          'main',
          '--head',
          'feature-branch',
        ]),
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    it('should handle gh CLI not found', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      const error = Object.assign(new Error('Command not found'), { code: 'ENOENT' });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_CLI_ERROR');
      expect(result.error?.message).toContain('not installed');
    });

    it('should handle gh CLI errors', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      const error = Object.assign(new Error('Command failed'), { stderr: 'Authentication failed' });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_CLI_ERROR');
      expect(result.error?.message).toContain('Authentication failed');
    });

    it('should truncate large outputs', async () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'pr_diff', number: 42 },
      };

      // Create a large diff (>50KB)
      const largeDiff = 'a'.repeat(60 * 1024);
      mockExecFile.mockResolvedValue({ stdout: largeDiff, stderr: '' });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(result.content[0].text.length).toBeLessThan(largeDiff.length);
      expect(result.content[0].text).toContain('truncated');
    });
  });

  describe('environment variables', () => {
    it('should pass token from environment', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      const call: ToolCall = {
        id: 'test-1',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      mockExecFile.mockResolvedValue({ stdout: '[]', stderr: '' });
      await executeGitHub(call, config, uniqueUserId);

      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            GH_TOKEN: 'test-token',
            GITHUB_TOKEN: 'test-token',
          }),
        })
      );

      delete process.env.GITHUB_TOKEN;
    });
  });
});
