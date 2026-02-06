/**
 * Token Counter Tests
 */

import { describe, it, expect } from 'vitest';
import { TokenEstimator, tokenEstimator, estimateTokens, estimateMessageTokens } from './token-counter.js';
import type { ContextMessage } from '../types/index.js';

describe('TokenEstimator', () => {
  describe('estimate()', () => {
    it('should estimate tokens for simple text', () => {
      const estimator = new TokenEstimator();
      const text = 'Hello world';
      const tokens = estimator.estimate(text);

      // "Hello world" = 11 chars / 3.5 = ~3 tokens
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      const estimator = new TokenEstimator();
      expect(estimator.estimate('')).toBe(0);
    });

    it('should handle large text', () => {
      const estimator = new TokenEstimator();
      const text = 'a'.repeat(1000); // 1000 characters
      const tokens = estimator.estimate(text);

      // 1000 chars / 3.5 = ~286 tokens
      expect(tokens).toBeGreaterThan(250);
      expect(tokens).toBeLessThan(350);
    });
  });

  describe('estimateMessage()', () => {
    it('should estimate tokens for text message', () => {
      const estimator = new TokenEstimator();
      const message: ContextMessage = {
        role: 'user',
        content: 'Hello, how are you?',
      };

      const tokens = estimator.estimateMessage(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should add overhead for message structure', () => {
      const estimator = new TokenEstimator();
      const message: ContextMessage = {
        role: 'user',
        content: 'Hi',
      };

      const tokens = estimator.estimateMessage(message);
      const contentTokens = estimator.estimate('Hi');

      // Should include 4-token overhead
      expect(tokens).toBeGreaterThanOrEqual(contentTokens + 4);
    });

    it('should handle content blocks', () => {
      const estimator = new TokenEstimator();
      const message: ContextMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the answer' },
          { type: 'text', text: 'And more details' },
        ],
      };

      const tokens = estimator.estimateMessage(message);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle tool calls', () => {
      const estimator = new TokenEstimator();
      const message: ContextMessage = {
        role: 'assistant',
        content: 'Using a tool',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query": "test"}',
            },
          },
        ],
      };

      const tokens = estimator.estimateMessage(message);
      expect(tokens).toBeGreaterThan(10); // Should include tool call overhead
    });

    it('should cache tokens', () => {
      const estimator = new TokenEstimator();
      const message: ContextMessage = {
        role: 'user',
        content: 'Test message',
        _tokenCache: 100,
      };

      const tokens = estimator.estimateMessage(message);
      expect(tokens).toBe(100); // Should use cached value
    });
  });

  describe('estimateMessages()', () => {
    it('should sum tokens for multiple messages', () => {
      const estimator = new TokenEstimator();
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ];

      const tokens = estimator.estimateMessages(messages);
      expect(tokens).toBeGreaterThan(0);

      // Should be sum of individual estimates
      const sum = messages.reduce((total, msg) => total + estimator.estimateMessage(msg), 0);
      expect(tokens).toBe(sum);
    });

    it('should return 0 for empty array', () => {
      const estimator = new TokenEstimator();
      expect(estimator.estimateMessages([])).toBe(0);
    });
  });

});

describe('Exported functions', () => {
  it('should export singleton tokenEstimator', () => {
    expect(tokenEstimator).toBeInstanceOf(TokenEstimator);
  });

  it('should export estimateTokens function', () => {
    const tokens = estimateTokens('Hello world');
    expect(tokens).toBeGreaterThan(0);
  });

  it('should export estimateMessageTokens function', () => {
    const messages: ContextMessage[] = [
      { role: 'user', content: 'Test' },
      { role: 'assistant', content: 'Response' },
    ];
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('Accuracy validation', () => {
  it('should estimate within expected range for typical messages', () => {
    const estimator = new TokenEstimator();

    // Typical user message (based on Claude's actual tokenization)
    const message = 'Can you help me write a Python function to calculate fibonacci numbers?';
    const tokens = estimator.estimate(message);

    // This is ~14-16 tokens in Claude - our estimate should be close
    // chars = 71, tokens = 71/3.5 = ~20 (reasonable approximation)
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(25);
  });

  it('should estimate code reasonably', () => {
    const estimator = new TokenEstimator();
    const code = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`;

    const tokens = estimator.estimate(code);

    // Code is ~100 chars, should be ~30 tokens
    expect(tokens).toBeGreaterThan(20);
    expect(tokens).toBeLessThan(40);
  });
});
