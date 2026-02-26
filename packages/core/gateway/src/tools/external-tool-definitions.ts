/**
 * External Tool Definitions
 *
 * Tool schemas for container-based tools that run as separate services.
 * These definitions tell the LLM what tools are available.
 * Execution is handled via NATS request/reply in the ToolCoordinator.
 */

import type { ToolsConfig } from '@nachos/config';

export interface ExternalToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Filesystem read tool
 */
const FILESYSTEM_READ: ExternalToolDefinition = {
  name: 'filesystem_read',
  description: 'Read file contents or list directory entries.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['read', 'list', 'stat'],
      },
      path: {
        type: 'string',
        description: 'File or directory path',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (for read action)',
        enum: ['utf-8', 'utf8', 'ascii', 'base64', 'hex', 'binary'],
      },
    },
    required: ['action', 'path'],
  },
};

/**
 * Filesystem write tool
 */
const FILESYSTEM_WRITE: ExternalToolDefinition = {
  name: 'filesystem_write',
  description: 'Write content to a file. Creates parent directories if needed.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Write action to perform',
        enum: ['write', 'create', 'delete', 'mkdir'],
        default: 'write',
      },
      path: {
        type: 'string',
        description: 'File path to write',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
      encoding: {
        type: 'string',
        description: 'File encoding',
        enum: ['utf-8', 'utf8', 'ascii', 'base64'],
      },
    },
    required: ['path', 'content'],
  },
};

/**
 * Filesystem edit tool
 */
const FILESYSTEM_EDIT: ExternalToolDefinition = {
  name: 'filesystem_edit',
  description: 'Edit a file by replacing exact text matches.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to edit',
      },
      old_text: {
        type: 'string',
        description: 'Exact text to find and replace (must match exactly)',
      },
      new_text: {
        type: 'string',
        description: 'New text to replace the old text with',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },
};

/**
 * Web fetch tool
 */
const WEB_FETCH: ExternalToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch a URL and extract readable content as text or markdown.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch (http/https only)',
      },
      extract_mode: {
        type: 'string',
        description: 'Extraction mode',
        enum: ['text', 'markdown'],
      },
      max_chars: {
        type: 'number',
        description: 'Maximum characters to return',
      },
    },
    required: ['url'],
  },
};

/**
 * Code runner (JavaScript) tool
 */
const CODE_RUNNER_JAVASCRIPT: ExternalToolDefinition = {
  name: 'code_runner_javascript',
  description: 'Execute JavaScript (Node.js) code in a sandboxed environment.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds',
      },
    },
    required: ['code'],
  },
};

/**
 * Code runner (Python) tool
 */
const CODE_RUNNER_PYTHON: ExternalToolDefinition = {
  name: 'code_runner_python',
  description: 'Execute Python code in a sandboxed environment.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds',
      },
    },
    required: ['code'],
  },
};

/**
 * Get external tool definitions based on nachos.toml config.
 * Only returns tools that are enabled in config.
 */
export function getExternalToolDefinitions(
  toolsConfig?: ToolsConfig
): ExternalToolDefinition[] {
  if (!toolsConfig) {
    return [];
  }

  const definitions: ExternalToolDefinition[] = [];

  // Filesystem tools
  if (toolsConfig.filesystem?.enabled !== false) {
    definitions.push(FILESYSTEM_READ);
    if (toolsConfig.filesystem?.write) {
      definitions.push(FILESYSTEM_WRITE);
      definitions.push(FILESYSTEM_EDIT);
    }
  }

  // Web fetch
  if (toolsConfig.web_fetch?.enabled !== false) {
    definitions.push(WEB_FETCH);
  }

  // Code runner
  if (toolsConfig.code_runner?.enabled !== false) {
    definitions.push(CODE_RUNNER_JAVASCRIPT);
    definitions.push(CODE_RUNNER_PYTHON);
  }

  return definitions;
}
