/**
 * @nachos/sdk - Channel Interface
 *
 * Defines the NachosChannel interface that all channel adapters must implement.
 *
 * A channel adapter bridges a messaging platform (Slack, Discord, Telegram, etc.)
 * with the Nachos message bus. It receives messages from users, normalizes them
 * into InboundMessage format, publishes them to the bus, and delivers outbound
 * responses back to the user.
 *
 * @example
 * ```typescript
 * import type { NachosChannel, NachosChannelConfig, OutboundMessage, SendResult } from '@nachos/sdk';
 *
 * export class MyPlatformChannel implements NachosChannel {
 *   readonly channelId = 'my-platform';
 *   readonly name = 'My Platform';
 *
 *   private config!: NachosChannelConfig;
 *   private client: MyPlatformClient | undefined;
 *
 *   async initialize(config: NachosChannelConfig): Promise<void> {
 *     this.config = config;
 *     const token = config.secrets['MY_PLATFORM_TOKEN'];
 *     if (!token) throw new Error('MY_PLATFORM_TOKEN is required');
 *     this.client = new MyPlatformClient(token);
 *   }
 *
 *   async start(): Promise<void> {
 *     // Connect to the platform and subscribe to outbound messages
 *     await this.client!.connect();
 *
 *     // Listen for platform events
 *     this.client!.on('message', (msg) => this.onMessage(msg));
 *
 *     // Subscribe to outbound messages from the gateway
 *     await this.config.bus.subscribe(
 *       `nachos.channel.${this.channelId}.outbound`,
 *       (payload) => this.sendMessage(payload as OutboundMessage),
 *     );
 *   }
 *
 *   async stop(): Promise<void> {
 *     await this.client?.disconnect();
 *   }
 *
 *   async sendMessage(message: OutboundMessage): Promise<SendResult> {
 *     const result = await this.client!.send(message.conversationId, message.content.text);
 *     return { success: true, messageId: result.id };
 *   }
 *
 *   async sendTypingIndicator(conversationId: string): Promise<void> {
 *     await this.client!.sendTyping(conversationId);
 *   }
 *
 *   async healthCheck(): Promise<'healthy' | 'degraded' | 'unhealthy'> {
 *     return this.client?.isConnected() ? 'healthy' : 'unhealthy';
 *   }
 *
 *   private async onMessage(platformMsg: PlatformMessage): Promise<void> {
 *     // Normalize and publish to the bus
 *     await this.config.bus.publish(`nachos.channel.${this.channelId}.inbound`, {
 *       channel: this.channelId,
 *       channelMessageId: platformMsg.id,
 *       sender: { id: platformMsg.userId, isAllowed: true },
 *       conversation: { id: platformMsg.chatId, type: 'dm' },
 *       content: { text: platformMsg.text },
 *     });
 *   }
 * }
 * ```
 */

import type { PluginBus } from './context.js';
import type { SecurityMode, SendResult, OutboundMessage, HealthStatus } from './types.js';

/**
 * Configuration passed to a channel adapter during initialization.
 *
 * This mirrors the existing ChannelAdapterConfig from @nachos/types but is
 * defined here so plugin authors only need to depend on @nachos/sdk.
 */
export interface NachosChannelConfig {
  /**
   * Channel-specific configuration from nachos.toml.
   * The structure depends on how the user configured this channel.
   */
  config: Record<string, unknown>;

  /**
   * Secret values (API tokens, credentials) injected from environment variables.
   * Keyed by environment variable name (e.g. 'SLACK_BOT_TOKEN').
   */
  secrets: Record<string, string>;

  /**
   * The message bus for publishing inbound messages and subscribing to outbound messages.
   *
   * Channels typically:
   * 1. Publish to `nachos.channel.<channelId>.inbound` when a user sends a message.
   * 2. Subscribe to `nachos.channel.<channelId>.outbound` to deliver responses.
   * 3. Optionally subscribe to `nachos.status.<sessionId>.*` for typing indicators.
   */
  bus: PluginBus;

  /**
   * The security mode the platform is running under.
   */
  securityMode: SecurityMode;

  /**
   * DM policy resolved from the channel configuration and security mode.
   * Channels should check this before processing direct messages.
   */
  dmPolicy?: {
    /** Users explicitly allowed to send direct messages. */
    userAllowlist: string[];
    /** Whether pairing-based DM access is enabled. */
    pairing?: boolean;
  };

  /**
   * Group/channel message policy defaults.
   * Individual servers may override these via the channel config.
   */
  groupPolicy?: {
    /** Whether messages must @mention the bot to be processed. */
    mentionGating: boolean;
    /** Allowed channel IDs. Empty means all channels. */
    channelIds: string[];
    /** Allowed user IDs. Empty means all users. */
    userAllowlist: string[];
  };
}

/**
 * The interface that all Nachos channel adapters must implement.
 *
 * A channel adapter is responsible for:
 * 1. Connecting to a messaging platform (Slack, Discord, Telegram, etc.)
 * 2. Receiving user messages and publishing them as InboundMessages to the bus
 * 3. Subscribing to OutboundMessages from the bus and delivering them to users
 * 4. Optionally showing typing indicators based on status events
 * 5. Reporting its health status
 *
 * The lifecycle is: initialize -> start -> (handle messages) -> stop
 */
