/**
 * Agent Exec Tool — LLM-callable tool that launches Claude Code CLI
 * as a subprocess for autonomous coding tasks.
 *
 * Actions: spawn, status, output, cancel, list
 *
 * Gated behind permissive security mode via SecurityTier.ELEVATED.
 * The `claude` CLI binary must be installed in the runtime environment.
 */

import type { ToolCall, ToolResult } from '@nachos/types';
import type { AgentProcessRegistry } from './agent-process-registry.js';
import { createLogger } from '@nachos/types';

const logger = createLogger('agent-exec-tool');

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

export const AgentExecToolSchema = {
  $id: 'agent_exec',
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['spawn', 'status', 'output', 'cancel', 'list'],
      description:
        'Action to perform: spawn (start a new agent), status (check agent status), ' +
        'output (get agent stdout/stderr), cancel (stop a running agent), list (show all agents)',
    },
    task: {
      type: 'string',
      description: '(spawn) The task/prompt to give to the Claude Code agent',
    },
    cwd: {
      type: 'string',
      description: '(spawn) Working directory for the agent (optional, defaults to workspace root)',
    },
    timeout: {
      type: 'number',
      description: '(spawn) Timeout in seconds (optional, default 300s / 5min, max 1800s / 30min)',
    },
    agentId: {
      type: 'string',
      description: '(status/output/cancel) The ID of the agent process to query or control',
    },
    tail: {
      type: 'number',
      description: '(output) Return only the last N lines of output (optional)',
    },
  },
  required: ['action'],
};

// ---------------------------------------------------------------------------
// Tool definition for LLM
// ---------------------------------------------------------------------------

export function createAgentExecToolDefinition(): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} {
  const schema = JSON.parse(JSON.stringify(AgentExecToolSchema)) as Record<string, unknown>;
  delete schema.$id;

  return {
    name: 'agent_exec',
    description:
      'Launch and manage Claude Code CLI agents as subprocesses for autonomous coding tasks. ' +
      'Use "spawn" to start an agent with a task, "status" to check progress, "output" to read ' +
      'stdout/stderr, "cancel" to stop a running agent, and "list" to see all agents. ' +
      'Agents run with full Claude Code capabilities (file editing, terminal, etc.). ' +
      'Max 2 concurrent agents. Requires permissive security mode.',
    parameters: schema,
  };
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleAgentExecTool(
  call: ToolCall,
  registry: AgentProcessRegistry
): Promise<ToolResult> {
  const action = call.parameters.action as string | undefined;

  if (!action) {
    return formatError('INVALID_PARAMETERS', 'action is required');
  }

  switch (action) {
    case 'spawn':
      return handleSpawn(call, registry);
    case 'status':
      return handleStatus(call, registry);
    case 'output':
      return handleOutput(call, registry);
    case 'cancel':
      return handleCancel(call, registry);
    case 'list':
      return handleList(registry);
    default:
      return formatError('INVALID_PARAMETERS', `Unknown action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function handleSpawn(call: ToolCall, registry: AgentProcessRegistry): ToolResult {
  const task = call.parameters.task as string | undefined;
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return formatError('INVALID_PARAMETERS', 'task is required and must be a non-empty string');
  }

  const cwd = (call.parameters.cwd as string | undefined) ?? undefined;
  const timeoutSeconds = call.parameters.timeout as number | undefined;
  const timeoutMs = timeoutSeconds ? timeoutSeconds * 1000 : undefined;

  try {
    const agentId = registry.spawn(task.trim(), { cwd, timeoutMs });
    logger.info({ agentId, task: task.slice(0, 100) }, 'Agent process spawned via tool');

    return {
      success: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              agentId,
              status: 'running',
              message: 'Agent process spawned successfully. Use status/output actions to monitor.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to spawn agent process';
    logger.error({ err }, 'Failed to spawn agent process');
    return formatError('SPAWN_FAILED', message);
  }
}

function handleStatus(call: ToolCall, registry: AgentProcessRegistry): ToolResult {
  const agentId = call.parameters.agentId as string | undefined;
  if (!agentId) {
    return formatError('INVALID_PARAMETERS', 'agentId is required');
  }

  const status = registry.getStatus(agentId);
  if (!status) {
    return formatError('NOT_FOUND', `Agent process not found: ${agentId}`);
  }

  return {
    success: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(status, null, 2),
      },
    ],
  };
}

function handleOutput(call: ToolCall, registry: AgentProcessRegistry): ToolResult {
  const agentId = call.parameters.agentId as string | undefined;
  if (!agentId) {
    return formatError('INVALID_PARAMETERS', 'agentId is required');
  }

  const tail = call.parameters.tail as number | undefined;
  const output = registry.getOutput(agentId, tail);
  if (!output) {
    return formatError('NOT_FOUND', `Agent process not found: ${agentId}`);
  }

  return {
    success: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2),
      },
    ],
  };
}

function handleCancel(call: ToolCall, registry: AgentProcessRegistry): ToolResult {
  const agentId = call.parameters.agentId as string | undefined;
  if (!agentId) {
    return formatError('INVALID_PARAMETERS', 'agentId is required');
  }

  const cancelled = registry.cancel(agentId);
  return {
    success: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            agentId,
            cancelled,
            message: cancelled
              ? 'Agent process cancelled successfully'
              : 'Agent process could not be cancelled (not running or not found)',
          },
          null,
          2
        ),
      },
    ],
  };
}

function handleList(registry: AgentProcessRegistry): ToolResult {
  const agents = registry.list();
  return {
    success: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ agents, count: agents.length }, null, 2),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatError(code: string, message: string): ToolResult {
  return {
    success: false,
    content: [],
    error: { code, message },
  };
}
