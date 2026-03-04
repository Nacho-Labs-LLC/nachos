/**
 * Management API handlers for the Gateway.
 * Registers NATS subscription handlers for admin/management operations.
 * Extracted from Gateway to reduce the monolithic class.
 */
import type { Message } from '@nachos/types';
import { createConfigError, createValidationError, createNotFoundError } from '@nachos/types';
import { TOPICS } from '@nachos/bus';
import type { NatsBusAdapter } from '../router.js';
import type { SubagentOrchestrator } from '../subagents/subagent-orchestrator.js';
import type { SubagentRunRecord, SubagentRunRequest } from '../subagents/types.js';
import type { SessionsStore } from '@nachos/state';
import type { SandboxManager } from '../sandbox/sandbox-manager.js';
import type { RuntimeToolSandboxConfig } from '@nachos/config';
import {
  listSubagentWorkspaceEntries,
  readSubagentWorkspaceFile,
} from '../subagents/workspace-utils.js';
import { readOptionalString, readCleanup, readTimeoutMs } from '../utils/parsing.js';

/**
 * Dependencies required by management handlers.
 * Provided by the Gateway as a thin adapter.
 */
export interface ManagementDeps {
  getBus(): NatsBusAdapter | null;
  getSessionsStore(): SessionsStore;
  getSubagentOrchestrator(): SubagentOrchestrator | undefined;
  getSandboxManager(): SandboxManager | undefined;
  getToolSandboxConfig(): RuntimeToolSandboxConfig | undefined;
  listSubagents(): SubagentRunRecord[];
  getSubagentInfo(runId: string): SubagentRunRecord | null;
  stopSubagent(runId: string): boolean;
  getSubagentLog(runId: string): Promise<{ runId: string; messages: Message[] } | null>;
  buildSandboxDecisionSamples(): {
    main: { enabled: boolean; config?: unknown };
    subagent: { enabled: boolean; config?: unknown };
  } | null;
}

function respondError(respond: (data: unknown) => boolean, error: Error): void {
  respond({
    ok: false,
    error: {
      code: 'GATEWAY_REQUEST_ERROR',
      message: error.message,
    },
  });
}

/**
 * Register all management NATS subscription handlers.
 */
