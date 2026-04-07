/**
 * Bitbucket tool schemas for LLM tool calling
 *
 * This tool enables the LLM to interact with Bitbucket via the REST API v2.0.
 * It runs natively in the gateway process (no container required).
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import { ToolRateLimiter } from './tool-rate-limiter.js';

const MAX_OUTPUT_SIZE = 50 * 1024; // 50KB limit for large diffs

const rateLimiter = new ToolRateLimiter(60 * 1000, 30, 'Bitbucket');

/**
 * bitbucket tool schema
 * Single tool with action-based routing to keep tool count low
 */
export const BitbucketToolSchema = {
  $id: 'bitbucket',
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'repo_list',
        'repo_view',
        'pr_list',
        'pr_view',
        'pr_create',
        'pr_diff',
        'pr_merge',
        'pr_approve',
        'pr_comment',
        'issue_list',
        'issue_view',
        'issue_create',
        'issue_comment',
        'pipeline_list',
        'pipeline_view',
        'search',
      ],
      description: 'Bitbucket action to perform',
    },
    workspace: {
      type: 'string',
      description: 'Bitbucket workspace (optional if default configured)',
    },
    repo_slug: {
      type: 'string',
      description: 'Repository slug',
    },
    pr_id: {
      type: 'number',
      description: 'Pull request ID',
    },
    issue_id: {
      type: 'number',
      description: 'Issue ID',
    },
    pipeline_uuid: {
      type: 'string',
      description: 'Pipeline UUID',
    },
    title: {
      type: 'string',
      description: 'Title for create actions',
    },
    body: {
      type: 'string',
      description: 'Body text for comments',
    },
    description: {
      type: 'string',
      description: 'Description for PRs',
    },
    source_branch: {
      type: 'string',
      description: 'Source branch for PR',
    },
    destination_branch: {
      type: 'string',
      description: 'Destination branch for PR',
    },
    state: {
      type: 'string',
      enum: ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'],
      description: 'PR state filter',
    },
    kind: {
      type: 'string',
      enum: ['bug', 'enhancement', 'proposal', 'task'],
      description: 'Issue kind',
    },
    priority: {
      type: 'string',
      enum: ['trivial', 'minor', 'major', 'critical', 'blocker'],
      description: 'Issue priority',
    },
    merge_strategy: {
      type: 'string',
      enum: ['merge_commit', 'squash', 'fast_forward'],
      description: 'Merge strategy for PR merge',
    },
    query: {
      type: 'string',
      description: 'Search query',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return',
      default: 25,
    },
    content: {
      type: 'string',
      description: 'Issue content',
    },
  },
  required: ['action'],
};

/**
 * Bitbucket tool configuration
 */
export interface BitbucketConfig {
  enabled: boolean;
  default_workspace?: string;
  auth_type?: 'app_password' | 'oauth';
  username_env?: string;
  password_env?: string;
  token_env?: string;
  workspace_allowlist?: string[];
}

/**
 * Check rate limit for a user/session
 */
function checkRateLimit(userId: string): { allowed: boolean; message?: string } {
  return rateLimiter.check(userId);
}

/**
 * Truncate output if too large
 */
function truncateOutput(text: string, maxSize: number = MAX_OUTPUT_SIZE): string {
  if (text.length <= maxSize) {
    return text;
  }
  const truncated = text.slice(0, maxSize);
  const remaining = text.length - maxSize;
  return `${truncated}\n\n... [truncated ${remaining} bytes]`;
}

/**
 * Validate workspace against allowlist
 */
