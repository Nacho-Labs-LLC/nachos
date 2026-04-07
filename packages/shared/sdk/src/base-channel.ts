/**
 * @nachos/sdk - Base Channel
 *
 * Abstract base class that auto-wires bus subscriptions for channel adapters.
 * Subclass this instead of implementing NachosChannel from scratch to get
 * automatic outbound message routing, inbound message publishing, and
 * status event helpers.
 *
 * @example
 * ```typescript
 * import { BaseChannel } from '@nachos/sdk';
 * import type { OutboundMessage, SendResult, HealthStatus } from '@nachos/sdk';
 *
 * export class MyPlatformChannel extends BaseChannel {
 *   constructor() {
 *     super('my-platform', 'My Platform');
 *   }
 *
 *   protected async connect(): Promise<void> {
 *     // Connect to your platform SDK
 *   }
 *
 *   protected async disconnect(): Promise<void> {
 *     // Disconnect from your platform SDK
 *   }
 *
 *   protected async onOutboundMessage(message: OutboundMessage): Promise<SendResult> {
 *     // Translate OutboundMessage to your platform's format and send
 *     return { success: true, messageId: '...' };
 *   }
 *
 *   async sendTypingIndicator(conversationId: string): Promise<void> {
 *     // Show typing indicator on your platform (no-op if unsupported)
 *   }
 *
 *   async healthCheck(): Promise<HealthStatus> {
 *     return 'healthy';
 *   }
 * }
 * ```
 */

import type { NachosChannel, NachosChannelConfig } from './channel.js';
import { CHANNEL_TOPICS, STATUS_TOPICS } from './channel.js';
import type { PluginBus } from './context.js';
import type { OutboundMessage, InboundMessage, SendResult, HealthStatus } from './types.js';

/**
 * Status event type for the publishStatus helper.
 */
export type StatusEventType = 'thinking' | 'tool' | 'done' | 'error';

/**
 * Abstract base class for Nachos channel adapters.
 *
 * Handles the bus wiring that every channel needs:
 * - Subscribes to outbound messages on start()
 * - Provides publishInbound() and publishStatus() helpers
 * - Unsubscribes on stop()
 * - Wraps platform calls in error handling
 *
 * Subclasses implement the platform-specific parts:
 * - connect() / disconnect() for platform SDK lifecycle
 * - onOutboundMessage() to deliver messages to users
 * - sendTypingIndicator() for typing indicators
 * - healthCheck() for health reporting
 */
export abstract class BaseChannel implements NachosChannel {
  readonly channelId: string;
  readonly name: string;

  /** The bus instance, available after initialize() */
  protected bus!: PluginBus;

  /** The full channel config, available after initialize() */
  protected channelConfig!: NachosChannelConfig;

  /** Whether the channel has been started */
  private started = false;

  /** Subscription handle for cleanup */
  private outboundSubscription: unknown = null;

  constructor(channelId: string, name: string) {
    this.channelId = channelId;
    this.name = name;
  }

  /**
   * Initialize the channel with configuration.
   *
   * Stores the config and bus reference. Subclasses can override this
   * to perform additional initialization (e.g. validate secrets, create
   * platform clients), but MUST call `super.initialize(config)` first.
   */
  async initialize(config: NachosChannelConfig): Promise<void> {
    this.channelConfig = config;
    this.bus = config.bus;
  }

  /**
   * Start the channel adapter.
   *
   * Calls the subclass connect() method, then subscribes to the
   * outbound topic. After this returns, the channel is ready to
   * send and receive messages.
   */
  async start(): Promise<void> {
    // Call platform-specific connection
    await this.connect();

    // Subscribe to outbound messages from the gateway
    const outboundTopic = CHANNEL_TOPICS.outbound(this.channelId);
    this.outboundSubscription = await this.bus.subscribe(
      outboundTopic,
      async (payload: unknown) => {
        const message = payload as OutboundMessage;
        try {
          await this.onOutboundMessage(message);
        } catch (error) {
          // Swallow errors from platform delivery to avoid crashing
          // the subscription loop. Subclasses should handle their own
          // error reporting within onOutboundMessage if needed.
          const err = error instanceof Error ? error : new Error(String(error));
          this.onError('outbound_delivery', err, { conversationId: message.conversationId });
        }
      }
    );

    this.started = true;
  }

