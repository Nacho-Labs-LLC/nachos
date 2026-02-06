/**
 * Gateway - Main entry point for the Nachos Gateway service
 */
import type {
  ChannelInboundMessage,
  ChannelOutboundMessage,
  LLMRequestType,
  LLMResponseType,
  MessageEnvelope,
  Session,
} from '@nachos/types';
import type { AuditConfig } from '@nachos/config';
import { StateStorage } from './state.js';
import { SessionManager } from './session.js';
import { Router, InMemoryMessageBus, createEnvelope, type MessageBus } from './router.js';
import { createHealthServer, performHealthCheck, type HealthCheckDeps } from './health.js';
import { Salsa, type PolicyEngineConfig, type SecurityRequest } from './salsa/index.js';
import { AuditLogger, loadAuditProvider } from './audit/index.js';
import type { AuditEvent } from './audit/types.js';
import {
  createDefaultRateLimiterConfig,
  RateLimiter,
  type RateLimiterConfig,
} from './security/rate-limiter.js';
import { ToolCoordinator } from './tools/coordinator.js';
import { ToolCache } from './tools/cache.js';
import { ApprovalManager } from './tools/approval-manager.js';
import type { ToolCall } from '@nachos/types';

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
  private toolCoordinator: ToolCoordinator | null = null;
  private toolCache: ToolCache | null = null;
  private approvalManager: ApprovalManager | null = null;
  private instanceId: string;
  private healthServer: ReturnType<typeof createHealthServer> | null = null;
  private options: GatewayOptions;
  private isConnected: boolean = false;
  private shutdownHandlers: (() => void)[] = [];
  private streamingSessions: Map<
    string,
    {
      inbound: ChannelInboundMessage;
      buffer: string;
      lastSentAt: number;
      lastSentLength: number;
    }
  > = new Map();

  constructor(options: GatewayOptions = {}) {
    this.options = options;
    this.instanceId = options.instanceId ?? 'gateway';

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

    // Register default handlers
    this.registerDefaultHandlers();
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
    const message = envelope.payload as ChannelInboundMessage;
    const existingSession = this.sessionManager.getSessionByConversation(
      message.channel,
      message.conversation.id
    );

    // Get or create session for this conversation
    const session = this.sessionManager.getOrCreateSession({
      channel: message.channel,
      conversationId: message.conversation.id,
      userId: message.sender.id,
      systemPrompt: this.options.defaultSystemPrompt,
    });

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

        const approved = this.approvalManager.approve(requestId, message.sender.id);
        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: message.channelMessageId,
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

        const reason = denyMatch[2] ?? 'Denied by user';
        const denied = this.approvalManager.deny(requestId, reason, message.sender.id);
        const outbound: ChannelOutboundMessage = {
          channel: message.channel,
          conversationId: message.conversation.id,
          replyToMessageId: message.channelMessageId,
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

  private buildLLMRequest(
    sessionId: string,
    extraMessages: LLMRequestType['messages'] = [],
    stream: boolean = false
  ): LLMRequestType {
    const session = this.sessionManager.getSessionWithMessages(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const messages: LLMRequestType['messages'] = [];
    if (session.systemPrompt) {
      messages.push({ role: 'system', content: session.systemPrompt });
    }

    for (const message of session.messages) {
      messages.push({ role: message.role, content: message.content });
    }

    if (extraMessages.length > 0) {
      messages.push(...extraMessages);
    }

    return {
      sessionId,
      messages,
      options: {
        model: session.config?.model,
        maxTokens: session.config?.maxTokens,
        stream,
      },
    };
  }

  private async requestLLMResponse(
    sessionId: string,
    extraMessages: LLMRequestType['messages'] = [],
    stream: boolean = false
  ): Promise<LLMResponseType> {
    const request = this.buildLLMRequest(sessionId, extraMessages, stream);
    const responseEnvelope = await this.router.sendLLMRequest(request);

    const envelope = responseEnvelope as MessageEnvelope;
    if (envelope && typeof envelope === 'object' && 'payload' in envelope) {
      return envelope.payload as LLMResponseType;
    }

    return responseEnvelope as LLMResponseType;
  }

  private async executeToolCalls(
    sessionId: string,
    toolCalls: Array<{ id: string; name: string; arguments: string }>
  ): Promise<LLMRequestType['messages']> {
    if (!this.toolCoordinator) {
      throw new Error('Tool coordinator not initialized');
    }

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
        sessionId,
        parameters,
      };
    });

    // Execute tools using coordinator (handles parallel execution, caching, policy checks)
    const results = await this.toolCoordinator.executeTools(calls);

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

  private async sendLLMResponse(
    inbound: ChannelInboundMessage,
    sessionId: string,
    response: LLMResponseType
  ): Promise<void> {
    const content = response.success ? response.message?.content : response.error?.message;
    const toolCalls = response.success ? response.toolCalls : undefined;

    if (toolCalls && toolCalls.length > 0) {
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content: typeof content === 'string' ? content : '',
        toolCalls,
      });

      const toolMessages = await this.executeToolCalls(sessionId, toolCalls);
      const followUp = await this.requestLLMResponse(sessionId, toolMessages);
      await this.sendLLMResponse(inbound, sessionId, followUp);
      return;
    }

    if (content && typeof content === 'string') {
      this.sessionManager.addMessage(sessionId, {
        role: 'assistant',
        content,
      });
    } else {
      return;
    }

    const outbound: ChannelOutboundMessage = {
      channel: inbound.channel,
      conversationId: inbound.conversation.id,
      replyToMessageId: inbound.channelMessageId,
      content: {
        text: typeof content === 'string' ? content : '',
        format: 'markdown',
      },
    };

    await this.router.sendToChannel(outbound);
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

    // Initialize tool infrastructure
    this.approvalManager = new ApprovalManager();
    this.toolCache = new ToolCache();
    this.toolCoordinator = new ToolCoordinator({
      bus: this.router.getBus(),
      salsa: this.salsa ?? undefined,
      cache: this.toolCache,
      approvalManager: this.approvalManager,
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
