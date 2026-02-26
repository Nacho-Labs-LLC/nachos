/**
 * Sliding Window Manager Tests
 */

import { describe, it, expect } from 'vitest';
import {
  SlidingWindowManager,
  estimateAverageTokensPerMessage,
  findTurnBoundaries,
  describeSlidingAction,
} from './manager.js';
import type { ContextMessage, ContextBudget, SlidingWindowConfig } from '../types/index.js';

describe('SlidingWindowManager', () => {
  const createMessages = (count: number, tokensEach: number = 100): ContextMessage[] => {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: 'x'.repeat(Math.floor(tokensEach * 3.5)),
      _tokenCache: tokensEach,
    }));
  };

  const createBudget = (utilizationRatio: number): ContextBudget => ({
    total: 200000,
    systemPrompt: 10000,
    reserved: 20000,
    historyBudget: 170000,
    currentUsage: Math.floor(170000 * utilizationRatio),
    utilizationRatio,
    zone:
      utilizationRatio >= 0.95
        ? 'critical'
        : utilizationRatio >= 0.85
          ? 'red'
          : utilizationRatio >= 0.75
            ? 'orange'
            : utilizationRatio >= 0.6
              ? 'yellow'
              : 'green',
  });

  const defaultConfig: SlidingWindowConfig = {
    enabled: true,
    mode: 'hybrid',
    thresholds: {
      proactivePrune: 0.6,
      lightCompaction: 0.75,
      aggressiveCompaction: 0.85,
      emergency: 0.95,
    },
    keepRecent: {
      turns: 10,
      messages: 20,
      tokenBudget: 10000,
    },
    slide_strategy: 'turn',
  };

  describe('shouldSlide()', () => {
    const manager = new SlidingWindowManager();

    it('should return null when disabled', () => {
      const config = { ...defaultConfig, enabled: false };
      const budget = createBudget(0.8);

      const action = manager.shouldSlide(budget, config);
      expect(action).toBeNull();
    });

    it('should return null for green zone', () => {
      const budget = createBudget(0.5);
      const action = manager.shouldSlide(budget, defaultConfig);
      expect(action).toBeNull();
    });

    it('should return prune action for yellow zone', () => {
      const budget = createBudget(0.65);
      const action = manager.shouldSlide(budget, defaultConfig);

      expect(action).not.toBeNull();
      expect(action?.type).toBe('prune');
      expect(action?.zone).toBe('yellow');
      expect(action?.targetTokenReduction).toBeGreaterThan(0);
    });

    it('should return compact-light for orange zone', () => {
      const budget = createBudget(0.8);
      const action = manager.shouldSlide(budget, defaultConfig);

      expect(action).not.toBeNull();
      expect(action?.type).toBe('compact-light');
      expect(action?.zone).toBe('orange');
    });

    it('should return compact-aggressive for red zone', () => {
      const budget = createBudget(0.9);
      const action = manager.shouldSlide(budget, defaultConfig);

      expect(action).not.toBeNull();
      expect(action?.type).toBe('compact-aggressive');
      expect(action?.zone).toBe('red');
    });

    it('should return compact-emergency for critical zone', () => {
      const budget = createBudget(0.97);
      const action = manager.shouldSlide(budget, defaultConfig);

      expect(action).not.toBeNull();
      expect(action?.type).toBe('compact-emergency');
      expect(action?.zone).toBe('critical');
    });
  });

  describe('slide()', () => {
    const manager = new SlidingWindowManager();

    it('should keep recent messages in message-based mode', () => {
      const messages = createMessages(50, 100);
      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 20,
        targetTokenReduction: 2000,
      };

      const config: SlidingWindowConfig = {
        ...defaultConfig,
        mode: 'message-based',
        keepRecent: { turns: 10, messages: 30, tokenBudget: 10000 },
      };

      const result = manager.slide({ messages, action, config });

      expect(result.messagesKept.length).toBe(30);
      expect(result.messagesDropped.length).toBe(20);
      expect(result.tokensRemoved).toBeGreaterThan(0);
    });

    it('should respect minimum messages to keep', () => {
      const messages = createMessages(15, 100);
      const action = {
        type: 'compact-emergency' as const,
        zone: 'critical' as const,
        reason: 'Critical',
        targetDropCount: 10,
        targetTokenReduction: 1000,
      };

      const config: SlidingWindowConfig = {
        ...defaultConfig,
        mode: 'message-based',
        keepRecent: { turns: 5, messages: 5, tokenBudget: 5000 },
      };

      const result = manager.slide({ messages, action, config });

      // Should keep at least 10 messages for emergency compaction
      expect(result.messagesKept.length).toBeGreaterThanOrEqual(10);
    });

    it('should generate summary metadata', () => {
      const messages = createMessages(30, 100);
      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 10,
        targetTokenReduction: 1000,
      };

      const result = manager.slide({ messages, action, config: defaultConfig });

      expect(result.needsSummarization).toBe(true);
      expect(result.summaryTier).toBe('condensed');
    });

    it('should not summarize for prune action', () => {
      const messages = createMessages(30, 100);
      const action = {
        type: 'prune' as const,
        zone: 'yellow' as const,
        reason: 'Proactive pruning',
        targetDropCount: 5,
        targetTokenReduction: 500,
      };

      const result = manager.slide({ messages, action, config: defaultConfig });

      expect(result.needsSummarization).toBe(false);
      expect(result.summaryTier).toBeUndefined();
    });
  });

  describe('slideByTurns()', () => {
    const manager = new SlidingWindowManager();

    it('should keep complete turns', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Hello', _tokenCache: 10 },
        { role: 'assistant', content: 'Hi', _tokenCache: 10 },
        { role: 'user', content: 'How are you?', _tokenCache: 10 },
        { role: 'assistant', content: 'Good', _tokenCache: 10 },
        { role: 'user', content: 'Great', _tokenCache: 10 },
        { role: 'assistant', content: 'Indeed', _tokenCache: 10 },
      ];

      const action = {
        type: 'compact-emergency' as const, // Emergency has min 5 turns
        zone: 'critical' as const,
        reason: 'Test',
        targetDropCount: 2,
        targetTokenReduction: 20,
      };

      const config: SlidingWindowConfig = {
        ...defaultConfig,
        keepRecent: { turns: 2, messages: 20, tokenBudget: 10000 },
      };

      const result = manager.slideByTurns({ messages, action, config });

      // Should keep at least 2 turns, but emergency requires min 5 turns
      // Since we only have 3 turns total (6 messages), it keeps all
      expect(result.messagesKept.length).toBe(6);
      expect(result.messagesDropped.length).toBe(0);

      // Verify first message of kept messages is a user message
      expect(result.messagesKept[0].role).toBe('user');
    });

    it('should handle incomplete turns', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Message 1', _tokenCache: 10 },
        { role: 'assistant', content: 'Response 1', _tokenCache: 10 },
        { role: 'user', content: 'Message 2', _tokenCache: 10 },
        // Incomplete turn (no assistant response yet)
      ];

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 1,
        targetTokenReduction: 10,
      };

      const config: SlidingWindowConfig = {
        ...defaultConfig,
        keepRecent: { turns: 1, messages: 10, tokenBudget: 5000 },
      };

      const result = manager.slideByTurns({ messages, action, config });

      // Should keep last turn (incomplete)
      expect(result.messagesKept.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('validateResult()', () => {
    const manager = new SlidingWindowManager();

    it('should validate successful result', () => {
      const result = {
        messagesKept: createMessages(100, 150), // 15k tokens total
        messagesDropped: createMessages(25, 100), // 2.5k tokens dropped
        tokensRemoved: 2500,
        needsSummarization: true,
        summaryTier: 'condensed' as const,
      };

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 25,
        targetTokenReduction: 2500,
      };

      const config: SlidingWindowConfig = {
        ...defaultConfig,
        keepRecent: { turns: 10, messages: 20, tokenBudget: 10000 }, // Need 10k tokens
      };

      const validation = manager.validateResult(result, action, config);
      expect(validation.valid).toBe(true);
    });

    it('should fail if too few messages kept', () => {
      const result = {
        messagesKept: createMessages(5, 100), // Only 5 messages
        messagesDropped: createMessages(50, 100),
        tokensRemoved: 5000,
        needsSummarization: true,
        summaryTier: 'condensed' as const,
      };

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 50,
        targetTokenReduction: 5000,
      };

      const validation = manager.validateResult(result, action, defaultConfig);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Too few messages kept');
    });

    it('should fail if insufficient token reduction', () => {
      const result = {
        messagesKept: createMessages(100, 150), // 15k tokens (meets min requirements)
        messagesDropped: createMessages(5, 100), // Only removed 500 tokens
        tokensRemoved: 500,
        needsSummarization: true,
        summaryTier: 'condensed' as const,
      };

      const action = {
        type: 'compact-aggressive' as const,
        zone: 'red' as const,
        reason: 'Test',
        targetDropCount: 30,
        targetTokenReduction: 10000, // Target 10k but only removed 500 (< 5k minimum)
      };

      const config: SlidingWindowConfig = {
        ...defaultConfig,
        keepRecent: { turns: 10, messages: 20, tokenBudget: 10000 },
      };

      const validation = manager.validateResult(result, action, config);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Insufficient token reduction');
    });
  });

  describe('splitIntoTurns()', () => {
    const manager = new SlidingWindowManager();

    it('should split messages into turns', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ];

      const turns = manager.splitIntoTurns(messages);

      expect(turns.length).toBe(2);
      expect(turns[0].length).toBe(2); // user + assistant
      expect(turns[1].length).toBe(2);
    });

    it('should handle system messages', () => {
      const messages: ContextMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
      ];

      const turns = manager.splitIntoTurns(messages);

      // System message should be in first turn
      expect(turns.length).toBeGreaterThan(0);
    });
  });
});

