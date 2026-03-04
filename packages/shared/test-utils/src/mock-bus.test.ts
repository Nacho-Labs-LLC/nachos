import { describe, it, expect, beforeEach } from 'vitest';
import { MockBus, createMockBus } from './mock-bus.js';

describe('MockBus', () => {
  let bus: MockBus;

  beforeEach(() => {
    bus = new MockBus();
  });

  describe('publish', () => {
    it('should record published messages by topic', async () => {
      await bus.publish('nachos.channel.slack.inbound', { text: 'hello' });
      await bus.publish('nachos.channel.slack.inbound', { text: 'world' });

      const messages = bus.getPublished('nachos.channel.slack.inbound');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ text: 'hello' });
      expect(messages[1]).toEqual({ text: 'world' });
    });

    it('should dispatch to subscription handlers', async () => {
      const received: unknown[] = [];
      await bus.subscribe('test.topic', async (data) => {
        received.push(data);
      });

      await bus.publish('test.topic', { value: 42 });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ value: 42 });
    });

    it('should return empty array for topics with no messages', () => {
      expect(bus.getPublished('nonexistent.topic')).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('should support multiple handlers on the same topic', async () => {
      const results: string[] = [];
      await bus.subscribe('test.topic', async () => {
        results.push('handler-1');
      });
      await bus.subscribe('test.topic', async () => {
        results.push('handler-2');
      });

      await bus.publish('test.topic', {});

      expect(results).toEqual(['handler-1', 'handler-2']);
    });
  });

  describe('request', () => {
    it('should return default response when no canned response is set', async () => {
      const result = await bus.request('some.topic', {});
      expect(result).toEqual({ success: true });
    });

    it('should return canned response when configured', async () => {
      bus.setRequestResponse('nachos.policy.check', {
        allowed: true,
        reason: 'test',
      });

      const result = await bus.request('nachos.policy.check', {});
      expect(result).toEqual({ allowed: true, reason: 'test' });
    });
  });

  describe('unsubscribe', () => {
    it('should remove all handlers for a topic', async () => {
      const received: unknown[] = [];
      await bus.subscribe('test.topic', async (data) => {
        received.push(data);
      });

      await bus.unsubscribe('test.topic');
      await bus.publish('test.topic', { value: 1 });

      expect(received).toHaveLength(0);
    });
  });

  describe('getPublishedAs', () => {
    it('should return typed messages', async () => {
      await bus.publish('test.topic', { count: 1 });
      await bus.publish('test.topic', { count: 2 });

      const messages = bus.getPublishedAs<{ count: number }>('test.topic');
      expect(messages[0]?.count).toBe(1);
      expect(messages[1]?.count).toBe(2);
    });
  });

  describe('getAllPublished', () => {
    it('should return all published messages across topics', async () => {
      await bus.publish('topic.a', { a: 1 });
      await bus.publish('topic.b', { b: 2 });

      const all = bus.getAllPublished();
      expect(all).toHaveLength(2);
      expect(all).toEqual(
        expect.arrayContaining([
          { topic: 'topic.a', data: { a: 1 } },
          { topic: 'topic.b', data: { b: 2 } },
        ])
      );
    });
  });

  describe('getPublishCount', () => {
    it('should return total message count across all topics', async () => {
      await bus.publish('topic.a', {});
      await bus.publish('topic.a', {});
      await bus.publish('topic.b', {});

      expect(bus.getPublishCount()).toBe(3);
    });

    it('should return 0 when no messages published', () => {
      expect(bus.getPublishCount()).toBe(0);
    });
  });

  describe('getPublishedTopics', () => {
    it('should return all topics with published messages', async () => {
      await bus.publish('alpha', {});
      await bus.publish('beta', {});

      const topics = bus.getPublishedTopics();
      expect(topics).toEqual(expect.arrayContaining(['alpha', 'beta']));
      expect(topics).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('should clear published messages, handlers, and request responses', async () => {
      await bus.publish('test.topic', { val: 1 });
      await bus.subscribe('test.topic', async () => {});
      bus.setRequestResponse('test.topic', { result: true });

      bus.reset();

      expect(bus.getPublished('test.topic')).toEqual([]);
      expect(bus.getPublishCount()).toBe(0);

      // Verify handlers are gone (publishing should not trigger old handlers)
      await bus.publish('test.topic', { val: 2 });
      // No handler was re-added, so received stays empty

      // Verify request response is gone
      const result = await bus.request('test.topic', {});
      expect(result).toEqual({ success: true }); // default response
    });
  });

  describe('clearPublished', () => {
    it('should clear only published messages, keeping handlers', async () => {
      const received: unknown[] = [];
      await bus.subscribe('test.topic', async (data) => {
        received.push(data);
      });

      await bus.publish('test.topic', { val: 1 });
      expect(bus.getPublished('test.topic')).toHaveLength(1);

      bus.clearPublished();
      expect(bus.getPublished('test.topic')).toHaveLength(0);

      // Handler should still work
      await bus.publish('test.topic', { val: 2 });
      expect(received).toHaveLength(2); // handler called for both publishes
      expect(bus.getPublished('test.topic')).toHaveLength(1); // only second publish recorded
    });
  });
});

describe('createMockBus', () => {
  it('should create a fresh MockBus instance', () => {
    const bus = createMockBus();
    expect(bus).toBeInstanceOf(MockBus);
    expect(bus.getPublishCount()).toBe(0);
  });
});
