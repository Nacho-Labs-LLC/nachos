import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router, InMemoryMessageBus, Topics, createEnvelope } from './router.js';
import {
  NachosError,
  NachosErrorCodes,
  type MessageEnvelope,
  type ChannelOutboundMessage,
} from '@nachos/types';
import type { RateLimiter } from './security/rate-limiter.js';

describe('Router', () => {
  let bus: InMemoryMessageBus;
  let router: Router;

  beforeEach(() => {
    bus = new InMemoryMessageBus();
    router = new Router({ bus, componentName: 'test-gateway' });
  });

  describe('Topics', () => {
    it('should generate correct channel inbound topic', () => {
      expect(Topics.channelInbound('slack')).toBe('nachos.channel.slack.inbound');
    });

    it('should generate correct channel outbound topic', () => {
      expect(Topics.channelOutbound('discord')).toBe('nachos.channel.discord.outbound');
    });

    it('should generate correct tool request topic', () => {
      expect(Topics.toolRequest('browser')).toBe('nachos.tool.browser.request');
    });

    it('should generate correct tool response topic', () => {
      expect(Topics.toolResponse('filesystem')).toBe('nachos.tool.filesystem.response');
    });

    it('should generate correct LLM stream topic', () => {
      expect(Topics.llmStream('session-123')).toBe('nachos.llm.stream.session-123');
    });

    it('should have correct static topics', () => {
      expect(Topics.llmRequest).toBe('nachos.llm.request');
      expect(Topics.llmResponse).toBe('nachos.llm.response');
      expect(Topics.policyCheck).toBe('nachos.policy.check');
      expect(Topics.policyResult).toBe('nachos.policy.result');
      expect(Topics.auditLog).toBe('nachos.audit.log');
      expect(Topics.healthPing).toBe('nachos.health.ping');
    });
  });

  describe('createEnvelope', () => {
    it('should create a valid message envelope', () => {
      const envelope = createEnvelope('gateway', 'test.message', { data: 'test' });

      expect(envelope.id).toBeDefined();
      expect(envelope.source).toBe('gateway');
      expect(envelope.type).toBe('test.message');
      expect(envelope.payload).toEqual({ data: 'test' });
      expect(envelope.timestamp).toBeDefined();
      expect(envelope.correlationId).toBeUndefined();
    });

    it('should include correlationId when provided', () => {
      const envelope = createEnvelope(
        'gateway',
        'test.message',
        { data: 'test' },
        'correlation-123'
      );

      expect(envelope.correlationId).toBe('correlation-123');
    });
  });

  describe('Handler registration', () => {
    it('should register and retrieve a handler', () => {
      const handler = vi.fn();
      router.registerHandler('test.message', handler);

      const retrieved = router.getHandler('test.message');
      expect(retrieved).toBe(handler);
    });

    it('should return undefined for unregistered handler', () => {
      const handler = router.getHandler('non-existent');
      expect(handler).toBeUndefined();
    });
  });

  describe('route', () => {
    it('should route message to registered handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      router.registerHandler('test.message', handler);

      const envelope = createEnvelope('test', 'test.message', { data: 'test' });
      await router.route(envelope);

      expect(handler).toHaveBeenCalledWith(envelope);
    });

    it('should log warning for unhandled message type', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const envelope = createEnvelope('test', 'unknown.message', {});
      await router.route(envelope);

      expect(warnSpy).toHaveBeenCalledWith(
        'No handler registered for message type: unknown.message'
      );

      warnSpy.mockRestore();
    });
  });

  describe('subscribe', () => {
    it('should subscribe to a topic and route messages', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      router.registerHandler('test.message', handler);

      await router.subscribe('nachos.test.topic');

      const envelope = createEnvelope('test', 'test.message', { data: 'test' });
      await bus.publish('nachos.test.topic', envelope);

      expect(handler).toHaveBeenCalledWith(envelope);
    });
  });

  describe('subscribeToChannel', () => {
    it('should subscribe to channel inbound topic', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      router.registerHandler('channel.inbound', handler);

      await router.subscribeToChannel('slack');

      const envelope = createEnvelope('slack', 'channel.inbound', {
        message: 'test',
      });
      await bus.publish('nachos.channel.slack.inbound', envelope);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('sendToChannel', () => {
    it('should send outbound message to channel', async () => {
      const publishedMessages: { topic: string; data: unknown }[] = [];
      vi.spyOn(bus, 'publish').mockImplementation(async (topic, data) => {
        publishedMessages.push({ topic, data });
      });

      const message: ChannelOutboundMessage = {
        channel: 'slack',
        conversationId: 'conv-123',
        content: { text: 'Hello!' },
      };

      await router.sendToChannel(message);

      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0]?.topic).toBe('nachos.channel.slack.outbound');
      const envelope = publishedMessages[0]?.data as MessageEnvelope;
      expect(envelope.type).toBe('channel.outbound');
      expect(envelope.payload).toEqual(message);
    });

    it('should emit audit log and throw when rate limit exceeded', async () => {
      const publishSpy = vi.spyOn(bus, 'publish').mockResolvedValue(undefined);
      const rateLimiter = {
        check: vi.fn().mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + 1000,
          total: 1,
          source: 'memory',
        }),
      } as unknown as RateLimiter;

      const limitedRouter = new Router({
        bus,
        componentName: 'test-gateway',
        rateLimiter,
      });

      const message: ChannelOutboundMessage = {
        channel: 'slack',
        conversationId: 'conv-123',
        content: { text: 'Hello!' },
      };

      let thrown: unknown;
      try {
        await limitedRouter.sendToChannel(message);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(NachosError);
      expect((thrown as NachosError).code).toBe(NachosErrorCodes.RATE_LIMITED);
      expect(publishSpy).toHaveBeenCalledWith(
        'nachos.audit.log',
        expect.objectContaining({
          type: 'audit.log',
          payload: expect.objectContaining({
            type: 'rate_limit',
            action: 'message',
            userId: 'anonymous',
          }),
        })
      );
    });
  });

  describe('processInboundMessage', () => {
    it('should create envelope for inbound message', async () => {
      const message = {
        channel: 'slack',
        channelMessageId: 'msg-123',
        sender: { id: 'user-456', isAllowed: true },
        conversation: { id: 'conv-789', type: 'dm' as const },
        content: { text: 'Hello!' },
      };

      const envelope = await router.processInboundMessage(message);

      expect(envelope.source).toBe('test-gateway');
      expect(envelope.type).toBe('channel.inbound');
      expect(envelope.payload).toEqual(message);
    });
  });

  describe('sendLLMRequest', () => {
    it('should send LLM request and return response', async () => {
      vi.spyOn(bus, 'request').mockResolvedValue({ success: true });

      const payload = { messages: [{ role: 'user', content: 'Hello' }] };
      const result = await router.sendLLMRequest(payload);

      expect(result).toEqual({ success: true });
    });
  });

  describe('sendToolRequest', () => {
    it('should send tool request to correct topic', async () => {
      const requestSpy = vi.spyOn(bus, 'request').mockResolvedValue({ result: 'tool output' });

      const payload = { action: 'read', path: '/tmp/test.txt' };
      const result = await router.sendToolRequest('filesystem', payload);

      expect(requestSpy).toHaveBeenCalledWith(
        'nachos.tool.filesystem.request',
        expect.any(Object),
        30000
      );
      expect(result).toEqual({ result: 'tool output' });
    });
  });

  describe('checkPolicy', () => {
    it('should send policy check request', async () => {
      const requestSpy = vi.spyOn(bus, 'request').mockResolvedValue({ allowed: true });

      const payload = { action: 'tool.execute', resource: 'filesystem' };
      const result = await router.checkPolicy(payload);

      expect(requestSpy).toHaveBeenCalledWith('nachos.policy.check', expect.any(Object), 5000);
      expect(result).toEqual({ allowed: true });
    });
  });

  describe('audit', () => {
    it('should publish audit log entry', async () => {
      const publishSpy = vi.spyOn(bus, 'publish').mockResolvedValue(undefined);

      const payload = { action: 'session.create', sessionId: 'sess-123' };
      await router.audit(payload);

      expect(publishSpy).toHaveBeenCalledWith(
        'nachos.audit.log',
        expect.objectContaining({
          type: 'audit.log',
          payload,
        })
      );
    });
  });

  describe('getBus', () => {
    it('should return the underlying message bus', () => {
      expect(router.getBus()).toBe(bus);
    });
  });
});