function validateWorkspace(
  workspace: string | undefined,
  config: BitbucketConfig
): { valid: boolean; error?: string } {
  if (!workspace && !config.default_workspace) {
    return { valid: false, error: 'Workspace is required (no default configured)' };
  }

  const targetWorkspace = workspace || config.default_workspace!;

  if (config.workspace_allowlist && config.workspace_allowlist.length > 0) {
    if (!config.workspace_allowlist.includes(targetWorkspace)) {
      return {
        valid: false,
        error: `Workspace "${targetWorkspace}" not in allowlist: ${config.workspace_allowlist.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get authentication headers
 */
function getAuthHeaders(config: BitbucketConfig): { Authorization: string } | null {
  if (config.auth_type === 'oauth') {
    const token = config.token_env ? process.env[config.token_env] : null;
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  } else {
    // app_password (default)
    const username = config.username_env ? process.env[config.username_env] : null;
    const password = config.password_env ? process.env[config.password_env] : null;
    if (username && password) {
      const credentials = Buffer.from(`${username}:${password}`).toString('base64');
      return { Authorization: `Basic ${credentials}` };
    }
  }
  return null;
}

/**
 * Execute Bitbucket API request
 */
async function executeBitbucketAPI(
  endpoint: string,
  config: BitbucketConfig,
  options: RequestInit = {}
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const authHeaders = getAuthHeaders(config);
  if (!authHeaders) {
    return {
      data: null,
      error:
        'Authentication not configured. Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD (or BITBUCKET_TOKEN for OAuth).',
    };
  }

  const baseUrl = 'https://api.bitbucket.org/2.0';
  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Bitbucket API error (${response.status}): ${response.statusText}`;
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Use default error message
      }
      return { data: null, error: errorMessage };
    }

    const data = (await response.json()) as Record<string, unknown>;
    return { data };
  } catch (error: unknown) {
    return { data: null, error: (error as Error).message || 'Unknown error calling Bitbucket API' };
  }
}

/**
 * Paginate through Bitbucket API results
 */
async function paginateResults(
  endpoint: string,
  config: BitbucketConfig,
  limit: number
): Promise<{ results: Record<string, unknown>[]; error?: string }> {
  const results: Record<string, unknown>[] = [];
  let nextUrl: string | null = endpoint;

  while (nextUrl && results.length < limit) {
    const { data, error } = await executeBitbucketAPI(
      nextUrl.replace('https://api.bitbucket.org/2.0', ''),
      config
    );

    if (error) {
      return { results, error };
    }

    if (data && Array.isArray(data.values)) {
      results.push(...(data.values as Record<string, unknown>[]).slice(0, limit - results.length));
    }

    nextUrl = (data?.next as string) || null;
    if (!nextUrl || results.length >= limit) {
      break;
    }
  }

  return { results };
}

/**
 * Execute bitbucket tool
 */
