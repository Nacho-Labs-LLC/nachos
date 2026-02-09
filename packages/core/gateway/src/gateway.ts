/**
 * Gateway - Main entry point for the Nachos Gateway service
 */
import type {
  ChannelInboundMessage,
  ChannelOutboundMessage,
  LLMRequestType,
  LLMResponseType,
  Message,
  MessageEnvelope,
  Session,
  SessionWithMessages,
  PromptReport,
} from '@nachos/types';
import { TOPICS } from '@nachos/bus';
import {
  MemoryToolSchema,
  SessionsSpawnToolSchema,
  SubagentsToolSchema,
  UserProfileToolSchema,
  validateChannelInboundMessage,
} from '@nachos/types';
import type {
  AuditConfig,
  ContextManagementCommandsConfig,
  RuntimeToolSandboxConfig,
  SubagentToolProfileConfig,
  SubagentToolPolicyConfig,
  ToolGroupConfig,
  NachosConfig,
  PartialNachosConfig,
} from '@nachos/config';
import {
  applyRuntimeOverlay,
  loadAndValidateConfig,
  loadRuntimeOverlay,
  resolveRuntimeStateDir,
  saveRuntimeOverlay,
  validateConfigOrThrow,
} from '@nachos/config';
import { randomUUID } from 'node:crypto';
import { StateStorage } from './state.js';
import { SessionManager } from './session.js';
import {
  Router,
  InMemoryMessageBus,
  createEnvelope,
  type MessageBus,
  NatsBusAdapter,
} from './router.js';
import { createHealthServer, performHealthCheck, type HealthCheckDeps } from './health.js';
import { Salsa, type PolicyEngineConfig, type SecurityRequest } from './salsa/index.js';
import { AuditLogger, loadAuditProvider } from './audit/index.js';
import type { AuditEvent } from './audit/types.js';
import { DLPSecurityLayer, type DLPConfig } from './security/dlp.js';
import {
  createDefaultRateLimiterConfig,
  RateLimiter,
  type RateLimiterConfig,
} from './security/rate-limiter.js';
import { ToolCoordinator } from './tools/coordinator.js';
import { ToolCache } from './tools/cache.js';
import { ApprovalManager } from './tools/approval-manager.js';
import type { ToolCall, ToolResult } from '@nachos/types';
import {
  StateLayer,
  createStateLayer,
  type StateOperationContext,
} from './state-layer/state-layer.js';
import { MemoryPipeline, type MemoryPipelineConfig } from './state-layer/memory-pipeline.js';
import { tokenEstimator } from '@nachos/context-manager';
import type { ContextManager } from '@nachos/context-manager';
import type {
  StateLayerConfig,
  StateLayerDependencies,
  StatePolicyRequest,
} from './state-layer/types.js';
import { SubagentManager } from './subagents/subagent-manager.js';
import { SubagentOrchestrator } from './subagents/subagent-orchestrator.js';
import {
  listSubagentWorkspaceEntries,
  readSubagentWorkspaceFile,
  resolveSubagentWorkspaceRoot,
} from './subagents/workspace-utils.js';
import type {
  SubagentManagerConfig,
  SubagentOrchestratorConfig,
  SubagentResult,
  SubagentRunRecord,
  SubagentRunRequest,
  SubagentTask,
} from './subagents/types.js';
import { SandboxManager } from './sandbox/sandbox-manager.js';

const DEFAULT_SUBAGENT_DENY_TOOLS = new Set([
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
]);

const DEFAULT_TOOL_GROUPS: Record<string, string[]> = {
  lookup: ['web_fetch', 'goplaces'],
  media: ['gifgrep'],
  summarize: ['summarize'],
  workspace: ['gog'],
};

type ResolvedContextCommandConfig = {
  enabled: boolean;
  allowInDms: boolean;
  allowInChannels: boolean;
  adminAllowlist: Set<string>;
  resetTriggers: string[];
  contextTriggers: string[];
};

type ContextCommandOutcome = {
  handled: boolean;
  replyText?: string;
  newSession?: Session;
  nextMessageText?: string;
};

/**
 * Gateway configuration options
 */
export interface GatewayOptions {
  /** Path to SQLite database file, or ':memory:' for in-memory */
  dbPath?: string;
  /** Port for health check endpoint */
  healthPort?: number;
  /** Message bus implementation (defaults to in-memory) */
  bus?: MessageBus;
  /** Default system prompt for new sessions */
  defaultSystemPrompt?: string;
  /** Channels to subscribe to */
  channels?: string[];
  /** Policy engine configuration */
  policyConfig?: PolicyEngineConfig;
  /** Audit configuration */
  auditConfig?: AuditConfig;
  /** DLP configuration */
  dlpConfig?: DLPConfig;
  /** Allowlisted approvers for restricted actions */
  approvalAllowlist?: string[];
  /** Gateway instance ID */
  instanceId?: string;
  /** Rate limiting configuration */
  rateLimiterConfig?: RateLimiterConfig;
  /** Enable streaming passthrough to channels */
  streamingPassthrough?: boolean;
  /** Minimum characters between streaming updates */
  streamingChunkSize?: number;
  /** Minimum interval between streaming updates (ms) */
  streamingMinIntervalMs?: number;
  /** Context manager instance */
  contextManager?: ContextManager;
  /** State layer instance */
  stateLayer?: StateLayer;
  /** State layer configuration (used if stateLayer not provided) */
  stateLayerConfig?: StateLayerConfig;
  /** Memory pipeline instance */
  memoryPipeline?: MemoryPipeline;
  /** Memory pipeline configuration (used if memoryPipeline not provided) */
  memoryPipelineConfig?: MemoryPipelineConfig;
  /** Context command configuration for session controls */
  contextCommandConfig?: ContextManagementCommandsConfig;
  /** Subagent configuration */
  subagentConfig?: SubagentManagerConfig;
  /** Subagent orchestration configuration */
  subagentOrchestratorConfig?: SubagentOrchestratorConfig;
  /** Subagent tool policy overrides */
  subagentToolPolicy?: SubagentToolPolicyConfig;
  /** Tool sandbox configuration */
  toolSandboxConfig?: RuntimeToolSandboxConfig;
  /** Runtime workspace directory */
  workspaceDir?: string;
  /** Tool group mapping for policy grouping */
  toolGroups?: Record<string, ToolGroupConfig>;
}

/**
 * Gateway class - orchestrates sessions, routing, and health
 */
export class Gateway {
  private storage: StateStorage;
  private sessionManager: SessionManager;
  private router: Router;
  private rateLimiter?: RateLimiter;
  private salsa: Salsa | null = null;
  private auditLogger: AuditLogger | null = null;
  private dlp: DLPSecurityLayer | null = null;
  private dlpConfig?: DLPConfig;
  private toolCoordinator: ToolCoordinator | null = null;
  private toolCache: ToolCache | null = null;
  private approvalManager: ApprovalManager | null = null;
  private instanceId: string;
  private healthServer: ReturnType<typeof createHealthServer> | null = null;
  private options: GatewayOptions;
  private isConnected: boolean = false;
  private shutdownHandlers: (() => void)[] = [];
  private stateLayer?: StateLayer;
  private memoryPipeline?: MemoryPipeline;
  private memoryPipelineInterval?: NodeJS.Timeout;
  private securityMode: 'strict' | 'standard' | 'permissive';
  private contextCommandConfig?: ContextManagementCommandsConfig;
  private subagentManager?: SubagentManager;
  private subagentOrchestrator?: SubagentOrchestrator;
  private subagentToolPolicy?: SubagentToolPolicyConfig;
  private subagentWorkspaceRoot?: string;
  private sandboxManager?: SandboxManager;
  private streamingSessions: Map<
    string,
    {
      inbound: ChannelInboundMessage;
      buffer: string;
      lastSentAt: number;
      lastSentLength: number;
    }
  > = new Map();
  private approvalAllowlist: Set<string>;
  private toolGroupMap: Map<string, string>;
  private skillsPrompt: string | null = null;