  /**
   * Stop the channel adapter.
   *
   * Unsubscribes from the outbound topic, then calls the subclass
   * disconnect() method for platform-specific teardown.
   */
  async stop(): Promise<void> {
    this.started = false;

    // Unsubscribe from outbound topic if we have a subscription handle
    // The PluginBus.subscribe returns Promise<unknown>, so we check for
    // common unsubscribe patterns
    if (this.outboundSubscription != null) {
      const sub = this.outboundSubscription as Record<string, unknown>;
      if (typeof sub.unsubscribe === 'function') {
        (sub.unsubscribe as () => void)();
      } else if (typeof sub.drain === 'function') {
        await (sub.drain as () => Promise<void>)();
      }
      this.outboundSubscription = null;
    }

    // Call platform-specific disconnection
    try {
      await this.disconnect();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError('disconnect', err);
    }
  }

  /**
   * Send a message through this channel.
   *
   * Delegates to onOutboundMessage with error handling.
   * This satisfies the NachosChannel interface.
   */
  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      return await this.onOutboundMessage(message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError('send_message', err, { conversationId: message.conversationId });
      return {
        success: false,
        error: {
          code: 'channel_error',
          message: err.message,
          retryable: true,
        },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Publish an inbound message to the bus.
   *
   * Call this when your platform receives a user message.
   * The message will be routed to the gateway for processing.
   */
  protected async publishInbound(message: InboundMessage): Promise<void> {
    const topic = CHANNEL_TOPICS.inbound(this.channelId);
    await this.bus.publish(topic, message);
  }

  /**
   * Publish a status event to the bus.
   *
   * Use this to broadcast typing/tool/done/error status for a session.
   * Channels can subscribe to these to show real-time feedback to users.
   *
   * @param sessionId - The session to publish status for.
   * @param type - The status event type.
   * @param details - Optional additional details (e.g. toolName).
   */
  protected async publishStatus(
    sessionId: string,
    type: StatusEventType,
    details?: Record<string, unknown>
  ): Promise<void> {
    let topic: string;
    switch (type) {
      case 'thinking':
        topic = STATUS_TOPICS.thinking(sessionId);
        break;
      case 'tool':
        topic = STATUS_TOPICS.tool(sessionId);
        break;
      case 'done':
        topic = STATUS_TOPICS.done(sessionId);
        break;
      case 'error':
        topic = STATUS_TOPICS.error(sessionId);
        break;
    }

    await this.bus.publish(topic, {
      sessionId,
      status: type,
      channelId: this.channelId,
      ...details,
    });
  }

  /**
   * Whether the channel has been started and is running.
   */
  protected get isStarted(): boolean {
    return this.started;
  }

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  /**
   * Called when an error occurs in bus wiring or platform calls.
   *
   * Subclasses can override this to integrate with their logging
   * framework. The default implementation is a no-op (errors are
   * silently swallowed to prevent crashes).
   *
   * @param operation - A short label for what was happening.
   * @param error - The error that occurred.
   * @param context - Optional context about the operation.
   */
  protected onError(_operation: string, _error: Error, _context?: Record<string, unknown>): void {
    // Default: no-op. Subclasses can override for logging.
  }

  // ---------------------------------------------------------------------------
  // Abstract methods for subclasses
  // ---------------------------------------------------------------------------

  /**
   * Connect to the messaging platform.
   *
   * Called during start() before bus subscriptions are set up.
   * Implement this to initialize your platform SDK, log in, etc.
   */
  protected abstract connect(): Promise<void>;

  /**
   * Disconnect from the messaging platform.
   *
   * Called during stop() after bus subscriptions are torn down.
   * Implement this to gracefully disconnect, clean up timers, etc.
   */
  protected abstract disconnect(): Promise<void>;

  /**
   * Handle an outbound message from the gateway.
   *
   * Called when the gateway publishes a response that should be
   * delivered to a user through this channel. Translate the
   * OutboundMessage into your platform's native format and send it.
   *
   * @param message - The outbound message to deliver.
   * @returns A result indicating success or failure.
   */
  protected abstract onOutboundMessage(message: OutboundMessage): Promise<SendResult>;

  /**
   * Send a typing indicator to a conversation.
   *
   * Implement this if your platform supports typing indicators.
   * If not, implement as a no-op (empty async function).
   */
  abstract sendTypingIndicator(conversationId: string): Promise<void>;

  /**
   * Report the health status of this channel.
   *
   * Check platform connectivity, API availability, etc.
   */
  abstract healthCheck(): Promise<HealthStatus>;
}