export interface NachosChannel {
  /**
   * Unique identifier for this channel type.
   * Must match the key used in nachos.toml under `[channels.<channelId>]`.
   * Examples: 'slack', 'discord', 'telegram', 'my-platform'.
   */
  readonly channelId: string;

  /**
   * Human-readable display name for this channel.
   * Used in logs, admin UI, and status messages.
   */
  readonly name: string;

  /**
   * Initialize the channel adapter with platform configuration.
   *
   * This is where you should:
   * - Validate required secrets (API tokens, etc.)
   * - Create platform client instances
   * - Set up event handlers (but do NOT connect yet)
   *
   * @param config - Channel configuration including secrets, bus access, and security mode.
   * @throws If required configuration is missing or invalid.
   */
  initialize(config: NachosChannelConfig): Promise<void>;

  /**
   * Start the channel adapter.
   *
   * This is where you should:
   * - Connect to the messaging platform
   * - Subscribe to `nachos.channel.<channelId>.outbound` on the bus
   * - Begin processing incoming messages
   * - Optionally subscribe to status topics for typing indicators
   *
   * This method is called after `initialize()` and should not return until
   * the channel is ready to receive messages.
   */
  start(): Promise<void>;

  /**
   * Stop the channel adapter gracefully.
   *
   * This is called during shutdown. You should:
   * - Disconnect from the messaging platform
   * - Clean up any timers or intervals (e.g. typing indicator refreshes)
   * - Release any resources
   */
  stop(): Promise<void>;

  /**
   * Send a message to a user through this channel.
   *
   * Called when the gateway has a response to deliver. The channel should
   * translate the OutboundMessage into the platform's native format and
   * send it.
   *
   * @param message - The outbound message to deliver.
   * @returns A result indicating success or failure with error details.
   */
  sendMessage(message: OutboundMessage): Promise<SendResult>;

  /**
   * Send a typing indicator to a conversation.
   *
   * Not all platforms support typing indicators. If the platform does not
   * support them, this method should be a no-op (resolve immediately).
   *
   * Typing indicators typically expire after a few seconds. For long-running
   * operations, the platform should refresh the indicator periodically.
   *
   * @param conversationId - The platform-specific conversation to show typing in.
   */
  sendTypingIndicator(conversationId: string): Promise<void>;

  /**
   * Report the health status of this channel.
   *
   * Called periodically by the platform's health check system.
   *
   * @returns 'healthy' if fully operational, 'degraded' if partially working,
   *          'unhealthy' if unable to send or receive messages.
   */
  healthCheck(): Promise<HealthStatus>;
}

/**
 * NATS topic helpers for channel adapters.
 *
 * Channels publish inbound messages and subscribe to outbound messages using
 * these topic patterns. This helper avoids hardcoding topic strings.
 *
 * @example
 * ```typescript
 * import { CHANNEL_TOPICS } from '@nachos/sdk';
 *
 * // In your channel's start() method:
 * const inboundTopic = CHANNEL_TOPICS.inbound(this.channelId);
 * const outboundTopic = CHANNEL_TOPICS.outbound(this.channelId);
 *
 * await config.bus.subscribe(outboundTopic, (msg) => this.sendMessage(msg));
 * ```
 */
export const CHANNEL_TOPICS = {
  /** Topic for inbound messages (user -> gateway). */
  inbound: (channelId: string) => `nachos.channel.${channelId}.inbound`,
  /** Topic for outbound messages (gateway -> channel). */
  outbound: (channelId: string) => `nachos.channel.${channelId}.outbound`,
} as const;

/**
 * NATS topic helpers for status events (typing indicators, progress).
 *
 * Channel adapters can subscribe to these topics to show real-time feedback
 * (e.g. typing indicators) to users while the assistant is thinking or
 * executing tools.
 *
 * @example
 * ```typescript
 * import { STATUS_TOPICS } from '@nachos/sdk';
 *
 * // Subscribe to thinking events for all sessions
 * await config.bus.subscribe(STATUS_TOPICS.thinking('*'), (event) => {
 *   // Show typing indicator
 * });
 * ```
 */
export const STATUS_TOPICS = {
  /** Published when the LLM is generating a response. */
  thinking: (sessionId: string) => `nachos.status.${sessionId}.thinking`,
  /** Published when a tool is being executed. */
  tool: (sessionId: string) => `nachos.status.${sessionId}.tool`,
  /** Published when the response is complete. */
  done: (sessionId: string) => `nachos.status.${sessionId}.done`,
  /** Published when an error occurred. */
  error: (sessionId: string) => `nachos.status.${sessionId}.error`,
} as const;

/**
 * NATS topic for audit logging.
 *
 * Channel adapters should publish audit events for security-relevant actions
 * such as command execution, policy checks, and configuration changes.
 */
export const AUDIT_TOPIC = 'nachos.audit.log' as const;
