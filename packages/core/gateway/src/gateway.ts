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
import {
  createSessionNotFoundError,
  createInvalidStateError,
  createConfigError,
  createLogger,
} from '@nachos/types';

const logger = createLogger('gateway');
import { TOPICS } from '@nachos/bus';
import {
  SessionsSpawnToolSchema,
  SessionsOrchestrateToolSchema,
  SubagentsToolSchema,
  SubagentProgressToolSchema,
  BootstrapToolSchema,
  UserProfileToolSchema,
  validateChannelInboundMessage,
} from '@nachos/types';
import {
  MemorySearchToolSchema,
  MemoryGetToolSchema,
  executeMemorySearch,
  executeMemoryGet,
} from './tools/memory-tools.js';
import {
  WebSearchToolSchema,
  executeWebSearch,
  type WebSearchConfig,
} from './tools/web-search-tools.js';
import {
  WebFetchNativeToolSchema,
  executeWebFetchNative,
  type WebFetchConfig,
} from './tools/web-fetch-tools.js';
import {
  BitbucketToolSchema,
  executeBitbucket,
  type BitbucketConfig,
} from './tools/bitbucket-tools.js';
import {
  ComposioToolSchema,
  executeComposio,
  initComposioClient,
} from './tools/composio-tools.js';
import {
  GitHubToolSchema,
  executeGitHub,
  type GitHubConfig,
} from './tools/github-tools.js';
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
} from './tools/cron-tools.js';
import { getExternalToolDefinitions } from './tools/external-tool-definitions.js';
import { Scheduler, HeartbeatManager, type SchedulerConfig, type HeartbeatConfig } from './scheduler/index.js';
import type {
  AuditConfig,
  ContextManagementCommandsConfig,
  RuntimeToolSandboxConfig,
  SkillsConfig,
  SubagentToolProfileConfig,
  SubagentToolPolicyConfig,
  ToolGroupConfig,
  ToolsConfig,
  NachosConfig,
} from '@nachos/config';
import { loadAndValidateConfig, validateConfigOrThrow } from '@nachos/config';
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
import type { ToolCall, ToolResult } from '@nachos/types';
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
import type { ContextManager } from '@nachos/context-manager';
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
import type { Skill } from './skills/skill-loader.js';
import type { SkillToolConfig } from './tools/shell-tool.js';
import {
  readOptionalString,
  readOptionalStringArray,
  readOptionalNumber,
  readOptionalBoolean,
  readOptionalStringMap,
  readTimeoutMs,
  readCleanup,
  stringifyToolParameters,
  coerceLLMContentText,
} from './utils/parsing.js';
import { registerManagementHandlers } from './management/management-handlers.js';

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
  state: ['memory', 'user_profile', 'bootstrap'],
  browser: [
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_fill',
    'browser_select_option',
    'browser_hover',
    'browser_press_key',
    'browser_screenshot',
    'browser_evaluate',
    'browser_wait',
    'browser_close',
    'browser_go_back',
    'browser_go_forward',
    'browser_tab_new',
    'browser_tab_close',
    'browser_tab_list',
    'browser_pdf_save',
  ],
};

/**
 * Browser tool definitions exposed to the LLM.
 * These map to @playwright/mcp tools and are executed locally in the gateway.
 * Disabled for now - uncomment when browser tools are ready
 */
/* const BROWSER_TOOL_DEFINITIONS: Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Capture an accessibility snapshot of the current page. Returns a structured ARIA tree with element references (ref) that can be used to target elements in subsequent actions like click, type, and fill.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Specific element ref to snapshot (optional)' },
      },
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page using its ref from a snapshot.',
    parameters: {
      type: 'object',
      properties: {
        element: {
          type: 'string',
          description: 'Human-readable description of the element to click',
        },
        ref: { type: 'string', description: 'Exact ref value from the accessibility snapshot' },
      },
      required: ['element', 'ref'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an editable element identified by its ref.',
    parameters: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the element' },
        ref: { type: 'string', description: 'Exact ref value from the accessibility snapshot' },
        text: { type: 'string', description: 'Text to type' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
      },
      required: ['element', 'ref', 'text'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Clear and fill an input field identified by its ref.',
    parameters: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the element' },
        ref: { type: 'string', description: 'Exact ref value from the accessibility snapshot' },
        value: { type: 'string', description: 'Value to fill' },
      },
      required: ['element', 'ref', 'value'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select an option in a dropdown identified by its ref.',
    parameters: {
      type: 'object',
      properties: {
        element: {
          type: 'string',
          description: 'Human-readable description of the select element',
        },
        ref: { type: 'string', description: 'Exact ref value from the accessibility snapshot' },
        values: { type: 'array', items: { type: 'string' }, description: 'Values to select' },
      },
      required: ['element', 'ref', 'values'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element identified by its ref.',
    parameters: {
      type: 'object',
      properties: {
        element: { type: 'string', description: 'Human-readable description of the element' },
        ref: { type: 'string', description: 'Exact ref value from the accessibility snapshot' },
      },
      required: ['element', 'ref'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key or combination (e.g. "Enter", "Control+c", "ArrowDown").',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key or key combination to press' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a screenshot of the current page. Use browser_snapshot for structured data instead when possible.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute JavaScript in the browser page context.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a specified amount of time.',
    parameters: {
      type: 'object',
      properties: {
        time: { type: 'number', description: 'Time to wait in seconds (max 10)' },
      },
      required: ['time'],
    },
  },
  {
    name: 'browser_close',
    description: 'Close the current browser page.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_go_back',
    description: 'Navigate back in browser history.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_go_forward',
    description: 'Navigate forward in browser history.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_tab_new',
    description: 'Open a new browser tab, optionally navigating to a URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate the new tab to (optional)' },
      },
    },
  },
  {
    name: 'browser_tab_close',
    description: 'Close a browser tab by its index.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index to close' },
      },
      required: ['index'],
    },
  },
  {
    name: 'browser_tab_list',
    description: 'List all open browser tabs.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_pdf_save',
    description: 'Save the current page as a PDF.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]; */

