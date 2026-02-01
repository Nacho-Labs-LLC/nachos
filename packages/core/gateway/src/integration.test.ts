/**
 * Gateway-Bus Integration Tests
 *
 * Tests the integration between the Gateway and Bus components
 * to ensure reliable message passing with validated messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Gateway } from './gateway.js';
import { Router, InMemoryMessageBus, createEnvelope, NatsBusAdapter } from './router.js';
import { TOPICS } from '@nachos/bus';
import {
  validateChannelInboundMessage,
  validateChannelOutboundMessage,
  ChannelInboundMessageSchema,
  createValidatedHandler,
  createValidationError,
} from '@nachos/types';
import type { MessageEnvelope, ChannelInboundMessage, ChannelOutboundMessage } from '@nachos/types';

// Mock NATS for integration tests
vi.mock('nats', () => {
  const mockSubscription = {
    unsubscribe: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
    [Symbol.asyncIterator]: vi.fn().mockReturnValue({
      next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
    }),
  };

  const mockConnection = {
    isClosed: vi.fn().mockReturnValue(false),
    close: vi.fn().mockResolvedValue(undefined),
    drain: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue(mockSubscription),
    request: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    closed: vi.fn().mockReturnValue(new Promise(() => {})),
    status: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: vi.fn().mockReturnValue({
        next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      }),
    }),
  };

  return {
    connect: vi.fn().mockResolvedValue(mockConnection),
    StringCodec: vi.fn().mockReturnValue({
      encode: vi.fn((str: string) => new TextEncoder().encode(str)),
      decode: vi.fn((data: Uint8Array) => new TextDecoder().decode(data)),
    }),
    NatsError: class NatsError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
    ErrorCode: {
      Timeout: 'TIMEOUT',
    },
    getMockConnection: () => mockConnection,
    getMockSubscription: () => mockSubscription,
  };
});

describe('Gateway-Bus Integration', () => {
  describe('Message Flow with InMemoryMessageBus', () => {
    let gateway: Gateway;
    let bus: InMemoryMessageBus;
    let router: Router;

    beforeEach(async () => {
      bus = new InMemoryMessageBus();
      router = new Router({ bus, componentName: 'gateway' });
      gateway = new Gateway({
        dbPath: ':memory:',
        bus,
        defaultSystemPrompt: 'You are a helpful assistant.',
      });
    });

    afterEach(async () => {
      await gateway.stop();
    });

    it('should process inbound channel message and create session', async () => {
      const inboundMessage: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: {
          id: 'user-456',
          name: 'Test User',
          isAllowed: true,
        },
        conversation: {
          id: 'conv-789',
          type: 'dm',
        },
        content: {
          text: 'Hello, assistant!',
        },
      };

      // Validate the message using our schemas
      const validationResult = validateChannelInboundMessage(inboundMessage);
      expect(validationResult.success).toBe(true);

      // Process the message
      const session = await gateway.processMessage(inboundMessage);

      // Verify session was created
      expect(session).toBeDefined();
      expect(session.channel).toBe('slack');
      expect(session.conversationId).toBe('conv-789');
      expect(session.userId).toBe('user-456');
      expect(session.status).toBe('active');

      // Verify message was added to session
      const sessionManager = gateway.getSessionManager();
      const messages = sessionManager.getMessages(session.id);
      expect(messages.length).toBe(1);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content).toBe('Hello, assistant!');
    });

    it('should validate outbound message before sending', async () => {
      const outboundMessage: ChannelOutboundMessage = {
        channel: 'slack',
        conversationId: 'conv-789',
        content: {
          text: 'Hello from the assistant!',
          format: 'markdown',
        },
        options: {
          threadReply: true,
        },
      };

      // Validate outbound message
      const validationResult = validateChannelOutboundMessage(outboundMessage);
      expect(validationResult.success).toBe(true);

      // Track published messages
      const publishedMessages: { topic: string; data: unknown }[] = [];
      vi.spyOn(bus, 'publish').mockImplementation(async (topic, data) => {
        publishedMessages.push({ topic, data });
      });

      // Send outbound message
      await router.sendToChannel(outboundMessage);

      // Verify message was published to correct topic
      expect(publishedMessages.length).toBe(1);
      expect(publishedMessages[0]?.topic).toBe('nachos.channel.slack.outbound');

      // Verify envelope contains valid data
      const envelope = publishedMessages[0]?.data as MessageEnvelope;
      expect(envelope.type).toBe('channel.outbound');
      expect(envelope.source).toBe('gateway');
      expect(envelope.payload).toEqual(outboundMessage);
    });

    it('should reject invalid inbound message', () => {
      const invalidMessage = {
        channel: 'slack',
        // Missing required fields
      };

      const validationResult = validateChannelInboundMessage(invalidMessage);
      expect(validationResult.success).toBe(false);
      expect(validationResult.errors).toBeDefined();
      expect(validationResult.errors!.length).toBeGreaterThan(0);
    });

    it('should reject invalid outbound message', () => {
      const invalidMessage = {
        channel: 'slack',
        conversationId: 'conv-789',
        // Missing required content
      };

      const validationResult = validateChannelOutboundMessage(invalidMessage);
      expect(validationResult.success).toBe(false);
    });

    it('should handle message routing with type handlers', async () => {
      const handlerCalled = vi.fn();

      // Register handler for custom message type
      router.registerHandler('custom.event', async (envelope) => {
        handlerCalled(envelope);
      });

      // Create and route envelope
      const envelope = createEnvelope('test', 'custom.event', { data: 'test' });
      await router.route(envelope);

      expect(handlerCalled).toHaveBeenCalledTimes(1);
      expect(handlerCalled).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'custom.event',
          payload: { data: 'test' },
        })
      );
    });

    it('should subscribe to channel topics and process messages', async () => {
      const processedMessages: MessageEnvelope[] = [];

      router.registerHandler('channel.inbound', async (envelope) => {
        processedMessages.push(envelope);
      });

      await router.subscribeToChannel('slack');

      // Simulate inbound message
      const inboundMessage: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-456',
        sender: { id: 'user-123', isAllowed: true },
        conversation: { id: 'conv-999', type: 'channel' },
        content: { text: 'Test message' },
      };

      const envelope = createEnvelope('slack-channel', 'channel.inbound', inboundMessage);
      await bus.publish(TOPICS.channel.inbound('slack'), envelope);

      expect(processedMessages.length).toBe(1);
      expect(processedMessages[0]?.payload).toEqual(inboundMessage);
    });
  });

  describe('Validated Message Handlers', () => {
    it('should call handler only for valid messages', async () => {
      const validHandler = vi.fn();
      const errorHandler = vi.fn();

      const validatedHandler = createValidatedHandler<typeof ChannelInboundMessageSchema>(
        ChannelInboundMessageSchema,
        async (_envelope, payload) => {
          validHandler(payload);
        },
        { onError: errorHandler }
      );

      // Valid message
      const validEnvelope = {
        id: 'msg-123',
        timestamp: new Date().toISOString(),
        source: 'slack-channel',
        type: 'channel.inbound',
        payload: {
          channel: 'slack',
          channelMessageId: 'msg-456',
          sender: { id: 'user-123', isAllowed: true },
          conversation: { id: 'conv-789', type: 'dm' },
          content: { text: 'Hello!' },
        },
      };

      await validatedHandler(validEnvelope);
      expect(validHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).not.toHaveBeenCalled();

      // Invalid message (missing required fields in payload)
      const invalidEnvelope = {
        id: 'msg-456',
        timestamp: new Date().toISOString(),
        source: 'slack-channel',
        type: 'channel.inbound',
        payload: {
          channel: 'slack',
          // Missing required fields
        },
      };

      await validatedHandler(invalidEnvelope);
      expect(validHandler).toHaveBeenCalledTimes(1); // Still 1, not called again
      expect(errorHandler).toHaveBeenCalledTimes(1);
    });

    it('should throw on invalid message when throwOnInvalid is true', async () => {
      const validatedHandler = createValidatedHandler(ChannelInboundMessageSchema, async () => {}, {
        throwOnInvalid: true,
      });

      const invalidEnvelope = {
        // Missing required envelope fields
        payload: {},
      };

      await expect(validatedHandler(invalidEnvelope)).rejects.toThrow('Invalid message envelope');
    });
  });

  describe('Topic Structure', () => {
    it('should generate correct channel topics', () => {
      expect(TOPICS.channel.inbound('slack')).toBe('nachos.channel.slack.inbound');
      expect(TOPICS.channel.outbound('discord')).toBe('nachos.channel.discord.outbound');
      expect(TOPICS.channel.allInbound).toBe('nachos.channel.*.inbound');
    });

    it('should generate correct LLM topics', () => {
      expect(TOPICS.llm.request).toBe('nachos.llm.request');
      expect(TOPICS.llm.response).toBe('nachos.llm.response');
      expect(TOPICS.llm.stream('session-123')).toBe('nachos.llm.stream.session-123');
    });

    it('should generate correct tool topics', () => {
      expect(TOPICS.tool.request('filesystem')).toBe('nachos.tool.filesystem.request');
      expect(TOPICS.tool.response('browser')).toBe('nachos.tool.browser.response');
    });

    it('should generate correct policy topics', () => {
      expect(TOPICS.policy.check).toBe('nachos.policy.check');
      expect(TOPICS.policy.result).toBe('nachos.policy.result');
    });
  });

  describe('Error Handling', () => {
    it('should create validation errors with proper structure', () => {
      const error = createValidationError('Invalid message format', {
        component: 'gateway',
        details: {
          field: 'payload.content',
          received: null,
          expected: 'object',
        },
        correlationId: 'corr-123',
      });

      expect(error.code).toBe('NACHOS_ERR_VALIDATION');
      expect(error.message).toBe('Invalid message format');
      expect(error.component).toBe('gateway');
      expect(error.details).toEqual({
        field: 'payload.content',
        received: null,
        expected: 'object',
      });
      expect(error.correlationId).toBe('corr-123');
      expect(error.timestamp).toBeDefined();
    });
  });

  describe('NatsBusAdapter Integration', () => {
    it('should require valid MessageEnvelope for publish', async () => {
      const mockClient = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        request: vi.fn(),
      };

      const adapter = new NatsBusAdapter(mockClient as never);

      // Invalid data should throw
      await expect(adapter.publish('test.topic', { invalid: 'data' })).rejects.toThrow(
        'Invalid message envelope'
      );

      // Valid envelope should work
      const validEnvelope = createEnvelope('test', 'test.message', { data: 'test' });
      await adapter.publish('test.topic', validEnvelope);
      expect(mockClient.publish).toHaveBeenCalled();
    });

    it('should wrap bus client correctly', () => {
      const mockClient = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        request: vi.fn(),
      };

      const adapter = new NatsBusAdapter(mockClient as never);
      expect(adapter.getClient()).toBe(mockClient);
    });
  });

  describe('End-to-End Message Flow', () => {
    it('should process complete inbound-to-outbound flow', async () => {
      const bus = new InMemoryMessageBus();
      const gateway = new Gateway({
        dbPath: ':memory:',
        bus,
        defaultSystemPrompt: 'You are a helpful assistant.',
      });

      const outboundMessages: { topic: string; data: MessageEnvelope }[] = [];

      // Intercept outbound messages
      const originalPublish = bus.publish.bind(bus);
      vi.spyOn(bus, 'publish').mockImplementation(async (topic, data) => {
        if (topic.includes('outbound') || topic.includes('processed')) {
          outboundMessages.push({ topic, data: data as MessageEnvelope });
        }
        return originalPublish(topic, data);
      });

      // Process inbound message
      const inboundMessage: ChannelInboundMessage = {
        channel: 'slack',
        channelMessageId: 'msg-e2e-123',
        sender: { id: 'user-e2e', name: 'E2E User', isAllowed: true },
        conversation: { id: 'conv-e2e', type: 'dm' },
        content: { text: 'End-to-end test message' },
      };

      const session = await gateway.processMessage(inboundMessage);

      // Verify session was created correctly
      expect(session.id).toBeDefined();
      expect(session.channel).toBe('slack');
      expect(session.userId).toBe('user-e2e');

      // Verify processed message was published
      const processedMessage = outboundMessages.find((m) => m.topic === 'nachos.gateway.processed');
      expect(processedMessage).toBeDefined();
      expect((processedMessage?.data.payload as { sessionId: string }).sessionId).toBe(session.id);

      await gateway.stop();
    });
  });
});