describe('InMemoryMessageBus', () => {
  let bus: InMemoryMessageBus;

  beforeEach(() => {
    bus = new InMemoryMessageBus();
  });

  describe('publish/subscribe', () => {
    it('should deliver messages to subscribers', async () => {
      const received: unknown[] = [];
      await bus.subscribe('test.topic', async (data) => {
        received.push(data);
      });

      await bus.publish('test.topic', { message: 'hello' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ message: 'hello' });
    });

    it('should deliver to multiple subscribers', async () => {
      const received1: unknown[] = [];
      const received2: unknown[] = [];

      await bus.subscribe('test.topic', async (data) => {
        received1.push(data);
      });
      await bus.subscribe('test.topic', async (data) => {
        received2.push(data);
      });

      await bus.publish('test.topic', { message: 'hello' });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('should not deliver to unsubscribed topics', async () => {
      const received: unknown[] = [];
      await bus.subscribe('test.topic', async (data) => {
        received.push(data);
      });

      await bus.publish('other.topic', { message: 'hello' });

      expect(received).toHaveLength(0);
    });
  });

  describe('unsubscribe', () => {
    it('should remove all handlers for a topic', async () => {
      const received: unknown[] = [];
      await bus.subscribe('test.topic', async (data) => {
        received.push(data);
      });

      await bus.unsubscribe('test.topic');
      await bus.publish('test.topic', { message: 'hello' });

      expect(received).toHaveLength(0);
    });
  });

  describe('request', () => {
    it('should return default response', async () => {
      const result = await bus.request('test.topic', { query: 'test' });
      expect(result).toEqual({ success: true });
    });
  });
});

describe('NatsBusAdapter', () => {
  // Note: Full integration tests with actual NachosBusClient require a NATS server
  // These tests verify the adapter's type validation without requiring NATS

  describe('type validation', () => {
    it('should require valid MessageEnvelope for publish', async () => {
      // Create a mock NachosBusClient
      const mockClient = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        request: vi.fn(),
      };

      // Import NatsBusAdapter
      const { NatsBusAdapter } = await import('./router.js');
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

    it('should require valid MessageEnvelope for request', async () => {
      const mockClient = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        request: vi.fn().mockResolvedValue({ payload: 'response' }),
      };

      const { NatsBusAdapter } = await import('./router.js');
      const adapter = new NatsBusAdapter(mockClient as never);

      // Invalid data should throw
      await expect(adapter.request('test.topic', { invalid: 'data' })).rejects.toThrow(
        'Invalid message envelope'
      );

      // Valid envelope should work
      const validEnvelope = createEnvelope('test', 'test.message', { data: 'test' });
      await adapter.request('test.topic', validEnvelope);
      expect(mockClient.request).toHaveBeenCalled();
    });
  });
});
