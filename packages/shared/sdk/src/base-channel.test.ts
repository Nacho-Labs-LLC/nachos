import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseChannel } from './base-channel.js';
import type { NachosChannelConfig } from './channel.js';
import type { OutboundMessage, InboundMessage, SendResult, HealthStatus } from './types.js';
import type { StatusEventType } from './base-channel.js';

// ---------------------------------------------------------------------------
// Test double: a concrete subclass of BaseChannel
// ---------------------------------------------------------------------------

class TestChannel extends BaseChannel {
  connectCalled = false;
  disconnectCalled = false;
  lastOutboundMessage: OutboundMessage | null = null;
  lastTypingConversation: string | null = null;
  healthResult: HealthStatus = 'healthy';
  sendResult: SendResult = { success: true, messageId: 'msg-1' };
  errors: Array<{ operation: string; error: Error; context?: Record<string, unknown> }> = [];

  /** Whether connect() should throw */
  connectShouldThrow = false;

  /** Whether onOutboundMessage() should throw */
  outboundShouldThrow = false;

  constructor() {
    super('test-channel', 'Test Channel');
  }

  protected async connect(): Promise<void> {
    if (this.connectShouldThrow) {
      throw new Error('connect failed');
    }
    this.connectCalled = true;
  }

  protected async disconnect(): Promise<void> {
    this.disconnectCalled = true;
  }

  protected async onOutboundMessage(message: OutboundMessage): Promise<SendResult> {
    if (this.outboundShouldThrow) {
      throw new Error('platform send failed');
    }
    this.lastOutboundMessage = message;
    return this.sendResult;
  }

  async sendTypingIndicator(conversationId: string): Promise<void> {
    this.lastTypingConversation = conversationId;
  }

  async healthCheck(): Promise<HealthStatus> {
    return this.healthResult;
  }

  protected override onError(
    operation: string,
    error: Error,
    context?: Record<string, unknown>
  ): void {
    this.errors.push({ operation, error, context });
  }

  // Expose protected methods for testing
  async testPublishInbound(message: InboundMessage): Promise<void> {
    return this.publishInbound(message);
  }

  async testPublishStatus(
    sessionId: string,
    type: StatusEventType,
    details?: Record<string, unknown>
  ): Promise<void> {
    return this.publishStatus(sessionId, type, details);
  }

  get testIsStarted(): boolean {
    return this.isStarted;
  }
}

// ---------------------------------------------------------------------------
// Mock bus
// ---------------------------------------------------------------------------

