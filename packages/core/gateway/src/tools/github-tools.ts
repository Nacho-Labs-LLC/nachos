/**
 * GitHub tool schemas for LLM tool calling
 *
 * This tool enables the LLM to interact with GitHub via the gh CLI.
 * It runs natively in the gateway process (no container required).
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolRateLimiter } from './tool-rate-limiter.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_SIZE = 50 * 1024; // 50KB limit for large diffs

const rateLimiter = new ToolRateLimiter(60 * 1000, 30, 'GitHub');

/**
 * github tool schema
 * Single tool with action-based routing to keep tool count low
 */
export const GitHubToolSchema = {
  $id: 'github',
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: [
        'issue_list',
        'issue_view',
        'issue_create',
        'issue_comment',
        'pr_list',
        'pr_view',
        'pr_create',
        'pr_diff',
        'pr_checks',
        'pr_merge',
        'run_list',
        'run_view',
        'repo_view',
        'search',
        'api',
      ],
      description: 'GitHub action to perform',
    },
    repo: {
      type: 'string',
      description: 'Repository in "owner/repo" format (optional if default configured)',
    },
    number: {
      type: 'number',
      description: 'Issue or PR number',
    },
    query: {
      type: 'string',
      description: 'Search query',
    },
    title: {
      type: 'string',
      description: 'Title for create actions',
    },
    body: {
      type: 'string',
      description: 'Body text for create/comment actions',
    },
    labels: {
      type: 'array',
      items: { type: 'string' },
      description: 'Labels for filtering or creation',
    },
    state: {
      type: 'string',
      enum: ['open', 'closed', 'all'],
      description: 'Issue/PR state filter',
    },
    assignee: {
      type: 'string',
      description: 'GitHub username for assignee',
    },
    base: {
      type: 'string',
      description: 'Base branch for PR',
    },
    head: {
      type: 'string',
      description: 'Head branch for PR',
    },
    method: {
      type: 'string',
      enum: ['merge', 'squash', 'rebase'],
      description: 'Merge method for PR merge',
    },
    endpoint: {
      type: 'string',
      description: 'API endpoint for raw API calls (e.g., "/repos/owner/repo/issues")',
    },
    http_method: {
      type: 'string',
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      description: 'HTTP method for raw API calls',
    },
    run_id: {
      type: 'number',
      description: 'Workflow run ID',
    },
    workflow: {
      type: 'string',
      description: 'Workflow name or file',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return',
      default: 30,
    },
    author: {
      type: 'string',
      description: 'Filter PRs by author username',
    },
    status: {
      type: 'string',
      description: 'Filter workflow runs by status (e.g., "completed", "in_progress")',
    },
    type: {
      type: 'string',
      enum: ['issue', 'pr', 'code'],
      description: 'Search type for search action',
    },
  },
  required: ['action'],
};

/**
 * GitHub tool configuration
 */
