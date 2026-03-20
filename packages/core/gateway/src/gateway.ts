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
  BootstrapProfile,
} from '@nachos/types';
import { createSessionNotFoundError, createConfigError, createLogger } from '@nachos/types';

const logger = createLogger('gateway');
import { TOPICS } from '@nachos/bus';
import { validateChannelInboundMessage } from '@nachos/types';
import { initComposioClient } from './tools/composio-tools.js';
import {
  Scheduler,
  HeartbeatManager,
  syncConfigJobs,
  type SchedulerConfig,
  type HeartbeatConfig,
  type ConfigJobDefinition,
} from './scheduler/index.js';
import { SCHEDULER_SCHEMA } from './scheduler/schema.js';
import type {
  AuditConfig,
  ContextManagementCommandsConfig,
  RuntimeToolSandboxConfig,
  SkillsConfig,
  SubagentToolPolicyConfig,
  ToolGroupConfig,
  ToolsConfig,
  NachosConfig,
} from '@nachos/config';
import { loadAndValidateConfig, validateConfigOrThrow, getModelContextWindow } from '@nachos/config';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { SessionsStore } from '@nachos/state';
import { SqliteSessionsStore } from '@nachos/state';
import {
  Router,
  InMemoryMessageBus,
  createEnvelope,
  type MessageBus,
  NatsBusAdapter,
} from './router.js';
import { createHealthServer, performHealthCheck, type HealthCheckDeps } from './health.js';
import { Cheese, type PolicyEngineConfig, type SecurityRequest } from './cheese/index.js';
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
import {
  StateLayer,
  createStateLayer,
  createDefaultBootstrapBlocks,
  MemoryPipeline,
  type StateOperationContext,
  type StateLayerConfig,
  type StateLayerDependencies,
  type StatePolicyRequest,
} from '@nachos/state';
import type { MemoryPipelineConfig } from '@nachos/state';
import { tokenEstimator } from '@nachos/context-manager';
import type { ContextManager, IContextSnapshotService } from '@nachos/context-manager';
import { SubagentManager } from './subagents/subagent-manager.js';
import { SubagentOrchestrator } from './subagents/subagent-orchestrator.js';
import { resolveSubagentWorkspaceRoot } from './subagents/workspace-utils.js';
import type {
  SubagentManagerConfig,
  SubagentOrchestratorConfig,
  SubagentResult,
  SubagentRunRecord,
  SubagentRunRequest,
  SubagentTask,
} from './subagents/types.js';
import { SandboxManager } from './sandbox/sandbox-manager.js';
import { coerceLLMContentText } from './utils/parsing.js';
import {
  resolveAgentId,
  buildStateContext,
  isSubagentSession,
  normalizeToolName,
} from './utils/session-utils.js';
import { registerManagementHandlers } from './management/management-handlers.js';
import { SkillsManager } from './skills/skills-manager.js';
import { StreamingSessionManager } from './streaming/streaming-session-manager.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { HookRegistry } from './hooks/index.js';
import {
  LLMExtractionAdapter,
  deduplicateFacts,
  type ExtractionMessage,
  type LLMCallFn,
} from '@nachos/state';
import type { SessionsLifecycleConfig } from '@nachos/config';

const DEFAULT_TOOL_GROUPS: Record<string, string[]> = {
  lookup: ['web_fetch', 'goplaces'],
  media: ['gifgrep'],
  summarize: ['summarize'],
  workspace: ['gog'],
  state: ['memory', 'user_profile', 'bootstrap'],
  scheduler: [
    'nachos_cron_add',
    'nachos_cron_list',
    'nachos_cron_remove',
    'nachos_cron_update',
    'nachos_cron_run',
  ],
  browser: [
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_fill',
    'browser_select_option',
    'browser_hover',
    'browser_drag',
    'browser_press_key',
    'browser_screenshot',
    'browser_evaluate',
    'browser_upload_file',
    'browser_handle_dialog',
    'browser_wait',
    'browser_close',
    'browser_resize',
    'browser_go_back',
    'browser_go_forward',
    'browser_tab_new',
    'browser_tab_close',
    'browser_tab_list',
    'browser_tab_select',
    'browser_console_messages',
    'browser_network_requests',
    'browser_pdf_save',
  ],
};

type ResolvedContextCommandConfig = {
  enabled: boolean;
  allowInDms: boolean;
  allowInChannels: boolean;
  adminAllowlist: Set<string>;
  resetTriggers: string[];
  contextTriggers: string[];
  identityTriggers: string[];
  helpTriggers: string[];
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
  /** Path to SQLite database file, or ':memory:' for in-memory (deprecated, use stateLayerConfig.sessions) */
  dbPath?: string;
  /** Port for health check endpoint */
  healthPort?: number;
  /** Message bus implementation (defaults to in-memory) */
  bus?: MessageBus;
  /** Default system prompt for new sessions */
  defaultSystemPrompt?: string;
  /** Assistant name (prepended to system prompt) */
  assistantName?: string;
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
  /** Snapshot service for context snapshot operations */
  snapshotService?: IContextSnapshotService;
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
  /** Tool configuration from nachos.toml */
  toolsConfig?: ToolsConfig;
  /** Skills configuration from nachos.toml */
  skillsConfig?: SkillsConfig;
  /** Full Nachos config (for skills gating) */
  nachosConfig?: NachosConfig;
  /** Scheduler configuration */
  schedulerConfig?: SchedulerConfig;
  /** Config-defined scheduler jobs (from [[scheduler.jobs]] in nachos.toml) */
  schedulerJobs?: ConfigJobDefinition[];
  /** Heartbeat configuration */
  heartbeatConfig?: HeartbeatConfig;
  /** Session lifecycle configuration (inactivity timeout, archive TTL) */
  sessionsConfig?: SessionsLifecycleConfig;
}

/**
 * Gateway class - orchestrates sessions, routing, and health
 */
export class Gateway {
  private schedulerDb?: InstanceType<typeof Database>;
  private sessionsDb?: InstanceType<typeof Database>;
  private sessionsStore: SessionsStore;
  private router: Router;
  private rateLimiter?: RateLimiter;
  private cheese: Cheese | null = null;
  private auditLogger: AuditLogger | null = null;
  private dlp: DLPSecurityLayer | null = null;
  private dlpConfig?: DLPConfig;
  private toolCoordinator: ToolCoordinator | null = null;
  private toolCache: ToolCache | null = null;
  private approvalManager: ApprovalManager | null = null;
  private localToolHandler?: import('./tools/local-tool-handler.js').LocalToolHandler;
  private instanceId: string;
  private healthServer: ReturnType<typeof createHealthServer> | null = null;
  private options: GatewayOptions;
  private isConnected: boolean = false;
  private shutdownHandlers: (() => void)[] = [];
  private stateLayer?: StateLayer;
  private _stateLayerInitPromise?: Promise<void>;
  private memoryPipeline?: MemoryPipeline;
  private memoryPipelineInterval?: NodeJS.Timeout;
  private sessionSweeperInterval?: NodeJS.Timeout;
  private sessionsLifecycleConfig?: SessionsLifecycleConfig;
  private securityMode: 'strict' | 'standard' | 'permissive';
  private contextCommandConfig?: ContextManagementCommandsConfig;
  private subagentManager?: SubagentManager;
  private subagentOrchestrator?: SubagentOrchestrator;
  private subagentToolPolicy?: SubagentToolPolicyConfig;
  private subagentWorkspaceRoot?: string;
  private sandboxManager?: SandboxManager;
  private approvalAllowlist: Set<string>;
  private toolGroupMap: Map<string, string>;
  private toolsConfig?: ToolsConfig;
  private skillsConfig?: SkillsConfig;
  private nachosConfig?: NachosConfig;
  private scheduler?: Scheduler;
  private heartbeatManager?: HeartbeatManager;
  private schedulerConfig?: SchedulerConfig;
  private heartbeatConfig?: HeartbeatConfig;
  // Extracted managers
  private skillsManager: SkillsManager;
  private streamingManager: StreamingSessionManager;
  private toolExecutor: ToolExecutor;
  private hooks: HookRegistry;

