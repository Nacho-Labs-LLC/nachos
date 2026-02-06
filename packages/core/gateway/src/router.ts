/**
 * Message Router - Routes messages between components
 */
import {
  createRateLimitedError,
  type MessageEnvelope,
  type ChannelInboundMessage,
  type ChannelOutboundMessage,
  type Message,
} from '@nachos/types';
import {
  TOPICS,
  type NachosBusClient,
  type MessageEnvelope as BusMessageEnvelope,
  type BusSubscription,
} from '@nachos/bus';
import { v4 as uuid } from 'uuid';
import type {
  RateLimitAction,
  RateLimitCheckResult,
  RateLimiter,
} from './security/rate-limiter.js';
import { getRateLimitUserId } from './router-utils.js';
import type {
  ContextManager,
  ContextCheckResult,
  EnhancedCompactionResult,
} from '@nachos/context-manager';
import { messageAdapter } from '@nachos/context-manager';
import type { SessionManager } from './session.js';

/**
 * Route handler function type
 */
export type RouteHandler = (envelope: MessageEnvelope) => Promise<void>;

/**
 * Message bus interface - abstraction for NATS or other message systems
 */
export interface MessageBus {
  publish(topic: string, data: unknown): Promise<void>;
  subscribe(topic: string, handler: (data: unknown) => Promise<void>): Promise<void>;
  request(topic: string, data: unknown, timeout?: number): Promise<unknown>;
  unsubscribe(topic: string): Promise<void>;
}

/**
 * In-memory message bus for testing and standalone operation
 */
export class InMemoryMessageBus implements MessageBus {
  private handlers: Map<string, Set<(data: unknown) => Promise<void>>> = new Map();

  async publish(topic: string, data: unknown): Promise<void> {
    const handlers = this.handlers.get(topic);
    if (handlers) {
      for (const handler of handlers) {
        await handler(data);
      }
    }
  }

  async subscribe(topic: string, handler: (data: unknown) => Promise<void>): Promise<void> {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
    }
    this.handlers.get(topic)!.add(handler);
  }

  async request(_topic: string, _data: unknown, _timeout?: number): Promise<unknown> {
    // For testing, return a default response
    return { success: true };
  }

  async unsubscribe(topic: string): Promise<void> {
    this.handlers.delete(topic);
  }
}

/**
 * Check if a value is a valid MessageEnvelope
 */
function isMessageEnvelope(data: unknown): data is MessageEnvelope {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.source === 'string' &&
    typeof obj.type === 'string' &&
    'payload' in obj
  );
}

/**
 * Adapter to wrap NachosBusClient to implement the MessageBus interface
 */
export class NatsBusAdapter implements MessageBus {
  private client: NachosBusClient;
  private subscriptions: Map<string, BusSubscription> = new Map();

  constructor(client: NachosBusClient) {
    this.client = client;
  }

  async publish(topic: string, data: unknown): Promise<void> {
    // NachosBusClient.publish wraps data in an envelope, but we already have an envelope
    // So we need to extract the payload if data is already an envelope
    if (!isMessageEnvelope(data)) {
      throw new Error('Invalid message envelope: data must be a valid MessageEnvelope');
    }
    this.client.publish(topic, data.payload, {
      type: data.type,
      correlationId: data.correlationId,
    });
  }

  async subscribe(topic: string, handler: (data: unknown) => Promise<void>): Promise<void> {
    const subscription = await this.client.subscribe(topic, async (msg: BusMessageEnvelope) => {
      // Convert the bus envelope to the gateway envelope format
      const envelope: MessageEnvelope = {
        id: msg.id,
        timestamp: msg.timestamp,
        source: msg.source,
        type: msg.type,
        correlationId: msg.correlationId,
        payload: msg.payload,
      };
      await handler(envelope);
    });
    this.subscriptions.set(topic, subscription);
  }

  async request(topic: string, data: unknown, timeout?: number): Promise<unknown> {
    if (!isMessageEnvelope(data)) {
      throw new Error('Invalid message envelope: data must be a valid MessageEnvelope');
    }
    const response = await this.client.request(topic, data.payload, {
      type: data.type,
      timeout,
    });
    return response;
  }

  async unsubscribe(topic: string): Promise<void> {
    const subscription = this.subscriptions.get(topic);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(topic);
    }
  }

  /**
   * Get the underlying NachosBusClient
   */
  getClient(): NachosBusClient {
    return this.client;
  }
}

