import { describe, it, expect, beforeEach } from 'vitest';
import { MockBus } from './mock-bus.js';
import {
  expectPublished,
  expectNoPublished,
  expectPublishCount,
  expectToolSuccess,
  expectToolFailure,
  expectToolResultContains,
} from './assertions.js';
import { createToolResult } from './factories.js';

describe('assertion helpers', () => {
  let bus: MockBus;

  beforeEach(() => {
    bus = new MockBus();
  });

  describe('expectPublished', () => {
    it('should pass when a message was published to the topic', async () => {
      await bus.publish('test.topic', { text: 'hi' });

      expect(() => expectPublished(bus, 'test.topic')).not.toThrow();
    });

    it('should throw when no message was published to the topic', () => {
      expect(() => expectPublished(bus, 'test.topic')).toThrow(
        'Expected at least one message published to "test.topic"'
      );
    });

    it('should pass with object matcher when message partially matches', async () => {
      await bus.publish('test.topic', {
        channel: 'slack',
        sender: { id: 'U1', name: 'Test' },
        text: 'hello',
      });

      expect(() =>
        expectPublished(bus, 'test.topic', { channel: 'slack', text: 'hello' })
      ).not.toThrow();
    });

    it('should throw with object matcher when no message matches', async () => {
      await bus.publish('test.topic', { channel: 'discord' });

      expect(() => expectPublished(bus, 'test.topic', { channel: 'slack' })).toThrow(
        'partially matching'
      );
    });

    it('should pass with function matcher when a message matches', async () => {
      await bus.publish('test.topic', { count: 5 });
      await bus.publish('test.topic', { count: 10 });

      expect(() =>
        expectPublished(bus, 'test.topic', (msg) => {
          const m = msg as { count: number };
          return m.count > 7;
        })
      ).not.toThrow();
    });

    it('should throw with function matcher when no message matches', async () => {
      await bus.publish('test.topic', { count: 5 });

      expect(() =>
        expectPublished(bus, 'test.topic', (msg) => {
          const m = msg as { count: number };
          return m.count > 100;
        })
      ).toThrow('matching the provided function');
    });

    it('should support nested object matching', async () => {
      await bus.publish('test.topic', {
        sender: { id: 'U1', name: 'Test', isAllowed: true },
        content: { text: 'hello' },
      });

      expect(() =>
        expectPublished(bus, 'test.topic', {
          sender: { id: 'U1' },
          content: { text: 'hello' },
        })
      ).not.toThrow();
    });
  });

  describe('expectNoPublished', () => {
    it('should pass when no messages were published to the topic', () => {
      expect(() => expectNoPublished(bus, 'test.topic')).not.toThrow();
    });

    it('should throw when messages were published to the topic', async () => {
      await bus.publish('test.topic', { data: 1 });

      expect(() => expectNoPublished(bus, 'test.topic')).toThrow(
        'Expected no messages published to "test.topic"'
      );
    });
  });

  describe('expectPublishCount', () => {
    it('should pass when count matches', async () => {
      await bus.publish('test.topic', {});
      await bus.publish('test.topic', {});

      expect(() => expectPublishCount(bus, 'test.topic', 2)).not.toThrow();
    });

    it('should throw when count does not match', async () => {
      await bus.publish('test.topic', {});

      expect(() => expectPublishCount(bus, 'test.topic', 2)).toThrow(
        'Expected 2 message(s) published to "test.topic", but found 1'
      );
    });

    it('should work with zero count', () => {
      expect(() => expectPublishCount(bus, 'test.topic', 0)).not.toThrow();
    });
  });

  describe('expectToolSuccess', () => {
    it('should pass for a successful result', () => {
      const result = createToolResult({ success: true });
      expect(() => expectToolSuccess(result)).not.toThrow();
    });

    it('should throw for a failed result', () => {
      const result = createToolResult({
        success: false,
        error: { code: 'ERR', message: 'failed' },
      });

      expect(() => expectToolSuccess(result)).toThrow('Expected tool result to be successful');
    });
  });

  describe('expectToolFailure', () => {
    it('should pass for a failed result', () => {
      const result = createToolResult({ success: false });
      expect(() => expectToolFailure(result)).not.toThrow();
    });

    it('should throw for a successful result', () => {
      const result = createToolResult({ success: true });

      expect(() => expectToolFailure(result)).toThrow('Expected tool result to be a failure');
    });

    it('should pass when error code matches', () => {
      const result = createToolResult({
        success: false,
        error: { code: 'TIMEOUT', message: 'timed out' },
      });

      expect(() => expectToolFailure(result, 'TIMEOUT')).not.toThrow();
    });

    it('should throw when error code does not match', () => {
      const result = createToolResult({
        success: false,
        error: { code: 'TIMEOUT', message: 'timed out' },
      });

      expect(() => expectToolFailure(result, 'AUTH_ERROR')).toThrow(
        'Expected tool error code "AUTH_ERROR"'
      );
    });
  });

  describe('expectToolResultContains', () => {
    it('should pass when text content contains substring', () => {
      const result = createToolResult({
        content: [{ type: 'text', text: 'Hello, World!' }],
      });

      expect(() => expectToolResultContains(result, 'World')).not.toThrow();
    });

    it('should pass when text content matches regex', () => {
      const result = createToolResult({
        content: [{ type: 'text', text: 'Error code: E1234' }],
      });

      expect(() => expectToolResultContains(result, /E\d{4}/)).not.toThrow();
    });

    it('should throw when text content does not contain substring', () => {
      const result = createToolResult({
        content: [{ type: 'text', text: 'Hello' }],
      });

      expect(() => expectToolResultContains(result, 'Goodbye')).toThrow(
        'Expected tool result text to match "Goodbye"'
      );
    });

    it('should throw when there are no text content blocks', () => {
      const result = createToolResult({
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
      });

      expect(() => expectToolResultContains(result, 'anything')).toThrow(
        'Expected tool result to contain text content blocks'
      );
    });

    it('should search across multiple text blocks', () => {
      const result = createToolResult({
        content: [
          { type: 'text', text: 'First line' },
          { type: 'text', text: 'Second line with match' },
        ],
      });

      expect(() => expectToolResultContains(result, 'match')).not.toThrow();
    });
  });
});
