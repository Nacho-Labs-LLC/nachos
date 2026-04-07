/**
 * @nachos/sdk - Runtime Context
 *
 * Defines the NachosContext type that is injected into channels and tools
 * at runtime. This provides access to the bus, configuration, logging,
 * and session information without requiring direct NATS knowledge.
 */

import type { SecurityMode } from './types.js';

/**
 * A simplified bus interface for plugin authors.
 *
 * Provides publish/subscribe access to the Nachos message bus without
 * exposing NATS internals. Plugins use this to send and receive messages
 * through the platform's topic structure.
 *
 * @example
 * ```typescript
 * // Publish an inbound message
 * ctx.bus.publish('nachos.channel.mychannel.inbound', message);
 *
 * // Subscribe to outbound messages
 * await ctx.bus.subscribe('nachos.channel.mychannel.outbound', (msg) => {
 *   // deliver the message to the user
 * });
 * ```
 */
export interface PluginBus {
  /**
   * Publish a message to a topic.
   *
   * @param topic - The NATS topic to publish to (e.g. 'nachos.channel.slack.inbound').
   * @param payload - The message payload. Will be JSON-serialized automatically.
   */
  publish<T>(topic: string, payload: T): void | Promise<void>;

  /**
   * Subscribe to messages on a topic.
   *
   * @param topic - The NATS topic to subscribe to. Supports '*' wildcards.
   * @param handler - Callback invoked for each message. Receives the deserialized payload.
   * @returns A subscription handle. Call unsubscribe/drain to stop receiving messages.
   */
  subscribe<T>(topic: string, handler: (payload: T) => void | Promise<void>): Promise<unknown>;
}

/**
 * A structured logger for plugin components.
 *
 * Plugins should use this logger rather than console.log to ensure structured,
 * filterable log output that integrates with the platform's logging pipeline.
 *
 * The interface follows the pino logger pattern used throughout Nachos.
 */
export interface PluginLogger {
  /** Log a message at info level. */
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;

  /** Log a message at warn level. */
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;

  /** Log a message at error level. */
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;

  /** Log a message at debug level. */
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;

  /** Log a message at fatal level (unrecoverable errors). */
  fatal(obj: Record<string, unknown>, msg?: string): void;
  fatal(msg: string): void;
}

/**
 * Runtime context injected into channels and tools.
 *
 * This is the main integration point between a plugin and the Nachos platform.
 * It provides everything a plugin needs to interact with the system: bus access,
 * configuration, logging, and session information.
 *
 * Channel adapters receive this through their `ChannelAdapterConfig`.
 * Tool containers receive this through their `ToolConfig` and NATS connection.
 *
 * @example
 * ```typescript
 * class MyChannel implements NachosChannel {
 *   private ctx!: NachosContext;
 *
 *   async initialize(ctx: NachosContext): Promise<void> {
 *     this.ctx = ctx;
 *     ctx.logger.info('MyChannel initialized');
 *
 *     const apiKey = ctx.secrets['MY_API_KEY'];
 *     if (!apiKey) throw new Error('MY_API_KEY is required');
 *   }
 * }
 * ```
 */
export interface NachosContext {
  /**
   * The security mode the platform is running under.
   * Plugins should adjust their behavior based on this value -- for example,
   * disabling risky operations in strict mode.
   */
  securityMode: SecurityMode;

  /**
   * Plugin-specific configuration from nachos.toml.
   * The structure depends on how the user has configured this plugin.
   */
  config: Record<string, unknown>;

  /**
   * Secret values (API tokens, credentials) injected from environment variables.
   * Keyed by environment variable name (e.g. 'SLACK_BOT_TOKEN').
   */
  secrets: Record<string, string>;

  /**
   * The message bus for publishing and subscribing to topics.
   */
  bus: PluginBus;

  /**
   * A structured logger scoped to this plugin.
   */
  logger: PluginLogger;

  /**
   * Session information for the current request, when available.
   * This is primarily useful for tools that execute in a session context.
   * Channel adapters may not have this set at initialization time.
   */
  session?: {
    /** The session identifier. */
    id: string;
    /** The user identifier associated with this session. */
    userId: string;
    /** The channel this session is on. */
    channel: string;
    /** The conversation identifier. */
    conversationId: string;
  };
}