/**
 * Re-export TOPICS from @nachos/bus for convenience
 * @deprecated Use TOPICS from @nachos/bus directly
 */
export const Topics = {
  // Channel messages
  channelInbound: TOPICS.channel.inbound,
  channelOutbound: TOPICS.channel.outbound,

  // LLM
  llmRequest: TOPICS.llm.request,
  llmResponse: TOPICS.llm.response,
  llmStream: TOPICS.llm.stream,

  // Tools
  toolRequest: TOPICS.tool.request,
  toolResponse: TOPICS.tool.response,

  // Policy
  policyCheck: TOPICS.policy.check,
  policyResult: TOPICS.policy.result,

  // Audit
  auditLog: TOPICS.audit.log,

  // Health
  healthPing: TOPICS.health.ping,
} as const;

/**
 * Create a message envelope
 */
export function createEnvelope(
  source: string,
  type: string,
  payload: unknown,
  correlationId?: string
): MessageEnvelope {
  return {
    id: uuid(),
    timestamp: new Date().toISOString(),
    source,
    type,
    correlationId,
    payload,
  };
}

/**
 * Router options
 */
export interface RouterOptions {
  bus: MessageBus;
  componentName?: string;
  rateLimiter?: RateLimiter;
  contextManager?: ContextManager;
  sessionManager?: SessionManager;
}

/**
 * Message Router class
 */
export class Router {
  private bus: MessageBus;
  private componentName: string;
  private rateLimiter?: RateLimiter;
  private contextManager?: ContextManager;
  private sessionManager?: SessionManager;
  private handlers: Map<string, RouteHandler> = new Map();

  constructor(options: RouterOptions) {
    this.bus = options.bus;
    this.componentName = options.componentName ?? 'gateway';
    this.rateLimiter = options.rateLimiter;
    this.contextManager = options.contextManager;
    this.sessionManager = options.sessionManager;
  }

  /**
   * Register a handler for a specific message type
   */
  registerHandler(messageType: string, handler: RouteHandler): void {
    this.handlers.set(messageType, handler);
  }

  /**
   * Get registered handler for a message type
   */
  getHandler(messageType: string): RouteHandler | undefined {
    return this.handlers.get(messageType);
  }

  /**
   * Route an incoming message to the appropriate handler
   */
  async route(envelope: MessageEnvelope): Promise<void> {
    const handler = this.handlers.get(envelope.type);
    if (handler) {
      await handler(envelope);
    } else {
      console.warn(`No handler registered for message type: ${envelope.type}`);
    }
  }

  /**
   * Subscribe to a topic and route messages
   */
  async subscribe(topic: string): Promise<void> {
    await this.bus.subscribe(topic, async (data) => {
      const envelope = data as MessageEnvelope;
      await this.route(envelope);
    });
  }

  /**
   * Subscribe to channel inbound messages
   */
  async subscribeToChannel(channel: string): Promise<void> {
    const topic = TOPICS.channel.inbound(channel);
    await this.subscribe(topic);
  }

  /**
   * Send an outbound message to a channel
   */
  async sendToChannel(message: ChannelOutboundMessage): Promise<void> {
    const limitResult = await this.checkRateLimit('message', message);
    if (!limitResult.allowed) {
      throw this.createRateLimitError(limitResult, 'Outbound message rate limit exceeded', {
        channel: message.channel,
      });
    }
    const topic = TOPICS.channel.outbound(message.channel);
    const envelope = createEnvelope(this.componentName, 'channel.outbound', message);
    await this.bus.publish(topic, envelope);
  }

  /**
   * Process an inbound channel message
   */
  async processInboundMessage(message: ChannelInboundMessage): Promise<MessageEnvelope> {
    const limitResult = await this.checkRateLimit('message', message);
    if (!limitResult.allowed) {
      throw this.createRateLimitError(limitResult, 'Inbound message rate limit exceeded', {
        channel: message.channel,
      });
    }
    const envelope = createEnvelope(this.componentName, 'channel.inbound', message);
    return envelope;
  }

