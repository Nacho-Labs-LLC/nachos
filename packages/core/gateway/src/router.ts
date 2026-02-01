/**
 * Message Router - Routes messages between components
 */
import type { MessageEnvelope, ChannelInboundMessage, ChannelOutboundMessage } from '@nachos/types';
import { v4 as uuid } from 'uuid';

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
 * NATS topic structure
 */
export const Topics = {
  // Channel messages
  channelInbound: (channel: string) => `nachos.channel.${channel}.inbound`,
  channelOutbound: (channel: string) => `nachos.channel.${channel}.outbound`,

  // LLM
  llmRequest: 'nachos.llm.request',
  llmResponse: 'nachos.llm.response',
  llmStream: (sessionId: string) => `nachos.llm.stream.${sessionId}`,

  // Tools
  toolRequest: (tool: string) => `nachos.tool.${tool}.request`,
  toolResponse: (tool: string) => `nachos.tool.${tool}.response`,

  // Policy
  policyCheck: 'nachos.policy.check',
  policyResult: 'nachos.policy.result',

  // Audit
  auditLog: 'nachos.audit.log',

  // Health
  healthPing: 'nachos.health.ping',
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
}

/**
 * Message Router class
 */
export class Router {
  private bus: MessageBus;
  private componentName: string;
  private handlers: Map<string, RouteHandler> = new Map();

  constructor(options: RouterOptions) {
    this.bus = options.bus;
    this.componentName = options.componentName ?? 'gateway';
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
    const topic = Topics.channelInbound(channel);
    await this.subscribe(topic);
  }

  /**
   * Send an outbound message to a channel
   */
  async sendToChannel(message: ChannelOutboundMessage): Promise<void> {
    const topic = Topics.channelOutbound(message.channel);
    const envelope = createEnvelope(this.componentName, 'channel.outbound', message);
    await this.bus.publish(topic, envelope);
  }

  /**
   * Process an inbound channel message
   */
  async processInboundMessage(message: ChannelInboundMessage): Promise<MessageEnvelope> {
    const envelope = createEnvelope(this.componentName, 'channel.inbound', message);
    return envelope;
  }

  /**
   * Send an LLM request
   */
  async sendLLMRequest(payload: unknown): Promise<unknown> {
    const envelope = createEnvelope(this.componentName, 'llm.request', payload);
    return this.bus.request(Topics.llmRequest, envelope, 60000);
  }

  /**
   * Send a tool request
   */
  async sendToolRequest(tool: string, payload: unknown): Promise<unknown> {
    const topic = Topics.toolRequest(tool);
    const envelope = createEnvelope(this.componentName, 'tool.request', payload);
    return this.bus.request(topic, envelope, 30000);
  }

  /**
   * Send a policy check request
   */
  async checkPolicy(payload: unknown): Promise<unknown> {
    const envelope = createEnvelope(this.componentName, 'policy.check', payload);
    return this.bus.request(Topics.policyCheck, envelope, 5000);
  }

  /**
   * Send an audit log entry
   */
  async audit(payload: unknown): Promise<void> {
    const envelope = createEnvelope(this.componentName, 'audit.log', payload);
    await this.bus.publish(Topics.auditLog, envelope);
  }

  /**
   * Get the underlying message bus
   */
  getBus(): MessageBus {
    return this.bus;
  }
}