  constructor(options: GatewayOptions = {}) {
    this.options = options;
    this.instanceId = options.instanceId ?? 'gateway';
    this.dlpConfig = options.dlpConfig;
    this.approvalAllowlist = new Set(options.approvalAllowlist ?? []);
    this.securityMode = options.policyConfig?.securityMode ?? 'standard';
    this.toolGroupMap = this.buildToolGroupMap(options.toolGroups);
    this.subagentToolPolicy = options.subagentToolPolicy;
    this.subagentWorkspaceRoot = resolveSubagentWorkspaceRoot(options.workspaceDir);
    this.contextCommandConfig = options.contextCommandConfig;
    if (options.toolSandboxConfig) {
      this.sandboxManager = new SandboxManager(options.toolSandboxConfig, {
        workspaceDir: options.workspaceDir,
      });
    }

    // Initialize storage
    this.storage = new StateStorage(options.dbPath ?? ':memory:');

    // Initialize session manager
    this.sessionManager = new SessionManager(this.storage);

    // Initialize rate limiter
    if (options.rateLimiterConfig?.enabled !== false) {
      this.rateLimiter = new RateLimiter(
        options.rateLimiterConfig ?? createDefaultRateLimiterConfig()
      );
    }

    // Initialize router
    const bus = options.bus ?? new InMemoryMessageBus();
    this.router = new Router({ bus, componentName: 'gateway', rateLimiter: this.rateLimiter });

    // Initialize Salsa policy engine if configured
    if (options.policyConfig) {
      this.salsa = new Salsa(options.policyConfig);
      console.log('[Gateway] Policy engine (Salsa) initialized');
    }

    if (options.stateLayer) {
      this.stateLayer = options.stateLayer;
    } else if (options.stateLayerConfig) {
      this.stateLayer = createStateLayer(
        options.stateLayerConfig,
        this.buildStateLayerDependencies()
      );
    }

    if (options.memoryPipeline) {
      this.memoryPipeline = options.memoryPipeline;
    } else if (options.memoryPipelineConfig && this.stateLayer) {
      this.memoryPipeline = new MemoryPipeline(this.stateLayer, options.memoryPipelineConfig);
    }

    // Initialize router
    this.router = new Router({
      bus,
      componentName: 'gateway',
      rateLimiter: this.rateLimiter,
      contextManager: options.contextManager,
      sessionManager: this.sessionManager,
      memoryPipeline: this.memoryPipeline,
      securityMode: this.securityMode,
    });

    if (options.subagentConfig) {
      this.subagentManager = new SubagentManager(options.subagentConfig, async (request) => {
        return (await this.router.sendLLMRequest(request)) as LLMResponseType;
      });
      this.subagentOrchestrator = new SubagentOrchestrator({
        subagentManager: this.subagentManager,
        sessionManager: this.sessionManager,
        router: this.router,
        buildLLMRequest: this.buildLLMRequest.bind(this),
        defaultSystemPrompt: this.options.defaultSystemPrompt,
        config: options.subagentOrchestratorConfig,
        workspaceRoot: this.subagentWorkspaceRoot,
      });
    }

    // Register default handlers
    this.registerDefaultHandlers();
  }