export async function executeBitbucket(
  call: ToolCall,
  config: BitbucketConfig,
  userId: string
): Promise<ToolResult> {
  try {
    // Check rate limit
    const rateLimitCheck = checkRateLimit(userId);
    if (!rateLimitCheck.allowed) {
      return {
        success: false,
        content: [],
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: rateLimitCheck.message!,
        },
      };
    }

    const params = call.parameters as {
      action: string;
      workspace?: string;
      repo_slug?: string;
      pr_id?: number;
      issue_id?: number;
      pipeline_uuid?: string;
      title?: string;
      body?: string;
      description?: string;
      source_branch?: string;
      destination_branch?: string;
      state?: string;
      kind?: string;
      priority?: string;
      merge_strategy?: string;
      query?: string;
      limit?: number;
      content?: string;
    };

    const action = params.action;
    const workspace = params.workspace || config.default_workspace;
    const limit = params.limit || 25;

    // Validate workspace
    const workspaceCheck = validateWorkspace(params.workspace, config);
    if (!workspaceCheck.valid) {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_WORKSPACE',
          message: workspaceCheck.error!,
        },
      };
    }

    let resultText = '';
    let apiResult: {
      data?: Record<string, unknown> | null;
      error?: string;
      results?: Record<string, unknown>[];
    } = {};

    switch (action) {
      case 'repo_list': {
        if (!workspace) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'workspace is required for repo_list' },
          };
        }
        apiResult = await paginateResults(
          `/repositories/${workspace}?pagelen=${Math.min(limit, 100)}`,
          config,
          limit
        );
        if (apiResult.results) {
          resultText = JSON.stringify(
            apiResult.results.map((r) => ({
              slug: r.slug,
              name: r.name,
              description: r.description,
              is_private: r.is_private,
              created_on: r.created_on,
              updated_on: r.updated_on,
            })),
            null,
            2
          );
        }
        break;
      }

      case 'repo_view': {
        if (!workspace || !params.repo_slug) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace and repo_slug are required for repo_view',
            },
          };
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}`,
          config
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pr_list': {
        if (!workspace || !params.repo_slug) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace and repo_slug are required for pr_list',
            },
          };
        }
        let endpoint = `/repositories/${workspace}/${params.repo_slug}/pullrequests?pagelen=${Math.min(limit, 100)}`;
        if (params.state) {
          endpoint += `&state=${params.state}`;
        }
        apiResult = await paginateResults(endpoint, config, limit);
        if (apiResult.results) {
          resultText = JSON.stringify(
            apiResult.results.map((pr) => ({
              id: pr.id,
              title: pr.title,
              state: pr.state,
              source:
                (pr.source as Record<string, unknown>)?.branch &&
                ((pr.source as Record<string, unknown>).branch as Record<string, unknown>)?.name,
              destination:
                (pr.destination as Record<string, unknown>)?.branch &&
                ((pr.destination as Record<string, unknown>).branch as Record<string, unknown>)
                  ?.name,
              author: (pr.author as Record<string, unknown>)?.display_name,
              created_on: pr.created_on,
              updated_on: pr.updated_on,
            })),
            null,
            2
          );
        }
        break;
      }

      case 'pr_view': {
        if (!workspace || !params.repo_slug || !params.pr_id) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and pr_id are required for pr_view',
            },
          };
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pullrequests/${params.pr_id}`,
          config
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pr_create': {
        if (
          !workspace ||
          !params.repo_slug ||
          !params.title ||
          !params.source_branch ||
          !params.destination_branch
        ) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message:
                'workspace, repo_slug, title, source_branch, and destination_branch are required for pr_create',
            },
          };
        }
        const prData = {
          title: params.title,
          description: params.description || '',
          source: {
            branch: {
              name: params.source_branch,
            },
          },
          destination: {
            branch: {
              name: params.destination_branch,
            },
          },
        };
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pullrequests`,
          config,
          {
            method: 'POST',
            body: JSON.stringify(prData),
          }
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pr_diff': {
        if (!workspace || !params.repo_slug || !params.pr_id) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and pr_id are required for pr_diff',
            },
          };
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pullrequests/${params.pr_id}/diff`,
          config
        );
        if (apiResult.data) {
          resultText =
            typeof apiResult.data === 'string'
              ? apiResult.data
              : JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pr_merge': {
        if (!workspace || !params.repo_slug || !params.pr_id) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and pr_id are required for pr_merge',
            },
          };
        }
        const mergeData: Record<string, unknown> = {};
        if (params.merge_strategy) {
          mergeData.merge_strategy = params.merge_strategy;
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pullrequests/${params.pr_id}/merge`,
          config,
          {
            method: 'POST',
            body: JSON.stringify(mergeData),
          }
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pr_approve': {
        if (!workspace || !params.repo_slug || !params.pr_id) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and pr_id are required for pr_approve',
            },
          };
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pullrequests/${params.pr_id}/approve`,
          config,
          {
            method: 'POST',
          }
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pr_comment': {
        if (!workspace || !params.repo_slug || !params.pr_id || !params.body) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, pr_id, and body are required for pr_comment',
            },
          };
        }
        const commentData = {
          content: {
            raw: params.body,
          },
        };
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pullrequests/${params.pr_id}/comments`,
          config,
          {
            method: 'POST',
            body: JSON.stringify(commentData),
          }
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'issue_list': {
        if (!workspace || !params.repo_slug) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace and repo_slug are required for issue_list',
            },
          };
        }
        let endpoint = `/repositories/${workspace}/${params.repo_slug}/issues?pagelen=${Math.min(limit, 100)}`;
        if (params.state) {
          endpoint += `&q=state="${params.state}"`;
        }
        apiResult = await paginateResults(endpoint, config, limit);
        if (apiResult.results) {
          resultText = JSON.stringify(
            apiResult.results.map((issue) => ({
              id: issue.id,
              title: issue.title,
              state: issue.state,
              kind: issue.kind,
              priority: issue.priority,
              created_on: issue.created_on,
              updated_on: issue.updated_on,
            })),
            null,
            2
          );
        }
        break;
      }

      case 'issue_view': {
        if (!workspace || !params.repo_slug || !params.issue_id) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and issue_id are required for issue_view',
            },
          };
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/issues/${params.issue_id}`,
          config
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'issue_create': {
        if (!workspace || !params.repo_slug || !params.title) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and title are required for issue_create',
            },
          };
        }
        const issueData: Record<string, unknown> = {
          title: params.title,
        };
        if (params.content) {
          issueData.content = { raw: params.content };
        }
        if (params.kind) {
          issueData.kind = params.kind;
        }
        if (params.priority) {
          issueData.priority = params.priority;
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/issues`,
          config,
          {
            method: 'POST',
            body: JSON.stringify(issueData),
          }
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'issue_comment': {
        if (!workspace || !params.repo_slug || !params.issue_id || !params.body) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, issue_id, and body are required for issue_comment',
            },
          };
        }
        const commentData = {
          content: {
            raw: params.body,
          },
        };
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/issues/${params.issue_id}/comments`,
          config,
          {
            method: 'POST',
            body: JSON.stringify(commentData),
          }
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'pipeline_list': {
        if (!workspace || !params.repo_slug) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace and repo_slug are required for pipeline_list',
            },
          };
        }
        apiResult = await paginateResults(
          `/repositories/${workspace}/${params.repo_slug}/pipelines?pagelen=${Math.min(limit, 100)}`,
          config,
          limit
        );
        if (apiResult.results) {
          resultText = JSON.stringify(
            apiResult.results.map((pipeline) => ({
              uuid: pipeline.uuid,
              state: (pipeline.state as Record<string, unknown>)?.name,
              created_on: pipeline.created_on,
              completed_on: pipeline.completed_on,
              build_number: pipeline.build_number,
            })),
            null,
            2
          );
        }
        break;
      }

      case 'pipeline_view': {
        if (!workspace || !params.repo_slug || !params.pipeline_uuid) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace, repo_slug, and pipeline_uuid are required for pipeline_view',
            },
          };
        }
        apiResult = await executeBitbucketAPI(
          `/repositories/${workspace}/${params.repo_slug}/pipelines/${params.pipeline_uuid}`,
          config
        );
        if (apiResult.data) {
          resultText = JSON.stringify(apiResult.data, null, 2);
        }
        break;
      }

      case 'search': {
        if (!workspace || !params.query) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'workspace and query are required for search',
            },
          };
        }
        // Bitbucket code search API
        apiResult = await paginateResults(
          `/workspaces/${workspace}/search/code?search_query=${encodeURIComponent(params.query)}&pagelen=${Math.min(limit, 100)}`,
          config,
          limit
        );
        if (apiResult.results) {
          resultText = JSON.stringify(apiResult.results, null, 2);
        }
        break;
      }

      default:
        return {
          success: false,
          content: [],
          error: { code: 'INVALID_ACTION', message: `Unknown action: ${action}` },
        };
    }

    // Check for API errors
    if (apiResult.error) {
      return {
        success: false,
        content: [],
        error: {
          code: 'BITBUCKET_API_ERROR',
          message: apiResult.error,
        },
      };
    }

    // Truncate if too large
    resultText = truncateOutput(resultText);

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: resultText || 'Command completed successfully (no output)',
        },
      ],
    };
  } catch (error: unknown) {
    return {
      success: false,
      content: [],
      error: {
        code: 'BITBUCKET_ERROR',
        message: (error as Error).message || 'Unknown error executing Bitbucket API call',
      },
    };
  }
}