  /**
   * Check context budget and perform compaction if needed
   *
   * This runs before each LLM request to ensure context stays within limits.
   * If compaction is needed, it will:
   * 1. Execute compaction (sliding window + optional summarization)
   * 2. Replace messages in StateStorage
   * 3. Update session metadata with context state
   * 4. Publish context events to message bus
   */
  private async checkAndCompactContext(params: {
    sessionId: string;
    contextWindow?: number;
    systemPromptTokens?: number;
  }): Promise<void> {
    // Skip if context manager or session manager not configured
    if (!this.contextManager || !this.sessionManager) {
      return;
    }

    const { sessionId, contextWindow = 200000, systemPromptTokens = 0 } = params;

    // Get session with messages
    const sessionWithMessages = this.sessionManager.getSessionWithMessages(sessionId);
    if (!sessionWithMessages) {
      console.warn(`[Router] Cannot check context: session ${sessionId} not found`);
      return;
    }

    // Convert NACHOS messages to ContextMessages
    const contextMessages = sessionWithMessages.messages.map((msg) =>
      messageAdapter.toContextMessage(msg)
    );

    // Check if compaction is needed
    const check: ContextCheckResult = await this.contextManager.checkBeforeTurn({
      sessionId,
      messages: contextMessages,
      systemPromptTokens,
      contextWindow,
      reserveTokens: 20000, // Reserve 20k tokens for response
    });

    // Publish budget update event
    const budgetEvent = {
      sessionId,
      timestamp: new Date().toISOString(),
      budget: check.budget,
      needsCompaction: check.needsCompaction,
    };
    await this.bus.publish(
      TOPICS.context.budgetUpdate,
      createEnvelope(this.componentName, 'context.budget_update', budgetEvent)
    );

    // Publish zone change if zone is concerning
    if (
      check.budget.zone === 'yellow' ||
      check.budget.zone === 'orange' ||
      check.budget.zone === 'red' ||
      check.budget.zone === 'critical'
    ) {
      const zoneEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        zone: check.budget.zone,
        utilizationRatio: check.budget.utilizationRatio,
        currentUsage: check.budget.currentUsage,
        historyBudget: check.budget.historyBudget,
      };
      await this.bus.publish(
        TOPICS.context.zoneChange,
        createEnvelope(this.componentName, 'context.zone_change', zoneEvent)
      );
    }

    // If compaction not needed, we're done
    if (!check.needsCompaction || !check.action) {
      return;
    }

    console.log(
      `[Router] Context compaction needed for session ${sessionId}: ${check.action.reason}`
    );

    // Execute compaction
    const compactionResult: EnhancedCompactionResult = await this.contextManager.compact({
      sessionId,
      messages: contextMessages,
      action: check.action,
    });

    // Convert compacted messages back to NACHOS format
    if (!compactionResult.messagesKept) {
      console.warn(
        '[Router] Compaction completed without messagesKept. Skipping message replacement.'
      );
      return;
    }

    if (
      !compactionResult.budget ||
      !compactionResult.messagesDropped ||
      !compactionResult.slidingResult
    ) {
      console.warn('[Router] Compaction result missing details. Skipping metadata update.');
      return;
    }

    const compactedNachosMessages: Message[] = compactionResult.messagesKept.map((msg) =>
      messageAdapter.toNachosMessage(msg, sessionId)
    );

    // Replace messages in StateStorage (atomic operation)
    const messageCount = this.sessionManager.getMessageCount(sessionId);
    console.log(
      `[Router] Replacing ${messageCount} messages with ${compactedNachosMessages.length} compacted messages`
    );

    // Atomically replace messages in storage
    this.sessionManager.replaceMessages(sessionId, compactedNachosMessages);

    // Update session metadata with context state
    const metadata = sessionWithMessages.metadata as {
      contextManagement?: { compactionHistory?: Array<Record<string, unknown>> };
    } | null;

    this.sessionManager.updateMetadata(sessionId, {
      contextManagement: {
        lastCompaction: new Date().toISOString(),
        budget: check.budget,
        compactionHistory: [
          ...(metadata?.contextManagement?.compactionHistory ?? []),
          {
            timestamp: new Date().toISOString(),
            trigger: check.action.type,
            zone: check.action.zone,
            tokensBefore: check.budget.currentUsage,
            tokensAfter: compactionResult.budget.currentUsage,
            messagesDropped: compactionResult.messagesDropped.length,
          },
        ],
      },
    });

    // Publish compaction event
    const compactionEvent = {
      sessionId,
      timestamp: new Date().toISOString(),
      trigger: check.action.type,
      zone: check.action.zone,
      result: {
        tokensBefore: check.budget.currentUsage,
        tokensAfter: compactionResult.budget.currentUsage,
        messagesDropped: compactionResult.messagesDropped.length,
        messagesKept: compactionResult.messagesKept.length,
        tokensRemoved: compactionResult.slidingResult.tokensRemoved,
        summaryGenerated: compactionResult.summary !== undefined,
      },
    };
    await this.bus.publish(
      TOPICS.context.compaction,
      createEnvelope(this.componentName, 'context.compaction', compactionEvent)
    );

