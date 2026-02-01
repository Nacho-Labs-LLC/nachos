/**
 * Type definitions for the Nachos Message Bus
 */

import type { NatsConnection, Subscription } from 'nats';

/**
 * Message envelope that wraps all bus messages
 * @see TECHNICAL_SPEC.md section 1.1
 */
export interface MessageEnvelope<T = unknown> {
  /** Unique message identifier (UUID) */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Component that sent the message */
  source: string;
  /** Message type identifier */
  type: string;
  /** Correlation ID for request/reply patterns */
  correlationId?: string;
  /** Message-specific payload */
  payload: T;
}

/**
 * Options for creating a Nachos bus client
 */
export interface NachosBusOptions {
  /** NATS server URL(s) */
  servers: string | string[];
  /** Component name for message attribution */
  name: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Reconnect time wait in milliseconds */
  reconnectTimeWait?: number;
}

/**
 * Options for publishing messages
 */
export interface PublishOptions {
  /** Custom message type identifier */
  type?: string;
  /** Correlation ID for tracking related messages */
  correlationId?: string;
  /** Reply subject for request/reply pattern */
  reply?: string;
}

/**
 * Options for subscribing to topics
 */
export interface SubscribeOptions {
  /** Queue group name for load balancing */
  queue?: string;
  /** Maximum messages to receive before auto-unsubscribing */
  max?: number;
}

/**
 * Options for request/reply pattern
 */
export interface RequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom message type identifier */
  type?: string;
}

/**
 * Message handler callback for subscriptions
 */
export type MessageHandler<T = unknown> = (
  msg: MessageEnvelope<T>,
  rawMsg: {
    subject: string;
    reply?: string;
    respond: (data: unknown) => boolean;
  }
) => void | Promise<void>;

/**
 * Result from subscribing to a topic
 */
export interface BusSubscription {
  /** Unsubscribe from the topic */
  unsubscribe(): void;
  /** Drain the subscription before unsubscribing */
  drain(): Promise<void>;
  /** Get the underlying NATS subscription */
  getSubscription(): Subscription;
}

/**
 * Health status for the bus connection
 */
export interface BusHealthStatus {
  /** Current health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Component name */
  component: string;
  /** Package version */
  version: string;
  /** Uptime in seconds */
  uptime: number;
  /** Individual health checks */
  checks: {
    connection: 'ok' | 'error';
    latency?: number;
  };
}

/**
 * Interface for the Nachos bus client
 */
export interface INachosBusClient {
  /** Connect to the NATS server */
  connect(): Promise<void>;

  /** Disconnect from the NATS server */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Publish a message to a topic */
  publish<T>(topic: string, payload: T, options?: PublishOptions): void;

  /** Subscribe to a topic */
  subscribe<T = unknown>(
    topic: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions
  ): Promise<BusSubscription>;

  /** Request/reply pattern */
  request<TReq, TRes>(
    topic: string,
    payload: TReq,
    options?: RequestOptions
  ): Promise<MessageEnvelope<TRes>>;

  /** Get health status */
  getHealth(): Promise<BusHealthStatus>;

  /** Get the underlying NATS connection */
  getConnection(): NatsConnection | null;
}

/**
 * Events emitted by the bus client
 */
export type BusEvent = 'connect' | 'disconnect' | 'reconnect' | 'error' | 'update';

/**
 * Event handler for bus events
 */
export type BusEventHandler = (event: BusEvent, data?: unknown) => void;
