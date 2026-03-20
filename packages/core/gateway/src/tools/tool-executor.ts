/**
 * ToolExecutor — owns tool definition building, tool call execution,
 * DLP scanning of tool I/O, and local tool dispatch.
 * Extracted from Gateway to reduce the monolithic class.
 */
import { createLogger } from '@nachos/types';
import type { LLMRequestType, Session, ToolCall, ToolResult } from '@nachos/types';
import type {
  ToolsConfig,
  SubagentToolPolicyConfig,
  SubagentToolProfileConfig,
} from '@nachos/config';
import type { StateLayer, StateOperationContext, SessionsStore } from '@nachos/state';
import type { IContextSnapshotService } from '@nachos/context-manager';
import type { AuditEvent } from '../audit/types.js';
import type { DLPSecurityLayer } from '../security/dlp.js';
import type { ToolCoordinator } from './coordinator.js';
import type { SandboxManager } from '../sandbox/sandbox-manager.js';
import type { SubagentOrchestrator } from '../subagents/subagent-orchestrator.js';
import type { SubagentRunRecord, SubagentRunRequest } from '../subagents/types.js';
import type { Scheduler } from '../scheduler/index.js';
import {
  SessionsSpawnToolSchema,
  SessionsOrchestrateToolSchema,
  SubagentsToolSchema,
  SubagentProgressToolSchema,
  BootstrapToolSchema,
  UserProfileToolSchema,
} from '@nachos/types';
import {
  MemorySearchToolSchema,
  MemoryGetToolSchema,
  MemoryWriteToolSchema,
  MemoryDeleteToolSchema,
  MemoryRecallToolSchema,
  executeMemorySearch,
  executeMemoryGet,
  executeMemoryWrite,
  executeMemoryDelete,
  executeMemoryRecall,
  ConversationSearchToolSchema,
  executeConversationSearch,
} from './memory-tools.js';
import {
  SnapshotListToolSchema,
  SnapshotRestoreToolSchema,
  executeSnapshotList,
  executeSnapshotRestore,
} from './snapshot-tools.js';
import { WebSearchToolSchema, executeWebSearch, type WebSearchConfig } from './web-search-tools.js';

import { BitbucketToolSchema, executeBitbucket, type BitbucketConfig } from './bitbucket-tools.js';
import { ComposioToolSchema, executeComposio } from './composio-tools.js';
import {
  GitHubToolSchema,
  executeGitHub,
  isWriteAction,
  type GitHubConfig,
} from './github-tools.js';
import {
  CronAddToolSchema,
  CronListToolSchema,
  CronRemoveToolSchema,
  CronUpdateToolSchema,
  CronRunToolSchema,
  executeCronAdd,
  executeCronList,
  executeCronRemove,
  executeCronUpdate,
  executeCronRun,
} from './cron-tools.js';
import { getExternalToolDefinitions } from './external-tool-definitions.js';
import {
  createAgentExecToolDefinition,
  handleAgentExecTool,
} from './agent-exec-tool.js';
import { AgentProcessRegistry } from './agent-process-registry.js';
import {
  listSubagentWorkspaceEntries,
  readSubagentWorkspaceFile,
} from '../subagents/workspace-utils.js';
import {
  readOptionalString,
  readOptionalStringArray,
  readOptionalNumber,
  readOptionalBoolean,
  readOptionalStringMap,
  readTimeoutMs,
  readCleanup,
  stringifyToolParameters,
} from '../utils/parsing.js';
import {
  resolveAgentId,
  buildStateContext,
  isSubagentSession,
  normalizeToolName,
} from '../utils/session-utils.js';
import { randomUUID } from 'node:crypto';
import type { HookRegistry } from '../hooks/index.js';

const logger = createLogger('tool-executor');

/** Default timeout for local tool execution (30 seconds). */
const DEFAULT_LOCAL_TOOL_TIMEOUT_MS = 30_000;

/** Default timeout for coordinated (remote) tool execution (60 seconds). */
const DEFAULT_REMOTE_TOOL_TIMEOUT_MS = 60_000;

/**
 * Wraps a promise with a timeout. Rejects with a descriptive error if the
 * promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(`Tool execution timed out after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timerId !== undefined) clearTimeout(timerId);
  });
}

// ---------------------------------------------------------------------------
// ToolExecutorDeps — grouped sub-interfaces
// ---------------------------------------------------------------------------

export interface ToolExecutorCoreDeps {
  instanceId: string;
  securityMode: 'strict' | 'standard' | 'permissive';
  toolsConfig?: ToolsConfig;
  toolCoordinator: ToolCoordinator | null;
  scheduler?: Scheduler;
  subagentManager?: unknown;
  subagentOrchestrator?: SubagentOrchestrator;
  hooks?: HookRegistry;
  /** Runtime workspace directory for memory tools (injected from gateway config) */
  workspaceDir?: string;
}

export interface ToolExecutorPolicyDeps {
  /** Resolve tool group for a tool name */
  resolveToolGroup(tool: string): string | undefined;
  /** Evaluate policy for a security request */
  evaluatePolicy(request: unknown): { allowed: boolean; reason?: string; ruleId?: string };
  /** Subagent tool policy configuration */
  subagentToolPolicy?: SubagentToolPolicyConfig;
}

export interface ToolExecutorAuditDeps {
  /** Log an audit event */
  logAuditEvent(event: AuditEvent): Promise<void>;
  /** Publish a status event */
  publishStatusEvent(
    sessionId: string,
    status: 'thinking' | 'tool' | 'done' | 'error',
    channelId: string,
    channelMessageId?: string,
    toolName?: string
  ): Promise<void>;
}

export interface ToolExecutorStateDeps {
  stateLayer?: StateLayer;
  /** Sessions store for snapshot restore */
  sessionsStore?: SessionsStore;
  /** Snapshot service for listing/restoring snapshots */
  snapshotService?: IContextSnapshotService;
  /** Get session by ID */
  getSession(sessionId: string): Promise<Session | null>;
  /** Get messages for a session */
  getMessages(sessionId: string): Promise<unknown[]>;
  /** Get identity completion status */
  getIdentityCompletionStatus(session: Session): Promise<boolean>;
  /** Mark identity as completed */
  markIdentityCompleted(
    agentId: string,
    bootstrapContent: Record<string, string>,
    context: StateOperationContext
  ): Promise<void>;
  /** Reset identity for command */
  resetIdentityForCommand(session: Session): Promise<void>;
  /** Get subagent run info */
  getSubagentInfo(runId: string): SubagentRunRecord | null;
  /** List all subagent runs */
  listSubagents(): SubagentRunRecord[];
  /** Stop a subagent run */
  stopSubagent(runId: string): boolean;
  /** Steer a subagent run */
  steerSubagent(runId: string, message: string): Promise<boolean>;
  /** Get subagent log */
  getSubagentLog(runId: string): Promise<{ runId: string; messages: unknown[] } | null>;
}

export interface ToolExecutorSecurityDeps {
  dlp: DLPSecurityLayer | null;
  sandboxManager?: SandboxManager;
}

export interface ToolExecutorDeps {
  core: ToolExecutorCoreDeps;
  policy: ToolExecutorPolicyDeps;
  audit: ToolExecutorAuditDeps;
  state: ToolExecutorStateDeps;
  security: ToolExecutorSecurityDeps;
}

export class ToolExecutor {
  private deps: ToolExecutorDeps;
  /** H2: Memory tool rate limiting (10 calls per minute per session) */
  private memoryToolCalls: Map<string, number[]> = new Map();
  /** Agent process registry (Claude Code CLI subprocess launcher) */
  private agentProcessRegistry: AgentProcessRegistry | null = null;

  constructor(deps: ToolExecutorDeps) {
    this.deps = deps;

    // Initialize agent process registry if enabled
    const agentExecConfig = deps.core.toolsConfig?.agent_exec;
    if (agentExecConfig?.enabled) {
      this.agentProcessRegistry = new AgentProcessRegistry({
        maxConcurrent: agentExecConfig.max_concurrent,
        defaultTimeoutMs: agentExecConfig.default_timeout
          ? agentExecConfig.default_timeout * 1000
          : undefined,
        maxTimeoutMs: agentExecConfig.max_timeout
          ? agentExecConfig.max_timeout * 1000
          : undefined,
        maxOutputBuffer: agentExecConfig.max_output_buffer,
      });
    }
  }