  constructor(options: GatewayOptions = {}) {
    this.options = options;
    this.instanceId = options.instanceId ?? 'gateway';
    this.hooks = new HookRegistry();
    this.dlpConfig = options.dlpConfig;
    this.approvalAllowlist = new Set(options.approvalAllowlist ?? []);
    this.securityMode = options.policyConfig?.securityMode ?? 'standard';
    this.toolGroupMap = this.buildToolGroupMap(options.toolGroups);
    this.toolsConfig = options.toolsConfig;
    this.skillsConfig = options.skillsConfig;
    this.nachosConfig = options.nachosConfig;
    this.subagentToolPolicy = options.subagentToolPolicy;
    this.subagentWorkspaceRoot = resolveSubagentWorkspaceRoot(options.workspaceDir);
    this.contextCommandConfig = options.contextCommandConfig;
    this.sessionsLifecycleConfig = options.sessionsConfig;
    if (options.toolSandboxConfig) {
      this.sandboxManager = new SandboxManager(options.toolSandboxConfig, {
        workspaceDir: options.workspaceDir,
      });
    }

    // Initialize scheduler (gets its own database connection, decoupled from session storage)
    const dbPath = options.dbPath ?? ':memory:';
    this.schedulerConfig = options.schedulerConfig;
    this.heartbeatConfig = options.heartbeatConfig;
    if (this.schedulerConfig?.enabled) {
      this.schedulerDb = new Database(dbPath);
      this.schedulerDb.pragma('journal_mode = WAL');
      this.schedulerDb.exec(SCHEDULER_SCHEMA);
      this.scheduler = new Scheduler(
        this.schedulerDb,
        this.schedulerConfig,
        this.createJobExecutor()
      );

      if (this.heartbeatConfig?.enabled) {
        this.heartbeatManager = new HeartbeatManager(this.scheduler, this.heartbeatConfig);
      }
    }

    // Initialize rate limiter
    if (options.rateLimiterConfig?.enabled !== false) {
      this.rateLimiter = new RateLimiter(
        options.rateLimiterConfig ?? createDefaultRateLimiterConfig()
      );
    }

    // Initialize bus (router created after state layer setup below)
    const bus = options.bus ?? new InMemoryMessageBus();

    // Initialize Cheese policy engine if configured
    if (options.policyConfig) {
      this.cheese = new Cheese(options.policyConfig);
      logger.info('Policy engine (Cheese) initialized');
    }

    if (options.stateLayer) {
      this.stateLayer = options.stateLayer;
    } else if (options.stateLayerConfig) {
      this.stateLayer = createStateLayer(
        options.stateLayerConfig,
        this.buildStateLayerDependencies()
      );
      // Initialize state layer (e.g., semantic search if enabled)
      // Note: init() is awaited in start() — fail-fast if state layer cannot initialize
      this._stateLayerInitPromise = this.stateLayer.init();
    }

    // Initialize sessions store: use stateLayer's store if available, else create standalone SQLite store
    if (this.stateLayer?.sessionsStore) {
      this.sessionsStore = this.stateLayer.sessionsStore;
    } else {
      this.sessionsDb = new Database(dbPath);
      this.sessionsDb.pragma('journal_mode = WAL');
      this.sessionsStore = new SqliteSessionsStore(this.sessionsDb);
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
      sessionsStore: this.sessionsStore,
      memoryPipeline: this.memoryPipeline,
      securityMode: this.securityMode,
    });

    if (options.subagentConfig) {
      this.subagentManager = new SubagentManager(options.subagentConfig, async (request) => {
        const envelope = await this.router.sendLLMRequest(request);
        // sendLLMRequest returns a MessageEnvelope — unwrap to get the LLMResponseType
        const wrapped = envelope as { payload?: LLMResponseType };
        return (wrapped.payload ?? envelope) as LLMResponseType;
      });
      this.subagentOrchestrator = new SubagentOrchestrator({
        subagentManager: this.subagentManager,
        sessionsStore: this.sessionsStore,
        router: this.router,
        buildLLMRequest: this.buildLLMRequest.bind(this),
        subscribe: async (topic: string, handler: (data: unknown) => Promise<void>) => {
          const bus = this.router.getBus();
          if (bus) {
            await bus.subscribe(topic, handler);
          }
        },
        unsubscribe: async (topic: string) => {
          const bus = this.router.getBus();
          if (bus) {
            await bus.unsubscribe(topic);
          }
        },
        defaultSystemPrompt: this.options.defaultSystemPrompt,
        config: options.subagentOrchestratorConfig,
        workspaceRoot: this.subagentWorkspaceRoot,
      });
    }

    // Initialize Composio client if enabled
    if (options.toolsConfig?.composio?.enabled) {
      const apiKeyEnv = options.toolsConfig.composio.api_key_env ?? 'COMPOSIO_API_KEY';
      const apiKey = process.env[apiKeyEnv];

      if (!apiKey) {
        logger.warn(`Composio enabled but ${apiKeyEnv} not set in environment`);
      } else {
        const entityId = options.toolsConfig.composio.entity_id ?? 'default';
        const allowedApps = options.toolsConfig.composio.allowed_apps;

        initComposioClient({
          apiKey,
          entityId,
          allowedApps,
        });
        logger.info({ entityId, allowedApps }, 'Composio client initialized');
      }
    }

    // Initialize extracted managers
    this.skillsManager = new SkillsManager(
      {
        resolveToolGroup: (bin) => this.resolveToolGroup(bin),
        getBus: () => {
          const b = this.router.getBus();
          return b instanceof NatsBusAdapter ? b : null;
        },
      },
      {
        skillsConfig: this.skillsConfig,
        nachosConfig: this.nachosConfig,
        toolsConfig: this.toolsConfig,
      }
    );

    this.streamingManager = new StreamingSessionManager(
      { sendToChannel: (outbound) => this.router.sendToChannel(outbound) },
      {
        streamingMinIntervalMs: options.streamingMinIntervalMs,
        streamingChunkSize: options.streamingChunkSize,
      }
    );