type ResolvedContextCommandConfig = {
  enabled: boolean;
  allowInDms: boolean;
  allowInChannels: boolean;
  adminAllowlist: Set<string>;
  resetTriggers: string[];
  contextTriggers: string[];
  identityTriggers: string[];
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
  /** Tool configuration from nachos.toml */
  toolsConfig?: ToolsConfig;
  /** Skills configuration from nachos.toml */
  skillsConfig?: SkillsConfig;
  /** Full Nachos config (for skills gating) */
  nachosConfig?: NachosConfig;
  /** Scheduler configuration */
  schedulerConfig?: SchedulerConfig;
  /** Heartbeat configuration */
  heartbeatConfig?: HeartbeatConfig;
}

/**
 * Gateway class - orchestrates sessions, routing, and health
 */
export class Gateway {
  private storage: StateStorage;
  private sessionManager: SessionManager;
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
      createdAt: number;
    }
  > = new Map();
  private streamingSessionSweepInterval?: NodeJS.Timeout;
  private approvalAllowlist: Set<string>;
  private toolGroupMap: Map<string, string>;
  private skillsPrompt: string | null = null;
  private skillsDir: string | null = null;
  private currentSkills: Skill[] = [];
  private skillWatcher: any = null;
  private toolsConfig?: ToolsConfig;
  private skillsConfig?: SkillsConfig;
  private nachosConfig?: NachosConfig;
  // H2: Memory tool rate limiting (10 calls per minute per session)
  private memoryToolCalls: Map<string, number[]> = new Map();
  private scheduler?: Scheduler;
  private heartbeatManager?: HeartbeatManager;
  private schedulerConfig?: SchedulerConfig;
  private heartbeatConfig?: HeartbeatConfig;

  constructor(options: GatewayOptions = {}) {
    this.options = options;
    this.instanceId = options.instanceId ?? 'gateway';
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
    if (options.toolSandboxConfig) {
      this.sandboxManager = new SandboxManager(options.toolSandboxConfig, {
        workspaceDir: options.workspaceDir,
      });
    }

    // Initialize storage (SQLite by default for backwards compatibility)
    // Copilot fix #4: Check provider config and throw error if postgres is configured
    const sessionsProvider = options.stateLayerConfig?.sessions?.provider ?? 'sqlite';
    if (sessionsProvider === 'postgres') {
      throw new Error(
        'Postgres sessions provider is not yet wired up in the Gateway. ' +
        'Please use "sqlite" provider in runtime.state.sessions or remove the provider config to use default SQLite.'
      );
    }
    const dbPath = options.stateLayerConfig?.sessions?.sqlite?.dbPath ?? options.dbPath ?? ':memory:';
    this.storage = new StateStorage(dbPath);

    // Initialize session manager
    this.sessionManager = new SessionManager(this.storage);

    // Initialize scheduler
    this.schedulerConfig = options.schedulerConfig;
    this.heartbeatConfig = options.heartbeatConfig;
    if (this.schedulerConfig?.enabled) {
      this.scheduler = new Scheduler(
        this.storage.getDatabase(),
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
      this.stateLayer.init().catch((error) => {
        console.error('[Gateway] Failed to initialize state layer:', error);
      });
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
    let messageText = message.content.text ?? '';
    const securityMode = this.options.policyConfig?.securityMode ?? 'standard';

    // --- Early intercept: approval commands work from ANY channel/session ---
    if (this.approvalManager && messageText) {
      logger.info({ messageText: messageText.slice(0, 100), senderId: message.sender.id }, 'Checking for approval command');
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

    const existingSession = await this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    // Get or create session for this conversation
    let session = await this.sessionManager.getOrCreateSession({
      channel: message.channel,
      conversationId: message.conversation.id,
      userId: message.sender.id,
      systemPrompt: this.options.defaultSystemPrompt,
    });

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
      await this.sessionManager.addMessage(session.id, {
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
        this.streamingSessions.set(session.id, {
          inbound: message,
          buffer: '',
          lastSentAt: 0,
          lastSentLength: 0,
          createdAt: Date.now(),
        });
      }

      void this.publishStatusEvent(session.id, 'thinking', message.conversation.id, message.channelMessageId ?? undefined);

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

      void this.publishStatusEvent(session.id, 'error', message.conversation.id, message.channelMessageId ?? undefined);

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
    };
  }

  private buildSkillToolConfigs(skills: Skill[]): SkillToolConfig[] {
    const configs = new Map<string, SkillToolConfig>();

    for (const skill of skills) {
      const bins = skill.metadata.nachos?.requires?.bins ?? [];
      const requiredEnv = skill.metadata.nachos?.requires?.env ?? [];
      for (const bin of bins) {
        if (configs.has(bin)) {
          continue;
        }
        const group = this.resolveToolGroup(bin) ?? 'shell';
        configs.set(bin, {
          bin,
          group,
          requiredEnv,
        });
      }
    }

    return Array.from(configs.values());
  }

  private parseContextCommand(
    text: string,
    config: ResolvedContextCommandConfig
  ): { type: 'reset' | 'context' | 'identity'; trigger: string; remainder: string } | null {
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
        const allowlist = config.adminAllowlist.size > 0 ? config.adminAllowlist : this.approvalAllowlist;
        const senderId = message.sender.id ?? '';
        
        if (allowlist.size > 0 && !allowlist.has(senderId)) {
          return {
            handled: true,
            replyText: '⛔ You are not authorized to reset identity. This action is restricted to administrators.',
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
      await this.sessionManager.updateMetadata(session.id, {
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
      await this.sessionManager.updateMetadata(session.id, {
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
      await this.sessionManager.updateMetadata(session.id, updatedMetadata);
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
    const previous = await this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (previous) {
      await this.sessionManager.deleteSession(previous.id);
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
    }

    const newSession = await this.sessionManager.createSession({
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
  ): Promise<LLMRequestType & { systemPromptTokens?: number; promptReport?: PromptReport }> {
    const session = await this.sessionManager.getSessionWithMessages(sessionId);
    if (!session) {
      throw createSessionNotFoundError('Session not found', { component: 'gateway' });
    }

    const messages: LLMRequestType['messages'] = [];
    const basePrompt = session.systemPrompt ?? this.options.defaultSystemPrompt ?? '';

    let prompt = basePrompt;
    let promptReport: PromptReport | undefined;
    let systemPromptTokens = 0;
    let bootstrapLocked = false;

    if (this.stateLayer) {
      const context = this.buildStateContext(session);
      const agentId = this.resolveAgentId(session);
      const isSubagent = this.isSubagentSession(session);

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
        const memory = isSubagent
          ? { entries: [], facts: [] }
          : await this.stateLayer.queryMemory({ agentId, limit: 200 }, context);
        const sessionState = isSubagent
          ? null
          : await this.stateLayer.getSessionState(sessionId, context);

        const assembled = this.stateLayer.assemblePrompt({
          basePrompt,
          bootstrap,
          identity,
          userProfile,
          memoryEntries: memory.entries,
          memoryFacts: memory.facts,
          sessionState,
          skills: this.skillsPrompt,
          includeMemoryInstructions: true, // Add memory recall instructions
        });

        prompt = assembled.prompt;
        promptReport = assembled.report;
        systemPromptTokens = assembled.report.totalTokens ?? 0;

        await this.sessionManager.updateMetadata(sessionId, {
          promptReport: assembled.report,
          promptReportUpdatedAt: assembled.report.generatedAt,
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
      if (message.role === 'assistant' && message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
        // Include tool_use blocks so the LLM adapter can reconstruct the full assistant turn
        const contentBlocks: unknown[] = [];
        if (message.content) {
          contentBlocks.push({ type: 'text', text: message.content });
        }
        for (const tc of message.toolCalls as Array<{ id: string; name: string; arguments: string }>) {
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

    const tools = this.buildToolDefinitions(session, { bootstrapLocked });

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

  private buildToolDefinitions(
    session: Session,
    options?: { bootstrapLocked?: boolean }
  ): LLMRequestType['tools'] {
    if (this.isSubagentSession(session)) {
      return this.buildSubagentToolDefinitions();
    }

    const tools: NonNullable<LLMRequestType['tools']> = [];
    const bootstrapLocked = Boolean(options?.bootstrapLocked);

    if (this.subagentManager) {
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

    // Memory tools - re-enabled with usage gating
    // These tools allow the LLM to query stored memories
    if (this.stateLayer && !bootstrapLocked) {
      tools.push({
        name: 'memory_search',
        description: 'Search stored memories (past decisions, preferences, facts, tasks). Use ONLY when answering questions about prior work, user preferences, past decisions, or context from previous sessions. DO NOT use for current conversation context or general knowledge.',
        parameters: this.sanitizeToolSchema(MemorySearchToolSchema),
      });
      
      tools.push({
        name: 'memory_get',
        description: 'Read specific memory file sections (MEMORY.md, memory/YYYY-MM-DD.md, AGENTS.md, etc.). Use when you need full file content or specific line ranges. Complements memory_search for detailed context.',
        parameters: this.sanitizeToolSchema(MemoryGetToolSchema),
      });
    }

    // GitHub tool - interact with GitHub via gh CLI
    if (this.toolsConfig?.github?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'github',
        description: 'Interact with GitHub: list/view/create issues and PRs, view CI status, search code, and more. All actions use the gh CLI.',
        parameters: this.sanitizeToolSchema(GitHubToolSchema),
      });
    }
    
    // Cron scheduler tools - manage scheduled tasks
    if (this.scheduler && !bootstrapLocked) {
      tools.push({
        name: 'nachos_cron_add',
        description: 'Create a new scheduled task. Supports one-shot (at), interval (every), and cron expressions.',
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

    // User profile tool - manage per-user preferences and settings
    if (this.stateLayer) {
      tools.push({
        name: 'user_profile',
        description: 'Manage user-specific preferences and settings. Get, set, or delete user profile data for personalization.',
        parameters: this.sanitizeToolSchema(UserProfileToolSchema),
      });
    }

    // Bootstrap tool - manage agent onboarding and identity
    if (this.stateLayer && this.toolsConfig?.bootstrap?.enabled !== false && !bootstrapLocked) {
      tools.push({
        name: 'bootstrap',
        description: 'Manage agent onboarding and identity configuration. Used during initial setup to gather agent information.',
        parameters: this.sanitizeToolSchema(BootstrapToolSchema),
      });
    }

    // Bitbucket tool - interact with Bitbucket repositories via REST API
    if (this.toolsConfig?.bitbucket?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'bitbucket',
        description: 'Interact with Bitbucket: list/view/create issues and PRs, view pipeline status, search code, and more. All actions use the Bitbucket REST API v2.0.',
        parameters: this.sanitizeToolSchema(BitbucketToolSchema),
      });
    }

    // Composio tool - execute actions on integrated apps (Gmail, Calendar, Docs, etc.)
    if (this.toolsConfig?.composio?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'composio',
        description: 'Execute actions on integrated productivity apps via Composio. Supports Gmail (send/read/search emails), Google Calendar (create/manage events), Google Docs (create/edit documents), Google Meet (schedule meetings), Google Drive (manage files), and LinkedIn (post updates). Use this when you need to interact with these external services.',
        parameters: this.sanitizeToolSchema(ComposioToolSchema),
      });
    }

    // Web search tool - native Brave Search API integration
    if (this.toolsConfig?.web_search?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'web_search',
        description: 'Search the web using Brave Search API. Returns titles, URLs, and snippets. Use for finding information, news, documentation, or current events.',
        parameters: this.sanitizeToolSchema(WebSearchToolSchema),
      });
    }

    // Web fetch native tool - lightweight URL fetching without Docker
    if (this.toolsConfig?.web_fetch?.enabled && !bootstrapLocked) {
      tools.push({
        name: 'web_fetch_native',
        description: 'Fetch and extract readable content from a URL. Converts HTML to markdown or plain text. Lighter alternative to the Docker-based web_fetch tool.',
        parameters: this.sanitizeToolSchema(WebFetchNativeToolSchema),
      });
    }

    // Browser automation tools disabled temporarily — not needed for chat
    // tools.push(...BROWSER_TOOL_DEFINITIONS);

    // External container-based tools (filesystem, web_fetch, code_runner)
    // These are executed via NATS request/reply to their respective containers
    const externalTools = getExternalToolDefinitions(this.toolsConfig);
    for (const extTool of externalTools) {
      tools.push({
        name: extTool.name,
        description: extTool.description,
        parameters: extTool.parameters,
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

  /**
   * Build tool definitions for subagent sessions.
   * Subagents get a limited set of tools, primarily for reporting progress.
   */
  private buildSubagentToolDefinitions(): LLMRequestType['tools'] {
    const tools: NonNullable<LLMRequestType['tools']> = [];

    // Progress reporting tool - allows subagents to report progress
    tools.push({
      name: 'subagent_progress',
      description:
        'Report progress on the current task. Use this to keep the requester informed of your progress. The runId is automatically determined from your session context.',
      parameters: this.sanitizeToolSchema(SubagentProgressToolSchema),
    });

    return tools;
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
    toolCalls: Array<{ id: string; name: string; arguments: string }>,
    statusMeta?: { channelId: string; channelMessageId?: string }
  ): Promise<LLMRequestType['messages']> {
    logger.info({ sessionId, tools: toolCalls.map(tc => tc.name) }, 'Executing tool calls');
    if (!this.toolCoordinator) {
      throw createInvalidStateError('Tool coordinator not initialized', { component: 'gateway' });
    }

    const session = await this.sessionManager.getSession(sessionId);

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
        if (statusMeta) {
          void this.publishStatusEvent(sessionId, 'tool', statusMeta.channelId, statusMeta.channelMessageId, call.tool);
        }
        localResults.push({ index: i, result: localResult });
        continue;
      }

      if (this.sandboxManager) {
        const sandboxDecision = this.sandboxManager.resolveToolSandbox(session);
        if (sandboxDecision.enabled && sandboxDecision.config) {
          call.sandbox = sandboxDecision.config;
        }
      }

      if (statusMeta) {
        void this.publishStatusEvent(sessionId, 'tool', statusMeta.channelId, statusMeta.channelMessageId, call.tool);
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
      const stream = typeof call.parameters.stream === 'boolean' ? call.parameters.stream : undefined;
      const cleanup = this.readCleanup(call.parameters.cleanup);
      const timeoutMs = this.readTimeoutMs(call.parameters.runTimeoutSeconds);

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

    if (call.tool === 'sessions_orchestrate') {
      if (!this.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Subagent execution is not configured');
      }

      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for workflow orchestration');
      }

      const steps = call.parameters.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        return this.formatToolError('INVALID_PARAMETERS', 'steps array is required');
      }

      // Build workflow definition
      const workflow: import('./subagents/dependency-graph.js').WorkflowDefinition = {
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
            model: this.readOptionalString(s.model),
            modelHint: s.modelHint,
            stream: typeof s.stream === 'boolean' ? s.stream : undefined,
          };
        }),
      };

      const workflowRecord = await this.subagentOrchestrator.enqueueWorkflow(workflow, {
        sessionId: session.id,
        channel: session.channel,
        conversationId: session.conversationId,
        userId: session.userId,
      });

      const payload = {
        status: 'accepted',
        workflowId: workflowRecord.workflowId,
        totalBatches: workflowRecord.totalBatches,
      };

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    }

    if (call.tool === 'subagent_progress') {
      if (!this.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Subagent execution is not configured');
      }

      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }

      // Extract runId from session metadata (only available in subagent sessions)
      const subagentMetadata = session.metadata?.subagent as { runId?: string } | undefined;
      const runId = subagentMetadata?.runId;
      if (!runId) {
        return this.formatToolError(
          'NOT_SUBAGENT_SESSION',
          'Progress reporting is only available within subagent sessions'
        );
      }

      const status = this.readOptionalString(call.parameters.status);
      if (!status) {
        return this.formatToolError('INVALID_PARAMETERS', 'status is required');
      }

      const percentage =
        typeof call.parameters.percentage === 'number' ? call.parameters.percentage : undefined;
      const metadata =
        typeof call.parameters.metadata === 'object' && call.parameters.metadata !== null
          ? (call.parameters.metadata as Record<string, unknown>)
          : undefined;

      const success = this.subagentOrchestrator.reportProgress(runId, status, percentage, metadata);

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
      if (!this.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory search');
      }

      // H2: Rate limit memory_search calls (10 per minute per session)
      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = { ...this.buildStateContext(session), internalTool: true };
      return executeMemorySearch(call, this.stateLayer, context);
    }

    if (call.tool === 'memory_get') {
      if (!this.stateLayer) {
        return this.formatToolError('STATE_LAYER_DISABLED', 'Memory is not configured');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for memory get');
      }

      // H2: Rate limit memory_get calls (10 per minute per session)
      const rateLimitResult = this.checkMemoryToolRateLimit(session.id);
      if (!rateLimitResult.allowed) {
        return this.formatToolError(
          'RATE_LIMIT_EXCEEDED',
          `Memory tool rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds} seconds.`
        );
      }

      const context = { ...this.buildStateContext(session), internalTool: true };
      return executeMemoryGet(call, this.stateLayer, context);
    }

    // GitHub tool
    if (call.tool === 'github') {
      if (!this.toolsConfig?.github?.enabled) {
        return this.formatToolError('GITHUB_DISABLED', 'GitHub tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      
      const githubConfig: GitHubConfig = {
        enabled: true,
        default_repo: this.toolsConfig.github.default_repo,
        token_env: this.toolsConfig.github.token_env || 'GITHUB_TOKEN',
        repo_allowlist: this.toolsConfig.github.repo_allowlist,
      };
      return executeGitHub(call, githubConfig, session.userId);
    }

    // Cron scheduler tools
    if (call.tool === 'nachos_cron_add') {
      if (!this.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronAdd(call, this.scheduler, session.userId, session.id);
    }

    if (call.tool === 'nachos_cron_list') {
      if (!this.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronList(call, this.scheduler, session.userId, session.id);
    }

    if (call.tool === 'nachos_cron_remove') {
      if (!this.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronRemove(call, this.scheduler, session.userId);
    }

    if (call.tool === 'nachos_cron_update') {
      if (!this.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronUpdate(call, this.scheduler, session.userId);
    }

    if (call.tool === 'nachos_cron_run') {
      if (!this.scheduler) {
        return this.formatToolError('SCHEDULER_DISABLED', 'Scheduler is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      return executeCronRun(call, this.scheduler, session.userId);
    }

    if (call.tool === 'bootstrap') {
      return this.executeBootstrapToolCall(call, session);
    }

    if (call.tool === 'user_profile') {
      return this.executeUserProfileToolCall(call, session);
    }

    if (call.tool === 'bitbucket') {
      if (!this.toolsConfig?.bitbucket?.enabled) {
        return this.formatToolError('BITBUCKET_DISABLED', 'Bitbucket tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }
      const bitbucketConfig: BitbucketConfig = {
        enabled: true,
        default_workspace: this.toolsConfig.bitbucket.default_workspace,
        auth_type: this.toolsConfig.bitbucket.auth_type || 'app_password',
        username_env: this.toolsConfig.bitbucket.username_env || 'BITBUCKET_USERNAME',
        password_env: this.toolsConfig.bitbucket.password_env || 'BITBUCKET_APP_PASSWORD',
        token_env: this.toolsConfig.bitbucket.token_env || 'BITBUCKET_TOKEN',
        workspace_allowlist: this.toolsConfig.bitbucket.workspace_allowlist,
      };
      return executeBitbucket(call, bitbucketConfig, session.userId);
    }

    if (call.tool === 'composio') {
      if (!this.toolsConfig?.composio?.enabled) {
        return this.formatToolError('COMPOSIO_DISABLED', 'Composio tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for Composio tool');
      }

      const context = { ...this.buildStateContext(session), internalTool: false };
      return executeComposio(call, this.stateLayer!, context);
    }

    if (call.tool === 'web_search') {
      if (!this.toolsConfig?.web_search?.enabled) {
        return this.formatToolError('WEB_SEARCH_DISABLED', 'Web search tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }

      const apiKeyEnv = this.toolsConfig.web_search.api_key_env || 'BRAVE_API_KEY';
      const apiKey = process.env[apiKeyEnv];
      if (!apiKey) {
        return this.formatToolError(
          'API_KEY_MISSING',
          `Brave Search API key not found in environment variable: ${apiKeyEnv}`
        );
      }

      const webSearchConfig: WebSearchConfig = {
        api_key: apiKey,
        default_country: this.toolsConfig.web_search.default_country,
        safe_search: this.toolsConfig.web_search.safe_search,
        max_results: this.toolsConfig.web_search.max_results,
      };

      return executeWebSearch(call, webSearchConfig, session.userId);
    }

    if (call.tool === 'web_fetch_native') {
      if (!this.toolsConfig?.web_fetch?.enabled) {
        return this.formatToolError('WEB_FETCH_DISABLED', 'Web fetch tool is not enabled');
      }
      if (!session) {
        return this.formatToolError('SESSION_NOT_FOUND', 'Session not found');
      }

      const webFetchConfig: WebFetchConfig = {
        timeout_ms: this.toolsConfig.web_fetch.timeout_ms,
        max_chars: this.toolsConfig.web_fetch.max_chars,
        domain_allowlist: this.toolsConfig.web_fetch.domain_allowlist,
      };

      return executeWebFetchNative(call, webFetchConfig, session.userId);
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

  private async executeBootstrapToolCall(
    call: ToolCall,
    session: Session | null
  ): Promise<ToolResult> {
    if (this.toolsConfig?.bootstrap?.enabled === false) {
      return this.formatToolError('TOOL_DISABLED', 'bootstrap tool is disabled');
    }

    if (!this.stateLayer) {
      return this.formatToolError('STATE_LAYER_DISABLED', 'State layer is not configured');
    }

    if (!session) {
      return this.formatToolError('SESSION_NOT_FOUND', 'Session not found for bootstrap tool');
    }

    const action = this.readOptionalString(call.parameters.action);
    if (!action) {
      return this.formatToolError('INVALID_PARAMETERS', 'action is required');
    }

    const identityCompleted = this.readOptionalBoolean(call.parameters.identityCompleted);

    const agentId = this.resolveAgentId(session);
    const context = { ...this.buildStateContext(session), internalTool: true };

    if (await this.getIdentityCompletionStatus(session)) {
      if (action !== 'get') {
        return this.formatToolError(
          'TOOL_DISABLED',
          'bootstrap is locked after identity completion; use /identity reset to restart onboarding'
        );
      }
    }

    if (action === 'get') {
      const profile = await this.stateLayer.getBootstrap(agentId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile }, null, 2) }],
      };
    }

    if (action === 'set') {
      const content = this.readOptionalStringMap(call.parameters.content);
      if (!content) {
        return this.formatToolError('INVALID_PARAMETERS', 'content is required');
      }

      const current = await this.stateLayer.getBootstrap(agentId, context);
      const nextContent = { ...content };
      if (identityCompleted) {
        delete nextContent.bootstrap;
      }
      const stored = await this.stateLayer.putBootstrap(
        {
          agentId,
          content: nextContent,
          updatedAt: new Date().toISOString(),
          version: current?.version ? current.version + 1 : 1,
        },
        context
      );

      if (identityCompleted) {
        await this.markIdentityCompleted(agentId, nextContent, context);
      }

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ profile: stored }, null, 2) }],
      };
    }

    if (action === 'delete') {
      await this.stateLayer.deleteBootstrap(agentId, context);
      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    return this.formatToolError('INVALID_PARAMETERS', `unknown bootstrap action: ${action}`);
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
      const log = await this.getSubagentLog(runId);
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

    if (action === 'stop') {
      const stopped = this.subagentOrchestrator.stopRun(runId);
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
      const message = this.readOptionalString(call.parameters.message);
      if (!message) {
        return this.formatToolError('INVALID_PARAMETERS', 'message is required for steer action');
      }

      const steered = await this.steerSubagent(runId, message);
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
      if (!this.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Workflow orchestration is not configured');
      }

      const workflows = this.subagentOrchestrator.listWorkflows();
      // Convert Map to plain object for JSON serialization
      const serializedWorkflows = workflows.map((wf) => ({
        ...wf,
        stepResults: Object.fromEntries(wf.stepResults),
      }));

      return {
        success: true,
        content: [{ type: 'text', text: JSON.stringify({ workflows: serializedWorkflows }, null, 2) }],
      };
    }

    if (action === 'workflow_info') {
      if (!this.subagentOrchestrator) {
        return this.formatToolError('SUBAGENT_DISABLED', 'Workflow orchestration is not configured');
      }

      const workflowId = this.readOptionalString(call.parameters.workflowId);
      if (!workflowId) {
        return this.formatToolError('INVALID_PARAMETERS', 'workflowId is required for workflow_info action');
      }

      const workflow = this.subagentOrchestrator.getWorkflow(workflowId);
      if (!workflow) {
        return this.formatToolError('NOT_FOUND', 'Workflow not found');
      }

      // Convert Map to plain object for JSON serialization
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
            await this.router.getBus().publish(
              TOPICS.channel.inbound(job.deliveryChannel),
              envelope
            );

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
            await this.router.getBus().publish(
              TOPICS.channel.inbound(job.deliveryChannel),
              envelope
            );

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

  // Utility parsing methods delegate to extracted functions in utils/parsing.ts
  private readOptionalString(value: unknown) { return readOptionalString(value); }
  private readOptionalStringArray(value: unknown) { return readOptionalStringArray(value); }
  private readOptionalNumber(value: unknown, limits?: { min?: number; max?: number }) { return readOptionalNumber(value, limits); }
  private readOptionalBoolean(value: unknown) { return readOptionalBoolean(value); }

  private async getIdentityCompletionStatus(session: Session): Promise<boolean> {
    if (!this.stateLayer) {
      return false;
    }
    const agentId = this.resolveAgentId(session);
    const context = { ...this.buildStateContext(session), internalTool: true };
    const identity = await this.stateLayer.getIdentity(agentId, context);
    return Boolean(identity?.identityCompleted);
  }

  private async resetIdentityForCommand(session: Session): Promise<void> {
    if (!this.stateLayer) {
      return;
    }

    const agentId = this.resolveAgentId(session);
    const context = { ...this.buildStateContext(session), internalTool: true };
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

  private readOptionalStringMap(value: unknown) { return readOptionalStringMap(value); }
  private readTimeoutMs(value: unknown) { return readTimeoutMs(value); }
  private readCleanup(value: unknown) { return readCleanup(value); }

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
        logger.warn({ sessionId, toolIteration }, 'Max tool iterations reached, forcing text response');
        if (!responseText) {
          responseText = 'I got caught in a loop processing your request. Could you try rephrasing?';
        }
        // Fall through to send responseText
      } else {
        await this.sessionManager.addMessage(sessionId, {
          role: 'assistant',
          content: responseText,
          toolCalls,
        });

        const toolMessages = await this.executeToolCalls(sessionId, toolCalls, {
          channelId: inbound.conversation.id,
          channelMessageId: inbound.channelMessageId ?? undefined,
        });

        // Store tool result messages in session so multi-turn history is complete
        // (tool_use blocks need matching tool_result blocks in subsequent requests)
        for (const toolMsg of toolMessages) {
          await this.sessionManager.addMessage(sessionId, {
            role: 'tool',
            content: typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content),
          });
        }

        // Tool results are now in session history; no extraMessages needed
        const followUp = await this.requestLLMResponse(sessionId);
        await this.sendLLMResponse(inbound, sessionId, followUp, toolIteration + 1);
        return;
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
      await this.sessionManager.addMessage(sessionId, {
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
    void this.publishStatusEvent(sessionId, 'done', inbound.conversation.id, inbound.channelMessageId ?? undefined);
  }

  private stringifyToolParameters(parameters: Record<string, unknown>) { return stringifyToolParameters(parameters); }
  private coerceLLMContentText(content: unknown) { return coerceLLMContentText(content); }

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
    const trimmed = text.trim().replace(/^(<@!?\d+>\s*)+/, '').trim();
    logger.info({ originalText: text.slice(0, 100), trimmedText: trimmed.slice(0, 100) }, 'Approval command parsing');
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
      await reply(result ? `✅ Approved request \`${requestId}\`.` : `⚠️ Request already resolved.`);
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

  /**
   * H2: Check memory tool rate limit (10 calls per minute per session)
   */
  private checkMemoryToolRateLimit(sessionId: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxCalls = 10;

    // Get or initialize call timestamps for this session
    const calls = this.memoryToolCalls.get(sessionId) ?? [];
    
    // Remove timestamps older than 1 minute
    const recentCalls = calls.filter(timestamp => now - timestamp < windowMs);
    
    // Check if limit exceeded
    if (recentCalls.length >= maxCalls) {
      const oldestCall = Math.min(...recentCalls);
      const retryAfterSeconds = Math.ceil((oldestCall + windowMs - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    // Add current call and update map
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
    if (!this.dlp || result.content.length === 0) {
      return { allowed: true };
    }

    const redactedContent: ToolResult['content'] = [];
    let blocked = false;
    let blockReason: string | undefined;

    for (const block of result.content) {
      // M4: Scan text content
      if (block.type === 'text') {
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
        continue;
      }

      // M4: Scan non-text content for metadata, paths, and structured data
      const structuredText: string[] = [];
      
      // Extract scannable strings from structured content
      if (typeof block === 'object' && block !== null) {
        const extractStrings = (obj: unknown, depth = 0): void => {
          if (depth > 5) return; // Prevent deep recursion
          
          if (typeof obj === 'string' && obj.length > 0) {
            structuredText.push(obj);
          } else if (Array.isArray(obj)) {
            obj.forEach(item => extractStrings(item, depth + 1));
          } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach(value => extractStrings(value, depth + 1));
          }
        };
        
        extractStrings(block);
      }

      // Scan extracted strings
      for (const text of structuredText) {
        const scanResult = this.dlp.scan(text, session?.channel);
        if (!scanResult.allowed) {
          blocked = true;
          blockReason = scanResult.reason;
          void this.logAuditEvent({
            id: `dlp-tool-result-structured-${Date.now()}`,
            timestamp: new Date().toISOString(),
            instanceId: this.instanceId,
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

  private async registerManagementHandlers(): Promise<void> {
    const bus = this.router.getBus();
    if (!(bus instanceof NatsBusAdapter)) {
      return;
    }

    await registerManagementHandlers({
      getBus: () => bus,
      getSessionManager: () => this.sessionManager,
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

    // Load skills for system prompt and exec allowlist
    let skillToolConfigs: SkillToolConfig[] = [];
    try {
      const { formatSkillsForPrompt } = await import('./skills/skill-loader.js');
      const { join } = await import('path');
      const { fileURLToPath } = await import('url');
      const { dirname } = await import('path');

      // Resolve skills directory (relative to gateway package)
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const skillsDir = join(currentDir, '..', '..', '..', '..', 'skills');
      this.skillsDir = skillsDir;

      // Initial skill load
      const skillsForPrompt = await this.loadAndFilterSkills();
      this.currentSkills = skillsForPrompt;

      if (skillsForPrompt.length > 0) {
        this.skillsPrompt = formatSkillsForPrompt(skillsForPrompt);
        logger.info({ count: skillsForPrompt.length }, 'Loaded skills for LLM prompt');
      } else {
        logger.warn('No skills loaded');
      }

      skillToolConfigs = this.buildSkillToolConfigs(skillsForPrompt);

      // Start skill watcher if hot reload is enabled
      const hotReloadEnabled = this.skillsConfig?.hot_reload ?? (process.env.NODE_ENV !== 'production');
      if (hotReloadEnabled) {
        const { SkillWatcher } = await import('./skills/skill-watcher.js');
        this.skillWatcher = new SkillWatcher({
          skillsDir,
          debounceMs: this.skillsConfig?.debounce_ms ?? 500,
          onReload: async () => this.handleSkillReload(),
        });
        this.skillWatcher.start();
        logger.info('Skill hot reload enabled');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load skills');
    }

    // Initialize local tool handler for gateway-integrated tools (exec/shell)
    const { LocalToolHandler } = await import('./tools/local-tool-handler.js');
    const localToolsLogger = createLogger('local-tools');
    const localToolHandler = new LocalToolHandler({
      logger: localToolsLogger,
      shellConfig: {
        allowedTools: skillToolConfigs,
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

    this.approvalManager.on('approval-requested', async (request) => {
      const session = await this.sessionManager.getSession(request.sessionId);
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

      // Sweep stale streaming sessions every 60s to prevent leaks if LLM proxy
      // crashes without sending a 'done' event.
      this.streamingSessionSweepInterval = setInterval(() => {
        const maxAge = 300_000; // 5 minutes
        const now = Date.now();
        for (const [id, state] of this.streamingSessions) {
          if (now - state.createdAt > maxAge) {
            this.streamingSessions.delete(id);
          }
        }
      }, 60_000);
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

    // Start scheduler if enabled
    if (this.scheduler) {
      this.scheduler.setMessageBus(this.router.getBus());
      await this.scheduler.start();
      logger.info('Scheduler started');
      
      if (this.heartbeatManager) {
        await this.heartbeatManager.start();
        logger.info('Heartbeat manager started');
      }
    }

    this.isConnected = true;
    logger.info('Gateway started');
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

    if (this.streamingSessionSweepInterval) {
      clearInterval(this.streamingSessionSweepInterval);
      this.streamingSessionSweepInterval = undefined;
    }

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

    if (this.skillWatcher) {
      this.skillWatcher.stop();
      this.skillWatcher = null;
    }

    if (this.heartbeatManager) {
      await this.heartbeatManager.stop();
      logger.info('Heartbeat manager stopped');
    }

    if (this.scheduler) {
      await this.scheduler.stop();
      logger.info('Scheduler stopped');
    }

    this.storage.close();
    logger.info('Gateway stopped');
  }

  /**
   * Load and filter skills for the system prompt
   */
  private async loadAndFilterSkills(): Promise<Skill[]> {
    if (!this.skillsDir) {
      return [];
    }

    const { loadSkills, filterSkillsForPrompt } = await import('./skills/skill-loader.js');
    const skills = loadSkills({ skillsDir: this.skillsDir });
    const shellEnabled = this.toolsConfig?.shell?.enabled !== false;
    const allowlist = this.skillsConfig?.allow ?? this.skillsConfig?.enabled;
    const filtered = filterSkillsForPrompt(skills, {
      allow: allowlist,
      deny: this.skillsConfig?.deny,
      entries: this.skillsConfig?.entries,
      config: this.nachosConfig,
    });

    return shellEnabled ? filtered : [];
  }

  /**
   * Handle skill reload from watcher
   */
  private async handleSkillReload(): Promise<{
    previous: Skill[];
    current: Skill[];
  }> {
    const previous = this.currentSkills;
    const current = await this.loadAndFilterSkills();

    // Update skills prompt
    const { formatSkillsForPrompt } = await import('./skills/skill-loader.js');
    this.skillsPrompt = current.length > 0 ? formatSkillsForPrompt(current) : null;
    this.currentSkills = current;

    // Detect changes
    const prevMap = new Map(previous.map((s) => [s.name, s]));
    const currMap = new Map(current.map((s) => [s.name, s]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    for (const [name, skill] of currMap) {
      const prevSkill = prevMap.get(name);
      if (!prevSkill) {
        added.push(name);
      } else if (prevSkill.content !== skill.content) {
        modified.push(name);
      }
    }

    for (const name of prevMap.keys()) {
      if (!currMap.has(name)) {
        removed.push(name);
      }
    }

    logger.info(
      {
        added,
        removed,
        modified,
        total: current.length,
      },
      'Skills reloaded'
    );

    // Publish NATS event
    try {
      await this.router.getBus().publish(TOPICS.skills.reloaded, {
        event: 'skills.reloaded',
        added,
        removed,
        modified,
        total: current.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to publish skills.reloaded event');
    }

    return { previous, current };
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
        const sessions = await this.sessionManager.listSessions({ status: 'active' });
        for (const session of sessions) {
          if (!this.isContextManagementEnabledForSession(session)) {
            continue;
          }
          const context = this.buildStateContext(session);
          const shouldRun = await memoryPipeline.shouldRunPeriodic(session, context);
          if (!shouldRun) continue;

          const withMessages = await this.sessionManager.getSessionWithMessages(session.id);
          if (!withMessages) continue;

          await memoryPipeline.handleExtraction({
            session,
            messages: withMessages.messages,
            context,
            trigger: 'periodic',
          });
        }
      } catch (error) {
        logger.warn({ err: error }, 'Periodic memory extraction failed');
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
      messages: await this.sessionManager.getMessages(run.childSessionId),
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

    const session = await this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    if (!session) {
      throw createSessionNotFoundError('Session not found after processing message', { component: 'gateway' });
    }

    return session;
  }
}