function createTestBus() {
  const handlers = new Map<string, Array<(data: unknown) => void | Promise<void>>>();
  const published: Array<{ topic: string; data: unknown }> = [];

  return {
    publish: vi.fn(async (topic: string, data: unknown) => {
      published.push({ topic, data });
    }),
    subscribe: vi.fn(async (topic: string, handler: (data: unknown) => void | Promise<void>) => {
      if (!handlers.has(topic)) {
        handlers.set(topic, []);
      }
      handlers.get(topic)!.push(handler);
      return { unsubscribe: vi.fn() };
    }),
    // test helpers
    _published: published,
    _handlers: handlers,
    async _dispatch(topic: string, data: unknown) {
      const topicHandlers = handlers.get(topic) ?? [];
      for (const handler of topicHandlers) {
        await handler(data);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseChannel', () => {
  let channel: TestChannel;
  let bus: ReturnType<typeof createTestBus>;
  let config: NachosChannelConfig;

  beforeEach(() => {
    channel = new TestChannel();
    bus = createTestBus();
    config = {
      config: {},
      secrets: {},
      bus,
      securityMode: 'standard',
    };
  });

  describe('initialize()', () => {
    it('stores the config and bus reference', async () => {
      await channel.initialize(config);

      // The channel should have stored the config internally.
      // We verify by checking that subsequent operations work.
      expect(channel.channelId).toBe('test-channel');
      expect(channel.name).toBe('Test Channel');
    });
  });

  describe('start()', () => {
    it('calls connect() on the subclass', async () => {
      await channel.initialize(config);
      await channel.start();

      expect(channel.connectCalled).toBe(true);
    });

    it('subscribes to the outbound topic', async () => {
      await channel.initialize(config);
      await channel.start();

      expect(bus.subscribe).toHaveBeenCalledWith(
        'nachos.channel.test-channel.outbound',
        expect.any(Function)
      );
    });

    it('marks the channel as started', async () => {
      await channel.initialize(config);
      expect(channel.testIsStarted).toBe(false);

      await channel.start();
      expect(channel.testIsStarted).toBe(true);
    });

    it('dispatches outbound messages to onOutboundMessage()', async () => {
      await channel.initialize(config);
      await channel.start();

      const outbound: OutboundMessage = {
        channel: 'test-channel',
        conversationId: 'conv-1',
        content: { text: 'Hello from gateway' },
      };

      await bus._dispatch('nachos.channel.test-channel.outbound', outbound);

      expect(channel.lastOutboundMessage).toEqual(outbound);
    });

    it('catches errors from onOutboundMessage and calls onError', async () => {
      channel.outboundShouldThrow = true;
      await channel.initialize(config);
      await channel.start();

      const outbound: OutboundMessage = {
        channel: 'test-channel',
        conversationId: 'conv-1',
        content: { text: 'Hello' },
      };

      await bus._dispatch('nachos.channel.test-channel.outbound', outbound);

      expect(channel.errors).toHaveLength(1);
      expect(channel.errors[0]?.operation).toBe('outbound_delivery');
      expect(channel.errors[0]?.error.message).toBe('platform send failed');
      expect(channel.errors[0]?.context).toEqual({ conversationId: 'conv-1' });
    });
  });

  describe('stop()', () => {
    it('calls disconnect() on the subclass', async () => {
      await channel.initialize(config);
      await channel.start();
      await channel.stop();

      expect(channel.disconnectCalled).toBe(true);
    });

    it('marks the channel as stopped', async () => {
      await channel.initialize(config);
      await channel.start();
      expect(channel.testIsStarted).toBe(true);

      await channel.stop();
      expect(channel.testIsStarted).toBe(false);
    });

    it('calls unsubscribe on the subscription handle', async () => {
      await channel.initialize(config);
      await channel.start();

      // The subscribe mock returns { unsubscribe: vi.fn() }
      const subscribeCall = bus.subscribe.mock.results[0];
      const subscriptionHandle = await subscribeCall?.value;
      expect(subscriptionHandle.unsubscribe).not.toHaveBeenCalled();

      await channel.stop();

      expect(subscriptionHandle.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('sendMessage()', () => {
    it('delegates to onOutboundMessage and returns the result', async () => {
      channel.sendResult = { success: true, messageId: 'msg-42' };
      await channel.initialize(config);

      const result = await channel.sendMessage({
        channel: 'test-channel',
        conversationId: 'conv-1',
        content: { text: 'Hi' },
      });

      expect(result).toEqual({ success: true, messageId: 'msg-42' });
    });

    it('returns an error result when onOutboundMessage throws', async () => {
      channel.outboundShouldThrow = true;
      await channel.initialize(config);

      const result = await channel.sendMessage({
        channel: 'test-channel',
        conversationId: 'conv-1',
        content: { text: 'Hi' },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('channel_error');
      expect(result.error?.message).toBe('platform send failed');
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('publishInbound()', () => {
    it('publishes to the correct inbound topic', async () => {
      await channel.initialize(config);

      const inbound: InboundMessage = {
        channel: 'test-channel',
        channelMessageId: 'msg-1',
        sender: { id: 'user-1', isAllowed: true },
        conversation: { id: 'conv-1', type: 'dm' },
        content: { text: 'Hello' },
      };

      await channel.testPublishInbound(inbound);

      expect(bus.publish).toHaveBeenCalledWith('nachos.channel.test-channel.inbound', inbound);
    });
  });

  describe('publishStatus()', () => {
    it('publishes thinking status to the correct topic', async () => {
      await channel.initialize(config);

      await channel.testPublishStatus('session-1', 'thinking');

      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.status.session-1.thinking',
        expect.objectContaining({
          sessionId: 'session-1',
          status: 'thinking',
          channelId: 'test-channel',
        })
      );
    });

    it('publishes tool status with details', async () => {
      await channel.initialize(config);

      await channel.testPublishStatus('session-1', 'tool', { toolName: 'filesystem_read' });

      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.status.session-1.tool',
        expect.objectContaining({
          sessionId: 'session-1',
          status: 'tool',
          channelId: 'test-channel',
          toolName: 'filesystem_read',
        })
      );
    });

    it('publishes done status', async () => {
      await channel.initialize(config);

      await channel.testPublishStatus('session-1', 'done');

      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.status.session-1.done',
        expect.objectContaining({ status: 'done' })
      );
    });

    it('publishes error status', async () => {
      await channel.initialize(config);

      await channel.testPublishStatus('session-1', 'error');

      expect(bus.publish).toHaveBeenCalledWith(
        'nachos.status.session-1.error',
        expect.objectContaining({ status: 'error' })
      );
    });
  });

  describe('error handling', () => {
    it('catches disconnect errors and calls onError', async () => {
      const failingChannel = new TestChannel();
      // Override disconnect to throw
      failingChannel['disconnect'] = async () => {
        throw new Error('disconnect boom');
      };

      await failingChannel.initialize(config);
      await failingChannel.start();
      await failingChannel.stop();

      expect(failingChannel.errors).toHaveLength(1);
      expect(failingChannel.errors[0]?.operation).toBe('disconnect');
      expect(failingChannel.errors[0]?.error.message).toBe('disconnect boom');
    });
  });
});