export async function registerManagementHandlers(deps: ManagementDeps): Promise<void> {
  const bus = deps.getBus();
  if (!bus) {
    return;
  }

  const client = bus.getClient();

  // --- Subagent handlers ---

  await client.subscribe(TOPICS.gateway.subagents.list, async (msg, raw) => {
    try {
      const payload = msg.payload as { limit?: number };
      const runs = deps.listSubagents();
      const limit = payload?.limit && payload.limit > 0 ? Math.floor(payload.limit) : undefined;
      const items = limit ? runs.slice(0, limit) : runs;
      raw.respond({ ok: true, data: { runs: items, total: runs.length } });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.subagents.spawn, async (msg, raw) => {
    try {
      const orchestrator = deps.getSubagentOrchestrator();
      if (!orchestrator) {
        throw createConfigError('Subagent execution is not configured', { component: 'gateway' });
      }

      const payload = msg.payload as {
        task?: string;
        label?: string;
        profile?: string;
        agentId?: string;
        model?: string;
        thinking?: string;
        cleanup?: string;
        runTimeoutSeconds?: number;
        sessionId?: string;
        channel?: string;
        conversationId?: string;
        replyToMessageId?: string;
        userId?: string;
      };

      const task = typeof payload.task === 'string' ? payload.task.trim() : '';
      if (!task) {
        throw createValidationError('task is required', { component: 'gateway' });
      }

      const runRequest: SubagentRunRequest = {
        task,
        label: readOptionalString(payload.label),
        profile: readOptionalString(payload.profile),
        agentId: readOptionalString(payload.agentId),
        model: readOptionalString(payload.model),
        thinking: readOptionalString(payload.thinking),
        cleanup: readCleanup(payload.cleanup),
        timeoutMs: readTimeoutMs(payload.runTimeoutSeconds),
        requester: {
          sessionId: readOptionalString(payload.sessionId) ?? 'cli',
          channel: readOptionalString(payload.channel) ?? 'cli',
          conversationId: readOptionalString(payload.conversationId) ?? 'cli',
          replyToMessageId: readOptionalString(payload.replyToMessageId),
          userId: readOptionalString(payload.userId),
        },
      };

      const run = await orchestrator.enqueue(runRequest);
      raw.respond({
        ok: true,
        data: {
          runId: run.runId,
          childSessionId: run.childSessionId,
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.subagents.info, async (msg, raw) => {
    try {
      const payload = msg.payload as { runId?: string };
      const runId = typeof payload?.runId === 'string' ? payload.runId : '';
      const run = runId ? deps.getSubagentInfo(runId) : null;
      raw.respond({ ok: true, data: { run } });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.subagents.stop, async (msg, raw) => {
    try {
      const payload = msg.payload as { runId?: string };
      const runId = typeof payload?.runId === 'string' ? payload.runId : '';
      const ok = runId ? deps.stopSubagent(runId) : false;
      raw.respond({ ok: true, data: { stopped: ok } });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.subagents.log, async (msg, raw) => {
    try {
      const payload = msg.payload as { runId?: string; limit?: number };
      const runId = typeof payload?.runId === 'string' ? payload.runId : '';
      const limit = payload?.limit && payload.limit > 0 ? Math.floor(payload.limit) : 50;
      const log = runId ? await deps.getSubagentLog(runId) : null;
      const messages = log?.messages ?? [];
      raw.respond({
        ok: true,
        data: {
          runId,
          messages: messages.slice(-limit),
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.subagents.files.list, async (msg, raw) => {
    try {
      const payload = msg.payload as {
        runId?: string;
        path?: string;
        recursive?: boolean;
        limit?: number;
      };
      const runId = typeof payload?.runId === 'string' ? payload.runId : '';
      if (!runId) {
        throw createValidationError('runId is required', { component: 'gateway' });
      }
      const orchestrator = deps.getSubagentOrchestrator();
      const workspaceDir = orchestrator?.getRunWorkspaceDir(runId);
      if (!workspaceDir) {
        throw createNotFoundError('Subagent workspace not available', { component: 'gateway' });
      }

      const entries = await listSubagentWorkspaceEntries({
        rootDir: workspaceDir,
        relativePath: readOptionalString(payload.path),
        recursive: Boolean(payload.recursive),
        limit: payload.limit && payload.limit > 0 ? Math.floor(payload.limit) : 200,
      });

      raw.respond({
        ok: true,
        data: {
          runId,
          entries,
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.subagents.files.get, async (msg, raw) => {
    try {
      const payload = msg.payload as { runId?: string; path?: string; maxBytes?: number };
      const runId = typeof payload?.runId === 'string' ? payload.runId : '';
      const relativePath = readOptionalString(payload?.path);
      if (!runId || !relativePath) {
        throw createValidationError('runId and path are required', { component: 'gateway' });
      }
      const orchestrator = deps.getSubagentOrchestrator();
      const workspaceDir = orchestrator?.getRunWorkspaceDir(runId);
      if (!workspaceDir) {
        throw createNotFoundError('Subagent workspace not available', { component: 'gateway' });
      }

      const maxBytes =
        payload?.maxBytes && payload.maxBytes > 0 ? Math.floor(payload.maxBytes) : 65536;
      const file = await readSubagentWorkspaceFile({
        rootDir: workspaceDir,
        relativePath,
        maxBytes,
      });

      raw.respond({
        ok: true,
        data: {
          runId,
          file,
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  // --- Sandbox handlers ---

  await client.subscribe(TOPICS.gateway.sandbox.explain, async (_msg, raw) => {
    try {
      raw.respond({
        ok: true,
        data: {
          config: deps.getToolSandboxConfig() ?? null,
          decisions: deps.buildSandboxDecisionSamples(),
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.sandbox.list, async (_msg, raw) => {
    try {
      const runs = deps.listSubagents();
      raw.respond({
        ok: true,
        data: {
          config: deps.getToolSandboxConfig() ?? null,
          decisions: deps.buildSandboxDecisionSamples(),
          subagentRuns: runs,
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });

  await client.subscribe(TOPICS.gateway.sandbox.recreate, async (_msg, raw) => {
    try {
      raw.respond({
        ok: true,
        data: {
          message: 'Sandbox configuration is stateless; nothing to recreate.',
        },
      });
    } catch (error) {
      respondError(raw.respond, error as Error);
    }
  });
}
