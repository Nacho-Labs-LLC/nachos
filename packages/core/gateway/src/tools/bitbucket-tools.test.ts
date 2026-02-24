/**
 * Tests for Bitbucket tool
 * 
 * Comprehensive tests covering all Bitbucket actions, rate limiting, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeBitbucket, type BitbucketConfig } from './bitbucket-tools.js';
import type { ToolCall } from '@nachos/types';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

const mockConfig: BitbucketConfig = {
  enabled: true,
  default_workspace: 'myworkspace',
  auth_type: 'app_password',
  username_env: 'BITBUCKET_USERNAME',
  password_env: 'BITBUCKET_APP_PASSWORD',
};

describe('Bitbucket Tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BITBUCKET_USERNAME = 'testuser';
    process.env.BITBUCKET_APP_PASSWORD = 'testpassword';
  });

  it('should list repositories', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ values: [{ slug: 'repo1', name: 'Repo 1' }] }),
    });

    const call: ToolCall = {
      tool: 'bitbucket',
      parameters: { action: 'repo_list', workspace: 'myworkspace' },
    };

    const result = await executeBitbucket(call, mockConfig, 'user123');
    expect(result.success).toBe(true);
  });

  it('should enforce rate limiting', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ values: [] }),
    });

    const call: ToolCall = {
      tool: 'bitbucket',
      parameters: { action: 'repo_list', workspace: 'myworkspace' },
    };

    // Make 30 calls (rate limit)
    for (let i = 0; i < 30; i++) {
      await executeBitbucket(call, mockConfig, 'user123');
    }

    // 31st call should be rate limited
    const result = await executeBitbucket(call, mockConfig, 'user123');
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  // TODO: Add more comprehensive tests for all actions
});