describe('Utility functions', () => {
  describe('estimateAverageTokensPerMessage()', () => {
    it('should calculate average', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Short', _tokenCache: 10 },
        { role: 'assistant', content: 'Long message', _tokenCache: 50 },
        { role: 'user', content: 'Medium', _tokenCache: 30 },
      ];

      const avg = estimateAverageTokensPerMessage(messages);
      expect(avg).toBe(30); // (10 + 50 + 30) / 3 = 30
    });

    it('should return 0 for empty array', () => {
      expect(estimateAverageTokensPerMessage([])).toBe(0);
    });
  });

  describe('findTurnBoundaries()', () => {
    it('should find user message indices', () => {
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ];

      const boundaries = findTurnBoundaries(messages);
      expect(boundaries).toEqual([0, 2]);
    });
  });

  describe('describeSlidingAction()', () => {
    it('should describe prune action', () => {
      const action = {
        type: 'prune' as const,
        zone: 'yellow' as const,
        reason: 'Test',
        targetDropCount: 10,
        targetTokenReduction: 1000,
      };

      const description = describeSlidingAction(action);
      expect(description).toContain('Pruning');
      expect(description).toContain('yellow');
    });

    it('should describe compaction actions', () => {
      const action = {
        type: 'compact-aggressive' as const,
        zone: 'red' as const,
        reason: 'Test',
        targetDropCount: 30,
        targetTokenReduction: 3000,
      };

      const description = describeSlidingAction(action);
      expect(description).toContain('Aggressive compaction');
      expect(description).toContain('red');
      expect(description).toContain('30');
    });
  });
});