  /**
   * Update deps (e.g. after toolCoordinator is initialized in start()).
   * Performs a shallow merge on each sub-group.
   */
  updateDeps(partial: {
    core?: Partial<ToolExecutorCoreDeps>;
    policy?: Partial<ToolExecutorPolicyDeps>;
    audit?: Partial<ToolExecutorAuditDeps>;
    state?: Partial<ToolExecutorStateDeps>;
    security?: Partial<ToolExecutorSecurityDeps>;
  }): void {
    if (partial.core) Object.assign(this.deps.core, partial.core);
    if (partial.policy) Object.assign(this.deps.policy, partial.policy);
    if (partial.audit) Object.assign(this.deps.audit, partial.audit);
    if (partial.state) Object.assign(this.deps.state, partial.state);
    if (partial.security) Object.assign(this.deps.security, partial.security);
  }

  // ---------------------------------------------------------------------------
  // Tool definitions
  // ---------------------------------------------------------------------------

  buildToolDefinitions(
    session: Session,
    options?: { bootstrapLocked?: boolean }
  ): LLMRequestType['tools'] {
    if (isSubagentSession(session)) {
      return this.buildSubagentToolDefinitions(session);
    }

    const tools: NonNullable<LLMRequestType['tools']> = [];
    const bootstrapLocked = Boolean(options?.bootstrapLocked);

    if (this.deps.core.subagentManager) {
      tools.push({
        name: 'sessions_spawn',
        description: 'Spawn a subagent to run a task and announce results back to the requester.',
        parameters: this.sanitizeToolSchema(SessionsSpawnToolSchema),
      });
      tools.push({
        name: 'sessions_orchestrate',
        description:
          'Orchestrate a multi-step workflow with dependencies. Steps execute in dependency order, with results passed to dependent steps.',
        parameters: this.sanitizeToolSchema(SessionsOrchestrateToolSchema),
      });
      tools.push({
        name: 'subagents',
        description:
          'Internal tool: inspect subagent runs, fetch logs, and read subagent workspace files.',
        parameters: this.sanitizeToolSchema(SubagentsToolSchema),
      });
    }

    // Memory tools
    if (this.deps.state.stateLayer && !bootstrapLocked) {
      tools.push({
        name: 'memory_search',
        description:
          'Search stored memories (past decisions, preferences, facts, tasks). Use ONLY when answering questions about prior work, user preferences, past decisions, or context from previous sessions. DO NOT use for current conversation context or general knowledge.',
        parameters: this.sanitizeToolSchema(MemorySearchToolSchema),
      });
      tools.push({
        name: 'memory_get',
        description:
          'Read specific memory file sections (MEMORY.md, memory/YYYY-MM-DD.md, AGENTS.md, etc.). Use when you need full file content or specific line ranges. Complements memory_search for detailed context.',
        parameters: this.sanitizeToolSchema(MemoryGetToolSchema),
      });
      tools.push({
        name: 'memory_write',
        description:
          'Save a memory entry for future recall. Use to remember user preferences, important decisions, learned facts, active tasks, or issues. Memories persist across sessions and can be retrieved with memory_search.',
        parameters: this.sanitizeToolSchema(MemoryWriteToolSchema),
      });
      tools.push({
        name: 'memory_delete',
        description:
          'Delete a memory entry by ID. Use to remove outdated, incorrect, or no longer relevant memories. Get the memory ID from memory_search results.',
        parameters: this.sanitizeToolSchema(MemoryDeleteToolSchema),
      });
      tools.push({
        name: 'memory_recall',
        description:
          'Recall detailed memories about a topic, person, or past conversation. Searches across memory entries, structured facts, and conversation history. Use when you need specifics beyond what is shown in the memory manifest.',
        parameters: this.sanitizeToolSchema(MemoryRecallToolSchema),
      });
      // Only expose conversation search if semantic search is available
      if (this.deps.state.sessionsStore?.searchMessages) {
        tools.push({
          name: 'nachos_search_conversations',
          description:
            'Search the full conversation history by meaning. Use when the user asks about something said in a past conversation (e.g. "what did I say about X last week?"). Searches verbatim message content, not extracted summaries.',
          parameters: this.sanitizeToolSchema(ConversationSearchToolSchema),
        });
      }
    }

    // Snapshot tools (available when snapshot service is configured)
    if (this.deps.state.snapshotService && this.deps.state.sessionsStore && !bootstrapLocked) {
      tools.push({
        name: 'snapshot_list',
        description:
          'List available context snapshots for the current session. Snapshots are created before compaction and can be used to restore conversation history.',
        parameters: this.sanitizeToolSchema(SnapshotListToolSchema),
      });
      tools.push({
        name: 'snapshot_restore',
        description:
          'Restore session conversation history from a snapshot. This replaces the current messages with those from the snapshot. Use with caution — current messages will be lost. Only use when the user explicitly requests restoring a previous conversation state.',
        parameters: this.sanitizeToolSchema(SnapshotRestoreToolSchema),
      });
    }

    // GitHub tool
    if (this.deps.core.toolsConfig?.github?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'github',
        description:
          'Interact with GitHub: list/view/create issues and PRs, view CI status, search code, and more. All actions use the gh CLI.',
        parameters: this.sanitizeToolSchema(GitHubToolSchema),
      });
    }

    // Cron scheduler tools
    if (this.deps.core.scheduler && !bootstrapLocked) {
      tools.push({
        name: 'nachos_cron_add',
        description:
          'Create a new scheduled task. Supports one-shot (at), interval (every), and cron expressions.',
        parameters: this.sanitizeToolSchema(CronAddToolSchema),
      });
      tools.push({
        name: 'nachos_cron_list',
        description: 'List scheduled tasks for this session or user.',
        parameters: this.sanitizeToolSchema(CronListToolSchema),
      });
      tools.push({
        name: 'nachos_cron_remove',
        description: 'Delete a scheduled task by ID.',
        parameters: this.sanitizeToolSchema(CronRemoveToolSchema),
      });
      tools.push({
        name: 'nachos_cron_update',
        description: 'Update an existing scheduled task.',
        parameters: this.sanitizeToolSchema(CronUpdateToolSchema),
      });
      tools.push({
        name: 'nachos_cron_run',
        description: 'Manually trigger a scheduled task immediately.',
        parameters: this.sanitizeToolSchema(CronRunToolSchema),
      });
    }

    // User profile tool
    if (this.deps.state.stateLayer) {
      tools.push({
        name: 'user_profile',
        description:
          'Manage user-specific preferences and settings. Get, set, or delete user profile data for personalization.',
        parameters: this.sanitizeToolSchema(UserProfileToolSchema),
      });
    }

    // Bootstrap tool
    if (
      this.deps.state.stateLayer &&
      this.deps.core.toolsConfig?.bootstrap?.enabled !== false &&
      !bootstrapLocked
    ) {
      tools.push({
        name: 'bootstrap',
        description:
          'Manage agent onboarding and identity configuration. Used during initial setup to gather agent information.',
        parameters: this.sanitizeToolSchema(BootstrapToolSchema),
      });
    }

    // Bitbucket tool
    if (this.deps.core.toolsConfig?.bitbucket?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'bitbucket',
        description:
          'Interact with Bitbucket: list/view/create issues and PRs, view pipeline status, search code, and more. All actions use the Bitbucket REST API v2.0.',
        parameters: this.sanitizeToolSchema(BitbucketToolSchema),
      });
    }

    // Composio tool
    if (this.deps.core.toolsConfig?.composio?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'composio',
        description:
          'Execute actions on integrated productivity apps via Composio. Supports Gmail (send/read/search emails), Google Calendar (create/manage events), Google Docs (create/edit documents), Google Meet (schedule meetings), Google Drive (manage files), and LinkedIn (post updates). Use this when you need to interact with these external services.',
        parameters: this.sanitizeToolSchema(ComposioToolSchema),
      });
    }

    // Web search tool
    if (this.deps.core.toolsConfig?.web_search?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'web_search',
        description:
          'Search the web using Brave Search API. Returns titles, URLs, and snippets. Use for finding information, news, documentation, or current events.',
        parameters: this.sanitizeToolSchema(WebSearchToolSchema),
      });
    }

    // web_fetch_native removed — use the containerized web_fetch tool instead

    // Agent exec tool (Claude Code CLI subprocess launcher)
    // Only available in permissive security mode
    if (
      this.agentProcessRegistry &&
      this.deps.core.toolsConfig?.agent_exec?.enabled &&
      this.deps.core.securityMode === 'permissive' &&
      !bootstrapLocked
    ) {
      tools.push(createAgentExecToolDefinition());
    }

    // Browser automation tools
    if (this.deps.core.toolsConfig?.browser?.enabled && !bootstrapLocked) {
      // Dynamically import to avoid circular dep at module level
      const browserDefs = getBrowserToolDefinitions();
      tools.push(...browserDefs);
    }

    // External container-based tools
    const externalTools = getExternalToolDefinitions(this.deps.core.toolsConfig);
    for (const extTool of externalTools) {
      tools.push({
        name: extTool.name,
        description: extTool.description,
        parameters: extTool.parameters,
      });
    }

    return tools.length > 0 ? tools : undefined;
  }

  // ---------------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------------

  async executeToolCalls(
    sessionId: string,
    toolCalls: Array<{ id: string; name: string; arguments: string }>,
    statusMeta?: { channelId: string; channelMessageId?: string }
  ): Promise<LLMRequestType['messages']> {
    logger.info({ sessionId, tools: toolCalls.map((tc) => tc.name) }, 'Executing tool calls');
    if (!this.deps.core.toolCoordinator) {
      throw new Error('Tool coordinator not initialized');
    }

    const session = await this.deps.state.getSession(sessionId);

    // Convert LLM tool calls to our ToolCall format
    const calls: ToolCall[] = toolCalls.map((tc) => {
      let parameters: Record<string, unknown> = {};
      try {
        parameters = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
      } catch {
        parameters = { _parseError: 'Invalid tool arguments JSON' };
      }

      return {
        id: tc.id,
        tool: tc.name,
        toolGroup: this.deps.policy.resolveToolGroup(tc.name),
        sessionId,
        userId: session?.userId,
        parameters,
        securityMode: this.deps.core.securityMode,
      };
    });

    const securityMode = this.deps.core.securityMode;

    const blockedResults: Array<{ index: number; result: ToolResult }> = [];
    const allowedCalls: Array<{ index: number; call: ToolCall }> = [];
    const localResults: Array<{ index: number; result: ToolResult }> = [];
    const callStartTimes = new Map<string, number>();

    for (let i = 0; i < calls.length; i += 1) {
      const call = calls[i];
      if (!call) continue;
      callStartTimes.set(call.id, Date.now());

      // -----------------------------------------------------------------------
      // Basic tool call validation (#148)
      // -----------------------------------------------------------------------
      if (typeof call.tool !== 'string' || call.tool.trim().length === 0) {
        blockedResults.push({
          index: i,
          result: this.formatToolError(
            'INVALID_TOOL_NAME',
            'Tool name must be a non-empty string'
          ),
        });
        continue;
      }

      if (
        call.parameters === null ||
        call.parameters === undefined ||
        Array.isArray(call.parameters) ||
        typeof call.parameters !== 'object'
      ) {
        blockedResults.push({
          index: i,
          result: this.formatToolError(
            'INVALID_PARAMETERS',
            'Tool parameters must be a plain object (not null, array, or primitive)'
          ),
        });
        continue;
      }

      // Subagent policy check
      if (isSubagentSession(session)) {
        const policy = this.evaluateSubagentToolPolicy(call.tool, session);
        if (!policy.allowed) {
          void this.deps.audit.logAuditEvent({
            id: `subagent-tool-policy-${call.id}`,
            timestamp: new Date().toISOString(),
            instanceId: this.deps.core.instanceId,
            userId: session?.userId ?? 'unknown',
            sessionId,
            channel: session?.channel ?? 'unknown',
            eventType: 'policy_check',
            action: 'policy.subagent.tool',
            resource: call.tool,
            outcome: 'denied',
            reason: policy.reason,
            securityMode,
          });
          blockedResults.push({
            index: i,
            result: this.formatToolError(
              'POLICY_DENIED',
              policy.reason ?? 'Tool blocked for subagent session'
            ),
          });
          continue;
        }
      }

      // DLP scan on tool input
      if (this.deps.security.dlp) {
        const paramText = stringifyToolParameters(call.parameters);
        if (paramText) {
          const scanResult = this.deps.security.dlp.scan(paramText, session?.channel);
          if (!scanResult.allowed) {
            void this.deps.audit.logAuditEvent({
              id: `dlp-tool-${call.id}`,
              timestamp: new Date().toISOString(),
              instanceId: this.deps.core.instanceId,
              userId: session?.userId ?? 'unknown',
              sessionId,
              channel: session?.channel ?? 'unknown',
              eventType: 'dlp_block',
              action: 'dlp.block.tool_input',
              resource: call.tool,
              outcome: 'blocked',
              reason: scanResult.reason,
              securityMode,
              details: {
                findingsCount: scanResult.findings.length,
                action: scanResult.action,
              },
            });
            blockedResults.push({
              index: i,
              result: {
                success: false,
                content: [],
                error: {
                  code: 'DLP_BLOCKED',
                  message: scanResult.reason ?? 'Tool call blocked by DLP policy.',
                },
              },
            });
            continue;
          }

          if (scanResult.action === 'alert') {
            void this.deps.audit.logAuditEvent({
              id: `dlp-tool-alert-${call.id}`,
              timestamp: new Date().toISOString(),
              instanceId: this.deps.core.instanceId,
              userId: session?.userId ?? 'unknown',
              sessionId,
              channel: session?.channel ?? 'unknown',
              eventType: 'dlp_scan',
              action: 'dlp.alert.tool_input',
              resource: call.tool,
              outcome: 'allowed',
              reason: scanResult.reason,
              securityMode,
              details: {
                findingsCount: scanResult.findings.length,
                action: scanResult.action,
              },
            });
          }
        }
      }

      // Hook: tool:before-call (fire-and-forget)
      if (this.deps.core.hooks) {
        try {
          void this.deps.core.hooks.emit('tool:before-call', {
            sessionId,
            toolName: call.tool,
            callId: call.id,
            parameters: call.parameters as Readonly<Record<string, unknown>>,
            toolGroup: call.toolGroup,
            timestamp: new Date().toISOString(),
          });
        } catch (hookError) {
          logger.warn({ err: hookError }, 'tool:before-call hook failed');
        }
      }

      // Try local execution first (with timeout guard)
      let localResult: ToolResult | null;
      try {
        localResult = await withTimeout(
          this.executeLocalToolCall(call, session),
          DEFAULT_LOCAL_TOOL_TIMEOUT_MS,
          call.tool
        );
      } catch (timeoutErr) {
        logger.warn({ tool: call.tool, err: timeoutErr }, 'Local tool execution timed out');
        localResult = this.formatToolError(
          'TOOL_TIMEOUT',
          `Tool '${call.tool}' execution timed out after ${DEFAULT_LOCAL_TOOL_TIMEOUT_MS}ms`
        );
      }
      if (localResult) {
        if (statusMeta) {
          void this.deps.audit.publishStatusEvent(
            sessionId,
            'tool',
            statusMeta.channelId,
            statusMeta.channelMessageId,
            call.tool
          );
        }
        localResults.push({ index: i, result: localResult });
        continue;
      }

      // Sandbox resolution
      if (this.deps.security.sandboxManager) {
        const sandboxDecision = this.deps.security.sandboxManager.resolveToolSandbox(session!);
        if (sandboxDecision.enabled && sandboxDecision.config) {
          call.sandbox = sandboxDecision.config;
        }
      }

      if (statusMeta) {
        void this.deps.audit.publishStatusEvent(
          sessionId,
          'tool',
          statusMeta.channelId,
          statusMeta.channelMessageId,
          call.tool
        );
      }
      allowedCalls.push({ index: i, call });
    }

    // Merge results
    const results: ToolResult[] = new Array(calls.length);

    for (const blocked of blockedResults) {
      results[blocked.index] = blocked.result;
    }
    for (const local of localResults) {
      results[local.index] = local.result;
    }

    let executedResults: ToolResult[] = [];
    if (allowedCalls.length) {
      try {
        executedResults = await withTimeout(
          this.deps.core.toolCoordinator.executeTools(allowedCalls.map((item) => item.call)),
          DEFAULT_REMOTE_TOOL_TIMEOUT_MS,
          `coordinator[${allowedCalls.map((c) => c.call.tool).join(',')}]`
        );
      } catch (timeoutErr) {
        logger.warn({ err: timeoutErr }, 'Remote tool execution timed out');
        executedResults = allowedCalls.map((c) =>
          this.formatToolError(
            'TOOL_TIMEOUT',
            `Tool '${c.call.tool}' execution timed out after ${DEFAULT_REMOTE_TOOL_TIMEOUT_MS}ms`
          )
        );
      }
    }

    for (let i = 0; i < allowedCalls.length; i += 1) {
      const allowed = allowedCalls[i];
      if (!allowed) continue;
      results[allowed.index] = executedResults[i] as ToolResult;
    }

    // DLP scan on tool results
    if (this.deps.security.dlp) {
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        const call = calls[i];
        if (!result || !call || !result.success) continue;

        const scanned = this.scanToolResult(result, session, call.tool, securityMode);
        if (!scanned.allowed) {
          results[i] = {
            success: false,
            content: [],
            error: {
              code: 'DLP_BLOCKED',
              message: scanned.reason ?? 'Tool result blocked by DLP policy.',
            },
          };
          continue;
        }

        if (scanned.redactedContent) {
          results[i] = { ...result, content: scanned.redactedContent };
        }
      }
    }

    // Hook: tool:after-call for each completed tool (fire-and-forget)
    if (this.deps.core.hooks) {
      for (let i = 0; i < results.length; i += 1) {
        const result = results[i];
        const call = calls[i];
        if (!call) continue;
        try {
          const resultSummary = result?.success
            ? (result.content?.[0] as { text?: string } | undefined)?.text?.slice(0, 200)
            : result?.error?.message?.slice(0, 200);
          void this.deps.core.hooks.emit('tool:after-call', {
            sessionId,
            toolName: call.tool,
            callId: call.id,
            success: result?.success ?? false,
            resultSummary,
            error: result?.error
              ? { code: result.error.code, message: result.error.message }
              : undefined,
            durationMs: Date.now() - (callStartTimes.get(call.id) ?? Date.now()),
            timestamp: new Date().toISOString(),
          });
        } catch (hookError) {
          logger.warn({ err: hookError }, 'tool:after-call hook failed');
        }
      }
    }

    // Convert ToolResult[] to LLM message format
    const toolMessages: LLMRequestType['messages'] = results.map((result, i) => {
      const toolCall = calls[i];
      if (!toolCall) {
        return {
          role: 'tool',
          tool_call_id: `missing-${i}`,
          content: [{ type: 'tool_result', tool_use_id: `missing-${i}`, tool_result: result }],
        };
      }

      let resultData: unknown = {};
      if (result.success && result.content.length > 0) {
        const firstBlock = result.content[0];
        if (result.content.length === 1 && firstBlock && firstBlock.type === 'text') {
          try {
            resultData = JSON.parse(firstBlock.text);
          } catch {
            resultData = firstBlock.text;
          }
        } else {
          resultData = { content: result.content, metadata: result.metadata };
        }
      } else if (result.error) {
        resultData = result.error;
      }

      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: [{ type: 'tool_result', tool_use_id: toolCall.id, tool_result: resultData }],
      };
    });

    return toolMessages;
  }

  // ---------------------------------------------------------------------------
  // Local tool dispatch
  // ---------------------------------------------------------------------------

  private async executeLocalToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult | null> {
    if (call.tool === 'sessions_spawn') {
      if (!this.deps.core.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Subagent execution is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for subagent spawn');
      }

      const taskRaw = call.parameters.task;
      const task = typeof taskRaw === 'string' ? taskRaw.trim() : '';
      if (!task) {
        return this.formatToolError('INVALID_PARAMETERS', 'task is required');
      }

      const label = readOptionalString(call.parameters.label);
      const profile = readOptionalString(call.parameters.profile);
      const agentId = readOptionalString(call.parameters.agentId);
      const model = readOptionalString(call.parameters.model);
      const thinking = readOptionalString(call.parameters.thinking);
      const stream =
        typeof call.parameters.stream === 'boolean' ? call.parameters.stream : undefined;
      const cleanup = readCleanup(call.parameters.cleanup);
      const timeoutMs = readTimeoutMs(call.parameters.runTimeoutSeconds);
      const sandboxModeRaw = readOptionalString(call.parameters.sandboxMode);
      const sandboxMode =
        sandboxModeRaw === 'host' || sandboxModeRaw === 'full' ? sandboxModeRaw : undefined;

      const runRequest: SubagentRunRequest = {
        task,
        label,
        profile,
        agentId,
        model,
        thinking,
        stream,
        cleanup,
        timeoutMs,
        sandboxMode,
        sessionConfig: session.config,
        requester: {
          sessionId: session.id,
          channel: session.channel,
          conversationId: session.conversationId,
          userId: session.userId,
        },
      };

      const run = await this.deps.core.subagentOrchestrator.enqueue(runRequest);
      return {
        success: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { status: 'accepted', runId: run.runId, childSessionId: run.childSessionId },
              null,
              2
            ),
          },
        ],
      };
    }

    if (call.tool === 'sessions_orchestrate') {
      if (!this.deps.core.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Subagent execution is not configured');
      }
      if (!session) {
        return this.formatToolError(
          'SESSION_NOT_FOUND',
          'Session not found for workflow orchestration'
        );
      }

      const steps = call.parameters.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        return this.formatToolError('INVALID_PARAMETERS', 'steps array is required');
      }

      const workflow: import('../subagents/dependency-graph.js').WorkflowDefinition = {
        steps: steps.map((step: unknown) => {
          const s = step as {
            id: string;
            task: string;
            dependsOn?: string[];
            model?: string;
            modelHint?: 'fast' | 'balanced' | 'thorough';
            stream?: boolean;
          };
          return {
            id: s.id,
            task: s.task,
            dependsOn: s.dependsOn,
            model: readOptionalString(s.model),
            modelHint: s.modelHint,
            stream: typeof s.stream === 'boolean' ? s.stream : undefined,
          };
        }),
      };

      const workflowRecord = await this.deps.core.subagentOrchestrator.enqueueWorkflow(workflow, {
        sessionId: session.id,
        channel: session.channel,
        conversationId: session.conversationId,
        userId: session.userId,
      });

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'accepted',
                workflowId: workflowRecord.workflowId,
                totalBatches: workflowRecord.totalBatches,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (call.tool === 'subagent_progress') {
      if (!this.deps.core.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Subagent execution is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }

      const subagentMetadata = session.metadata?.subagent as { runId?: string } | undefined;
      const runId = subagentMetadata?.runId;
      if (!runId) {
        return this.formatToolError(
          'NOT_SUBAGENT_SESSION',
          'Progress reporting is only available within subagent sessions'
        );
      }

      const status = readOptionalString(call.parameters.status);
      if (!status) {
        return this.formatToolError('INVALID_PARAMETERS', 'status is required');
      }

      const percentage =
        typeof call.parameters.percentage === 'number' ? call.parameters.percentage : undefined;
      const metadata =
        typeof call.parameters.metadata === 'object' && call.parameters.metadata !== null
          ? (call.parameters.metadata as Record<string, unknown>)
          : undefined;

      const success = this.deps.core.subagentOrchestrator.reportProgress(
        runId,
        status,
        percentage,
        metadata
      );

      if (!success) {
        return this.formatToolError(
          'PROGRESS_REPORT_FAILED',
          'Failed to report progress (run may be completed or not found)'
        );
      }

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'recorded',
              message: 'Progress update recorded successfully',
            }),
          },
        ],
      };
    }

    if (call.tool === 'subagents') {
      return this.executeSubagentsToolCall(call, session);
    }

    if (call.tool === 'memory') {
      return this.executeMemoryToolCall(call, session);
    }

    if (call.tool === 'memory_search') {
      if (!this.deps.state.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory search');
      }

      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: true,
      };
      return executeMemorySearch(call, this.deps.state.stateLayer, context);
    }

    if (call.tool === 'memory_get') {
      if (!this.deps.state.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory get');
      }

      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: true,
      };
      return executeMemoryGet(call, this.deps.state.stateLayer, context, { workspaceDir: this.deps.core.workspaceDir });
    }

    if (call.tool === 'nachos_search_conversations') {
      if (!this.deps.state.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for conversation search');
      }

      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: true,
      };
      return executeConversationSearch(call, this.deps.state.stateLayer, context);
    }

    if (call.tool === 'memory_write') {
      if (!this.deps.state.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory write');
      }

      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: true,
      };
      return executeMemoryWrite(call, this.deps.state.stateLayer, context);
    }

    if (call.tool === 'memory_delete') {
      if (!this.deps.state.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory delete');
      }

      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: true,
      };
      return executeMemoryDelete(call, this.deps.state.stateLayer, context);
    }

    if (call.tool === 'memory_recall') {
      if (!this.deps.state.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory recall');
      }

      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: true,
      };
      return executeMemoryRecall(call, this.deps.state.stateLayer, context);
    }

    if (call.tool === 'snapshot_list') {
      if (!this.deps.state.snapshotService) {
        return this.formatToolError('SNAPSHOTS_DISABLED', 'Snapshot service is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for snapshot list');
      }
      return executeSnapshotList(call, this.deps.state.snapshotService, session.id);
    }

    if (call.tool === 'snapshot_restore') {
      if (!this.deps.state.snapshotService) {
        return this.formatToolError('SNAPSHOTS_DISABLED', 'Snapshot service is not configured');
      }
      if (!this.deps.state.sessionsStore) {
        return this.formatToolError('SESSIONS_DISABLED', 'Sessions store is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for snapshot restore');
      }
      return executeSnapshotRestore(
        call,
        this.deps.state.snapshotService,
        this.deps.state.sessionsStore,
        session.id
      );
    }

    if (call.tool === 'github') {
      if (!this.deps.core.toolsConfig?.github?.enabled) {
        return this.formatToolError('GITHUB_DISABLED', 'GitHub tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }

      const githubConfig: GitHubConfig = {
        enabled: true,
        default_repo: this.deps.core.toolsConfig.github.default_repo,
        token_env: this.deps.core.toolsConfig.github.token_env || 'GITHUB_TOKEN',
        repo_allowlist: this.deps.core.toolsConfig.github.repo_allowlist,
      };

      const ghParams = call.parameters as {
        action?: string;
        http_method?: string;
        repo?: string;
        number?: number;
        endpoint?: string;
      };
      const ghAction = ghParams.action || 'unknown';
      const isWrite = isWriteAction(ghAction, ghParams.http_method);

      const startTime = Date.now();
      const result = await executeGitHub(call, githubConfig, session.userId);

      // Audit log write operations
      if (isWrite) {
        void this.deps.audit.logAuditEvent({
          id: `github-write-${call.id}`,
          timestamp: new Date().toISOString(),
          instanceId: this.deps.core.instanceId,
          userId: session.userId,
          sessionId: session.id,
          channel: session.channel ?? 'unknown',
          eventType: 'tool_execute',
          action: `github.${ghAction}`,
          resource: ghParams.repo || githubConfig.default_repo || 'unknown',
          outcome: result.success ? 'allowed' : 'error',
          reason: result.success ? undefined : result.error?.message,
          securityMode: this.deps.core.securityMode,
          toolMetadata: {
            toolName: 'github',
            operation: ghAction,
            resource: ghParams.endpoint || (ghParams.number ? `#${ghParams.number}` : undefined),
            duration: Date.now() - startTime,
            success: result.success,
          },
          details: {
            http_method: ghParams.http_method,
            is_write: true,
          },
        });
      }

      return result;
    }

    // Cron scheduler tools
    if (call.tool === 'nachos_cron_add') {
      if (!this.deps.core.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronAdd(call, this.deps.core.scheduler, session.userId, session.id);
    }

    if (call.tool === 'nachos_cron_list') {
      if (!this.deps.core.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronList(call, this.deps.core.scheduler, session.userId, session.id);
    }

    if (call.tool === 'nachos_cron_remove') {
      if (!this.deps.core.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronRemove(call, this.deps.core.scheduler, session.userId);
    }

    if (call.tool === 'nachos_cron_update') {
      if (!this.deps.core.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronUpdate(call, this.deps.core.scheduler, session.userId);
    }

    if (call.tool === 'nachos_cron_run') {
      if (!this.deps.core.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronRun(call, this.deps.core.scheduler, session.userId);
    }

    if (call.tool === 'bootstrap') {
      return this.executeBootstrapToolCall(call, session);
    }

    if (call.tool === 'user_profile') {
      return this.executeUserProfileToolCall(call, session);
    }

    if (call.tool === 'bitbucket') {
      if (!this.deps.core.toolsConfig?.bitbucket?.enabled) {
        return this.formatToolError('BITBUCKET_DISABLED', 'Bitbucket tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      const bitbucketConfig: BitbucketConfig = {
        enabled: true,
        default_workspace: this.deps.core.toolsConfig.bitbucket.default_workspace,
        auth_type: this.deps.core.toolsConfig.bitbucket.auth_type || 'app_password',
        username_env: this.deps.core.toolsConfig.bitbucket.username_env || 'BITBUCKET_USERNAME',
        password_env: this.deps.core.toolsConfig.bitbucket.password_env || 'BITBUCKET_APP_PASSWORD',
        token_env: this.deps.core.toolsConfig.bitbucket.token_env || 'BITBUCKET_TOKEN',
        workspace_allowlist: this.deps.core.toolsConfig.bitbucket.workspace_allowlist,
      };
      return executeBitbucket(call, bitbucketConfig, session.userId);
    }

    if (call.tool === 'composio') {
      if (!this.deps.core.toolsConfig?.composio?.enabled) {
        return this.formatToolError('COMPOSIO_DISABLED', 'Composio tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for Composio tool');
      }

      const context = {
        ...buildStateContext(session, this.deps.core.securityMode),
        internalTool: false,
      };
      return executeComposio(call, this.deps.state.stateLayer!, context);
    }

    if (call.tool === 'web_search') {
      if (!this.deps.core.toolsConfig?.web_search?.enabled) {
        return this.formatToolError('WEB_SEARCH_DISABLED', 'Web search tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }

      const apiKeyEnv = this.deps.core.toolsConfig.web_search.api_key_env || 'BRAVE_API_KEY';
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) {
        return this.formatToolError(
          'API_KEY_MISSING',
          `Brave Search API key not found in environment variable: ${apiKeyEnv}`
        );
      }

      const webSearchConfig: WebSearchConfig = {
        api_key: apiKey,
        default_country: this.deps.core.toolsConfig.web_search.default_country,
        safe_search: this.deps.core.toolsConfig.web_search.safe_search,
        max_results: this.deps.core.toolsConfig.web_search.max_results,
      };

      return executeWebSearch(call, webSearchConfig, session.userId);
    }



    if (call.tool === 'agent_exec') {
      if (!this.agentProcessRegistry) {
        return this.formatToolError('AGENT_EXEC_DISABLED', 'Agent exec tool is not enabled');
      }
      if (this.deps.core.securityMode !== 'permissive') {
        return this.formatToolError(
          'SECURITY_MODE_DENIED',
          'Agent exec tool is only available in permissive security mode'
        );
      }
      return handleAgentExecTool(call, this.agentProcessRegistry);
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Memory tool
  // ---------------------------------------------------------------------------

  private async executeMemoryToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (!this.deps.state.stateLayer) {
      return this.formatToolError('STATE_LAYER_DISABLED', 'State layer is not configured');
    }
    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory tool');
    }

    const action = readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    const agentId = resolveAgentId(session);
    const context = {
      ...buildStateContext(session, this.deps.core.securityMode),
      internalTool: true,
    };
    const allowedKinds = new Set(['summary', 'preference', 'fact', 'decision', 'task', 'issue']);

    if (action === 'query') {
      const kinds = readOptionalStringArray(call.parameters.kinds);
      const tags = readOptionalStringArray(call.parameters.tags);
      const text = readOptionalString(call.parameters.text);
      const limit = readOptionalNumber(call.parameters.limit, { min: 1 });
      const offset = readOptionalNumber(call.parameters.offset, { min: 0 });

      if (kinds) {
        const invalid = kinds.filter((kind) => !allowedKinds.has(kind));
        if (invalid.length > 0) {
          return this.formatToolError(
            'INVALID_PARAMETERS',
            `unsupported memory kinds: ${invalid.join(', ')}`
          );
        }
      }
      const normalizedKinds = kinds as
        | Array<'summary' | 'preference' | 'fact' | 'decision' | 'task' | 'issue'>
        | undefined;

      const result = await this.deps.state.stateLayer.queryMemory(
        {
          agentId,
          kinds: normalizedKinds ?? undefined,
          tags: tags ?? undefined,
          text,
          limit,
          offset,
        },
        context
      );

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    if (action === 'append_entry') {
      const kind = readOptionalString(call.parameters.kind);
      const content = readOptionalString(call.parameters.content);
      if (!kind || !content) {
        return this.formatToolError('INVALID_PARAMETERS', 'kind and content are required');
      }

      if (!allowedKinds.has(kind)) {
        return this.formatToolError('INVALID_PARAMETERS', `unsupported memory kind: ${kind}`);
      }

      const tags = readOptionalStringArray(call.parameters.tags) ?? undefined;
      const confidence = readOptionalNumber(call.parameters.confidence, { min: 0, max: 1 });
      const expiresAt = readOptionalString(call.parameters.expiresAt);

      const entry = await this.deps.state.stateLayer.appendMemoryEntry(
        {
          id: randomUUID(),
          agentId,
          kind: kind as 'summary' | 'preference' | 'fact' | 'decision' | 'task' | 'issue',
          content,
          tags,
          confidence,
          provenance: { source: 'tool.memory', sessionId: session.id },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: expiresAt ?? undefined,
        },
        context
      );

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ entry }, null, 2) }],
      };
    }

    if (action === 'append_facts') {
      const factsInput = call.parameters.facts;
      if (!Array.isArray(factsInput) || factsInput.length === 0) {
        return this.formatToolError('INVALID_PARAMETERS', 'facts must be a non-empty array');
      }

      const now = new Date().toISOString();
      const facts = factsInput
        .map((fact) => {
          if (!fact || typeof fact !== 'object') return null;
          const subject = readOptionalString((fact as { subject?: unknown }).subject);
          const predicate = readOptionalString((fact as { predicate?: unknown }).predicate);
          const object = readOptionalString((fact as { object?: unknown }).object);
          if (!subject || !predicate || !object) return null;
          const confidence = readOptionalNumber((fact as { confidence?: unknown }).confidence, {
            min: 0,
            max: 1,
          });
          const sourceEntryId = readOptionalString(
            (fact as { sourceEntryId?: unknown }).sourceEntryId
          );
          return {
            id: randomUUID(),
            agentId,
            subject,
            predicate,
            object,
            confidence,
            sourceEntryId: sourceEntryId ?? undefined,
            createdAt: now,
          };
        })
        .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));

      if (facts.length === 0) {
        return this.formatToolError(
          'INVALID_PARAMETERS',
          'facts must include subject/predicate/object'
        );
      }

      const stored = await this.deps.state.stateLayer.appendMemoryFacts(facts, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ facts: stored }, null, 2) }],
      };
    }

    if (action === 'delete_entry') {
      const id = readOptionalString(call.parameters.id);
      if (!id) {
        return this.formatToolError('INVALID_PARAMETERS', 'id is required');
      }

      await this.deps.state.stateLayer.deleteMemoryEntry(id, agentId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown memory action: ${action}`);
  }

  // ---------------------------------------------------------------------------
  // User profile tool
  // ---------------------------------------------------------------------------

  private async executeUserProfileToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (!this.deps.state.stateLayer) {
      return this.formatToolError('STATE_LAYER_DISABLED', 'State layer is not configured');
    }
    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for user profile tool');
    }

    const userId = session.userId;
    if (!userId) {
      return this.formatToolError('INVALID_PARAMETERS', 'userId is not available for this session');
    }

    const action = readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    const agentId = resolveAgentId(session);
    const context = {
      ...buildStateContext(session, this.deps.core.securityMode),
      internalTool: true,
    };

    if (action === 'get') {
      const profile = await this.deps.state.stateLayer.getUserProfile(agentId, userId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile }, null, 2) }],
      };
    }

    if (action === 'set') {
      const profileText = readOptionalString(call.parameters.profile);
      if (!profileText) {
        return this.formatToolError('INVALID_PARAMETERS', 'profile is required');
      }

      const current = await this.deps.state.stateLayer.getUserProfile(agentId, userId, context);
      const stored = await this.deps.state.stateLayer.putUserProfile(
        {
          userId,
          agentId,
          profile: profileText,
          updatedAt: new Date().toISOString(),
          version: current?.version ? current.version + 1 : 1,
        },
        context
      );

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile: stored }, null, 2) }],
      };
    }

    if (action === 'delete') {
      await this.deps.state.stateLayer.deleteUserProfile(agentId, userId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown user_profile action: ${action}`);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap tool
  // ---------------------------------------------------------------------------

  private async executeBootstrapToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (this.deps.core.toolsConfig?.bootstrap?.enabled === false) {
      return this.formatToolError('TOOL_DISABLED', 'bootstrap tool is disabled');
    }
    if (!this.deps.state.stateLayer) {
      return this.formatToolError('STATE_LAYER_DISABLED', 'State layer is not configured');
    }
    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for bootstrap tool');
    }

    const action = readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    const identityCompleted = readOptionalBoolean(call.parameters.identityCompleted);
    const agentId = resolveAgentId(session);
    const context = {
      ...buildStateContext(session, this.deps.core.securityMode),
      internalTool: true,
    };

    if (await this.deps.state.getIdentityCompletionStatus(session)) {
      if (action !== 'get') {
        return this.formatToolError(
          'TOOL_DISABLED',
          'bootstrap is locked after identity completion; use /identity reset to restart onboarding'
        );
      }
    }

    if (action === 'get') {
      const profile = await this.deps.state.stateLayer.getBootstrap(agentId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile }, null, 2) }],
      };
    }

    if (action === 'set') {
      const content = readOptionalStringMap(call.parameters.content);
      if (!content) {
        return this.formatToolError('INVALID_PARAMETERS', 'content is required');
      }

      const current = await this.deps.state.stateLayer.getBootstrap(agentId, context);
      const nextContent = { ...content };
      if (identityCompleted) {
        delete nextContent.bootstrap;
      }
      const stored = await this.deps.state.stateLayer.putBootstrap(
        {
          agentId,
          content: nextContent,
          updatedAt: new Date().toISOString(),
          version: current?.version ? current.version + 1 : 1,
        },
        context
      );

      if (identityCompleted) {
        await this.deps.state.markIdentityCompleted(agentId, nextContent, context);
      }

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile: stored }, null, 2) }],
      };
    }

    if (action === 'delete') {
      await this.deps.state.stateLayer.deleteBootstrap(agentId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown bootstrap action: ${action}`);
  }

  // ---------------------------------------------------------------------------
  // Subagents tool
  // ---------------------------------------------------------------------------

  private async executeSubagentsToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (!this.deps.core.subagentOrchestrator) {
      return this.formatToolError('SUBAGENT_DISABLED', 'Subagent orchestration is not configured');
    }
    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for subagent tool');
    }

    const action = readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    if (action === 'list') {
      const runs = this.filterSubagentRunsForSession(session, this.deps.state.listSubagents());
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ runs }, null, 2) }],
      };
    }

    const runId = readOptionalString(call.parameters.runId);
    if (!runId) {
      return this.formatToolError('INVALID_PARAMETERS', 'runId is required');
    }

    const run = this.deps.state.getSubagentInfo(runId);
    if (!run || !this.canAccessSubagentRun(session, run)) {
      return this.formatToolError('NOT_FOUND', 'Subagent run not found');
    }

    if (action === 'info') {
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ run }, null, 2) }],
      };
    }

    if (action === 'log') {
      const limit = readOptionalNumber(call.parameters.limit, { min: 1 }) ?? 50;
      const log = await this.deps.state.getSubagentLog(runId);
      const messages = (log?.messages as unknown[]) ?? [];
      return {
        success: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ runId, messages: messages.slice(-limit) }, null, 2),
          },
        ],
      };
    }

    if (action === 'files_list') {
      const workspaceDir = this.deps.core.subagentOrchestrator.getRunWorkspaceDir(runId);
      if (!workspaceDir) {
        return this.formatToolError('NOT_FOUND', 'Subagent workspace not available');
      }

      const entries = await listSubagentWorkspaceEntries({
        rootDir: workspaceDir,
        relativePath: readOptionalString(call.parameters.path),
        recursive: Boolean(call.parameters.recursive),
        limit: readOptionalNumber(call.parameters.limit, { min: 1 }) ?? 200,
      });

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ runId, entries }, null, 2) }],
      };
    }

    if (action === 'files_get') {
      const workspaceDir = this.deps.core.subagentOrchestrator.getRunWorkspaceDir(runId);
      if (!workspaceDir) {
        return this.formatToolError('NOT_FOUND', 'Subagent workspace not available');
      }

      const relativePath = readOptionalString(call.parameters.path);
      if (!relativePath) {
        return this.formatToolError('INVALID_PARAMETERS', 'path is required');
      }

      const maxBytes = readOptionalNumber(call.parameters.maxBytes, { min: 1 }) ?? 65536;
      const file = await readSubagentWorkspaceFile({
        rootDir: workspaceDir,
        relativePath,
        maxBytes,
      });

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ runId, file }, null, 2) }],
      };
    }

    if (action === 'stop') {
      const stopped = this.deps.state.stopSubagent(runId);
      return {
        success: stopped,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                runId,
                stopped,
                message: stopped
                  ? 'Subagent run stopped successfully'
                  : 'Cannot stop run (already running or completed)',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (action === 'steer') {
      const message = readOptionalString(call.parameters.message);
      if (!message) {
        return this.formatToolError('INVALID_PARAMETERS', 'message is required for steer action');
      }

      const steered = await this.deps.state.steerSubagent(runId, message);
      return {
        success: steered,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                runId,
                steered,
                message: steered
                  ? 'Message sent to subagent'
                  : 'Cannot steer run (not running or already completed)',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (action === 'workflow_list') {
      const workflows = this.deps.core.subagentOrchestrator.listWorkflows();
      const serializedWorkflows = workflows.map((wf) => ({
        ...wf,
        stepResults: Object.fromEntries(wf.stepResults),
      }));

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ workflows: serializedWorkflows }, null, 2),
          },
        ],
      };
    }

    if (action === 'workflow_info') {
      const workflowId = readOptionalString(call.parameters.workflowId);
      if (!workflowId) {
        return this.formatToolError(
          'INVALID_PARAMETERS',
          'workflowId is required for workflow_info action'
        );
      }

      const workflow = this.deps.core.subagentOrchestrator.getWorkflow(workflowId);
      if (!workflow) {
        return this.formatToolError('NOT_FOUND', 'Workflow not found');
      }

      const serialized = {
        ...workflow,
        stepResults: Object.fromEntries(workflow.stepResults),
      };

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ workflow: serialized }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown subagents action: ${action}`);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  formatToolError(code: string, message: string, details?: unknown): ToolResult {
    return {
      success: false,
      content: [],
      error: { code, message, details },
    };
  }

  private sanitizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    delete cloned.$id;
    return cloned;
  }

  private canAccessSubagentRun(session: Session, run: SubagentRunRecord): boolean {
    if (session.id === run.requester.sessionId) return true;
    if (session.userId && run.requester.userId && session.userId === run.requester.userId)
      return true;
    return false;
  }

  private filterSubagentRunsForSession(
    session: Session,
    runs: SubagentRunRecord[]
  ): SubagentRunRecord[] {
    return runs.filter((run) => this.canAccessSubagentRun(session, run));
  }

  private buildSubagentToolDefinitions(session?: Session | null): LLMRequestType['tools'] {
    const tools: NonNullable<LLMRequestType['tools']> = [];

    // Always include subagent_progress
    tools.push({
      name: 'subagent_progress',
      description:
        'Report progress on the current task. Use this to keep the requester informed of your progress. The runId is automatically determined from your session context.',
      parameters: this.sanitizeToolSchema(SubagentProgressToolSchema),
    });

    // Resolve profile-based tool allow list
    const profileName = this.resolveSubagentProfile(session ?? null);
    const profilePolicy = this.resolveSubagentProfilePolicy(profileName);
    const allowList = profilePolicy?.allow && profilePolicy.allow.length > 0
      ? new Set(profilePolicy.allow.map((t) => normalizeToolName(t)))
      : null;

    // No allow list = no extra tools for the subagent (default restrictive behavior)
    if (!allowList) return tools;

    // Get all enabled external tool definitions from global config
    // (browser/exec tools are local-only and not offered to subagents via profiles)
    const allAvailable = getExternalToolDefinitions(this.deps.core.toolsConfig);

    for (const extTool of allAvailable) {
      const normalized = normalizeToolName(extTool.name);
      if (!allowList.has(normalized)) continue;

      // Skip tools that are in the profile deny list or global subagent deny list
      const policyCheck = this.evaluateSubagentToolPolicy(extTool.name, session);
      if (!policyCheck.allowed) continue;

      tools.push({
        name: extTool.name,
        description: extTool.description,
        parameters: this.sanitizeToolSchema(extTool.parameters),
      });
    }

    return tools;
  }

  private evaluateSubagentToolPolicy(
    tool: string,
    session?: Session | null
  ): { allowed: boolean; reason?: string } {
    const DEFAULT_SUBAGENT_DENY_TOOLS = new Set([
      'sessions_list',
      'sessions_history',
      'sessions_send',
      'sessions_spawn',
    ]);

    const normalized = normalizeToolName(tool);
    const policy = this.deps.policy.subagentToolPolicy;
    const profileName = this.resolveSubagentProfile(session ?? null);
    const profilePolicy = this.resolveSubagentProfilePolicy(profileName);
    const denyList = new Set(
      [
        ...DEFAULT_SUBAGENT_DENY_TOOLS,
        ...(policy?.deny ?? []).map((entry) => normalizeToolName(entry)),
        ...(profilePolicy?.deny ?? []).map((entry) => normalizeToolName(entry)),
      ].filter((entry) => entry.length > 0)
    );

    if (denyList.has(normalized)) {
      return { allowed: false, reason: `Tool blocked for subagents: ${tool}` };
    }

    const allowListSource =
      profilePolicy?.allow && profilePolicy.allow.length > 0
        ? profilePolicy.allow
        : (policy?.allow ?? []);
    const allow = allowListSource.map((entry) => normalizeToolName(entry));
    if (allow.length > 0 && !allow.includes(normalized)) {
      const profileSuffix = profileName ? ` (profile: ${profileName})` : '';
      return {
        allowed: false,
        reason: `Tool not allowlisted for subagents${profileSuffix}: ${tool}`,
      };
    }

    return { allowed: true };
  }

  private resolveSubagentProfile(session: Session | null): string | undefined {
    const defaultProfile = readOptionalString(this.deps.policy.subagentToolPolicy?.default_profile);
    if (!session?.metadata || typeof session.metadata !== 'object') {
      return defaultProfile;
    }
    const metadata = session.metadata as { subagent?: { profile?: string } };
    const profile = readOptionalString(metadata.subagent?.profile);
    return profile ?? defaultProfile;
  }

  private resolveSubagentProfilePolicy(profile?: string): SubagentToolProfileConfig | undefined {
    const profiles = this.deps.policy.subagentToolPolicy?.profiles;
    if (!profile || !profiles) return undefined;

    if (profiles[profile]) return profiles[profile];

    const normalized = normalizeToolName(profile);
    const match = Object.entries(profiles).find(([name]) => normalizeToolName(name) === normalized);
    return match?.[1];
  }

  private checkMemoryToolRateLimit(sessionId: string): {
    allowed: boolean;
    retryAfterSeconds?: number;
  } {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxCalls = 10;

    const calls = this.memoryToolCalls.get(sessionId) ?? [];
    const recentCalls = calls.filter((timestamp) => now - timestamp < windowMs);

    if (recentCalls.length >= maxCalls) {
      const oldestCall = Math.min(...recentCalls);
      const retryAfterSeconds = Math.ceil((oldestCall + windowMs - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    recentCalls.push(now);
    this.memoryToolCalls.set(sessionId, recentCalls);
    return { allowed: true };
  }

  private scanToolResult(
    result: ToolResult,
    session: Session | null,
    tool: string,
    securityMode: 'strict' | 'standard' | 'permissive'
  ): {
    allowed: boolean;
    reason?: string;
    redactedContent?: ToolResult['content'];
  } {
    if (!this.deps.security.dlp || result.content.length === 0) {
      return { allowed: true };
    }

    const redactedContent: ToolResult['content'] = [];
    let blocked = false;
    let blockReason: string | undefined;

    for (const block of result.content) {
      if (block.type === 'text') {
        const scanResult = this.deps.security.dlp.scan(block.text, session?.channel);
        if (!scanResult.allowed) {
          blocked = true;
          blockReason = scanResult.reason;
          void this.deps.audit.logAuditEvent({
            id: `dlp-tool-result-${Date.now()}`,
            timestamp: new Date().toISOString(),
            instanceId: this.deps.core.instanceId,
            userId: session?.userId ?? 'unknown',
            sessionId: session?.id ?? 'unknown',
            channel: session?.channel ?? 'unknown',
            eventType: 'dlp_block',
            action: 'dlp.block.tool_output',
            resource: tool,
            outcome: 'blocked',
            reason: scanResult.reason,
            securityMode,
            details: {
              findingsCount: scanResult.findings.length,
              action: scanResult.action,
            },
          });
          break;
        }

        if (scanResult.action === 'redact' && scanResult.message) {
          redactedContent.push({ ...block, text: scanResult.message });
        } else {
          redactedContent.push(block);
        }

        if (scanResult.action === 'alert') {
          void this.deps.audit.logAuditEvent({
            id: `dlp-tool-result-alert-${Date.now()}`,
            timestamp: new Date().toISOString(),
            instanceId: this.deps.core.instanceId,
            userId: session?.userId ?? 'unknown',
            sessionId: session?.id ?? 'unknown',
            channel: session?.channel ?? 'unknown',
            eventType: 'dlp_scan',
            action: 'dlp.alert.tool_output',
            resource: tool,
            outcome: 'allowed',
            reason: scanResult.reason,
            securityMode,
            details: {
              findingsCount: scanResult.findings.length,
              action: scanResult.action,
            },
          });
        }
        continue;
      }

      // Scan non-text content for structured data
      const structuredText: string[] = [];
      if (typeof block === 'object' && block !== null) {
        const extractStrings = (obj: unknown, depth = 0): void => {
          if (depth > 5) return;
          if (typeof obj === 'string' && obj.length > 0) {
            structuredText.push(obj);
          } else if (Array.isArray(obj)) {
            obj.forEach((item) => extractStrings(item, depth + 1));
          } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach((value) => extractStrings(value, depth + 1));
          }
        };
        extractStrings(block);
      }

      for (const text of structuredText) {
        const scanResult = this.deps.security.dlp.scan(text, session?.channel);
        if (!scanResult.allowed) {
          blocked = true;
          blockReason = scanResult.reason;
          void this.deps.audit.logAuditEvent({
            id: `dlp-tool-result-structured-${Date.now()}`,
            timestamp: new Date().toISOString(),
            instanceId: this.deps.core.instanceId,
            userId: session?.userId ?? 'unknown',
            sessionId: session?.id ?? 'unknown',
            channel: session?.channel ?? 'unknown',
            eventType: 'dlp_block',
            action: 'dlp.block.tool_output.structured',
            resource: tool,
            outcome: 'blocked',
            reason: scanResult.reason,
            securityMode,
            details: {
              findingsCount: scanResult.findings.length,
              action: scanResult.action,
              contentType: block.type,
            },
          });
          break;
        }
      }

      if (blocked) break;
      redactedContent.push(block);
    }

    if (blocked) {
      return { allowed: false, reason: blockReason };
    }

    return redactedContent.length > 0 ? { allowed: true, redactedContent } : { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Browser tool definitions — kept as a separate function to avoid large
// constant at module level interfering with tree-shaking.
// ---------------------------------------------------------------------------

function getBrowserToolDefinitions(): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the browser.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to navigate to' } },
        required: ['url'],
      },
    },
    {
      name: 'browser_snapshot',
      description:
        'Capture an accessibility snapshot of the current page. Returns a structured ARIA tree with element references (ref) that can be used to target elements in subsequent actions like click, type, and fill. Always call this first before interacting with page elements.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_click',
      description:
        'Click an element using its ref from a previous accessibility snapshot. Always call browser_snapshot first to get element refs.',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: 'Human-readable element description for logging' },
          ref: { type: 'string', description: 'Element ref from accessibility snapshot' },
        },
        required: ['element', 'ref'],
      },
    },
    {
      name: 'browser_type',
      description:
        'Type text using keyboard into a focused element. Each character generates keydown, keypress/input, and keyup events.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' },
          submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
        },
        required: ['text'],
      },
    },
    {
      name: 'browser_fill',
      description: 'Clear and fill an input element with text. Use ref from browser_snapshot.',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: 'Human-readable element description for logging' },
          ref: { type: 'string', description: 'Element ref from accessibility snapshot' },
          value: { type: 'string', description: 'Value to fill' },
        },
        required: ['element', 'ref', 'value'],
      },
    },
    {
      name: 'browser_select_option',
      description: 'Select an option in a dropdown element. Use ref from browser_snapshot.',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: 'Human-readable element description for logging' },
          ref: { type: 'string', description: 'Element ref from accessibility snapshot' },
          values: {
            type: 'array',
            items: { type: 'string' },
            description: 'Values to select',
          },
        },
        required: ['element', 'ref', 'values'],
      },
    },
    {
      name: 'browser_hover',
      description: 'Hover over an element. Use ref from browser_snapshot.',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: 'Human-readable element description for logging' },
          ref: { type: 'string', description: 'Element ref from accessibility snapshot' },
        },
        required: ['element', 'ref'],
      },
    },
    {
      name: 'browser_drag',
      description: 'Drag an element to a target element. Use refs from browser_snapshot.',
      parameters: {
        type: 'object',
        properties: {
          startElement: { type: 'string', description: 'Human-readable source element description' },
          startRef: { type: 'string', description: 'Source element ref from accessibility snapshot' },
          endElement: { type: 'string', description: 'Human-readable target element description' },
          endRef: { type: 'string', description: 'Target element ref from accessibility snapshot' },
        },
        required: ['startElement', 'startRef', 'endElement', 'endRef'],
      },
    },
    {
      name: 'browser_press_key',
      description: 'Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown, a, etc.).',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'Key name (e.g. Enter, Tab, Escape)' } },
        required: ['key'],
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page. Use when you need to visually inspect the page.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_evaluate',
      description: 'Run JavaScript in the browser console and return the result.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'JavaScript expression to evaluate' },
        },
        required: ['expression'],
      },
    },
    {
      name: 'browser_upload_file',
      description: 'Upload one or more files to a file input element. Use ref from browser_snapshot to target the file input.',
      parameters: {
        type: 'object',
        properties: {
          element: { type: 'string', description: 'Human-readable element description for logging' },
          ref: { type: 'string', description: 'Element ref for the file input' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Absolute file paths to upload',
          },
        },
        required: ['element', 'ref', 'paths'],
      },
    },
    {
      name: 'browser_handle_dialog',
      description: 'Handle a browser dialog (alert, confirm, prompt). Call before triggering the dialog action.',
      parameters: {
        type: 'object',
        properties: {
          accept: { type: 'boolean', description: 'Whether to accept or dismiss the dialog' },
          promptText: { type: 'string', description: 'Text to enter in a prompt dialog' },
        },
        required: ['accept'],
      },
    },
    {
      name: 'browser_wait',
      description: 'Wait for text to appear on the page, or for a specified time.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to wait for on the page' },
          time: { type: 'number', description: 'Wait time in seconds (max 10)' },
        },
      },
    },
    {
      name: 'browser_close',
      description: 'Close the browser and end the session.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_resize',
      description: 'Resize the browser viewport.',
      parameters: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'Viewport width in pixels' },
          height: { type: 'number', description: 'Viewport height in pixels' },
        },
        required: ['width', 'height'],
      },
    },
    {
      name: 'browser_go_back',
      description: 'Navigate back in browser history.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_go_forward',
      description: 'Navigate forward in browser history.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_tab_new',
      description: 'Open a new browser tab, optionally navigating to a URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to open in the new tab' } },
      },
    },
    {
      name: 'browser_tab_close',
      description: 'Close the current browser tab.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_tab_list',
      description: 'List all open browser tabs with their titles and URLs.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_tab_select',
      description: 'Switch to a specific browser tab by index.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Zero-based tab index to switch to' },
        },
        required: ['index'],
      },
    },
    {
      name: 'browser_console_messages',
      description: 'Read recent browser console messages (log, warn, error).',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_network_requests',
      description: 'List recent network requests made by the page.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'browser_pdf_save',
      description: 'Save the current page as a PDF file.',
      parameters: { type: 'object', properties: {} },
    },
  ];
}