    // Publish extraction event if history was extracted
    if (compactionResult.extracted) {
      const extractionEvent = {
        sessionId,
        timestamp: new Date().toISOString(),
        trigger: 'compaction',
        counts: {
          decisions: compactionResult.extracted.decisions.length,
          facts: compactionResult.extracted.facts.length,
          tasks: compactionResult.extracted.tasks.length,
          issues: compactionResult.extracted.issues.length,
          files: compactionResult.extracted.files.length,
        },
      };
      await this.bus.publish(
        TOPICS.context.extraction,
        createEnvelope(this.componentName, 'context.extraction', extractionEvent)
      );
    }

    console.log(
      `[Router] Context compaction completed: ${check.budget.currentUsage} → ${compactionResult.budget.currentUsage} tokens`
    );
  }

  /**
   * Send an LLM request
   *
   * Before sending the request, performs a context check and compaction if needed.
   */
  async sendLLMRequest(payload: unknown): Promise<unknown> {
    const limitResult = await this.checkRateLimit('llm', payload);
    if (!limitResult.allowed) {
      throw this.createRateLimitError(limitResult, 'LLM request rate limit exceeded');
    }

    // Extract sessionId from payload for context check
    // Payload structure depends on LLM proxy expectations - adjust as needed
    const payloadObj = payload as Record<string, unknown>;
    const sessionId = payloadObj.sessionId as string | undefined;

    // Perform context check and compaction if needed
    if (sessionId) {
      await this.checkAndCompactContext({
        sessionId,
        contextWindow: (payloadObj.contextWindow as number) ?? 200000,
        systemPromptTokens: (payloadObj.systemPromptTokens as number) ?? 0,
      });
    }

    const envelope = createEnvelope(this.componentName, 'llm.request', payload);
    return this.bus.request(TOPICS.llm.request, envelope, 60000);
  }

  /**
   * Send a tool request
   */
  async sendToolRequest(tool: string, payload: unknown): Promise<unknown> {
    const limitResult = await this.checkRateLimit('tool', payload);
    if (!limitResult.allowed) {
      throw this.createRateLimitError(limitResult, 'Tool request rate limit exceeded', { tool });
    }
    const topic = TOPICS.tool.request(tool);
    const envelope = createEnvelope(this.componentName, 'tool.request', payload);
    return this.bus.request(topic, envelope, 30000);
  }

  private async checkRateLimit(
    action: RateLimitAction,
    payload: unknown
  ): Promise<RateLimitCheckResult> {
    if (!this.rateLimiter) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        resetAt: Date.now(),
        total: Number.MAX_SAFE_INTEGER,
        source: 'memory',
      };
    }
    const userId = getRateLimitUserId(payload);
    if (!userId) {
      console.warn('[Router] Missing user identifier in payload; using anonymous bucket');
    }
    const resolvedUserId = userId ?? 'anonymous';
    const result = await this.rateLimiter.check(resolvedUserId, action);
    if (!result.allowed) {
      void this.bus.publish(
        TOPICS.audit.log,
        createEnvelope(this.componentName, 'audit.log', {
          type: 'rate_limit',
          action,
          userId: resolvedUserId,
          remaining: result.remaining,
          resetAt: result.resetAt,
          limit: result.total,
          source: result.source,
        })
      );
    }
    return result;
  }

  private createRateLimitError(
    result: RateLimitCheckResult,
    message: string,
    extraDetails?: Record<string, unknown>
  ) {
    return createRateLimitedError(message, {
      component: this.componentName,
      details: {
        remaining: result.remaining,
        resetAt: result.resetAt,
        limit: result.total,
        source: result.source,
        ...extraDetails,
      },
    });
  }

  /**
   * Send a policy check request
   */
  async checkPolicy(payload: unknown): Promise<unknown> {
    const envelope = createEnvelope(this.componentName, 'policy.check', payload);
    return this.bus.request(TOPICS.policy.check, envelope, 5000);
  }

  /**
   * Send an audit log entry
   */
  async audit(payload: unknown): Promise<void> {
    const envelope = createEnvelope(this.componentName, 'audit.log', payload);
    await this.bus.publish(TOPICS.audit.log, envelope);
  }

  /**
   * Get the underlying message bus
   */
  getBus(): MessageBus {
    return this.bus;
  }
}