    this.toolExecutor = new ToolExecutor({
      core: {
        instanceId: this.instanceId,
        securityMode: this.securityMode,
        toolsConfig: this.toolsConfig,
        toolCoordinator: this.toolCoordinator,
        scheduler: this.scheduler,
        subagentManager: this.subagentManager,
        subagentOrchestrator: this.subagentOrchestrator,
        hooks: this.hooks,
      },
      policy: {
        resolveToolGroup: (tool) => this.resolveToolGroup(tool),
        evaluatePolicy: (request) => this.evaluatePolicy(request as SecurityRequest),
        subagentToolPolicy: this.subagentToolPolicy,
      },
      audit: {
        logAuditEvent: (event) => this.logAuditEvent(event),
        publishStatusEvent: (sessionId, status, channelId, channelMessageId, toolName) =>
          this.publishStatusEvent(sessionId, status, channelId, channelMessageId, toolName),
      },
      state: {
        stateLayer: this.stateLayer,
        sessionsStore: this.sessionsStore,
        snapshotService: options.snapshotService,
        getSession: (sessionId) => this.sessionsStore.getSession(sessionId),
        getMessages: (sessionId) => this.sessionsStore.getMessages(sessionId),
        getIdentityCompletionStatus: (session) => this.getIdentityCompletionStatus(session),
        markIdentityCompleted: (agentId, content, context) =>
          this.markIdentityCompleted(agentId, content, context),
        resetIdentityForCommand: (session) => this.resetIdentityForCommand(session),
        getSubagentInfo: (runId) => this.getSubagentInfo(runId),
        listSubagents: () => this.listSubagents(),
        stopSubagent: (runId) => this.stopSubagent(runId),
        steerSubagent: (runId, message) => this.steerSubagent(runId, message),
        getSubagentLog: (runId) => this.getSubagentLog(runId),
      },
      security: {
        dlp: this.dlp,
        sandboxManager: this.sandboxManager,
      },
    });

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
      logger.warn({ errors: validated.errors }, 'Invalid inbound channel message');
      return;
    }

    const message = validated.data as ChannelInboundMessage;
    // Strip leading bot mention(s) so commands work even when mention gating is enabled
    // e.g. "<@123456> /new" → "/new"
    let messageText = (message.content.text ?? '').replace(/^(<@!?\d+>\s*)+/, '').trim();
    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';

    // --- Early intercept: approval commands work from ANY channel/session ---
    if (this.approvalManager && messageText) {
      logger.info(
        { messageText: messageText.slice(0, 100), senderId: message.sender.id },
        'Checking for approval command'
      );
      const handled = await this.handleApprovalCommand(message, messageText);
      if (handled) {
        logger.info('Approval command handled');
        return;
      }
    }

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

    const existingSession = await this.sessionsStore.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    // Get or create session for this conversation
    const { session: resolvedSession } = await this.sessionsStore.getOrCreateSessionAtomic({
      channel: message.channel,
      conversationId: message.conversation.id,
      userId: message.sender.id,
      systemPrompt: this.options.defaultSystemPrompt,
    });
    let session = resolvedSession;

    if (this.cheese) {
      const policyResult = this.cheese.evaluate({
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

      // Hook: session:created (fire-and-forget)
      try {
        void this.hooks.emit('session:created', {
          session: {
            id: session.id,
            channel: session.channel,
            conversationId: session.conversationId,
            userId: session.userId,
            status: session.status ?? 'active',
            createdAt: session.createdAt ?? new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        }).catch((err) => logger.warn({ err }, 'session:created hook emission failed'));
      } catch (hookError) {
        logger.warn({ err: hookError }, 'session:created hook failed');
      }
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

    // Hook: message:received (fire-and-forget)
    try {
      void this.hooks.emit('message:received', {
        envelopeId: envelope.id,
        channel: message.channel,
        channelMessageId: message.channelMessageId ?? '',
        sender: {
          id: message.sender.id ?? '',
          name: message.sender.name,
          isAllowed: message.sender.isAllowed ?? true,
        },
        conversation: {
          id: message.conversation.id,
          type: message.conversation.type,
        },
        text: messageText,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn({ err }, 'message:received hook emission failed'));
    } catch (hookError) {
      logger.warn({ err: hookError }, 'message:received hook failed');
    }

    // Add user message to session
    if (message.content.text) {
      await this.sessionsStore.addMessage({
        sessionId: session.id,
        role: 'user',
        content: message.content.text,
      });
    }

    // NOTE: /approve, /deny, /approve-all are handled early in handleInboundMessage
    // before session creation — see handleApprovalCommand()

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
    try {
      if (this.options.streamingPassthrough) {
        this.streamingManager.register(session.id, message);
      }

      void this.publishStatusEvent(
        session.id,
        'thinking',
        message.conversation.id,
        message.channelMessageId ?? undefined
      ).catch((err) => logger.warn({ err }, 'Failed to publish thinking status event'));

      const response = await this.requestLLMResponse(
        session.id,
        [],
        this.options.streamingPassthrough ?? false
      );
      await this.sendLLMResponse(message, session.id, response);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTimeout = errMsg.includes('timed out') || errMsg.includes('timeout');
      logger.error({ err: error, sessionId: session.id }, 'Failed to process inbound message');

      void this.publishStatusEvent(
        session.id,
        'error',
        message.conversation.id,
        message.channelMessageId ?? undefined
      ).catch((err) => logger.warn({ err }, 'Failed to publish error status event'));

      // Send error feedback to the user instead of silent failure
      const errorOutbound: ChannelOutboundMessage = {
        channel: message.channel,
        conversationId: message.conversation.id,
        replyToMessageId: this.getReplyToMessageId(message),
        sessionId: session.id,
        content: {
          text: isTimeout
            ? '⚠️ The request timed out. Please try again in a moment.'
            : '⚠️ Something went wrong processing your message. Please try again.',
          format: 'markdown',
        },
      };

      try {
        await this.router.sendToChannel(errorOutbound);
      } catch (sendError) {
        logger.error({ err: sendError }, 'Failed to send error response to channel');
      }

      // Audit the failure
      void this.logAuditEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId,
        userId: message.sender.id,
        sessionId: session.id,
        channel: message.channel,
        eventType: 'llm_request',
        action: 'llm.request.error',
        resource: message.channel,
        outcome: 'error',
        reason: errMsg,
        securityMode: this.options.policyConfig?.securityMode ?? 'standard',
      });
    }
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
      identityTriggers: (config.identity_triggers ?? ['/identity']).filter(Boolean),
      helpTriggers: (config.help_triggers ?? ['/help', '!help']).filter(Boolean),
    };
  }

  private parseContextCommand(
    text: string,
    config: ResolvedContextCommandConfig
  ): {
    type: 'reset' | 'context' | 'identity' | 'help';
    trigger: string;
    remainder: string;
  } | null {
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

    const identity = matchTrigger(config.identityTriggers);
    if (identity) {
      return { type: 'identity', trigger: identity.trigger, remainder: identity.remainder };
    }

    const context = matchTrigger(config.contextTriggers);
    if (context) {
      return { type: 'context', trigger: context.trigger, remainder: context.remainder };
    }

    const help = matchTrigger(config.helpTriggers);
    if (help) {
      return { type: 'help', trigger: help.trigger, remainder: help.remainder };
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

    if (parsed.type === 'help') {
      return {
        handled: true,
        replyText: [
          'Available commands:',
          '/reset - Start a new conversation',
          '/context on|off|status - Manage context window',
          '/identity status|reset - View or reset identity (admin only)',
          '/help - Show this help message',
        ].join('\n'),
      };
    }

    // Admin-only commands (identity reset) are checked inside their handlers.
    // User-level commands (reset, context, help) are open to all allowed users.

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

    if (parsed.type === 'identity') {
      if (!this.stateLayer) {
        return {
          handled: true,
          replyText: 'Identity state is not configured.',
        };
      }

      if (!action || action === 'status') {
        const completed = await this.getIdentityCompletionStatus(session);
        return {
          handled: true,
          replyText: completed
            ? 'Identity onboarding is complete.'
            : 'Identity onboarding is not complete yet.',
        };
      }

      if (['reset', 'clear', 'restart'].includes(action)) {
        // H1: Admin allowlist check for identity reset
        const allowlist =
          config.adminAllowlist.size > 0 ? config.adminAllowlist : this.approvalAllowlist;
        const senderId = message.sender.id ?? '';

        if (allowlist.size > 0 && !allowlist.has(senderId)) {
          return {
            handled: true,
            replyText:
              '⛔ You are not authorized to reset identity. This action is restricted to administrators.',
          };
        }

        await this.resetIdentityForCommand(session);
        return {
          handled: true,
          replyText: '🔁 Identity reset. Bootstrap guidance restored for onboarding.',
        };
      }

      return {
        handled: true,
        replyText: 'Unknown identity command. Try `/identity status` or `/identity reset`.',
      };
    }

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
      await this.sessionsStore.updateSession(session.id, {
        metadata: { ...metadata, contextManagement },
      });
      return {
        handled: true,
        replyText: '✅ Context management enabled for this session.',
      };
    }

    if (['off', 'disable', 'disabled'].includes(action)) {
      contextManagement.enabled = false;
      contextManagement.updatedAt = new Date().toISOString();
      await this.sessionsStore.updateSession(session.id, {
        metadata: { ...metadata, contextManagement },
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
      await this.sessionsStore.updateSession(session.id, { metadata: updatedMetadata });
      return {
        handled: true,
        replyText: '🔁 Context management reset to default for this session.',
      };
    }

    return {
      handled: true,
      replyText:
        'Unknown context command. Try `/context on`, `/context off`, or `/context status`.',
    };
  }

  private async resetSessionForCommand(
    session: Session,
    message: ChannelInboundMessage,
    securityMode: 'strict' | 'standard' | 'permissive'
  ): Promise<Session> {
    const previous = await this.sessionsStore.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (previous) {
      await this.sessionsStore.deleteSession(previous.id);
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
          logger.warn({ err: error }, 'Failed to delete session state during reset');
        }
      }

      // Hook: session:destroyed (fire-and-forget)
      try {
        void this.hooks.emit('session:destroyed', {
          sessionId: previous.id,
          reason: 'user_command',
          timestamp: new Date().toISOString(),
        }).catch((err) => logger.warn({ err }, 'session:destroyed hook emission failed'));
      } catch (hookError) {
        logger.warn({ err: hookError }, 'session:destroyed hook failed');
      }
    }

    const newSession = await this.sessionsStore.createSession({
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
      eventType: 'session_end',
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
  ): Promise<LLMRequestType & { contextWindow?: number; systemPromptTokens?: number; promptReport?: PromptReport }> {
    const session = await this.sessionsStore.getSessionWithMessages(sessionId);
    if (!session) {
      throw createSessionNotFoundError('Session not found', { component: 'gateway' });
    }

    const messages: LLMRequestType['messages'] = [];
    const rawPrompt = session.systemPrompt ?? this.options.defaultSystemPrompt ?? '';
    // Prepend assistant name if configured
    const basePrompt = this.options.assistantName
      ? `Your name is ${this.options.assistantName}.\n\n${rawPrompt}`
      : rawPrompt;

    let prompt = basePrompt;
    let promptReport: PromptReport | undefined;
    let systemPromptTokens = 0;
    let bootstrapLocked = false;

    if (this.stateLayer) {
      const context = buildStateContext(session, this.securityMode);
      const agentId = resolveAgentId(session);
      const isSubagent = isSubagentSession(session);

      try {
        const identity = isSubagent ? null : await this.stateLayer.getIdentity(agentId, context);
        bootstrapLocked = Boolean(identity?.identityCompleted);
        let bootstrap = await this.stateLayer.getBootstrap(agentId, context);
        if (identity?.identityCompleted) {
          bootstrap = await this.pruneBootstrapAfterCompletion(bootstrap, context);
        }
        if (isSubagent) {
          bootstrap = this.filterBootstrapForSubagent(bootstrap);
        }

        const userProfile = isSubagent
          ? null
          : session.userId
            ? await this.stateLayer.getUserProfile(agentId, session.userId, context)
            : null;
        // Build lightweight memory manifest for prompt injection (skip for subagents)
        const memInjCfg = this.nachosConfig?.runtime?.state?.memory_injection;
        const manifestEnabled = memInjCfg?.enabled !== false; // Default: enabled
        const memoryManifest = isSubagent || !manifestEnabled
          ? null
          : await this.stateLayer.buildMemoryManifest(agentId, context, {
              maxTokens: memInjCfg?.manifest_max_tokens,
              includePreferences: memInjCfg?.manifest_preferences,
              recentTopicCount: memInjCfg?.manifest_recent_topics,
              includeFactCounts: memInjCfg?.manifest_fact_counts,
            });

        // Only load critical entries (preferences, active tasks) — not the full 200
        const memory = isSubagent
          ? { entries: [], facts: [] }
          : await this.stateLayer.queryMemory(
              { agentId, limit: 20, kinds: ['preference', 'task', 'fact', 'note', 'lesson'] },
              context,
            );
        const sessionState = isSubagent
          ? null
          : await this.stateLayer.getSessionState(sessionId, context);

        const assembled = this.stateLayer.assemblePrompt({
          basePrompt,
          bootstrap,
          identity,
          userProfile,
          memoryManifest,
          memoryEntries: memory.entries,
          memoryFacts: memory.facts,
          sessionState,
          skills: this.skillsManager.getSkillsPrompt(),
          includeMemoryInstructions: true, // Add memory recall instructions
          includeDelegationInstructions: true, // Add subagent vs agent_exec guidance
        });

        prompt = assembled.prompt;
        promptReport = assembled.report;
        systemPromptTokens = assembled.report.totalTokens ?? 0;

        await this.sessionsStore.updateSession(sessionId, {
          metadata: {
            ...(session.metadata as Record<string, unknown> | undefined ?? {}),
            promptReport: assembled.report,
            promptReportUpdatedAt: assembled.report.generatedAt,
          },
        });
      } catch (error) {
        logger.warn({ err: error }, 'Failed to assemble prompt with state layer');
      }
    } else if (basePrompt) {
      systemPromptTokens = tokenEstimator.estimate(basePrompt);
    }

    if (prompt) {
      messages.push({ role: 'system', content: prompt });
    }

    for (const message of session.messages) {
      if (
        message.role === 'assistant' &&
        message.toolCalls &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.length > 0
      ) {
        // Include tool_use blocks so the LLM adapter can reconstruct the full assistant turn
        const contentBlocks: unknown[] = [];
        if (message.content) {
          contentBlocks.push({ type: 'text', text: message.content });
        }
        for (const tc of message.toolCalls as Array<{
          id: string;
          name: string;
          arguments: string;
        }>) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments,
          });
        }
        messages.push({ role: 'assistant', content: contentBlocks as unknown as string });
      } else if (message.role === 'tool') {
        // Tool result messages: parse stored JSON content back to structured blocks
        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(message.content);
        } catch {
          parsedContent = message.content;
        }
        messages.push({ role: 'tool', content: parsedContent as string });
      } else {
        messages.push({ role: message.role, content: message.content });
      }
    }

    if (extraMessages.length > 0) {
      messages.push(...extraMessages);
    }

    // Safety net: ensure every assistant tool_use block has a matching tool_result
    // AND every tool_result block has a matching tool_use in a preceding assistant message.
    // Orphaned blocks in either direction cause Anthropic API 400 errors.
    this.patchOrphanedToolUseBlocks(messages);
    this.removeOrphanedToolResultBlocks(messages);

    const tools = this.toolExecutor.buildToolDefinitions(session, { bootstrapLocked });

    // Resolve context window from model ID, with explicit config override
    const effectiveModel = session.config?.model ?? this.nachosConfig?.llm?.model;
    const contextWindow = getModelContextWindow(
      effectiveModel,
      this.nachosConfig?.llm?.context_window
    );

    return {
      sessionId,
      messages,
      tools,
      options: {
        model: session.config?.model,
        maxTokens: session.config?.maxTokens,
        stream,
      },
      contextWindow,
      systemPromptTokens,
      promptReport,
    };
  }

  /**
   * Patch orphaned tool_use blocks that lack matching tool_result messages.
   * Mutates the messages array in place by injecting synthetic tool_result blocks.
   */
  private patchOrphanedToolUseBlocks(messages: LLMRequestType['messages']): void {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

      // Collect tool_use ids from this assistant message
      const toolUseIds: string[] = [];
      for (const block of msg.content as Array<{ type?: string; id?: string }>) {
        if (block && block.type === 'tool_use' && block.id) {
          toolUseIds.push(block.id);
        }
      }
      if (toolUseIds.length === 0) continue;

      // Check subsequent messages for matching tool_result blocks
      const matchedIds = new Set<string>();
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j];
        if (!next) break;
        // tool_result blocks are in tool-role messages
        if (next.role === 'tool' && Array.isArray(next.content)) {
          for (const block of next.content as Array<{
            type?: string;
            tool_use_id?: string;
          }>) {
            if (block && block.type === 'tool_result' && block.tool_use_id) {
              matchedIds.add(block.tool_use_id);
            }
          }
        } else if (next.role === 'user' || next.role === 'assistant') {
          // Stop scanning once we hit the next user/assistant message
          break;
        }
      }

      const orphanedIds = toolUseIds.filter((id) => !matchedIds.has(id));
      if (orphanedIds.length === 0) continue;

      logger.warn(
        { orphanedIds, messageIndex: i },
        'Patching orphaned tool_use blocks with synthetic tool_result'
      );

      // Insert synthetic tool_result messages right after this assistant message
      const syntheticToolMessages = orphanedIds.map((id) => ({
        role: 'tool' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: id,
            tool_result: { error: 'Tool result unavailable (recovered from history gap)' },
            is_error: true,
          },
        ] as unknown as string,
      }));
      messages.splice(i + 1, 0, ...syntheticToolMessages);
      // Skip past the messages we just inserted
      i += syntheticToolMessages.length;
    }
  }

  /**
   * Remove tool_result blocks whose tool_use_id has no matching tool_use
   * in any preceding assistant message. This is the reverse complement of
   * patchOrphanedToolUseBlocks — it handles cases where compaction preserved
   * a tool result but dropped the assistant message that issued the tool call.
   * Mutates the messages array in place.
   */
  private removeOrphanedToolResultBlocks(messages: LLMRequestType['messages']): void {
    // First pass: collect all tool_use IDs from assistant messages
    const allToolUseIds = new Set<string>();
    for (const msg of messages) {
      if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content as Array<{ type?: string; id?: string }>) {
          if (block?.type === 'tool_use' && block.id) {
            allToolUseIds.add(block.id);
          }
        }
      }
    }

    // Second pass: remove tool messages with orphaned tool_result blocks
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== 'tool' || !Array.isArray(msg.content)) continue;

      const blocks = msg.content as Array<{ type?: string; tool_use_id?: string }>;
      const validBlocks = blocks.filter(
        (block) =>
          !block || block.type !== 'tool_result' || !block.tool_use_id || allToolUseIds.has(block.tool_use_id)
      );

      if (validBlocks.length === blocks.length) continue; // No orphans

      const orphanedIds = blocks
        .filter((b) => b?.type === 'tool_result' && b.tool_use_id && !allToolUseIds.has(b.tool_use_id))
        .map((b) => b.tool_use_id);

      logger.warn(
        { orphanedIds, messageIndex: i },
        'Removing orphaned tool_result blocks with no matching tool_use'
      );

      if (validBlocks.length === 0) {
        // All blocks were orphaned — remove the entire message
        messages.splice(i, 1);
      } else {
        msg.content = validBlocks as unknown as string;
      }
    }
  }

  private async requestLLMResponse(
    sessionId: string,
    extraMessages: LLMRequestType['messages'] = [],
    stream: boolean = false
  ): Promise<LLMResponseType> {
    const request = await this.buildLLMRequest(sessionId, extraMessages, stream);

    // Hook: llm:before-request -- observe-only handlers (fire-and-forget)
    try {
      void this.hooks.emit('llm:before-request', {
        sessionId,
        messages: request.messages as ReadonlyArray<{
          role: string;
          content: string | readonly unknown[];
        }>,
        tools: request.tools?.map((t) => ({ name: t.name, description: t.description })),
        stream: Boolean(request.options?.stream),
        options: request.options as Readonly<Record<string, unknown>> | undefined,
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn({ err }, 'llm:before-request hook emission failed'));
    } catch (hookError) {
      logger.warn({ err: hookError }, 'llm:before-request observe hook failed');
    }

    // Hook: llm:before-request -- mutable handlers (awaited, sequential)
    try {
      const mutablePayload = await this.hooks.emitMutable('llm:before-request', {
        sessionId,
        messages: request.messages.map((m) => ({
          role: m.role as string,
          content:
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? ([...m.content] as unknown[])
                : (m.content as unknown[]),
        })),
        tools: request.tools?.map((t) => ({ name: t.name, description: t.description })),
        stream: Boolean(request.options?.stream),
        options: request.options as Readonly<Record<string, unknown>> | undefined,
        timestamp: new Date().toISOString(),
      });
      // Apply modifications back to the request
      request.messages = mutablePayload.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content as string,
      }));
      if (mutablePayload.tools && request.tools) {
        // Rebuild tools array: keep full tool definitions for tools that still
        // exist in the mutable payload, add stub entries for newly added tools
        const updatedTools: typeof request.tools = [];
        for (const mt of mutablePayload.tools) {
          const existing = request.tools.find((t) => t.name === mt.name);
          if (existing) {
            updatedTools.push(existing);
          } else {
            // Newly added tool -- create a minimal definition
            updatedTools.push({
              name: mt.name,
              description: mt.description,
              parameters: {},
            });
          }
        }
        request.tools = updatedTools;
      } else if (mutablePayload.tools === undefined) {
        request.tools = undefined;
      }
    } catch (hookError) {
      logger.warn({ err: hookError }, 'llm:before-request mutable hook failed');
    }

    const responseEnvelope = await this.router.sendLLMRequest(request);

    const envelope = responseEnvelope as MessageEnvelope;
    const response: LLMResponseType =
      envelope && typeof envelope === 'object' && 'payload' in envelope
        ? (envelope.payload as LLMResponseType)
        : (responseEnvelope as LLMResponseType);

    // Hook: llm:after-response (fire-and-forget)
    try {
      void this.hooks.emit('llm:after-response', {
        sessionId,
        success: response.success,
        responseText: this.coerceLLMContentText(
          response.success ? response.message?.content : undefined
        ),
        toolCalls: response.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
        })),
        usage: response.usage
          ? {
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
            }
          : undefined,
        provider: response.provider,
        model: response.model,
        finishReason: response.finishReason,
        error: response.error
          ? { code: response.error.code, message: response.error.message }
          : undefined,
        toolIteration: 0,
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn({ err }, 'llm:after-response hook emission failed'));
    } catch (hookError) {
      logger.warn({ err: hookError }, 'llm:after-response hook failed');
    }

    return response;
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

  /**
   * Create job executor for scheduler
   */
  private createJobExecutor() {
    return async (job: import('./scheduler/types.js').CronJob) => {
      try {
        logger.info({ jobId: job.id, actionType: job.actionType }, 'Executing scheduled job');

        if (job.actionType === 'systemEvent') {
          const actionData = job.actionData as import('./scheduler/types.js').SystemEventAction;

          // Inject system event into the configured channel
          if (job.deliveryChannel) {
            const message: ChannelInboundMessage = {
              channel: job.deliveryChannel,
              channelMessageId: randomUUID(),
              sender: {
                id: job.userId,
                name: 'Scheduler',
                isAllowed: true,
              },
              conversation: {
                id: job.sessionId ?? `scheduler-${job.id}`,
                type: 'channel',
              },
              content: {
                text: actionData.text,
              },
            };

            // Publish to channel inbound topic
            const envelope = createEnvelope(this.instanceId, 'channel-inbound', message);
            await this.router
              .getBus()
              .publish(TOPICS.channel.inbound(job.deliveryChannel), envelope);

            return { success: true, result: 'System event injected' };
          }

          return { success: false, error: 'No delivery channel specified' };
        }

        if (job.actionType === 'agentTurn') {
          const actionData = job.actionData as import('./scheduler/types.js').AgentTurnAction;

          // Create an isolated agent turn (similar to how subagents work)
          // For now, inject as a system event - can be enhanced later for true isolated turns
          if (job.deliveryChannel) {
            const message: ChannelInboundMessage = {
              channel: job.deliveryChannel,
              channelMessageId: randomUUID(),
              sender: {
                id: job.userId,
                name: 'Scheduler',
                isAllowed: true,
              },
              conversation: {
                id: job.sessionId ?? `scheduler-${job.id}`,
                type: 'channel',
              },
              content: {
                text: actionData.prompt,
              },
            };

            const envelope = createEnvelope(this.instanceId, 'channel-inbound', message);
            await this.router
              .getBus()
              .publish(TOPICS.channel.inbound(job.deliveryChannel), envelope);

            return { success: true, result: 'Agent turn scheduled' };
          }

          return { success: false, error: 'No delivery channel specified' };
        }

        return { success: false, error: `Unknown action type: ${job.actionType}` };
      } catch (error) {
        logger.error({ jobId: job.id, error }, 'Job execution failed');
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };
  }

  private buildToolGroupMap(groups?: Record<string, ToolGroupConfig>): Map<string, string> {
    const map = new Map<string, string>();
    const applyGroup = (groupName: string, tools: string[]) => {
      for (const tool of tools) {
        const normalized = normalizeToolName(tool);
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
          map.delete(normalizeToolName(tool));
        }
        continue;
      }
      applyGroup(groupName, config.tools);
    }

    return map;
  }

  private resolveToolGroup(tool: string): string | undefined {
    const normalized = normalizeToolName(tool);
    return this.toolGroupMap.get(normalized);
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
      isPinned: false,
      isArchived: false,
      lastActivity: now,
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

  // Utility parsing methods delegate to extracted functions in utils/parsing.ts

  private async getIdentityCompletionStatus(session: Session): Promise<boolean> {
    if (!this.stateLayer) {
      return false;
    }
    const agentId = resolveAgentId(session);
    const context = { ...buildStateContext(session, this.securityMode), internalTool: true };
    const identity = await this.stateLayer.getIdentity(agentId, context);
    return Boolean(identity?.identityCompleted);
  }

  private async resetIdentityForCommand(session: Session): Promise<void> {
    if (!this.stateLayer) {
      return;
    }

    const agentId = resolveAgentId(session);
    const context = { ...buildStateContext(session, this.securityMode), internalTool: true };
    const now = new Date().toISOString();
    const current = await this.stateLayer.getIdentity(agentId, context);

    await this.stateLayer.putIdentity(
      {
        agentId,
        soul: '',
        identity: '',
        userProfile: '',
        toolsNotes: '',
        updatedAt: now,
        version: current?.version ? current.version + 1 : 1,
        identityCompleted: false,
        identityCompletedAt: undefined,
      },
      context
    );

    const defaults = createDefaultBootstrapBlocks();
    const existingBootstrap = await this.stateLayer.getBootstrap(agentId, context);
    const content = {
      ...(existingBootstrap?.content ?? {}),
      soul: defaults.soul ?? '',
      identity: defaults.identity ?? '',
      user: defaults.user ?? '',
      bootstrap: defaults.bootstrap ?? '',
    };

    await this.stateLayer.putBootstrap(
      {
        agentId,
        content,
        updatedAt: now,
        version: existingBootstrap?.version ? existingBootstrap.version + 1 : 1,
      },
      context
    );
  }

  private filterBootstrapForSubagent(bootstrap: BootstrapProfile | null): BootstrapProfile | null {
    if (!bootstrap) {
      return null;
    }
    const allowed = new Set(['agents', 'tools']);
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(bootstrap.content ?? {})) {
      if (!allowed.has(key)) {
        continue;
      }
      filtered[key] = value;
    }
    if (Object.keys(filtered).length === 0) {
      return null;
    }
    return {
      ...bootstrap,
      content: filtered,
    };
  }

  private async pruneBootstrapAfterCompletion(
    bootstrap: BootstrapProfile | null,
    context: StateOperationContext
  ): Promise<BootstrapProfile | null> {
    if (!bootstrap) {
      return null;
    }
    if (!('bootstrap' in (bootstrap.content ?? {}))) {
      return bootstrap;
    }
    const nextContent = { ...bootstrap.content };
    delete nextContent.bootstrap;
    const stored = await this.stateLayer?.putBootstrap(
      {
        ...bootstrap,
        content: nextContent,
        updatedAt: new Date().toISOString(),
        version: bootstrap.version + 1,
      },
      context
    );
    return stored ?? bootstrap;
  }

  private async markIdentityCompleted(
    agentId: string,
    bootstrapContent: Record<string, string>,
    context: StateOperationContext
  ): Promise<void> {
    if (!this.stateLayer) {
      return;
    }

    const now = new Date().toISOString();
    const current = await this.stateLayer.getIdentity(agentId, context);
    const soul = current?.soul ?? bootstrapContent.soul ?? '';
    const identity = current?.identity ?? bootstrapContent.identity ?? '';
    const userProfile = current?.userProfile ?? bootstrapContent.user ?? '';
    const toolsNotes = current?.toolsNotes ?? bootstrapContent.tools ?? undefined;

    await this.stateLayer.putIdentity(
      {
        agentId,
        soul,
        identity,
        userProfile,
        toolsNotes,
        updatedAt: now,
        version: current?.version ? current.version + 1 : 1,
        identityCompleted: true,
        identityCompletedAt: now,
      },
      context
    );
  }

  private static readonly MAX_TOOL_ITERATIONS = 10;

  private async sendLLMResponse(
    inbound: ChannelInboundMessage,
    sessionId: string,
    response: LLMResponseType,
    toolIteration = 0
  ): Promise<void> {
    const content = response.success ? response.message?.content : response.error?.message;
    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';
    let responseText = this.coerceLLMContentText(content);
    const toolCalls = response.success ? response.toolCalls : undefined;

    if (toolCalls && toolCalls.length > 0) {
      if (toolIteration >= Gateway.MAX_TOOL_ITERATIONS) {
        logger.warn(
          { sessionId, toolIteration },
          'Max tool iterations reached, forcing text response'
        );
        if (!responseText) {
          responseText =
            'I got caught in a loop processing your request. Could you try rephrasing?';
        }
        // Fall through to send responseText
      } else {
        await this.sessionsStore.addMessage({
          sessionId,
          role: 'assistant',
          content: responseText,
          toolCalls,
        });

        try {
          const toolMessages = await this.toolExecutor.executeToolCalls(sessionId, toolCalls, {
            channelId: inbound.conversation.id,
            channelMessageId: inbound.channelMessageId ?? undefined,
          });

          // Store tool result messages in session so multi-turn history is complete
          // (tool_use blocks need matching tool_result blocks in subsequent requests)
          for (const toolMsg of toolMessages) {
            await this.sessionsStore.addMessage({
              sessionId,
              role: 'tool',
              content:
                typeof toolMsg.content === 'string'
                  ? toolMsg.content
                  : JSON.stringify(toolMsg.content),
            });
          }

          // Tool results are now in session history; no extraMessages needed
          const followUp = await this.requestLLMResponse(sessionId);
          await this.sendLLMResponse(inbound, sessionId, followUp, toolIteration + 1);
          return;
        } catch (toolError) {
          const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
          logger.error(
            { err: toolError, sessionId, toolIteration, tools: toolCalls.map((t) => t.name) },
            'Tool loop iteration failed'
          );

          // Store synthetic tool_result messages so the history stays valid.
          // The assistant message with tool_use blocks was already saved above;
          // without matching tool_result blocks, subsequent API calls will fail.
          for (const tc of toolCalls) {
            await this.sessionsStore.addMessage({
              sessionId,
              role: 'tool',
              content: JSON.stringify([
                {
                  type: 'tool_result',
                  tool_use_id: tc.id,
                  tool_result: { error: errMsg.slice(0, 200) },
                  is_error: true,
                },
              ]),
            });
          }

          // Fall through to send error as responseText to the user
          responseText = `⚠️ A tool call failed: ${errMsg.slice(0, 200)}. Please try again.`;
          void this.publishStatusEvent(
            sessionId,
            'error',
            inbound.conversation.id,
            inbound.channelMessageId ?? undefined
          ).catch((err) => logger.warn({ err }, 'Failed to publish tool error status event'));
        }
        // On success we returned above; on error fall through to send responseText
      }
    }

    if (this.cheese) {
      const policyResult = this.cheese.evaluate({
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
          ...inbound.metadata,
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

    // DLP scan outbound LLM response before sending to channel
    if (responseText && this.dlp) {
      const dlpResult = this.dlp.scan(responseText, inbound.channel);
      if (!dlpResult.allowed) {
        void this.logAuditEvent({
          id: `${sessionId}-dlp-outbound-${Date.now()}`,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: inbound.sender.id,
          sessionId,
          channel: inbound.channel,
          eventType: 'dlp_block',
          action: 'dlp.block',
          resource: inbound.channel,
          outcome: 'blocked',
          reason: dlpResult.reason,
          securityMode,
          details: {
            direction: 'outbound',
            findingsCount: dlpResult.findings.length,
            action: dlpResult.action,
          },
        });

        responseText = dlpResult.reason ?? 'Response blocked by DLP policy.';
      } else if (dlpResult.action === 'redact' && dlpResult.message) {
        responseText = dlpResult.message;
      } else if (dlpResult.action === 'alert') {
        void this.logAuditEvent({
          id: `${sessionId}-dlp-outbound-alert-${Date.now()}`,
          timestamp: new Date().toISOString(),
          instanceId: this.instanceId,
          userId: inbound.sender.id,
          sessionId,
          channel: inbound.channel,
          eventType: 'dlp_scan',
          action: 'dlp.alert',
          resource: inbound.channel,
          outcome: 'allowed',
          reason: dlpResult.reason,
          securityMode,
          details: {
            direction: 'outbound',
            findingsCount: dlpResult.findings.length,
            action: dlpResult.action,
          },
        });
      }
    }

    if (responseText) {
      await this.sessionsStore.addMessage({
        sessionId,
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

    // Hook: response:before-send -- observe-only handlers (fire-and-forget)
    try {
      void this.hooks.emit('response:before-send', {
        sessionId,
        channel: inbound.channel,
        conversationId: inbound.conversation.id,
        text: responseText,
        format: 'markdown',
        replyToMessageId: this.getReplyToMessageId(inbound),
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn({ err }, 'response:before-send hook emission failed'));
    } catch (hookError) {
      logger.warn({ err: hookError }, 'response:before-send observe hook failed');
    }

    // Hook: response:before-send -- mutable handlers (awaited, sequential)
    try {
      const mutablePayload = await this.hooks.emitMutable('response:before-send', {
        sessionId,
        channel: inbound.channel,
        conversationId: inbound.conversation.id,
        text: responseText,
        format: 'markdown' as const,
        replyToMessageId: this.getReplyToMessageId(inbound),
        timestamp: new Date().toISOString(),
      });
      // Apply text modification back to the outbound message
      if (mutablePayload.text !== responseText) {
        outbound.content.text = mutablePayload.text;
      }
    } catch (hookError) {
      logger.warn({ err: hookError }, 'response:before-send mutable hook failed');
    }

    await this.router.sendToChannel(outbound);
    void this.publishStatusEvent(
      sessionId,
      'done',
      inbound.conversation.id,
      inbound.channelMessageId ?? undefined
    ).catch((err) => logger.warn({ err }, 'Failed to publish done status event'));
  }

  private coerceLLMContentText(content: unknown) {
    return coerceLLMContentText(content);
  }

  /**
   * Handle /approve, /deny, and /approve-all commands from any channel.
   * Returns true if the message was an approval command (handled), false otherwise.
   */
  private async handleApprovalCommand(
    message: ChannelInboundMessage,
    text: string
  ): Promise<boolean> {
    if (!this.approvalManager) return false;

    // Strip leading mention patterns (e.g. <@123456>) so approval commands work
    // even when users need to mention the bot to pass mention gating
    const trimmed = text
      .trim()
      .replace(/^(<@!?\d+>\s*)+/, '')
      .trim();
    logger.info(
      { originalText: text.slice(0, 100), trimmedText: trimmed.slice(0, 100) },
      'Approval command parsing'
    );
    const approveMatch = trimmed.match(/^\/approve\s+(\S+)$/i);
    const approveAllMatch = trimmed.match(/^\/approve-all$/i);
    const denyMatch = trimmed.match(/^\/deny\s+(\S+)(?:\s+(.+))?$/i);

    if (!approveMatch && !approveAllMatch && !denyMatch) return false;

    const senderId = message.sender.id ?? '';
    const isOwner = this.approvalAllowlist.has(senderId);

    const reply = async (replyText: string) => {
      const outbound: ChannelOutboundMessage = {
        channel: message.channel,
        conversationId: message.conversation.id,
        replyToMessageId: message.channelMessageId,
        sessionId: undefined,
        content: { text: replyText, format: 'markdown' },
      };
      await this.router.sendToChannel(outbound);
    };

    // /approve-all — approve all pending requests (owner only)
    if (approveAllMatch) {
      if (!isOwner) {
        await reply('⛔ Only bot owners can use `/approve-all`.');
        return true;
      }
      const allPending = this.approvalManager.getAllPendingRequests();
      if (allPending.length === 0) {
        await reply('ℹ️ No pending approval requests.');
        return true;
      }
      let approved = 0;
      for (const req of allPending) {
        if (this.approvalManager.approve(req.id, senderId)) approved++;
      }
      await reply(`✅ Approved ${approved} pending request(s).`);
      return true;
    }

    // /approve <id>
    if (approveMatch) {
      const requestId = approveMatch[1]!;
      const pending = this.approvalManager.getPendingRequest(requestId);
      if (!pending) {
        await reply(`⚠️ No pending approval found for \`${requestId}\`.`);
        return true;
      }
      // Owner can approve any request; requester can approve their own
      if (!isOwner && pending.requesterUserId && pending.requesterUserId !== senderId) {
        await reply(`⛔ You are not authorized to approve request \`${requestId}\`.`);
        return true;
      }
      const result = this.approvalManager.approve(requestId, senderId);
      await reply(
        result ? `✅ Approved request \`${requestId}\`.` : `⚠️ Request already resolved.`
      );
      return true;
    }

    // /deny <id> [reason]
    if (denyMatch) {
      const requestId = denyMatch[1]!;
      const reason = denyMatch[2] ?? 'Denied by user';
      const pending = this.approvalManager.getPendingRequest(requestId);
      if (!pending) {
        await reply(`⚠️ No pending approval found for \`${requestId}\`.`);
        return true;
      }
      if (!isOwner && pending.requesterUserId && pending.requesterUserId !== senderId) {
        await reply(`⛔ You are not authorized to deny request \`${requestId}\`.`);
        return true;
      }
      const result = this.approvalManager.deny(requestId, reason, senderId);
      await reply(result ? `⛔ Denied request \`${requestId}\`.` : `⚠️ Request already resolved.`);
      return true;
    }

    return false;
  }

  private async publishStatusEvent(
    sessionId: string,
    status: 'thinking' | 'tool' | 'done' | 'error',
    channelId: string,
    channelMessageId?: string,
    toolName?: string
  ): Promise<void> {
    try {
      const payload = { sessionId, status, channelId, channelMessageId, toolName };
      const envelope = createEnvelope('gateway', `status.${status}`, payload);
      await this.router.getBus().publish(TOPICS.status[status](sessionId), envelope);
    } catch (err) {
      // Status events are best-effort; do not let failures affect message processing
      logger.debug({ err, sessionId, status }, 'Failed to publish status event');
    }
  }

  private getReplyToMessageId(message: ChannelInboundMessage): string | undefined {
    const metadata = message.metadata as { thread_ts?: string } | undefined;
    return metadata?.thread_ts ?? message.channelMessageId;
  }

  private async registerManagementHandlers(): Promise<void> {
    const bus = this.router.getBus();
    if (!(bus instanceof NatsBusAdapter)) {
      return;
    }

    await registerManagementHandlers({
      getBus: () => bus,
      getSessionsStore: () => this.sessionsStore,
      getSubagentOrchestrator: () => this.subagentOrchestrator,
      getSandboxManager: () => this.sandboxManager,
      getToolSandboxConfig: () => this.options.toolSandboxConfig,
      listSubagents: () => this.listSubagents(),
      getSubagentInfo: (runId) => this.getSubagentInfo(runId),
      stopSubagent: (runId) => this.stopSubagent(runId),
      getSubagentLog: (runId) => this.getSubagentLog(runId),
      buildSandboxDecisionSamples: () => this.buildSandboxDecisionSamples(),
    });
  }

  /**
   * Start the gateway
   */
  async start(): Promise<void> {
    // Fail startup if state layer initialization fails (Issue #147)
    if (this._stateLayerInitPromise) {
      try {
        await this._stateLayerInitPromise;
      } catch (error) {
        logger.fatal({ err: error }, 'State layer initialization failed — aborting startup');
        throw error;
      }
    }

    if (this.options.auditConfig?.enabled) {
      const provider = await loadAuditProvider(this.options.auditConfig);
      this.auditLogger = new AuditLogger(provider);
      await this.auditLogger.init();
    }

    if (this.dlpConfig) {
      this.dlp = new DLPSecurityLayer(this.dlpConfig, this.auditLogger ?? undefined);
      logger.info('DLP security layer initialized');
    }

    // Initialize tool infrastructure
    this.approvalManager = new ApprovalManager();
    this.toolCache = new ToolCache();

    // Load skills via SkillsManager
    const skillToolConfigs = await this.skillsManager.init();

    // Initialize local tool handler for gateway-integrated tools (exec/shell)
    const { LocalToolHandler } = await import('./tools/local-tool-handler.js');
    const localToolsLogger = createLogger('local-tools');
    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';
    const localToolHandler = new LocalToolHandler({
      logger: localToolsLogger,
      shellConfig: {
        allowedTools: skillToolConfigs,
        securityMode,
      },
    });
    this.localToolHandler = localToolHandler;
    logger.info('Local tool handler initialized (exec/shell, browser)');

    this.toolCoordinator = new ToolCoordinator({
      bus: this.router.getBus(),
      cheese: this.cheese ?? undefined,
      cache: this.toolCache,
      approvalManager: this.approvalManager,
      securityMode: this.options.policyConfig?.securityMode ?? 'standard',
      localToolHandler,
    });
    logger.info('Tool coordinator initialized');

    // Update ToolExecutor with runtime deps that weren't available during construction
    this.toolExecutor.updateDeps({
      core: { toolCoordinator: this.toolCoordinator, scheduler: this.scheduler },
      security: { dlp: this.dlp },
    });

    this.approvalManager.on('approval-requested', async (request) => {
      const session = await this.sessionsStore.getSession(request.sessionId);
      if (!session) {
        logger.warn({ sessionId: request.sessionId }, 'Approval request for unknown session');
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
      await this.streamingManager.startSubscription(this.router.getBus() as NatsBusAdapter);
    }

    await this.registerManagementHandlers();

    this.startMemoryPipelineScheduler();
    this.startSessionSweeper();
    await this.router.getBus().subscribe(TOPICS.config.update, async (data) => {
      await this.handleConfigUpdate(data);
    });

    // Create health server
    const healthDeps: HealthCheckDeps = {
      checkDatabase: () => {
        try {
          this.sessionsStore.listSessions({ limit: 1 });
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

    // Start scheduler if enabled
    if (this.scheduler) {
      this.scheduler.setMessageBus(this.router.getBus());

      // Sync config-defined jobs before starting the scheduler loop.
      // Treat undefined as empty list so removing all jobs from config
      // correctly disables previously-configured jobs.
      await syncConfigJobs(this.scheduler, this.options.schedulerJobs ?? []);

      await this.scheduler.start();
      logger.info('Scheduler started');

      if (this.heartbeatManager) {
        await this.heartbeatManager.start();
        logger.info('Heartbeat manager started');
      }
    }

    this.isConnected = true;
    logger.info('Gateway started');

    // Hook: gateway:startup (fire-and-forget)
    try {
      void this.hooks.emit('gateway:startup', {
        instanceId: this.instanceId,
        channels: this.options.channels ?? [],
        securityMode: this.securityMode,
        streamingEnabled: this.options.streamingPassthrough ?? false,
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn({ err }, 'gateway:startup hook emission failed'));
    } catch (hookError) {
      logger.warn({ err: hookError }, 'gateway:startup hook failed');
    }
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

    try {
      const candidate = this.mergeConfigOverlay(
        baseConfig as unknown as Record<string, unknown>,
        update.changes
      ) as unknown as NachosConfig;
      validateConfigOrThrow(candidate);

      if (!update.dryRun) {
        await emitResult({
          requestId,
          success: false,
          message: 'Runtime config updates are disabled. Edit config and restart.',
          errors: ['runtime_config_updates_disabled'],
        });
      } else {
        await emitResult({
          requestId,
          success: true,
          message: 'Config update validated. Restart required to apply changes.',
        });
      }

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
        outcome: update.dryRun ? 'allowed' : 'denied',
        reason: update.dryRun ? undefined : 'Runtime config updates are disabled',
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
    // Hook: gateway:shutdown (fire-and-forget — best-effort during teardown)
    try {
      void this.hooks.emit('gateway:shutdown', {
        instanceId: this.instanceId,
        reason: 'api',
        timestamp: new Date().toISOString(),
      }).catch((err) => logger.warn({ err }, 'gateway:shutdown hook emission failed'));
    } catch (hookError) {
      logger.warn({ err: hookError }, 'gateway:shutdown hook failed');
    }

    this.isConnected = false;

    // Remove signal handlers
    this.removeSignalHandlers();

    if (this.healthServer && this.healthServer.server.listening) {
      await this.healthServer.stop();
    }

    // Cleanup Cheese
    if (this.cheese) {
      this.cheese.destroy();
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

    if (this.sessionSweeperInterval) {
      clearInterval(this.sessionSweeperInterval);
      this.sessionSweeperInterval = undefined;
    }

    this.streamingManager.stop();

    if (this.toolCache) {
      await this.toolCache.shutdown();
    }

    if (this.stateLayer) {
      await this.stateLayer.close();
    }

    if (this.subagentOrchestrator) {
      await this.subagentOrchestrator.shutdown();
    }

    if (this.localToolHandler) {
      await this.localToolHandler.close();
    }

    this.skillsManager.stop();

    if (this.heartbeatManager) {
      await this.heartbeatManager.stop();
      logger.info('Heartbeat manager stopped');
    }

    if (this.scheduler) {
      await this.scheduler.stop();
      logger.info('Scheduler stopped');
    }

    if (this.schedulerDb) {
      this.schedulerDb.close();
    }
    if (this.sessionsDb) {
      this.sessionsDb.close();
    }
    logger.info('Gateway stopped');
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received signal, shutting down gracefully...');
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
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
   * Get the sessions store
   */
  getSessionsStore(): SessionsStore {
    return this.sessionsStore;
  }

  /**
   * Get the hook registry so plugins can register lifecycle handlers.
   */
  getHookRegistry(): HookRegistry {
    return this.hooks;
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
    try {
      await this.auditLogger.log(event);
    } catch (err) {
      logger.warn({ err, eventType: event.eventType }, 'Failed to log audit event');
    }
  }

  /**
   * @deprecated Periodic DLP extraction replaced by session-end LLM extraction (startSessionSweeper).
   * Kept as no-op for backward compatibility — will be removed in a future release.
   */
  private startMemoryPipelineScheduler(): void {
    // No-op: periodic extraction is now handled by session-end LLM extraction.
    // The session sweeper (startSessionSweeper) closes inactive sessions and triggers
    // knowledge extraction via onSessionClosed().
    // Compaction-based extraction in router.ts still uses MemoryPipeline.storeExtracted() directly.
  }

  /**
   * Start the session sweeper — runs every 30 minutes.
   *
   * Responsibilities:
   * 1. Close active sessions that have been inactive longer than `inactivity_timeout`
   *    → triggers end-of-session LLM extraction
   * 2. Hard-delete closed sessions older than `archive_ttl`
   *    → knowledge already extracted into MemoryFacts; safe to delete
   */
  private startSessionSweeper(): void {
    const cfg = this.sessionsLifecycleConfig;
    const inactivityMs = parseDurationMs(cfg?.inactivity_timeout ?? '4h', 4 * 60 * 60 * 1000);
    const archiveTtlMs = parseDurationMs(cfg?.archive_ttl ?? '30d', 30 * 24 * 60 * 60 * 1000);

    // Run every 30 minutes
    const CHECK_INTERVAL_MS = 30 * 60 * 1000;

    this.sessionSweeperInterval = setInterval(() => {
      void this.runSessionSweep(inactivityMs, archiveTtlMs);
    }, CHECK_INTERVAL_MS);

    logger.info(
      {
        inactivityTimeout: cfg?.inactivity_timeout ?? '4h',
        archiveTtl: cfg?.archive_ttl ?? '30d',
      },
      'Session sweeper started'
    );
  }

  private async runSessionSweep(inactivityMs: number, archiveTtlMs: number): Promise<void> {
    try {
      const now = Date.now();
      const inactivityCutoff = new Date(now - inactivityMs).toISOString();
      const archiveCutoff = new Date(now - archiveTtlMs).toISOString();

      // 1. Close inactive sessions
      const inactiveSessions = await this.sessionsStore.findInactiveSessions(inactivityCutoff);
      for (const session of inactiveSessions) {
        logger.info(
          { sessionId: session.id, lastActivity: session.lastActivity },
          'Session sweeper: closing inactive session'
        );
        const closed = await this.sessionsStore.closeSession(session.id, 'inactivity');
        if (closed) {
          // Fire-and-forget extraction — never blocks session close
          void this.onSessionClosed(closed).catch((err) => {
            logger.warn({ err, sessionId: session.id }, 'Post-close extraction failed');
          });
        }
      }

      // 2. Hard-delete expired closed sessions (knowledge already in MemoryFacts)
      const expiredSessions = await this.sessionsStore.findExpiredClosedSessions(archiveCutoff);
      for (const session of expiredSessions) {
        logger.info(
          { sessionId: session.id, closedAt: session.closedAt },
          'Session sweeper: deleting expired closed session'
        );
        await this.sessionsStore.deleteSession(session.id);
      }

      if (inactiveSessions.length > 0 || expiredSessions.length > 0) {
        logger.info(
          { closed: inactiveSessions.length, deleted: expiredSessions.length },
          'Session sweeper cycle complete'
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Session sweeper cycle failed');
    }
  }

  /**
   * Called after a session is closed.
   * Extracts knowledge from the session's conversation into permanent MemoryFacts.
   * Runs async — errors are logged but never surface to callers.
   */
  private async onSessionClosed(session: import('@nachos/types').Session): Promise<void> {
    if (!this.stateLayer) return;

    const sessionWithMessages = await this.sessionsStore.getSessionWithMessages(session.id);
    if (!sessionWithMessages || sessionWithMessages.messages.length === 0) {
      logger.debug({ sessionId: session.id }, 'Session closed with no messages — skipping extraction');
      return;
    }

    const agentId = resolveAgentId(sessionWithMessages);
    const stateContext = buildStateContext(sessionWithMessages, this.securityMode);
    const llmCall = this.createExtractionLLMCall(session.id);

    const adapter = new LLMExtractionAdapter(llmCall, {
      agentId,
      sessionId: session.id,
      maxConversationChars: 60_000,
    });

    const extractionMessages: ExtractionMessage[] = sessionWithMessages.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const result = await adapter.extract(extractionMessages);

    if (result.facts.length === 0) {
      logger.debug({ sessionId: session.id }, 'No facts extracted from session');
      return;
    }

    // Dedup: fetch all existing facts for this agent, then filter to relevant subjects in-memory
    const subjects = new Set(result.facts.map((f) => f.subject));
    const allExistingFacts = await this.stateLayer.queryMemoryFacts(agentId, stateContext, undefined);
    const relevantExistingFacts = allExistingFacts.filter((fact) => subjects.has(fact.subject));

    const { toInsert, toUpdate } = deduplicateFacts(result.facts, relevantExistingFacts);

    if (toInsert.length > 0) {
      await this.stateLayer.appendMemoryFacts(toInsert, stateContext);
    }

    for (const fact of toUpdate) {
      await this.stateLayer.updateMemoryFact(fact, stateContext);
    }

    logger.info(
      {
        sessionId: session.id,
        agentId,
        inserted: toInsert.length,
        merged: toUpdate.length,
        total: result.rawCount,
      },
      'Session knowledge extraction complete'
    );
  }

  /**
   * Create a simple LLM call function for extraction.
   * Sends a direct request to the LLM bus topic, bypassing session routing,
   * context management, and rate limiting.
   */
  private createExtractionLLMCall(sessionId: string): LLMCallFn {
    return async ({ systemPrompt, userMessage, maxTokens }) => {
      const request: import('@nachos/types').LLMRequest = {
        sessionId: `extraction:${sessionId}`,
        messages: [
          { role: 'user', content: userMessage },
        ],
        options: {
          maxTokens: maxTokens ?? 2048,
        },
      };

      // Include system prompt as a system message
      if (systemPrompt) {
        request.messages = [
          { role: 'system', content: systemPrompt },
          ...request.messages,
        ];
      }

      const envelope = createEnvelope('gateway-extraction', 'llm.request', request);
      const rawResponse = await this.router
        .getBus()
        .request(TOPICS.llm.request, envelope, 60000);

      // Unwrap envelope: the bus may return { payload: LLMResponse } or LLMResponse directly
      const response = (
        rawResponse &&
        typeof rawResponse === 'object' &&
        'payload' in (rawResponse as object)
          ? (rawResponse as { payload: LLMResponseType }).payload
          : rawResponse
      ) as LLMResponseType | undefined;

      if (!response?.success || !response.message) return '';
      return coerceLLMContentText(response.message.content) ?? '';
    };
  }

  /**
   * Get the sessions store
   * @deprecated Use getSessionsStore() instead
   */
  getStorage(): SessionsStore {
    return this.sessionsStore;
  }

  /**
   * Get health status
   */
  getHealth() {
    const health = performHealthCheck({
      checkDatabase: () => {
        try {
          this.sessionsStore.listSessions({ limit: 1 });
          return true;
        } catch {
          return false;
        }
      },
      checkBus: () => this.isConnected,
      getHookStats: () => this.hooks.getStats(),
    });

    // Add Cheese statistics if available
    if (this.cheese) {
      const cheeseStats = this.cheese.getStats();
      return {
        ...health,
        cheese: {
          policiesLoaded: cheeseStats.policiesLoaded,
          rulesActive: cheeseStats.rulesActive,
          hasErrors: this.cheese.hasValidationErrors(),
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
      throw createConfigError('Subagent orchestration is not configured', { component: 'gateway' });
    }

    return this.subagentOrchestrator.enqueue(request);
  }

  listSubagents(): SubagentRunRecord[] {
    return this.subagentOrchestrator?.listRuns() ?? [];
  }

  stopSubagent(runId: string): boolean {
    return this.subagentOrchestrator?.stopRun(runId) ?? false;
  }

  async steerSubagent(runId: string, message: string): Promise<boolean> {
    return (await this.subagentOrchestrator?.steerRun(runId, message)) ?? false;
  }

  getSubagentInfo(runId: string): SubagentRunRecord | null {
    return this.subagentOrchestrator?.getRun(runId) ?? null;
  }

  async getSubagentLog(runId: string): Promise<{ runId: string; messages: Message[] } | null> {
    const run = this.subagentOrchestrator?.getRun(runId);
    if (!run) {
      return null;
    }
    return {
      runId: run.runId,
      messages: await this.sessionsStore.getMessages(run.childSessionId),
    };
  }

  /**
   * Get the policy engine (Cheese)
   */
  getCheese(): Cheese | null {
    return this.cheese;
  }

  /**
   * Evaluate a security request against policies
   * @param request - Security request to evaluate
   * @returns Security result with allow/deny decision
   */
  evaluatePolicy(request: SecurityRequest) {
    if (!this.cheese) {
      // If no policy engine is configured, allow by default
      return {
        allowed: true,
        effect: 'allow' as const,
        evaluationTimeMs: 0,
      };
    }

    return this.cheese.evaluate(request);
  }

  /**
   * Process an inbound message directly (for testing)
   */
  async processMessage(message: ChannelInboundMessage): Promise<Session> {
    const envelope = createEnvelope('test', 'channel.inbound', message);
    await this.handleInboundMessage(envelope);

    const session = await this.sessionsStore.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (!session) {
      throw createSessionNotFoundError('Session not found after processing message', {
        component: 'gateway',
      });
    }

    return session;
  }
}

/**
 * Parse a duration string (e.g. '4h', '30m', '30d') into milliseconds.
 * Returns the default value if parsing fails.
 */
function parseDurationMs(value: string, defaultMs: number = 4 * 60 * 60 * 1000): number {
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) return defaultMs;
  const amount = Number.parseInt(match[1] ?? '', 10);
  const unit = (match[2] ?? '').toLowerCase();
  if (Number.isNaN(amount)) return defaultMs;

  switch (unit) {
    case 'ms': return amount;
    case 's': return amount * 1000;
    case 'm': return amount * 60 * 1000;
    case 'h': return amount * 60 * 60 * 1000;
    case 'd': return amount * 24 * 60 * 60 * 1000;
    default: return defaultMs;
  }
}
