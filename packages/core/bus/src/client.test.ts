import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NachosBusClient, createBusClient } from './client.js';
import type { MessageEnvelope } from './types.js';

// Mock the nats module
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
    closed: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
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

// Import after mocking
import * as nats from 'nats';

const getMockConnection = () =>
  (nats as unknown as { getMockConnection: () => ReturnType<typeof vi.fn> }).getMockConnection();
const getMockSubscription = () =>
  (
    nats as unknown as { getMockSubscription: () => ReturnType<typeof vi.fn> }
  ).getMockSubscription();

describe('NachosBusClient', () => {
  let client: NachosBusClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new NachosBusClient({
      servers: 'nats://localhost:4222',
      name: 'test-component',
    });
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('constructor', () => {
    it('should create client with required options', () => {
      const c = new NachosBusClient({
        servers: 'nats://localhost:4222',
        name: 'test',
      });
      expect(c).toBeInstanceOf(NachosBusClient);
    });

    it('should create client with all options', () => {
      const c = new NachosBusClient({
        servers: ['nats://localhost:4222', 'nats://localhost:4223'],
        name: 'test',
        timeout: 10000,
        maxReconnectAttempts: 5,
        reconnectTimeWait: 1000,
      });
      expect(c).toBeInstanceOf(NachosBusClient);
    });
  });

  describe('connect', () => {
    it('should connect to NATS server', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
      expect(nats.connect).toHaveBeenCalledWith({
        servers: ['nats://localhost:4222'],
        name: 'test-component',
        timeout: 5000,
        maxReconnectAttempts: 10,
        reconnectTimeWait: 2000,
      });
    });

    it('should not reconnect if already connected', async () => {
      await client.connect();
      await client.connect(); // Second call should be no-op
      expect(nats.connect).toHaveBeenCalledTimes(1);
    });

    it('should emit connect event', async () => {
      const handler = vi.fn();
      client.on('connect', handler);
      await client.connect();
      expect(handler).toHaveBeenCalledWith('connect', undefined);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from NATS server', async () => {
      await client.connect();
      await client.disconnect();
      expect(getMockConnection().drain).toHaveBeenCalled();
      expect(getMockConnection().close).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      await client.disconnect(); // Should not throw
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('publish', () => {
    it('should throw when not connected', () => {
      expect(() => client.publish('topic', { data: 'test' })).toThrow('Not connected to NATS');
    });

    it('should publish message to topic', async () => {
      await client.connect();
      client.publish('nachos.test.topic', { data: 'test' });

      expect(getMockConnection().publish).toHaveBeenCalled();
      const [topic, data, options] = getMockConnection().publish.mock.calls[0] as [
        string,
        Uint8Array,
        { reply?: string },
      ];
      expect(topic).toBe('nachos.test.topic');
      expect(options).toEqual({ reply: undefined });

      const envelope = JSON.parse(new TextDecoder().decode(data)) as MessageEnvelope;
      expect(envelope.payload).toEqual({ data: 'test' });
      expect(envelope.source).toBe('test-component');
      expect(envelope.type).toBe('message');
      expect(envelope.id).toBeDefined();
      expect(envelope.timestamp).toBeDefined();
    });

    it('should publish with custom options', async () => {
      await client.connect();
      client.publish(
        'nachos.test.topic',
        { data: 'test' },
        {
          type: 'custom-type',
          correlationId: 'corr-123',
          reply: 'reply.topic',
        }
      );

      const [_topic, data, options] = getMockConnection().publish.mock.calls[0] as [
        string,
        Uint8Array,
        { reply?: string },
      ];
      expect(options).toEqual({ reply: 'reply.topic' });

      const envelope = JSON.parse(new TextDecoder().decode(data)) as MessageEnvelope;
      expect(envelope.type).toBe('custom-type');
      expect(envelope.correlationId).toBe('corr-123');
    });
  });

  describe('subscribe', () => {
    it('should throw when not connected', async () => {
      await expect(client.subscribe('topic', vi.fn())).rejects.toThrow('Not connected to NATS');
    });

    it('should subscribe to topic', async () => {
      await client.connect();
      const handler = vi.fn();
      const subscription = await client.subscribe('nachos.test.topic', handler);

      expect(getMockConnection().subscribe).toHaveBeenCalledWith('nachos.test.topic', {});
      expect(subscription).toBeDefined();
      expect(typeof subscription.unsubscribe).toBe('function');
      expect(typeof subscription.drain).toBe('function');
    });

    it('should subscribe with queue group', async () => {
      await client.connect();
      await client.subscribe('nachos.test.topic', vi.fn(), { queue: 'workers' });

      expect(getMockConnection().subscribe).toHaveBeenCalledWith('nachos.test.topic', {
        queue: 'workers',
      });
    });

    it('should subscribe with max messages', async () => {
      await client.connect();
      await client.subscribe('nachos.test.topic', vi.fn(), { max: 10 });

      expect(getMockConnection().subscribe).toHaveBeenCalledWith('nachos.test.topic', { max: 10 });
    });

    it('should allow unsubscribing', async () => {
      await client.connect();
      const subscription = await client.subscribe('nachos.test.topic', vi.fn());
      subscription.unsubscribe();

      expect(getMockSubscription().unsubscribe).toHaveBeenCalled();
    });

    it('should allow draining subscription', async () => {
      await client.connect();
      const subscription = await client.subscribe('nachos.test.topic', vi.fn());
      await subscription.drain();

      expect(getMockSubscription().drain).toHaveBeenCalled();
    });
  });

  describe('request', () => {
    it('should throw when not connected', async () => {
      await expect(client.request('topic', { data: 'test' })).rejects.toThrow(
        'Not connected to NATS'
      );
    });

    it('should make request and receive response', async () => {
      await client.connect();

      const responseEnvelope: MessageEnvelope = {
        id: 'resp-123',
        timestamp: new Date().toISOString(),
        source: 'responder',
        type: 'response',
        payload: { result: 'success' },
      };

      getMockConnection().request.mockResolvedValue({
        data: new TextEncoder().encode(JSON.stringify(responseEnvelope)),
      });

      const response = await client.request<{ data: string }, { result: string }>(
        'nachos.policy.check',
        { data: 'test' }
      );

      expect(getMockConnection().request).toHaveBeenCalled();
      expect(response.payload).toEqual({ result: 'success' });
    });

    it('should use custom timeout', async () => {
      await client.connect();

      getMockConnection().request.mockResolvedValue({
        data: new TextEncoder().encode(
          JSON.stringify({
            id: 'resp-123',
            timestamp: new Date().toISOString(),
            source: 'responder',
            type: 'response',
            payload: {},
          })
        ),
      });

      await client.request('nachos.policy.check', { data: 'test' }, { timeout: 10000 });

      const [_topic, _data, options] = getMockConnection().request.mock.calls[0] as [
        string,
        Uint8Array,
        { timeout: number },
      ];
      expect(options.timeout).toBe(10000);
    });

    it('should throw on timeout', async () => {
      await client.connect();

      const NatsErrorClass = (
        nats as unknown as { NatsError: new (msg: string, code: string) => Error }
      ).NatsError;
      getMockConnection().request.mockRejectedValue(new NatsErrorClass('Timeout', 'TIMEOUT'));

      await expect(client.request('nachos.policy.check', { data: 'test' })).rejects.toThrow(
        'Request to nachos.policy.check timed out after 5000ms'
      );
    });
  });

  describe('getHealth', () => {
    it('should return unhealthy when not connected', async () => {
      const health = await client.getHealth();
      expect(health.status).toBe('unhealthy');
      expect(health.checks.connection).toBe('error');
    });

    it('should return healthy when connected', async () => {
      await client.connect();
      const health = await client.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.component).toBe('bus');
      expect(health.checks.connection).toBe('ok');
      expect(typeof health.checks.latency).toBe('number');
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return degraded when flush fails', async () => {
      await client.connect();
      getMockConnection().flush.mockRejectedValueOnce(new Error('Flush failed'));

      const health = await client.getHealth();
      expect(health.status).toBe('degraded');
      expect(health.checks.connection).toBe('error');
    });
  });

  describe('getConnection', () => {
    it('should return null when not connected', () => {
      expect(client.getConnection()).toBeNull();
    });

    it('should return connection when connected', async () => {
      await client.connect();
      expect(client.getConnection()).not.toBeNull();
    });
  });

  describe('event handlers', () => {
    it('should add and remove event handlers', async () => {
      const handler = vi.fn();
      client.on('connect', handler);
      await client.connect();
      expect(handler).toHaveBeenCalledTimes(1);

      client.off('connect', handler);
      // We can't easily test removal without reconnecting
    });

    it('should handle errors in event handlers gracefully', async () => {
      const errorHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.on('connect', errorHandler);
      await client.connect(); // Should not throw

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

describe('createBusClient', () => {
  it('should create a NachosBusClient instance', () => {
    const client = createBusClient({
      servers: 'nats://localhost:4222',
      name: 'test',
    });
    expect(client).toBeInstanceOf(NachosBusClient);
  });
});