  private mergeConfigOverlay(
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ): Record<string, unknown> {
    const result = { ...target };

    for (const key in source) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      const sourceValue = source[key];
      const targetValue = result[key];

      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.mergeConfigOverlay(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        );
      } else {
        result[key] = sourceValue as unknown;
      }
    }

    return result;
  }

  private extractEnvelopePayload(data: unknown): {
    envelopeId?: string;
    payload: unknown;
  } {
    if (data && typeof data === 'object' && 'payload' in (data as MessageEnvelope)) {
      const envelope = data as MessageEnvelope;
      return { envelopeId: envelope.id, payload: envelope.payload };
    }
    return { payload: data };
  }

  /**
   * Register default message handlers
   */
  private registerDefaultHandlers(): void {
    // Handle inbound channel messages
    this.router.registerHandler('channel.inbound', async (envelope: MessageEnvelope) => {
      await this.handleInboundMessage(envelope);
    });
  }

  /**
   * Handle an inbound message from a channel
   */
  private async handleInboundMessage(envelope: MessageEnvelope): Promise<void> {
    const validated = validateChannelInboundMessage(envelope.payload);
    if (!validated.success || !validated.data) {
      console.warn('[Gateway] Invalid inbound channel message', validated.errors);
      return;
    }

    const message = validated.data as ChannelInboundMessage;
    let messageText = message.content.text ?? '';
    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';

    if (this.rateLimiter) {
      const limitResult = await this.rateLimiter.check(message.sender.id ?? 'anonymous', 'message');

      if (!limitResult.allowed) {
        void this.logAuditEvent({
          id: envelope.id,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: message.sender.id,
          sessionId: message.sessionId ?? 'unknown',
          channel: message.channel,
          eventType: 'rate_limit',
          action: 'rate_limit',
          resource: message.channel,
          outcome: 'blocked',
          reason: 'Inbound message rate limit exceeded',
          securityMode,
          details: {
            remaining: limitResult.remaining,
            resetAt: limitResult.resetAt,
            limit: limitResult.total,
            retryAfterSeconds: limitResult.retryAfterSeconds,
            source: limitResult.source,
          },
        });

        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: this.getReplyToMessageId(message),
          sessionId: message.sessionId,
          content: {
            text: `Rate limit exceeded. Retry after ${limitResult.retryAfterSeconds ?? 60}s.`,
            format: 'markdown',
          },
        };

        await this.router.sendToChannel(outbound);
        return;
      }
    }

    const existingSession = this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    // Get or create session for this conversation
    let session = this.sessionManager.getOrCreateSession({
      channel: message.channel,
      conversationId: message.conversation.id,
      userId: message.sender.id,
      systemPrompt: this.options.defaultSystemPrompt,
    });

    if (this.salsa) {
      const policyResult = this.salsa.evaluate({
        requestId: envelope.id,
        userId: message.sender.id,
        sessionId: session.id,
        securityMode,
        resource: {
          type: message.conversation.type === 'dm' ? 'dm' : 'channel',
          id: message.channel,
        },
        action: 'receive',
        metadata: {
          channel: message.channel,
          conversationId: message.conversation.id,
          conversationType: message.conversation.type,
          channelMessageId: message.channelMessageId,
          userId: message.sender.id,
          ...message.metadata,
        },
        timestamp: new Date(),
      });

      if (!policyResult.allowed) {
        void this.logAuditEvent({
          id: envelope.id,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: message.sender.id,
          sessionId: session.id,
          channel: message.channel,
          eventType: 'policy_check',
          action: 'policy.receive',
          resource: message.channel,
          outcome: 'denied',
          reason: policyResult.reason,
          securityMode,
          policyMatched: policyResult.ruleId,
        });

        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: this.getReplyToMessageId(message),
          sessionId: session.id,
          content: {
            text: policyResult.reason ?? 'Message denied by policy.',
            format: 'markdown',
          },
        };

        await this.router.sendToChannel(outbound);
        return;
      }
    }

    if (!existingSession) {
      await this.logAuditEvent({
        id: envelope.id,
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId,
        userId: message.sender.id,
        sessionId: session.id,
        channel: message.channel,
        eventType: 'session_create',
        action: 'session.create',
        resource: session.id,
        outcome: 'allowed',
        securityMode: this.options.policyConfig?.securityMode ?? 'standard',
        details: {
          conversationId: message.conversation.id,
          messageId: message.channelMessageId,
        },
      });
    }

    // DLP scan before processing content
    if (messageText && this.dlp) {
      const scanResult = this.dlp.scan(messageText, message.channel);
      if (!scanResult.allowed) {
        void this.logAuditEvent({
          id: envelope.id,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: message.sender.id,
          sessionId: session.id,
          channel: message.channel,
          eventType: 'dlp_block',
          action: 'dlp.block',
          resource: message.channel,
          outcome: 'blocked',
          reason: scanResult.reason,
          securityMode,
          details: {
            findingsCount: scanResult.findings.length,
            action: scanResult.action,
          },
        });

        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: this.getReplyToMessageId(message),
          sessionId: session.id,
          content: {
            text: scanResult.reason ?? 'Message blocked by DLP policy.',
            format: 'markdown',
          },
        };

        await this.router.sendToChannel(outbound);
        return;
      }

      if (scanResult.action === 'redact' && scanResult.message) {
        messageText = scanResult.message;
      }

      if (scanResult.action === 'alert') {
        await this.logAuditEvent({
          id: envelope.id,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: message.sender.id,
          sessionId: session.id,
          channel: message.channel,
          eventType: 'dlp_scan',
          action: 'dlp.alert',
          resource: message.channel,
          outcome: 'allowed',
          reason: scanResult.reason,
          securityMode: this.options.policyConfig?.securityMode ?? 'standard',
          details: {
            findingsCount: scanResult.findings.length,
            action: scanResult.action,
          },
        });
      }
    }

    const commandOutcome = await this.handleContextCommand({
      message,
      session,
      securityMode,
      messageText,
    });

    if (commandOutcome?.handled) {
      if (commandOutcome.newSession) {
        session = commandOutcome.newSession;
      }

      if (commandOutcome.nextMessageText !== undefined) {
        messageText = commandOutcome.nextMessageText;
        if (message.content) {
          message.content.text = commandOutcome.nextMessageText;
        }
      }

      if (commandOutcome.replyText) {
        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: this.getReplyToMessageId(message),
          sessionId: session.id,
          content: {
            text: commandOutcome.replyText,
            format: 'markdown',
          },
        };

        await this.router.sendToChannel(outbound);

        if (commandOutcome.nextMessageText === undefined) {
          return;
        }
      }
    }

    // Add user message to session
    if (message.content.text) {
      this.sessionManager.addMessage(session.id, {
        role: 'user',
        content: message.content.text,
      });
    }

    const approvalText = message.content.text?.trim();
    if (approvalText && this.approvalManager) {
      const approveMatch = approvalText.match(/^\/approve\s+(\S+)$/i);
      const denyMatch = approvalText.match(/^\/deny\s+(\S+)(?:\s+(.+))?$/i);

      if (approveMatch) {
        const requestId = approveMatch[1];
        if (!requestId) {
          return;
        }

        const pending = this.approvalManager.getPendingRequest(requestId);
        if (!pending) {
          const outbound: ChannelOutboundMessage = {
            channel: message.channel,
            conversationId: message.conversation.id,
            replyToMessageId: message.channelMessageId,
            sessionId: session.id,
            content: {
              text: `⚠️ No pending approval found for ${requestId}.`,
              format: 'markdown',
            },
          };
          await this.router.sendToChannel(outbound);
          return;
        }

        if (pending.requesterUserId && pending.requesterUserId !== message.sender.id) {
          if (this.approvalAllowlist.has(message.sender.id ?? '')) {
            const approved = this.approvalManager.approve(requestId, message.sender.id);
            const outbound: ChannelOutboundMessage = {
              channel: message.channel,
              conversationId: message.conversation.id,
              replyToMessageId: message.channelMessageId,
              sessionId: session.id,
              content: {
                text: approved
                  ? `✅ Approved request ${requestId}.`
                  : `⚠️ No pending approval found for ${requestId}.`,
                format: 'markdown',
              },
            };
            await this.router.sendToChannel(outbound);
            return;
          }

          const outbound: ChannelOutboundMessage = {
            channel: message.channel,
            conversationId: message.conversation.id,
            replyToMessageId: message.channelMessageId,
            sessionId: session.id,
            content: {
              text: `⛔ You are not allowed to approve request ${requestId}.`,
              format: 'markdown',
            },
          };
          await this.router.sendToChannel(outbound);
          return;
        }

        const approved = this.approvalManager.approve(requestId, message.sender.id);
        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: message.channelMessageId,
          sessionId: session.id,
          content: {
            text: approved
              ? `✅ Approved request ${requestId}.`
              : `⚠️ No pending approval found for ${requestId}.`,
            format: 'markdown',
          },
        };
        await this.router.sendToChannel(outbound);
        return;
      }

      if (denyMatch) {
        const requestId = denyMatch[1];
        if (!requestId) {
          return;
        }

        const pending = this.approvalManager.getPendingRequest(requestId);
        if (!pending) {
          const outbound: ChannelOutboundMessage = {
            channel: message.channel,
            conversationId: message.conversation.id,
            replyToMessageId: message.channelMessageId,
            sessionId: session.id,
            content: {
              text: `⚠️ No pending approval found for ${requestId}.`,
              format: 'markdown',
            },
          };
          await this.router.sendToChannel(outbound);
          return;
        }

        if (pending.requesterUserId && pending.requesterUserId !== message.sender.id) {
          if (this.approvalAllowlist.has(message.sender.id ?? '')) {
            const reason = denyMatch[2] ?? 'Denied by approver';
            const denied = this.approvalManager.deny(requestId, reason, message.sender.id);
            const outbound: ChannelOutboundMessage = {
              channel: message.channel,
              conversationId: message.conversation.id,
              replyToMessageId: message.channelMessageId,
              sessionId: session.id,
              content: {
                text: denied
                  ? `⛔ Denied request ${requestId}.`
                  : `⚠️ No pending approval found for ${requestId}.`,
                format: 'markdown',
              },
            };
            await this.router.sendToChannel(outbound);
            return;
          }

          const outbound: ChannelOutboundMessage = {
            channel: message.channel,
            conversationId: message.conversation.id,
            replyToMessageId: message.channelMessageId,
            sessionId: session.id,
            content: {
              text: `⛔ You are not allowed to deny request ${requestId}.`,
              format: 'markdown',
            },
          };
          await this.router.sendToChannel(outbound);
          return;
        }

        const reason = denyMatch[2] ?? 'Denied by user';
        const denied = this.approvalManager.deny(requestId, reason, message.sender.id);
        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: message.channelMessageId,
          sessionId: session.id,
          content: {
            text: denied
              ? `⛔ Denied request ${requestId}.`
              : `⚠️ No pending approval found for ${requestId}.`,
            format: 'markdown',
          },
        };
        await this.router.sendToChannel(outbound);
        return;
      }
    }

    // Emit a processed message envelope
    const processedEnvelope = createEnvelope(
      'gateway',
      'message.processed',
      {
        sessionId: session.id,
        originalMessage: message,
      },
      envelope.id
    );

    // Publish the processed message (for further handling)
    await this.router.getBus().publish('nachos.gateway.processed', processedEnvelope);

    // Request LLM response and send back to channel
    if (this.options.streamingPassthrough) {
      this.streamingSessions.set(session.id, {
        inbound: message,
        buffer: '',
        lastSentAt: 0,
        lastSentLength: 0,
      });
    }

    const response = await this.requestLLMResponse(
      session.id,
      [],
      this.options.streamingPassthrough ?? false
    );
    await this.sendLLMResponse(message, session.id, response);
  }

  private resolveContextCommandConfig(): ResolvedContextCommandConfig {
    const config = this.contextCommandConfig ?? {};
    return {
      enabled: config.enabled ?? true,
      allowInDms: config.allow_in_dms ?? true,
      allowInChannels: config.allow_in_channels ?? false,
      adminAllowlist: new Set(config.admin_allowlist ?? []),
      resetTriggers: (config.reset_triggers ?? ['/new', '/reset']).filter(Boolean),
      contextTriggers: (config.context_triggers ?? ['/context']).filter(Boolean),
    };
  }

  private parseContextCommand(
    text: string,
    config: ResolvedContextCommandConfig
  ): { type: 'reset' | 'context'; trigger: string; remainder: string } | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const matchTrigger = (triggers: string[]) => {
      const normalizedText = trimmed.toLowerCase();
      for (const trigger of triggers) {
        const normalizedTrigger = trigger.trim().toLowerCase();
        if (!normalizedTrigger) continue;
        if (normalizedText === normalizedTrigger) {
          return { trigger: normalizedTrigger, remainder: '' };
        }
        if (normalizedText.startsWith(`${normalizedTrigger} `)) {
          const remainder = trimmed.slice(normalizedTrigger.length).trim();
          return { trigger: normalizedTrigger, remainder };
        }
      }
      return null;
    };

    const reset = matchTrigger(config.resetTriggers);
    if (reset) {
      return { type: 'reset', trigger: reset.trigger, remainder: reset.remainder };
    }

    const context = matchTrigger(config.contextTriggers);
    if (context) {
      return { type: 'context', trigger: context.trigger, remainder: context.remainder };
    }

    return null;
  }

  private getContextManagementOverride(session: Session | SessionWithMessages): boolean | null {
    const metadata = session.metadata as { contextManagement?: { enabled?: boolean } } | null;
    if (!metadata?.contextManagement) return null;
    const enabled = metadata.contextManagement.enabled;
    return typeof enabled === 'boolean' ? enabled : null;
  }

  private isContextManagementEnabledForSession(session: Session | SessionWithMessages): boolean {
    const override = this.getContextManagementOverride(session);
    if (override === false) return false;
    return true;
  }

  private async handleContextCommand(params: {
    message: ChannelInboundMessage;
    session: Session;
    securityMode: 'strict' | 'standard' | 'permissive';
    messageText: string;
  }): Promise<ContextCommandOutcome | null> {
    const { message, session, securityMode, messageText } = params;
    if (!messageText) return null;

    const config = this.resolveContextCommandConfig();
    if (!config.enabled) return null;

    const parsed = this.parseContextCommand(messageText, config);
    if (!parsed) return null;

    const isDm = message.conversation.type === 'dm';
    if (isDm && !config.allowInDms) {
      return {
        handled: true,
        replyText: 'Session commands are disabled in DMs.',
      };
    }
    if (!isDm && !config.allowInChannels) {
      return {
        handled: true,
        replyText: 'Session commands are disabled in channels.',
      };
    }

    if (config.adminAllowlist.size > 0 && !config.adminAllowlist.has(message.sender.id ?? '')) {
      return {
        handled: true,
        replyText: 'You are not allowed to run session commands here.',
      };
    }

    if (parsed.type === 'reset') {
      const newSession = await this.resetSessionForCommand(session, message, securityMode);
      if (parsed.remainder) {
        return {
          handled: true,
          newSession,
          nextMessageText: parsed.remainder,
        };
      }

      return {
        handled: true,
        newSession,
        replyText: '✅ New session started. You are on a clean slate.',
      };
    }

    const action = parsed.remainder.toLowerCase();
    const metadata = (session.metadata ?? {}) as Record<string, unknown>;
    const contextManagement =
      (metadata.contextManagement as Record<string, unknown> | undefined) ?? {};
    const currentOverride = this.getContextManagementOverride(session);
    const currentEnabled = this.isContextManagementEnabledForSession(session);

    if (!action || action === 'status') {
      const modeLabel = currentOverride === null ? 'default' : 'override';
      return {
        handled: true,
        replyText: `Context management is ${currentEnabled ? 'enabled' : 'disabled'} (${modeLabel}).`,
      };
    }

    if (['on', 'enable', 'enabled'].includes(action)) {
      contextManagement.enabled = true;
      contextManagement.updatedAt = new Date().toISOString();
      this.sessionManager.updateMetadata(session.id, {
        ...metadata,
        contextManagement,
      });
      return {
        handled: true,
        replyText: '✅ Context management enabled for this session.',
      };
    }

    if (['off', 'disable', 'disabled'].includes(action)) {
      contextManagement.enabled = false;
      contextManagement.updatedAt = new Date().toISOString();
      this.sessionManager.updateMetadata(session.id, {
        ...metadata,
        contextManagement,
      });
      return {
        handled: true,
        replyText: '⛔ Context management disabled for this session.',
      };
    }

    if (['auto', 'default', 'clear', 'reset'].includes(action)) {
      delete contextManagement.enabled;
      contextManagement.updatedAt = new Date().toISOString();
      const updatedMetadata = { ...metadata } as Record<string, unknown>;
      if (Object.keys(contextManagement).length === 0) {
        delete updatedMetadata.contextManagement;
      } else {
        updatedMetadata.contextManagement = contextManagement;
      }
      this.sessionManager.updateMetadata(session.id, updatedMetadata);
      return {
        handled: true,
        replyText: '🔁 Context management reset to default for this session.',
      };
    }

    return {
      handled: true,
      replyText: 'Unknown context command. Try `/context on`, `/context off`, or `/context status`.',
    };
  }

  private async resetSessionForCommand(
    session: Session,
    message: ChannelInboundMessage,
    securityMode: 'strict' | 'standard' | 'permissive'
  ): Promise<Session> {
    const previous = this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (previous) {
      this.sessionManager.deleteSession(previous.id);
      if (this.stateLayer) {
        try {
          await this.stateLayer.deleteSessionState(previous.id, {
            sessionId: previous.id,
            userId: previous.userId,
            securityMode,
            channel: previous.channel,
            internalTool: true,
          });
        } catch (error) {
          console.warn('[Gateway] Failed to delete session state during reset:', error);
        }
      }
    }

    const newSession = this.sessionManager.createSession({
      channel: message.channel,
      conversationId: message.conversation.id,
      userId: message.sender.id,
      systemPrompt: session.systemPrompt ?? this.options.defaultSystemPrompt,
      config: session.config,
    });

    await this.logAuditEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      instanceId: this.instanceId,
      userId: message.sender.id,
      sessionId: newSession.id,
      channel: message.channel,
      eventType: 'session_reset',
      action: 'session.reset',
      resource: newSession.id,
      outcome: 'allowed',
      securityMode,
      details: {
        previousSessionId: previous?.id,
        conversationId: message.conversation.id,
        messageId: message.channelMessageId,
      },
    });

    return newSession;
  }

  private async buildLLMRequest(
    sessionId: string,
    extraMessages: LLMRequestType['messages'] = [],
    stream: boolean = false
  ): Promise<LLMRequestType & { systemPromptTokens?: number; promptReport?: PromptReport }> {
    const session = this.sessionManager.getSessionWithMessages(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const messages: LLMRequestType['messages'] = [];
    const basePrompt = session.systemPrompt ?? this.options.defaultSystemPrompt ?? '';

    let prompt = basePrompt;
    let promptReport: PromptReport | undefined;
    let systemPromptTokens = 0;

    if (this.stateLayer) {
      const context = this.buildStateContext(session);
      const agentId = this.resolveAgentId(session);

      try {
        const identity = await this.stateLayer.getIdentity(agentId, context);
        const userProfile = session.userId
          ? await this.stateLayer.getUserProfile(agentId, session.userId, context)
          : null;
        const memory = await this.stateLayer.queryMemory({ agentId, limit: 200 }, context);
        const sessionState = await this.stateLayer.getSessionState(sessionId, context);

        const assembled = this.stateLayer.assemblePrompt({
          basePrompt,
          identity,
          userProfile,
          memoryEntries: memory.entries,
          memoryFacts: memory.facts,
          sessionState,
          skills: this.skillsPrompt,
        });

        prompt = assembled.prompt;
        promptReport = assembled.report;
        systemPromptTokens = assembled.report.totalTokens ?? 0;

        this.sessionManager.updateMetadata(sessionId, {
          promptReport: assembled.report,
          promptReportUpdatedAt: assembled.report.generatedAt,
        });
      } catch (error) {
        console.warn('[Gateway] Failed to assemble prompt with state layer:', error);
      }
    } else if (basePrompt) {
      systemPromptTokens = tokenEstimator.estimate(basePrompt);
    }

    if (prompt) {
      messages.push({ role: 'system', content: prompt });
    }

    for (const message of session.messages) {
      messages.push({ role: message.role, content: message.content });
    }

    if (extraMessages.length > 0) {
      messages.push(...extraMessages);
    }

    const tools = this.buildToolDefinitions(session);

    return {
      sessionId,
      messages,
      tools,
      options: {
        model: session.config?.model,
        maxTokens: session.config?.maxTokens,
        stream,
      },
      systemPromptTokens,
      promptReport,
    };
  }

  private async requestLLMResponse(
    sessionId: string,
    extraMessages: LLMRequestType['messages'] = [],
    stream: boolean = false
  ): Promise<LLMResponseType> {
    const request = await this.buildLLMRequest(sessionId, extraMessages, stream);
    const responseEnvelope = await this.router.sendLLMRequest(request);

    const envelope = responseEnvelope as MessageEnvelope;
    if (envelope && typeof envelope === 'object' && 'payload' in envelope) {
      return envelope.payload as LLMResponseType;
    }

    return responseEnvelope as LLMResponseType;
  }

  private resolveAgentId(session: Session): string {
    return session.userId ?? session.id;
  }

  private buildToolDefinitions(session: Session): LLMRequestType['tools'] {
    if (this.isSubagentSession(session)) {
      return undefined;
    }

    const tools: NonNullable<LLMRequestType['tools']> = [];

    if (this.subagentManager) {
      tools.push({
        name: 'sessions_spawn',
        description: 'Spawn a subagent to run a task and announce results back to the requester.',
        parameters: this.sanitizeToolSchema(SessionsSpawnToolSchema),
      });
      tools.push({
        name: 'subagents',
        description:
          'Internal tool: inspect subagent runs, fetch logs, and read subagent workspace files.',
        parameters: this.sanitizeToolSchema(SubagentsToolSchema),
      });
    }

    if (this.stateLayer) {
      tools.push({
        name: 'memory',
        description:
          'Internal state tool: query and curate durable memory entries and facts for the current user and agent.',
        parameters: this.sanitizeToolSchema(MemoryToolSchema),
      });
      tools.push({
        name: 'user_profile',
        description:
          'Internal state tool: read or update the curated profile for the current user (for personalization).',
        parameters: this.sanitizeToolSchema(UserProfileToolSchema),
      });
    }

    return tools.length > 0 ? tools : undefined;
  }

  private sanitizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    delete cloned.$id;
    return cloned;
  }

  private buildStateContext(session: Session): StateOperationContext {
    return {
      sessionId: session.id,
      userId: session.userId,
      securityMode: this.securityMode,
      channel: session.channel,
    };
  }

  private buildStateLayerDependencies(): StateLayerDependencies {
    return {
      instanceId: this.instanceId,
      policyCheck: async (request: StatePolicyRequest) => {
        const action = this.mapStateActionToPolicyAction(request.action);
        const result = this.evaluatePolicy({
          requestId: `state-${Date.now()}`,
          userId: request.userId ?? 'unknown',
          sessionId: request.sessionId,
          securityMode: request.securityMode,
          resource: {
            type: 'tool',
            id: request.resource ?? 'state',
          },
          action,
          metadata: {
            stateAction: request.action,
            ...request.metadata,
          },
          timestamp: new Date(),
        });

        return {
          allowed: result.allowed,
          reason: result.reason,
          ruleId: result.ruleId,
        };
      },
      auditLogger: async (event) => {
        await this.logAuditEvent(event);
      },
    };
  }

  private mapStateActionToPolicyAction(action: string): 'read' | 'write' | 'call' {
    if (action.includes('read') || action.includes('query')) {
      return 'read';
    }
    if (action.includes('write') || action.includes('append') || action.includes('delete')) {
      return 'write';
    }
    return 'call';
  }

  private async executeToolCalls(
    sessionId: string,
    toolCalls: Array<{ id: string; name: string; arguments: string }>
  ): Promise<LLMRequestType['messages']> {
    if (!this.toolCoordinator) {
      throw new Error('Tool coordinator not initialized');
    }

    const session = this.sessionManager.getSession(sessionId);

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
        toolGroup: this.resolveToolGroup(tc.name),
        sessionId,
        userId: session?.userId,
        parameters,
        securityMode: this.options.policyConfig?.securityMode ?? 'standard',
      };
    });

    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';

    const blockedResults: Array<{ index: number; result: ToolResult }> = [];
    const allowedCalls: Array<{ index: number; call: ToolCall }> = [];
    const localResults: Array<{ index: number; result: ToolResult }> = [];

    for (let i = 0; i < calls.length; i += 1) {
      const call = calls[i];
      if (!call) continue;

      if (this.isSubagentSession(session)) {
        const policy = this.evaluateSubagentToolPolicy(call.tool, session);
        if (!policy.allowed) {
          void this.logAuditEvent({
            id: `subagent-tool-policy-${call.id}`,
            timestamp: new Date().toISOString(),
            instanceId: this.instanceId,
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

      if (this.dlp) {
        const paramText = this.stringifyToolParameters(call.parameters);
        if (paramText) {
          const scanResult = this.dlp.scan(paramText, session?.channel);
          if (!scanResult.allowed) {
            void this.logAuditEvent({
              id: `dlp-tool-${call.id}`,
              timestamp: new Date().toISOString(),
              instanceId: this.instanceId,
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
            void this.logAuditEvent({
              id: `dlp-tool-alert-${call.id}`,
              timestamp: new Date().toISOString(),
              instanceId: this.instanceId,
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

      const localResult = await this.executeLocalToolCall(call, session);
      if (localResult) {
        localResults.push({ index: i, result: localResult });
        continue;
      }

      if (this.sandboxManager) {
        const sandboxDecision = this.sandboxManager.resolveToolSandbox(session);
        if (sandboxDecision.enabled && sandboxDecision.config) {
          call.sandbox = sandboxDecision.config;
        }
      }

      allowedCalls.push({ index: i, call });
    }

    const results: ToolResult[] = new Array(calls.length);

    for (const blocked of blockedResults) {
      results[blocked.index] = blocked.result;
    }

    for (const local of localResults) {
      results[local.index] = local.result;
    }

    const executedResults = allowedCalls.length
      ? await this.toolCoordinator.executeTools(allowedCalls.map((item) => item.call))
      : [];

    for (let i = 0; i < allowedCalls.length; i += 1) {
      const allowed = allowedCalls[i];
      if (!allowed) continue;
      results[allowed.index] = executedResults[i] as ToolResult;
    }

    // Apply DLP to tool results
    if (this.dlp) {
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
          results[i] = {
            ...result,
            content: scanned.redactedContent,
          };
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
          content: [
            {
              type: 'tool_result',
              tool_use_id: `missing-${i}`,
              tool_result: result,
            },
          ],
        };
      }

      // Extract result data from content blocks
      let resultData: unknown = {};
      if (result.success && result.content.length > 0) {
        // If single text block, try to parse as JSON
        const firstBlock = result.content[0];
        if (result.content.length === 1 && firstBlock && firstBlock.type === 'text') {
          try {
            resultData = JSON.parse(firstBlock.text);
          } catch {
            resultData = firstBlock.text;
          }
        } else {
          // Multiple content blocks, return structured
          resultData = { content: result.content, metadata: result.metadata };
        }
      } else if (result.error) {
        resultData = result.error;
      }

      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            tool_result: resultData,
          },
        ],
      };
    });

    return toolMessages;
  }

  private async executeLocalToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult | null> {
    if (call.tool === 'sessions_spawn') {
      if (!this.subagentOrchestrator) {
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

      const label = this.readOptionalString(call.parameters.label);
      const profile = this.readOptionalString(call.parameters.profile);
      const agentId = this.readOptionalString(call.parameters.agentId);
      const model = this.readOptionalString(call.parameters.model);
      const thinking = this.readOptionalString(call.parameters.thinking);
      const cleanup = this.readCleanup(call.parameters.cleanup);
      const timeoutMs = this.readTimeoutMs(call.parameters.runTimeoutSeconds);

      const runRequest: SubagentRunRequest = {
        task,
        label,
        profile,
        agentId,
        model,
        thinking,
        cleanup,
        timeoutMs,
        sessionConfig: session.config,
        requester: {
          sessionId: session.id,
          channel: session.channel,
          conversationId: session.conversationId,
          userId: session.userId,
        },
      };

      const run = await this.subagentOrchestrator.enqueue(runRequest);

      const payload = {
        status: 'accepted',
        runId: run.runId,
        childSessionId: run.childSessionId,
      };

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    }

    if (call.tool === 'subagents') {
      return this.executeSubagentsToolCall(call, session);
    }

    if (call.tool === 'memory') {
      return this.executeMemoryToolCall(call, session);
    }

    if (call.tool === 'user_profile') {
      return this.executeUserProfileToolCall(call, session);
    }

    return null;
  }

  private async executeMemoryToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (!this.stateLayer) {
      return this.formatToolError('STATE_LAYER_DISABLED', 'State layer is not configured');
    }

    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory tool');
    }

    const action = this.readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    const agentId = this.resolveAgentId(session);
    const context = { ...this.buildStateContext(session), internalTool: true };
    const allowedKinds = new Set(['summary', 'preference', 'fact', 'decision', 'task', 'issue']);

    if (action === 'query') {
      const kinds = this.readOptionalStringArray(call.parameters.kinds);
      const tags = this.readOptionalStringArray(call.parameters.tags);
      const text = this.readOptionalString(call.parameters.text);
      const limit = this.readOptionalNumber(call.parameters.limit, { min: 1 });
      const offset = this.readOptionalNumber(call.parameters.offset, { min: 0 });

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

      const result = await this.stateLayer.queryMemory(
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
      const kind = this.readOptionalString(call.parameters.kind);
      const content = this.readOptionalString(call.parameters.content);
      if (!kind || !content) {
        return this.formatToolError('INVALID_PARAMETERS', 'kind and content are required');
      }

      if (!allowedKinds.has(kind)) {
        return this.formatToolError('INVALID_PARAMETERS', `unsupported memory kind: ${kind}`);
      }

      const tags = this.readOptionalStringArray(call.parameters.tags) ?? undefined;
      const confidence = this.readOptionalNumber(call.parameters.confidence, { min: 0, max: 1 });
      const expiresAt = this.readOptionalString(call.parameters.expiresAt);

      const entry = await this.stateLayer.appendMemoryEntry(
        {
          id: randomUUID(),
          agentId,
          kind: kind as 'summary' | 'preference' | 'fact' | 'decision' | 'task' | 'issue',
          content,
          tags,
          confidence,
          provenance: {
            source: 'tool.memory',
            sessionId: session.id,
          },
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
          if (!fact || typeof fact !== 'object') {
            return null;
          }
          const subject = this.readOptionalString((fact as { subject?: unknown }).subject);
          const predicate = this.readOptionalString((fact as { predicate?: unknown }).predicate);
          const object = this.readOptionalString((fact as { object?: unknown }).object);
          if (!subject || !predicate || !object) {
            return null;
          }
          const confidence = this.readOptionalNumber(
            (fact as { confidence?: unknown }).confidence,
            { min: 0, max: 1 }
          );
          const sourceEntryId = this.readOptionalString(
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

      const stored = await this.stateLayer.appendMemoryFacts(facts, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ facts: stored }, null, 2) }],
      };
    }

    if (action === 'delete_entry') {
      const id = this.readOptionalString(call.parameters.id);
      if (!id) {
        return this.formatToolError('INVALID_PARAMETERS', 'id is required');
      }

      await this.stateLayer.deleteMemoryEntry(id, agentId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown memory action: ${action}`);
  }

  private async executeUserProfileToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (!this.stateLayer) {
      return this.formatToolError('STATE_LAYER_DISABLED', 'State layer is not configured');
    }

    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for user profile tool');
    }

    const userId = session.userId;
    if (!userId) {
      return this.formatToolError('INVALID_PARAMETERS', 'userId is not available for this session');
    }

    const action = this.readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    const agentId = this.resolveAgentId(session);
    const context = { ...this.buildStateContext(session), internalTool: true };

    if (action === 'get') {
      const profile = await this.stateLayer.getUserProfile(agentId, userId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile }, null, 2) }],
      };
    }

    if (action === 'set') {
      const profileText = this.readOptionalString(call.parameters.profile);
      if (!profileText) {
        return this.formatToolError('INVALID_PARAMETERS', 'profile is required');
      }

      const current = await this.stateLayer.getUserProfile(agentId, userId, context);
      const stored = await this.stateLayer.putUserProfile(
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
      await this.stateLayer.deleteUserProfile(agentId, userId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown user_profile action: ${action}`);
  }

  private async executeSubagentsToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (!this.subagentOrchestrator) {
      return this.formatToolError('SUBAGENT_DISABLED', 'Subagent orchestration is not configured');
    }

    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for subagent tool');
    }

    const action = this.readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    if (action === 'list') {
      const runs = this.filterSubagentRunsForSession(session, this.listSubagents());
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ runs }, null, 2) }],
      };
    }

    const runId = this.readOptionalString(call.parameters.runId);
    if (!runId) {
      return this.formatToolError('INVALID_PARAMETERS', 'runId is required');
    }

    const run = this.getSubagentInfo(runId);
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
      const limit = this.readOptionalNumber(call.parameters.limit, { min: 1 }) ?? 50;
      const log = this.getSubagentLog(runId);
      const messages = log?.messages ?? [];
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
      const workspaceDir = this.subagentOrchestrator.getRunWorkspaceDir(runId);
      if (!workspaceDir) {
        return this.formatToolError('NOT_FOUND', 'Subagent workspace not available');
      }

      const entries = await listSubagentWorkspaceEntries({
        rootDir: workspaceDir,
        relativePath: this.readOptionalString(call.parameters.path),
        recursive: Boolean(call.parameters.recursive),
        limit: this.readOptionalNumber(call.parameters.limit, { min: 1 }) ?? 200,
      });

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ runId, entries }, null, 2) }],
      };
    }

    if (action === 'files_get') {
      const workspaceDir = this.subagentOrchestrator.getRunWorkspaceDir(runId);
      if (!workspaceDir) {
        return this.formatToolError('NOT_FOUND', 'Subagent workspace not available');
      }

      const relativePath = this.readOptionalString(call.parameters.path);
      if (!relativePath) {
        return this.formatToolError('INVALID_PARAMETERS', 'path is required');
      }

      const maxBytes = this.readOptionalNumber(call.parameters.maxBytes, { min: 1 }) ?? 65536;
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

    return this.formatToolError('INVALID_PARAMETERS', `unknown subagents action: ${action}`);
  }

  private formatToolError(code: string, message: string, details?: unknown): ToolResult {
    return {
      success: false,
      content: [],
      error: {
        code,
        message,
        details,
      },
    };
  }

  private canAccessSubagentRun(session: Session, run: SubagentRunRecord): boolean {
    if (session.id === run.requester.sessionId) {
      return true;
    }
    if (session.userId && run.requester.userId && session.userId === run.requester.userId) {
      return true;
    }
    return false;
  }

  private filterSubagentRunsForSession(
    session: Session,
    runs: SubagentRunRecord[]
  ): SubagentRunRecord[] {
    return runs.filter((run) => this.canAccessSubagentRun(session, run));
  }

  private isSubagentSession(session: Session | null): boolean {
    if (!session?.metadata) {
      return false;
    }
    return 'subagent' in session.metadata;
  }

  private normalizeToolName(tool: string): string {
    return tool.trim().toLowerCase();
  }

  private buildToolGroupMap(groups?: Record<string, ToolGroupConfig>): Map<string, string> {
    const map = new Map<string, string>();
    const applyGroup = (groupName: string, tools: string[]) => {
      for (const tool of tools) {
        const normalized = this.normalizeToolName(tool);
        if (normalized.length > 0) {
          map.set(normalized, groupName);
        }
      }
    };

    for (const [groupName, tools] of Object.entries(DEFAULT_TOOL_GROUPS)) {
      applyGroup(groupName, tools);
    }

    if (!groups) {
      return map;
    }

    for (const [groupName, config] of Object.entries(groups)) {
      if (!config || !Array.isArray(config.tools)) {
        continue;
      }
      if (config.enabled === false) {
        for (const tool of config.tools) {
          map.delete(this.normalizeToolName(tool));
        }
        continue;
      }
      applyGroup(groupName, config.tools);
    }

    return map;
  }

  private resolveToolGroup(tool: string): string | undefined {
    const normalized = this.normalizeToolName(tool);
    return this.toolGroupMap.get(normalized);
  }

  private resolveSubagentProfile(session: Session | null): string | undefined {
    const defaultProfile = this.readOptionalString(this.subagentToolPolicy?.default_profile);
    if (!session?.metadata || typeof session.metadata !== 'object') {
      return defaultProfile;
    }

    const metadata = session.metadata as { subagent?: { profile?: string } };
    const profile = this.readOptionalString(metadata.subagent?.profile);
    return profile ?? defaultProfile;
  }

  private resolveSubagentProfilePolicy(profile?: string): SubagentToolProfileConfig | undefined {
    const profiles = this.subagentToolPolicy?.profiles;
    if (!profile || !profiles) {
      return undefined;
    }

    if (profiles[profile]) {
      return profiles[profile];
    }

    const normalized = this.normalizeToolName(profile);
    const match = Object.entries(profiles).find(
      ([name]) => this.normalizeToolName(name) === normalized
    );
    return match?.[1];
  }

  private evaluateSubagentToolPolicy(
    tool: string,
    session?: Session | null
  ): { allowed: boolean; reason?: string } {
    const normalized = this.normalizeToolName(tool);
    const policy = this.subagentToolPolicy;
    const profileName = this.resolveSubagentProfile(session ?? null);
    const profilePolicy = this.resolveSubagentProfilePolicy(profileName);
    const denyList = new Set(
      [
        ...DEFAULT_SUBAGENT_DENY_TOOLS,
        ...(policy?.deny ?? []).map((entry) => this.normalizeToolName(entry)),
        ...(profilePolicy?.deny ?? []).map((entry) => this.normalizeToolName(entry)),
      ].filter((entry) => entry.length > 0)
    );

    if (denyList.has(normalized)) {
      return { allowed: false, reason: `Tool blocked for subagents: ${tool}` };
    }

    const allowListSource =
      profilePolicy?.allow && profilePolicy.allow.length > 0
        ? profilePolicy.allow
        : (policy?.allow ?? []);
    const allow = allowListSource.map((entry) => this.normalizeToolName(entry));
    if (allow.length > 0 && !allow.includes(normalized)) {
      const profileSuffix = profileName ? ` (profile: ${profileName})` : '';
      return {
        allowed: false,
        reason: `Tool not allowlisted for subagents${profileSuffix}: ${tool}`,
      };
    }

    return { allowed: true };
  }

  private buildSandboxDecisionSamples(): {
    main: { enabled: boolean; config?: unknown };
    subagent: { enabled: boolean; config?: unknown };
  } | null {
    if (!this.sandboxManager) {
      return null;
    }

    const now = new Date().toISOString();
    const mainSession: Session = {
      id: 'sandbox-main',
      channel: 'internal',
      conversationId: 'sandbox-main',
      userId: 'system',
      status: 'active',
      config: {},
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    const subagentSession: Session = {
      ...mainSession,
      id: 'sandbox-subagent',
      conversationId: 'sandbox-subagent',
      metadata: { subagent: { runId: 'sandbox' } },
    };

    return {
      main: this.sandboxManager.resolveToolSandbox(mainSession),
      subagent: this.sandboxManager.resolveToolSandbox(subagentSession),
    };
  }

  private readOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readOptionalStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
      return null;
    }
    const items = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : null;
  }

  private readOptionalNumber(
    value: unknown,
    limits?: { min?: number; max?: number }
  ): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    if (limits?.min !== undefined && value < limits.min) {
      return undefined;
    }
    if (limits?.max !== undefined && value > limits.max) {
      return undefined;
    }
    return value;
  }

  private readTimeoutMs(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    const rounded = Math.floor(value);
    if (rounded <= 0) {
      return undefined;
    }
    return rounded * 1000;
  }

  private readCleanup(value: unknown): 'delete' | 'keep' | undefined {
    if (value === 'delete' || value === 'keep') {
      return value;
    }
    return undefined;
  }

  private async sendLLMResponse(
    inbound: ChannelInboundMessage,
    sessionId: string,
    response: LLMResponseType
  ): Promise<void> {
    const content = response.success ? response.message?.content : response.error?.message;
    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';
    const responseText = this.coerceLLMContentText(content);
    const toolCalls = response.success ? response.toolCalls : undefined;

    if (toolCalls && toolCalls.length > 0) {
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: responseText,
        toolCalls,
      });

      const toolMessages = await this.executeToolCalls(sessionId, toolCalls);
      const followUp = await this.requestLLMResponse(sessionId, toolMessages);
      await this.sendLLMResponse(inbound, sessionId, followUp);
      return;
    }

    if (this.salsa) {
      const policyResult = this.salsa.evaluate({
        requestId: `${sessionId}-outbound-${Date.now()}`,
        userId: inbound.sender.id,
        sessionId,
        securityMode,
        resource: {
          type: inbound.conversation.type === 'dm' ? 'dm' : 'channel',
          id: inbound.channel,
        },
        action: 'send',
        metadata: {
          channel: inbound.channel,
          conversationId: inbound.conversation.id,
          conversationType: inbound.conversation.type,
          replyToMessageId: inbound.channelMessageId,
          userId: inbound.sender.id,
        },
        timestamp: new Date(),
      });

      if (!policyResult.allowed) {
        void this.logAuditEvent({
          id: `${sessionId}-policy-outbound-${Date.now()}`,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: inbound.sender.id,
          sessionId,
          channel: inbound.channel,
          eventType: 'policy_check',
          action: 'policy.send',
          resource: inbound.channel,
          outcome: 'denied',
          reason: policyResult.reason,
          securityMode,
          policyMatched: policyResult.ruleId,
        });
        return;
      }
    }

    if (responseText) {
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: responseText,
      });
    } else {
      return;
    }

    const outbound: ChannelOutboundMessage = {
      channel: inbound.channel,
      conversationId: inbound.conversation.id,
      replyToMessageId: this.getReplyToMessageId(inbound),
      sessionId,
      content: {
        text: responseText,
        format: 'markdown',
      },
    };

    await this.router.sendToChannel(outbound);
  }

  private stringifyToolParameters(parameters: Record<string, unknown>): string {
    try {
      return JSON.stringify(parameters);
    } catch {
      return '';
    }
  }

  private coerceLLMContentText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== 'object' || !('text' in part)) {
            return '';
          }
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        })
        .filter((text) => text.length > 0)
        .join('');
    }

    return '';
  }

  private getReplyToMessageId(message: ChannelInboundMessage): string | undefined {
    const metadata = message.metadata as { thread_ts?: string } | undefined;
    return metadata?.thread_ts ?? message.channelMessageId;
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
    if (!this.dlp || result.content.length === 0) {
      return { allowed: true };
    }

    const redactedContent: ToolResult['content'] = [];
    let blocked = false;
    let blockReason: string | undefined;

    for (const block of result.content) {
      if (block.type !== 'text') {
        redactedContent.push(block);
        continue;
      }

      const scanResult = this.dlp.scan(block.text, session?.channel);
      if (!scanResult.allowed) {
        blocked = true;
        blockReason = scanResult.reason;
        void this.logAuditEvent({
          id: `dlp-tool-result-${Date.now()}`,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
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
        redactedContent.push({
          ...block,
          text: scanResult.message,
        });
      } else {
        redactedContent.push(block);
      }

      if (scanResult.action === 'alert') {
        void this.logAuditEvent({
          id: `dlp-tool-result-alert-${Date.now()}`,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
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
    }

    if (blocked) {
      return { allowed: false, reason: blockReason };
    }

    return redactedContent.length > 0 ? { allowed: true, redactedContent } : { allowed: true };
  }

  private async registerManagementHandlers(): Promise<void> {
    const bus = this.router.getBus();
    if (!(bus instanceof NatsBusAdapter)) {
      return;
    }

    const client = bus.getClient();
    const respondError = (respond: (data: unknown) => boolean, error: Error) => {
      respond({
        ok: false,
        error: {
          code: 'GATEWAY_REQUEST_ERROR',
          message: error.message,
        },
      });
    };

    await client.subscribe(TOPICS.gateway.subagents.list, async (msg, raw) => {
      try {
        const payload = msg.payload as { limit?: number };
        const runs = this.listSubagents();
        const limit = payload?.limit && payload.limit > 0 ? Math.floor(payload.limit) : undefined;
        const items = limit ? runs.slice(0, limit) : runs;
        raw.respond({ ok: true, data: { runs: items, total: runs.length } });
      } catch (error) {
        respondError(raw.respond, error as Error);
      }
    });

    await client.subscribe(TOPICS.gateway.subagents.spawn, async (msg, raw) => {
      try {
        if (!this.subagentOrchestrator) {
          throw new Error('Subagent execution is not configured');
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
          throw new Error('task is required');
        }

        const runRequest: SubagentRunRequest = {
          task,
          label: this.readOptionalString(payload.label),
          profile: this.readOptionalString(payload.profile),
          agentId: this.readOptionalString(payload.agentId),
          model: this.readOptionalString(payload.model),
          thinking: this.readOptionalString(payload.thinking),
          cleanup: this.readCleanup(payload.cleanup),
          timeoutMs: this.readTimeoutMs(payload.runTimeoutSeconds),
          requester: {
            sessionId: this.readOptionalString(payload.sessionId) ?? 'cli',
            channel: this.readOptionalString(payload.channel) ?? 'cli',
            conversationId: this.readOptionalString(payload.conversationId) ?? 'cli',
            replyToMessageId: this.readOptionalString(payload.replyToMessageId),
            userId: this.readOptionalString(payload.userId),
          },
        };

        const run = await this.subagentOrchestrator.enqueue(runRequest);
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
        const run = runId ? this.getSubagentInfo(runId) : null;
        raw.respond({ ok: true, data: { run } });
      } catch (error) {
        respondError(raw.respond, error as Error);
      }
    });

    await client.subscribe(TOPICS.gateway.subagents.stop, async (msg, raw) => {
      try {
        const payload = msg.payload as { runId?: string };
        const runId = typeof payload?.runId === 'string' ? payload.runId : '';
        const ok = runId ? this.stopSubagent(runId) : false;
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
        const log = runId ? this.getSubagentLog(runId) : null;
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
          throw new Error('runId is required');
        }
        const workspaceDir = this.subagentOrchestrator?.getRunWorkspaceDir(runId);
        if (!workspaceDir) {
          throw new Error('Subagent workspace not available');
        }

        const entries = await listSubagentWorkspaceEntries({
          rootDir: workspaceDir,
          relativePath: this.readOptionalString(payload.path),
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
        const relativePath = this.readOptionalString(payload?.path);
        if (!runId || !relativePath) {
          throw new Error('runId and path are required');
        }
        const workspaceDir = this.subagentOrchestrator?.getRunWorkspaceDir(runId);
        if (!workspaceDir) {
          throw new Error('Subagent workspace not available');
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

    await client.subscribe(TOPICS.gateway.sandbox.explain, async (_msg, raw) => {
      try {
        raw.respond({
          ok: true,
          data: {
            config: this.options.toolSandboxConfig ?? null,
            decisions: this.buildSandboxDecisionSamples(),
          },
        });
      } catch (error) {
        respondError(raw.respond, error as Error);
      }
    });

    await client.subscribe(TOPICS.gateway.sandbox.list, async (_msg, raw) => {
      try {
        const runs = this.listSubagents();
        raw.respond({
          ok: true,
          data: {
            config: this.options.toolSandboxConfig ?? null,
            decisions: this.buildSandboxDecisionSamples(),
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

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
    if (this.options.auditConfig?.enabled) {
      const provider = await loadAuditProvider(this.options.auditConfig);
      this.auditLogger = new AuditLogger(provider);
      await this.auditLogger.init();
    }

    if (this.dlpConfig) {
      this.dlp = new DLPSecurityLayer(this.dlpConfig, this.auditLogger ?? undefined);
      console.log('[Gateway] DLP security layer initialized');
    }

    // Initialize tool infrastructure
    this.approvalManager = new ApprovalManager();
    this.toolCache = new ToolCache();

    // Initialize local tool handler for gateway-integrated tools (exec/shell)
    const { LocalToolHandler } = await import('./tools/local-tool-handler.js');
    const localToolHandler = new LocalToolHandler({
      logger: {
        info: (...args: unknown[]) => console.log('[LocalTools]', ...args),
        warn: (...args: unknown[]) => console.warn('[LocalTools]', ...args),
        error: (...args: unknown[]) => console.error('[LocalTools]', ...args),
      },
    });
    console.log('[Gateway] Local tool handler initialized (exec/shell)');

    // Load skills for system prompt
    try {
      const { loadSkills, formatSkillsForPrompt } = await import('./skills/skill-loader.js');
      const { join } = await import('path');
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');

      // Resolve skills directory (relative to gateway package)
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const skillsDir = join(currentDir, '..', '..', '..', '..', 'skills');

      const skills = loadSkills({ skillsDir });
      if (skills.length > 0) {
        this.skillsPrompt = formatSkillsForPrompt(skills);
        console.log(`[Gateway] Loaded ${skills.length} skills for LLM prompt`);
      } else {
        console.warn('[Gateway] No skills loaded');
      }
    } catch (error) {
      console.error('[Gateway] Failed to load skills:', error);
    }

    this.toolCoordinator = new ToolCoordinator({
      bus: this.router.getBus(),
      salsa: this.salsa ?? undefined,
      cache: this.toolCache,
      approvalManager: this.approvalManager,
      securityMode: this.options.policyConfig?.securityMode ?? 'standard',
      localToolHandler,
    });
    console.log('[Gateway] Tool coordinator initialized');

    this.approvalManager.on('approval-requested', async (request) => {
      const session = this.sessionManager.getSession(request.sessionId);
      if (!session) {
        console.warn(`[Gateway] Approval request for unknown session: ${request.sessionId}`);
        return;
      }

      const outbound: ChannelOutboundMessage = {
        channel: session.channel,
        conversationId: session.conversationId,
        sessionId: request.sessionId,
        content: {
          text: this.approvalManager?.formatApprovalMessage(request) ?? 'Approval required.',
          format: 'markdown',
        },
      };

      await this.router.sendToChannel(outbound);
    });

    if (this.options.streamingPassthrough) {
      await this.router.getBus().subscribe('nachos.llm.stream.*', async (data) => {
        const chunk = data as { sessionId?: string; type?: string; delta?: string };
        if (!chunk.sessionId) return;
        const state = this.streamingSessions.get(chunk.sessionId);
        if (!state) return;

        if (chunk.type === 'done') {
          this.streamingSessions.delete(chunk.sessionId);
          return;
        }

        if (chunk.type === 'delta' && chunk.delta) {
          state.buffer += chunk.delta;
          const now = Date.now();
          const minInterval = this.options.streamingMinIntervalMs ?? 500;
          const chunkSize = this.options.streamingChunkSize ?? 200;
          const shouldSend =
            state.buffer.length - state.lastSentLength >= chunkSize &&
            now - state.lastSentAt >= minInterval;

          if (shouldSend) {
            state.lastSentAt = now;
            state.lastSentLength = state.buffer.length;
            const outbound: ChannelOutboundMessage = {
              channel: state.inbound.channel,
              conversationId: state.inbound.conversation.id,
              replyToMessageId: state.inbound.channelMessageId,
              sessionId: chunk.sessionId,
              content: {
                text: state.buffer,
                format: 'markdown',
              },
              options: {
                ephemeral: true,
              },
            };
            await this.router.sendToChannel(outbound);
          }
        }
      });
    }

    await this.registerManagementHandlers();

    this.startMemoryPipelineScheduler();
    await this.router.getBus().subscribe(TOPICS.config.update, async (data) => {
      await this.handleConfigUpdate(data);
    });

    // Create health server
    const healthDeps: HealthCheckDeps = {
      checkDatabase: () => {
        try {
          this.storage.listSessions({ limit: 1 });
          return true;
        } catch {
          return false;
        }
      },
      checkBus: () => this.isConnected,
    };

    this.healthServer = createHealthServer({
      port: this.options.healthPort ?? 8081,
      componentName: 'gateway',
      deps: healthDeps,
    });

    await this.healthServer.start();

    // Subscribe to configured channels
    if (this.options.channels) {
      for (const channel of this.options.channels) {
        await this.router.subscribeToChannel(channel);
      }
    }

    this.isConnected = true;
    console.log('Gateway started');
  }

  private async handleConfigUpdate(data: unknown): Promise<void> {
    const { envelopeId, payload } = this.extractEnvelopePayload(data);
    const update = payload as {
      requestId?: string;
      actor?: {
        userId?: string;
        channel?: string;
        serverId?: string;
        conversationId?: string;
      };
      changes?: Record<string, unknown>;
      reason?: string;
      dryRun?: boolean;
    };

    const requestId = update?.requestId ?? envelopeId ?? randomUUID();
    const actor = update?.actor;
    const userId = actor?.userId ?? 'unknown';
    const channel = actor?.channel ?? 'system';
    const conversationId = actor?.conversationId ?? requestId;

    const emitResult = async (response: {
      requestId: string;
      success: boolean;
      message?: string;
      errors?: string[];
    }) => {
      const envelope = createEnvelope(this.instanceId, 'config.updated', response, envelopeId);
      await this.router.getBus().publish(TOPICS.config.updated, envelope);
    };

    if (!update || !update.changes || typeof update.changes !== 'object') {
      await emitResult({
        requestId,
        success: false,
        message: 'Invalid config update payload.',
        errors: ['Missing changes payload'],
      });
      return;
    }

    let baseConfig: NachosConfig;
    try {
      baseConfig = loadAndValidateConfig({
        configPath: process.env.NACHOS_CONFIG_PATH,
        applyRuntime: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitResult({
        requestId,
        success: false,
        message: 'Failed to load base configuration.',
        errors: [message],
      });
      return;
    }

    const stateDir = resolveRuntimeStateDir(baseConfig);
    const currentOverlay = loadRuntimeOverlay(stateDir) as PartialNachosConfig;
    const mergedOverlay = this.mergeConfigOverlay(
      currentOverlay as Record<string, unknown>,
      update.changes
    ) as PartialNachosConfig;

    try {
      const candidate = applyRuntimeOverlay(baseConfig, mergedOverlay);
      validateConfigOrThrow(candidate);

      if (!update.dryRun) {
        saveRuntimeOverlay(stateDir, mergedOverlay);
      }

      await emitResult({
        requestId,
        success: true,
        message: update.dryRun ? 'Config update validated.' : 'Config update applied.',
      });

      await this.logAuditEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId,
        userId,
        sessionId: conversationId,
        channel,
        eventType: 'config_update',
        action: 'config.update',
        resource: requestId,
        outcome: 'allowed',
        securityMode: this.options.policyConfig?.securityMode ?? 'standard',
        details: {
          serverId: actor?.serverId,
          reason: update.reason,
          dryRun: update.dryRun ?? false,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitResult({
        requestId,
        success: false,
        message: 'Config update rejected.',
        errors: [message],
      });

      await this.logAuditEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId,
        userId,
        sessionId: conversationId,
        channel,
        eventType: 'config_update',
        action: 'config.update',
        resource: requestId,
        outcome: 'denied',
        reason: message,
        securityMode: this.options.policyConfig?.securityMode ?? 'standard',
        details: {
          serverId: actor?.serverId,
          reason: update.reason,
          dryRun: update.dryRun ?? false,
        },
      });
    }
  }

  /**
   * Stop the gateway
   */
  async stop(): Promise<void> {
    this.isConnected = false;

    // Remove signal handlers
    this.removeSignalHandlers();

    if (this.healthServer && this.healthServer.server.listening) {
      await this.healthServer.stop();
    }

    // Cleanup Salsa
    if (this.salsa) {
      this.salsa.destroy();
    }

    if (this.auditLogger) {
      await this.auditLogger.close();
      this.auditLogger = null;
    }
    if (this.rateLimiter) {
      await this.rateLimiter.shutdown();
    }

    if (this.memoryPipelineInterval) {
      clearInterval(this.memoryPipelineInterval);
      this.memoryPipelineInterval = undefined;
    }

    if (this.stateLayer) {
      await this.stateLayer.close();
    }

    if (this.subagentOrchestrator) {
      await this.subagentOrchestrator.shutdown();
    }

    this.storage.close();
    console.log('Gateway stopped');
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    const sigintHandler = () => shutdown('SIGINT');
    const sigtermHandler = () => shutdown('SIGTERM');

    process.on('SIGINT', sigintHandler);
    process.on('SIGTERM', sigtermHandler);

    // Store handlers for cleanup
    this.shutdownHandlers.push(
      () => process.removeListener('SIGINT', sigintHandler),
      () => process.removeListener('SIGTERM', sigtermHandler)
    );
  }

  /**
   * Remove signal handlers (for testing)
   */
  private removeSignalHandlers(): void {
    this.shutdownHandlers.forEach((handler) => handler());
    this.shutdownHandlers = [];
  }

  /**
   * Get the session manager
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get the router
   */
  getRouter(): Router {
    return this.router;
  }

  /**
   * Log an audit event when audit logging is enabled.
   */
  async logAuditEvent(event: AuditEvent): Promise<void> {
    if (!this.auditLogger) {
      return;
    }
    await this.auditLogger.log(event);
  }

  private startMemoryPipelineScheduler(): void {
    const memoryPipeline = this.memoryPipeline;
    if (!memoryPipeline) return;
    const intervalMs = memoryPipeline.getPeriodicIntervalMs();
    if (!intervalMs) return;

    this.memoryPipelineInterval = setInterval(async () => {
      try {
        const sessions = this.sessionManager.listSessions({ status: 'active' });
        for (const session of sessions) {
          if (!this.isContextManagementEnabledForSession(session)) {
            continue;
          }
          const context = this.buildStateContext(session);
          const shouldRun = await memoryPipeline.shouldRunPeriodic(session, context);
          if (!shouldRun) continue;

          const withMessages = this.sessionManager.getSessionWithMessages(session.id);
          if (!withMessages) continue;

          await memoryPipeline.handleExtraction({
            session,
            messages: withMessages.messages,
            context,
            trigger: 'periodic',
          });
        }
      } catch (error) {
        console.warn('[Gateway] Periodic memory extraction failed:', error);
      }
    }, intervalMs);
  }

  /**
   * Get the state storage
   */
  getStorage(): StateStorage {
    return this.storage;
  }

  /**
   * Get health status
   */
  getHealth() {
    const health = performHealthCheck({
      checkDatabase: () => {
        try {
          this.storage.listSessions({ limit: 1 });
          return true;
        } catch {
          return false;
        }
      },
      checkBus: () => this.isConnected,
    });

    // Add Salsa statistics if available
    if (this.salsa) {
      const salsaStats = this.salsa.getStats();
      return {
        ...health,
        salsa: {
          policiesLoaded: salsaStats.policiesLoaded,
          rulesActive: salsaStats.rulesActive,
          hasErrors: this.salsa.hasValidationErrors(),
        },
      };
    }

    return health;
  }

  /**
   * Execute a subagent task (host or sandboxed).
   */
  async runSubagent(task: SubagentTask): Promise<SubagentResult> {
    if (!this.subagentManager) {
      return {
        success: false,
        error: {
          code: 'SUBAGENT_DISABLED',
          message: 'Subagent execution is not configured',
        },
        durationMs: 0,
        sandboxed: false,
      };
    }

    return this.subagentManager.run(task);
  }

  async spawnSubagent(request: SubagentRunRequest): Promise<SubagentRunRecord> {
    if (!this.subagentOrchestrator) {
      throw new Error('Subagent orchestration is not configured');
    }

    return this.subagentOrchestrator.enqueue(request);
  }

  listSubagents(): SubagentRunRecord[] {
    return this.subagentOrchestrator?.listRuns() ?? [];
  }

  stopSubagent(runId: string): boolean {
    return this.subagentOrchestrator?.stopRun(runId) ?? false;
  }

  getSubagentInfo(runId: string): SubagentRunRecord | null {
    return this.subagentOrchestrator?.getRun(runId) ?? null;
  }

  getSubagentLog(runId: string): { runId: string; messages: Message[] } | null {
    const run = this.subagentOrchestrator?.getRun(runId);
    if (!run) {
      return null;
    }
    return {
      runId: run.runId,
      messages: this.sessionManager.getMessages(run.childSessionId),
    };
  }

  /**
   * Get the policy engine (Salsa)
   */
  getSalsa(): Salsa | null {
    return this.salsa;
  }

  /**
   * Evaluate a security request against policies
   * @param request - Security request to evaluate
   * @returns Security result with allow/deny decision
   */
  evaluatePolicy(request: SecurityRequest) {
    if (!this.salsa) {
      // If no policy engine is configured, allow by default
      return {
        allowed: true,
        effect: 'allow' as const,
        evaluationTimeMs: 0,
      };
    }

    return this.salsa.evaluate(request);
  }

  /**
   * Process an inbound message directly (for testing)
   */
  async processMessage(message: ChannelInboundMessage): Promise<Session> {
    const envelope = createEnvelope('test', 'channel.inbound', message);
    await this.handleInboundMessage(envelope);

    const session = this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (!session) {
      throw new Error('Session not found after processing message');
    }

    return session;
  }
}
