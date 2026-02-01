/**
 * Nachos Message Bus Client
 *
 * TypeScript wrapper around NATS for inter-component communication.
 * Provides publish/subscribe, request/reply, and health check functionality.
 */

import { connect, StringCodec, NatsError, ErrorCode } from 'nats';
import type { NatsConnection, Subscription } from 'nats';
import { randomUUID } from 'node:crypto';
import type {
  NachosBusOptions,
  PublishOptions,
  SubscribeOptions,
  RequestOptions,
  MessageHandler,
  BusSubscription,
  BusHealthStatus,
  MessageEnvelope,
  INachosBusClient,
  BusEvent,
  BusEventHandler,
} from './types.js';

// Package version for health reporting
const VERSION = '0.0.0';

// Default options
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
const DEFAULT_RECONNECT_TIME_WAIT = 2000;

/**
 * String codec for encoding/decoding messages
 */
const sc = StringCodec();

/**
 * Nachos Bus Client implementation
 */
export class NachosBusClient implements INachosBusClient {
  private connection: NatsConnection | null = null;
  private readonly options: Required<NachosBusOptions>;
  private readonly eventHandlers: Map<BusEvent, Set<BusEventHandler>> = new Map();
  private startTime: number = 0;

  constructor(options: NachosBusOptions) {
    this.options = {
      servers: options.servers,
      name: options.name,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxReconnectAttempts: options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectTimeWait: options.reconnectTimeWait ?? DEFAULT_RECONNECT_TIME_WAIT,
    };
  }

  /**
   * Connect to the NATS server
   */
  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    const servers = Array.isArray(this.options.servers)
      ? this.options.servers
      : [this.options.servers];

    this.connection = await connect({
      servers,
      name: this.options.name,
      timeout: this.options.timeout,
      maxReconnectAttempts: this.options.maxReconnectAttempts,
      reconnectTimeWait: this.options.reconnectTimeWait,
    });

    this.startTime = Date.now();

    // Set up event monitoring
    this.monitorConnection();

    this.emit('connect');
  }

  /**
   * Monitor connection status and emit events
   */
  private async monitorConnection(): Promise<void> {
    if (!this.connection) return;

    // Handle connection closed
    this.connection.closed().then(() => {
      this.emit('disconnect');
    });

    // Monitor status updates
    (async () => {
      if (!this.connection) return;
      for await (const status of this.connection.status()) {
        switch (status.type) {
          case 'reconnect':
            this.emit('reconnect');
            break;
          case 'error':
            this.emit('error', status.data);
            break;
          case 'update':
            this.emit('update', status.data);
            break;
        }
      }
    })().catch(() => {
      // Connection closed, ignore
    });
  }

  /**
   * Disconnect from the NATS server
   */
  async disconnect(): Promise<void> {
    if (!this.connection) {
      return;
    }

    await this.connection.drain();
    await this.connection.close();
    this.connection = null;
  }

  /**
   * Check if connected to NATS
   */
  isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  /**
   * Publish a message to a topic
   */
  publish<T>(topic: string, payload: T, options?: PublishOptions): void {
    if (!this.connection) {
      throw new Error('Not connected to NATS');
    }

    const envelope = this.createEnvelope(
      payload,
      options?.type ?? 'message',
      options?.correlationId
    );

    const data = sc.encode(JSON.stringify(envelope));

    this.connection.publish(topic, data, {
      reply: options?.reply,
    });
  }

  /**
   * Subscribe to a topic
   */
  async subscribe<T = unknown>(
    topic: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions
  ): Promise<BusSubscription> {
    if (!this.connection) {
      throw new Error('Not connected to NATS');
    }

    const subOpts: { queue?: string; max?: number } = {};
    if (options?.queue) {
      subOpts.queue = options.queue;
    }
    if (options?.max) {
      subOpts.max = options.max;
    }

    const subscription = this.connection.subscribe(topic, subOpts);

    // Start processing messages asynchronously
    this.processSubscription(subscription, handler);

    return {
      unsubscribe: () => subscription.unsubscribe(),
      drain: () => subscription.drain(),
      getSubscription: () => subscription,
    };
  }

  /**
   * Process incoming messages for a subscription
   */
  private async processSubscription<T>(
    subscription: Subscription,
    handler: MessageHandler<T>
  ): Promise<void> {
    for await (const msg of subscription) {
      try {
        const data = sc.decode(msg.data);
        const envelope = JSON.parse(data) as MessageEnvelope<T>;

        await handler(envelope, {
          subject: msg.subject,
          reply: msg.reply,
          respond: (responseData: unknown) => {
            if (msg.reply) {
              const responseEnvelope = this.createEnvelope(
                responseData,
                'response',
                envelope.correlationId
              );
              msg.respond(sc.encode(JSON.stringify(responseEnvelope)));
              return true;
            }
            return false;
          },
        });
      } catch (error) {
        // Log parsing errors but continue processing
        console.error('Error processing message:', error);
      }
    }
  }

  /**
   * Request/reply pattern
   */
  async request<TReq, TRes>(
    topic: string,
    payload: TReq,
    options?: RequestOptions
  ): Promise<MessageEnvelope<TRes>> {
    if (!this.connection) {
      throw new Error('Not connected to NATS');
    }

    const correlationId = randomUUID();
    const envelope = this.createEnvelope(payload, options?.type ?? 'request', correlationId);

    const data = sc.encode(JSON.stringify(envelope));
    const timeout = options?.timeout ?? this.options.timeout;

    try {
      const response = await this.connection.request(topic, data, { timeout });
      const responseData = sc.decode(response.data);
      return JSON.parse(responseData) as MessageEnvelope<TRes>;
    } catch (error) {
      if (error instanceof NatsError && error.code === ErrorCode.Timeout) {
        throw new Error(`Request to ${topic} timed out after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Get health status of the bus connection
   */
  async getHealth(): Promise<BusHealthStatus> {
    const baseHealth: BusHealthStatus = {
      status: 'unhealthy',
      component: 'bus',
      version: VERSION,
      uptime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      checks: {
        connection: 'error',
      },
    };

    if (!this.connection || this.connection.isClosed()) {
      return baseHealth;
    }

    try {
      // Measure round-trip latency with a flush
      const start = Date.now();
      await this.connection.flush();
      const latency = Date.now() - start;

      return {
        ...baseHealth,
        status: 'healthy',
        checks: {
          connection: 'ok',
          latency,
        },
      };
    } catch {
      return {
        ...baseHealth,
        status: 'degraded',
        checks: {
          connection: 'error',
        },
      };
    }
  }

  /**
   * Get the underlying NATS connection
   */
  getConnection(): NatsConnection | null {
    return this.connection;
  }

  /**
   * Add an event handler
   */
  on(event: BusEvent, handler: BusEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove an event handler
   */
  off(event: BusEvent, handler: BusEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: BusEvent, data?: unknown): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(event, data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  /**
   * Create a message envelope
   */
  private createEnvelope<T>(payload: T, type: string, correlationId?: string): MessageEnvelope<T> {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source: this.options.name,
      type,
      correlationId,
      payload,
    };
  }
}

/**
 * Factory function to create a new bus client
 */
export function createBusClient(options: NachosBusOptions): NachosBusClient {
  return new NachosBusClient(options);
}