export interface GitHubConfig {
  enabled: boolean;
  default_repo?: string;
  token_env?: string;
  repo_allowlist?: string[];
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
 * Validate repository against allowlist
 */
function validateRepo(
  repo: string | undefined,
  config: GitHubConfig
): { valid: boolean; error?: string } {
  if (!repo && !config.default_repo) {
    return { valid: false, error: 'Repository is required (no default configured)' };
  }

  const targetRepo = repo || config.default_repo!;

  if (config.repo_allowlist && config.repo_allowlist.length > 0) {
    if (!config.repo_allowlist.includes(targetRepo)) {
      return {
        valid: false,
        error: `Repository "${targetRepo}" not in allowlist: ${config.repo_allowlist.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Execute GitHub CLI command
 */
async function execGitHub(
  args: string[],
  config: GitHubConfig
): Promise<{ stdout: string; stderr: string }> {
  // Set up environment with GitHub token if configured
  const env = { ...process.env };
  if (config.token_env) {
    const token = process.env[config.token_env];
    if (token) {
      env.GH_TOKEN = token;
      env.GITHUB_TOKEN = token;
    }
  }

  try {
    const result = await execFileAsync('gh', args, {
      env,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 30000, // 30s timeout
    });
    return result;
  } catch (error: unknown) {
    // gh CLI returns error in stderr
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('GitHub CLI (gh) is not installed or not in PATH');
    }
    throw error;
  }
}

/**
 * Execute github tool
 */
export async function executeGitHub(
  call: ToolCall,
  config: GitHubConfig,
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
      repo?: string;
      number?: number;
      query?: string;
      title?: string;
      body?: string;
      labels?: string[];
      state?: string;
      assignee?: string;
      base?: string;
      head?: string;
      method?: string;
      endpoint?: string;
      http_method?: string;
      run_id?: number;
      workflow?: string;
      limit?: number;
      author?: string;
      status?: string;
      type?: string;
    };

    const action = params.action;
    const repo = params.repo || config.default_repo;
    const limit = params.limit || 30;

    // Validate repository
    const repoCheck = validateRepo(params.repo, config);
    if (!repoCheck.valid) {
      return {
        success: false,
        content: [],
        error: {
          code: 'INVALID_REPOSITORY',
          message: repoCheck.error!,
        },
      };
    }

    let ghArgs: string[] = [];
    let resultText = '';

    switch (action) {
      case 'issue_list': {
        ghArgs = [
          'issue',
          'list',
          '--json',
          'number,title,state,labels,assignees,createdAt',
          '--limit',
          String(limit),
        ];
        if (repo) ghArgs.push('--repo', repo);
        if (params.state) ghArgs.push('--state', params.state);
        if (params.assignee) ghArgs.push('--assignee', params.assignee);
        if (params.labels && params.labels.length > 0) {
          ghArgs.push('--label', params.labels.join(','));
        }
        break;
      }

      case 'issue_view': {
        if (!params.number) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'number is required for issue_view' },
          };
        }
        ghArgs = [
          'issue',
          'view',
          String(params.number),
          '--json',
          'number,title,body,state,labels,assignees,comments,createdAt,updatedAt',
        ];
        if (repo) ghArgs.push('--repo', repo);
        break;
      }

      case 'issue_create': {
        if (!params.title) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'title is required for issue_create' },
          };
        }
        ghArgs = ['issue', 'create', '--title', params.title];
        if (repo) ghArgs.push('--repo', repo);
        if (params.body) ghArgs.push('--body', params.body);
        if (params.assignee) ghArgs.push('--assignee', params.assignee);
        if (params.labels && params.labels.length > 0) {
          ghArgs.push('--label', params.labels.join(','));
        }
        break;
      }

      case 'issue_comment': {
        if (!params.number || !params.body) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'number and body are required for issue_comment',
            },
          };
        }
        ghArgs = ['issue', 'comment', String(params.number), '--body', params.body];
        if (repo) ghArgs.push('--repo', repo);
        break;
      }

      case 'pr_list': {
        ghArgs = [
          'pr',
          'list',
          '--json',
          'number,title,state,headRefName,baseRefName,author,createdAt',
          '--limit',
          String(limit),
        ];
        if (repo) ghArgs.push('--repo', repo);
        if (params.state) ghArgs.push('--state', params.state);
        if (params.author) ghArgs.push('--author', params.author);
        if (params.base) ghArgs.push('--base', params.base);
        break;
      }

      case 'pr_view': {
        if (!params.number) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'number is required for pr_view' },
          };
        }
        ghArgs = [
          'pr',
          'view',
          String(params.number),
          '--json',
          'number,title,body,state,headRefName,baseRefName,author,mergeable,reviews,comments,createdAt,updatedAt',
        ];
        if (repo) ghArgs.push('--repo', repo);
        break;
      }

      case 'pr_create': {
        if (!params.title || !params.base || !params.head) {
          return {
            success: false,
            content: [],
            error: {
              code: 'MISSING_PARAMETER',
              message: 'title, base, and head are required for pr_create',
            },
          };
        }
        ghArgs = [
          'pr',
          'create',
          '--title',
          params.title,
          '--base',
          params.base,
          '--head',
          params.head,
        ];
        if (repo) ghArgs.push('--repo', repo);
        if (params.body) ghArgs.push('--body', params.body);
        break;
      }

      case 'pr_diff': {
        if (!params.number) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'number is required for pr_diff' },
          };
        }
        ghArgs = ['pr', 'diff', String(params.number)];
        if (repo) ghArgs.push('--repo', repo);
        break;
      }

      case 'pr_checks': {
        if (!params.number) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'number is required for pr_checks' },
          };
        }
        ghArgs = ['pr', 'checks', String(params.number)];
        if (repo) ghArgs.push('--repo', repo);
        break;
      }

      case 'pr_merge': {
        if (!params.number) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'number is required for pr_merge' },
          };
        }
        ghArgs = ['pr', 'merge', String(params.number)];
        if (repo) ghArgs.push('--repo', repo);
        if (params.method) ghArgs.push('--' + params.method);
        break;
      }

      case 'run_list': {
        ghArgs = [
          'run',
          'list',
          '--json',
          'databaseId,status,conclusion,name,createdAt,workflowName',
          '--limit',
          String(limit),
        ];
        if (repo) ghArgs.push('--repo', repo);
        if (params.workflow) ghArgs.push('--workflow', params.workflow);
        if (params.status) ghArgs.push('--status', params.status);
        break;
      }

      case 'run_view': {
        if (!params.run_id) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'run_id is required for run_view' },
          };
        }
        ghArgs = [
          'run',
          'view',
          String(params.run_id),
          '--json',
          'databaseId,status,conclusion,name,createdAt,workflowName,jobs',
        ];
        if (repo) ghArgs.push('--repo', repo);
        break;
      }

      case 'repo_view': {
        if (!repo) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'repo is required for repo_view' },
          };
        }
        ghArgs = [
          'repo',
          'view',
          repo,
          '--json',
          'name,description,owner,visibility,defaultBranch,createdAt,updatedAt,url',
        ];
        break;
      }

      case 'search': {
        if (!params.query) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'query is required for search' },
          };
        }
        const searchType = params.type || 'issue';
        ghArgs = [
          'search',
          searchType === 'issue' ? 'issues' : searchType === 'pr' ? 'prs' : 'code',
          params.query,
          '--json',
          'url,repository',
          '--limit',
          String(limit),
        ];
        break;
      }

      case 'api': {
        if (!params.endpoint) {
          return {
            success: false,
            content: [],
            error: { code: 'MISSING_PARAMETER', message: 'endpoint is required for api action' },
          };
        }
        ghArgs = ['api', params.endpoint];
        if (params.http_method && params.http_method !== 'GET') {
          ghArgs.push('--method', params.http_method);
        }
        if (params.body) {
          ghArgs.push('--input', '-');
          // Note: For stdin input, we'd need to use a different approach
          // For now, we'll skip body support in api action
          return {
            success: false,
            content: [],
            error: { code: 'NOT_IMPLEMENTED', message: 'API action with body not yet implemented' },
          };
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

    // Execute GitHub CLI
    const { stdout, stderr } = await execGitHub(ghArgs, config);

    // Format output
    if (stdout) {
      try {
        // Try to parse as JSON for pretty formatting
        const jsonData = JSON.parse(stdout);
        resultText = JSON.stringify(jsonData, null, 2);
      } catch {
        // Not JSON, use raw output
        resultText = stdout;
      }
    }

    if (stderr) {
      resultText += `\n\nWarnings/Info:\n${stderr}`;
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
    const err = error as { stderr?: string; message?: string };
    return {
      success: false,
      content: [],
      error: {
        code: 'GITHUB_CLI_ERROR',
        message: err.stderr || err.message || 'Unknown error executing GitHub CLI',
      },
    };
  }
}
