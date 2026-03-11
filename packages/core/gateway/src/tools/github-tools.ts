/**
 * GitHub tool schemas for LLM tool calling
 *
 * This tool enables the LLM to interact with GitHub via the gh CLI.
 * It runs natively in the gateway process (no container required).
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import { createToolFailedError } from '@nachos/types';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolRateLimiter } from './tool-rate-limiter.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_SIZE = 50 * 1024; // 50KB limit for large diffs
const MAX_BODY_SIZE = 100 * 1024; // 100KB limit for request bodies

/**
 * Actions that perform write operations (create, update, delete).
 * Used for policy evaluation and audit logging.
 */
export const GITHUB_WRITE_ACTIONS = [
  'issue_create',
  'issue_comment',
  'pr_create',
  'pr_merge',
] as const;

/**
 * Check whether a GitHub action is a write operation.
 * For the generic `api` action, any non-GET method is considered a write.
 */
export function isWriteAction(action: string, httpMethod?: string): boolean {
  if ((GITHUB_WRITE_ACTIONS as readonly string[]).includes(action)) {
    return true;
  }
  if (action === 'api' && httpMethod && httpMethod !== 'GET') {
    return true;
  }
  return false;
}

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
 * Build environment for GitHub CLI execution
 */
function buildGitHubEnv(config: GitHubConfig): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (config.token_env) {
    const token = process.env[config.token_env];
    if (token) {
      env.GH_TOKEN = token;
      env.GITHUB_TOKEN = token;
    }
  }
  return env;
}

/**
 * Execute GitHub CLI command
 */
async function execGitHub(
  args: string[],
  config: GitHubConfig
): Promise<{ stdout: string; stderr: string }> {
  const env = buildGitHubEnv(config);

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
      throw createToolFailedError('GitHub CLI (gh) is not installed or not in PATH', {
        component: 'gateway',
      });
    }
    throw error;
  }
}

/**
 * Execute GitHub CLI command with stdin input (for api action with body).
 * Uses spawn instead of execFile to pipe body data via stdin.
 */
async function execGitHubWithStdin(
  args: string[],
  stdinData: string,
  config: GitHubConfig
): Promise<{ stdout: string; stderr: string }> {
  const env = buildGitHubEnv(config);

  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    const maxBuffer = 10 * 1024 * 1024; // 10MB

    child.stdout.on('data', (data: Buffer) => {
      stdoutSize += data.length;
      if (stdoutSize <= maxBuffer) {
        stdout += data.toString();
      }
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          createToolFailedError('GitHub CLI (gh) is not installed or not in PATH', {
            component: 'gateway',
          })
        );
      } else {
        reject(error);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = Object.assign(new Error(`gh exited with code ${code}`), {
          stderr,
          stdout,
          code: code,
        });
        reject(error);
      }
    });

    // Write body to stdin and close
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

/**
 * Classify GitHub CLI errors into specific error codes
 */
function classifyGitHubError(stderr: string, message?: string): { code: string; message: string } {
  const text = stderr || message || '';

  // HTTP 401 — authentication failure
  if (/HTTP 401|401 Unauthorized|authentication|login required/i.test(text)) {
    return { code: 'GITHUB_AUTH_FAILED', message: `Authentication failed: ${text}` };
  }

  // HTTP 403 — forbidden / secondary rate limit
  if (/HTTP 403|403 Forbidden|forbidden|Resource not accessible/i.test(text)) {
    return { code: 'GITHUB_FORBIDDEN', message: `Access denied: ${text}` };
  }

  // HTTP 429 or primary rate limit
  if (/HTTP 429|rate limit|API rate limit exceeded/i.test(text)) {
    // Try to extract reset time
    const resetMatch = /retry after (\d+)/i.exec(text) || /reset.*?(\d{10,})/i.exec(text);
    const retryInfo = resetMatch ? ` (retry after ${resetMatch[1]}s)` : '';
    return {
      code: 'GITHUB_RATE_LIMITED',
      message: `GitHub API rate limit exceeded${retryInfo}: ${text}`,
    };
  }

  // HTTP 422 — validation error
  if (/HTTP 422|422 Unprocessable|Validation Failed/i.test(text)) {
    return { code: 'GITHUB_VALIDATION_ERROR', message: `Validation failed: ${text}` };
  }

  // HTTP 404 — not found
  if (/HTTP 404|404 Not Found|Could not resolve/i.test(text)) {
    return { code: 'GITHUB_NOT_FOUND', message: `Not found: ${text}` };
  }

  // Default
  return { code: 'GITHUB_CLI_ERROR', message: text || 'Unknown error executing GitHub CLI' };
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

        // Validate endpoint starts with /
        if (!params.endpoint.startsWith('/')) {
          return {
            success: false,
            content: [],
            error: {
              code: 'INVALID_PARAMETER',
              message: 'endpoint must start with "/" (e.g., "/repos/owner/repo/issues")',
            },
          };
        }

        ghArgs = ['api', params.endpoint];
        if (params.http_method && params.http_method !== 'GET') {
          ghArgs.push('--method', params.http_method);
        }

        // Handle body via stdin piping using spawn
        if (params.body) {
          if (params.body.length > MAX_BODY_SIZE) {
            return {
              success: false,
              content: [],
              error: {
                code: 'BODY_TOO_LARGE',
                message: `Request body exceeds maximum size of ${MAX_BODY_SIZE / 1024}KB`,
              },
            };
          }
          ghArgs.push('--input', '-');

          const { stdout, stderr } = await execGitHubWithStdin(ghArgs, params.body, config);
          let apiResultText = '';
          if (stdout) {
            try {
              const jsonData = JSON.parse(stdout);
              apiResultText = JSON.stringify(jsonData, null, 2);
            } catch {
              apiResultText = stdout;
            }
          }
          if (stderr) {
            apiResultText += `\n\nWarnings/Info:\n${stderr}`;
          }
          apiResultText = truncateOutput(apiResultText);

          return {
            success: true,
            content: [
              {
                type: 'text',
                text: apiResultText || 'Command completed successfully (no output)',
              },
            ],
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
    const classified = classifyGitHubError(err.stderr || '', err.message);
    return {
      success: false,
      content: [],
      error: classified,
    };
  }
}
