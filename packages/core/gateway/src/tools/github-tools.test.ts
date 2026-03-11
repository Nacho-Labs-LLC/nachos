/**
 * Tests for GitHub tool
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ToolCall } from '@nachos/types';
import { EventEmitter, Writable, Readable } from 'node:stream';

// Use vi.hoisted to ensure mocks are available before mocking
const { mockExecFile, mockSpawn } = vi.hoisted(() => {
  return {
    mockExecFile: vi.fn(),
    mockSpawn: vi.fn(),
  };
});

// Mock execFile and spawn before imports
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

/**
 * Create a mock child process for spawn-based tests.
 * Simulates stdout/stderr/stdin streams and exit code.
 */
function createMockChildProcess(
  stdoutData: string,
  stderrData: string,
  exitCode: number
) {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin });

  // Push data and emit close asynchronously to let listeners attach
  process.nextTick(() => {
    if (stdoutData) stdout.push(Buffer.from(stdoutData));
    stdout.push(null);
    if (stderrData) stderr.push(Buffer.from(stderrData));
    stderr.push(null);

    // Emit close after streams end
    setTimeout(() => child.emit('close', exitCode), 5);
  });

  return child;
}

// Import after mocking
import {
  executeGitHub,
  GitHubToolSchema,
  isWriteAction,
  GITHUB_WRITE_ACTIONS,
  type GitHubConfig,
} from './github-tools.js';

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

      const error = Object.assign(new Error('Command failed'), {
        stderr: 'Authentication failed',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_AUTH_FAILED');
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

  describe('api action with body', () => {
    it('should POST with body via spawn stdin', async () => {
      const call: ToolCall = {
        id: 'test-api-post',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: '/repos/owner/repo/issues',
          http_method: 'POST',
          body: JSON.stringify({ title: 'New issue', body: 'Description' }),
        },
      };

      const responseJson = JSON.stringify({ number: 99, title: 'New issue' });
      mockSpawn.mockReturnValue(createMockChildProcess(responseJson, '', 0));

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(result.content[0].text).toContain('"number": 99');
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['api', '/repos/owner/repo/issues', '--method', 'POST', '--input', '-']),
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
      );
    });

    it('should PUT with body via spawn stdin', async () => {
      const call: ToolCall = {
        id: 'test-api-put',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: '/repos/owner/repo/issues/1',
          http_method: 'PUT',
          body: JSON.stringify({ state: 'closed' }),
        },
      };

      mockSpawn.mockReturnValue(createMockChildProcess('{"state":"closed"}', '', 0));

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--method', 'PUT', '--input', '-']),
        expect.any(Object)
      );
    });

    it('should PATCH with body via spawn stdin', async () => {
      const call: ToolCall = {
        id: 'test-api-patch',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: '/repos/owner/repo/issues/5',
          http_method: 'PATCH',
          body: JSON.stringify({ title: 'Updated title' }),
        },
      };

      mockSpawn.mockReturnValue(createMockChildProcess('{"title":"Updated title"}', '', 0));

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
    });

    it('should DELETE with body via spawn stdin', async () => {
      const call: ToolCall = {
        id: 'test-api-delete',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: '/repos/owner/repo/comments/42',
          http_method: 'DELETE',
          body: '{}',
        },
      };

      mockSpawn.mockReturnValue(createMockChildProcess('', '', 0));

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
    });

    it('should reject body exceeding size limit', async () => {
      const call: ToolCall = {
        id: 'test-api-large',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: '/repos/owner/repo/issues',
          http_method: 'POST',
          body: 'x'.repeat(101 * 1024), // 101KB, over the 100KB limit
        },
      };

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BODY_TOO_LARGE');
    });

    it('should work without body (GET via execFile)', async () => {
      const call: ToolCall = {
        id: 'test-api-get',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: '/repos/owner/repo',
        },
      };

      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({ name: 'repo' }),
        stderr: '',
      });

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalled();
    });
  });

  describe('api endpoint validation', () => {
    it('should reject endpoint not starting with /', async () => {
      const call: ToolCall = {
        id: 'test-api-bad-endpoint',
        tool: 'github',
        parameters: {
          action: 'api',
          endpoint: 'repos/owner/repo',
        },
      };

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMETER');
      expect(result.error?.message).toContain('must start with "/"');
    });
  });

  describe('error classification', () => {
    it('should classify HTTP 401 as auth failure', async () => {
      const call: ToolCall = {
        id: 'test-err-401',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      const error = Object.assign(new Error('failed'), {
        stderr: 'HTTP 401: 401 Unauthorized',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_AUTH_FAILED');
    });

    it('should classify HTTP 403 as forbidden', async () => {
      const call: ToolCall = {
        id: 'test-err-403',
        tool: 'github',
        parameters: { action: 'issue_create', title: 'test' },
      };

      const error = Object.assign(new Error('failed'), {
        stderr: 'HTTP 403: Resource not accessible by integration',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_FORBIDDEN');
    });

    it('should classify HTTP 429 as rate limited', async () => {
      const call: ToolCall = {
        id: 'test-err-429',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      const error = Object.assign(new Error('failed'), {
        stderr: 'HTTP 429: API rate limit exceeded, retry after 60',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_RATE_LIMITED');
      expect(result.error?.message).toContain('retry after 60');
    });

    it('should classify HTTP 422 as validation error', async () => {
      const call: ToolCall = {
        id: 'test-err-422',
        tool: 'github',
        parameters: { action: 'issue_create', title: 'test' },
      };

      const error = Object.assign(new Error('failed'), {
        stderr: 'HTTP 422: Validation Failed - title is missing',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_VALIDATION_ERROR');
    });

    it('should classify HTTP 404 as not found', async () => {
      const call: ToolCall = {
        id: 'test-err-404',
        tool: 'github',
        parameters: { action: 'issue_view', number: 99999 },
      };

      const error = Object.assign(new Error('failed'), {
        stderr: 'HTTP 404: Could not resolve to an issue',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_NOT_FOUND');
    });

    it('should fall back to generic error for unknown patterns', async () => {
      const call: ToolCall = {
        id: 'test-err-generic',
        tool: 'github',
        parameters: { action: 'issue_list' },
      };

      const error = Object.assign(new Error('failed'), {
        stderr: 'Some unexpected error occurred',
      });
      mockExecFile.mockRejectedValue(error);

      const result = await executeGitHub(call, config, uniqueUserId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_CLI_ERROR');
    });
  });
});

describe('isWriteAction', () => {
  it('should identify write actions', () => {
    expect(isWriteAction('issue_create')).toBe(true);
    expect(isWriteAction('issue_comment')).toBe(true);
    expect(isWriteAction('pr_create')).toBe(true);
    expect(isWriteAction('pr_merge')).toBe(true);
  });

  it('should identify read actions', () => {
    expect(isWriteAction('issue_list')).toBe(false);
    expect(isWriteAction('issue_view')).toBe(false);
    expect(isWriteAction('pr_list')).toBe(false);
    expect(isWriteAction('pr_view')).toBe(false);
    expect(isWriteAction('pr_diff')).toBe(false);
    expect(isWriteAction('search')).toBe(false);
    expect(isWriteAction('repo_view')).toBe(false);
  });

  it('should treat api action with non-GET method as write', () => {
    expect(isWriteAction('api', 'POST')).toBe(true);
    expect(isWriteAction('api', 'PUT')).toBe(true);
    expect(isWriteAction('api', 'PATCH')).toBe(true);
    expect(isWriteAction('api', 'DELETE')).toBe(true);
  });

  it('should treat api action with GET method as read', () => {
    expect(isWriteAction('api', 'GET')).toBe(false);
    expect(isWriteAction('api')).toBe(false);
  });
});

describe('GITHUB_WRITE_ACTIONS', () => {
  it('should contain all write action names', () => {
    expect(GITHUB_WRITE_ACTIONS).toContain('issue_create');
    expect(GITHUB_WRITE_ACTIONS).toContain('issue_comment');
    expect(GITHUB_WRITE_ACTIONS).toContain('pr_create');
    expect(GITHUB_WRITE_ACTIONS).toContain('pr_merge');
    expect(GITHUB_WRITE_ACTIONS).toHaveLength(4);
  });
});
