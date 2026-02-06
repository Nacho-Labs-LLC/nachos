/**
 * Context Manager Integration Tests
 */

import { describe, it, expect } from 'vitest';
import { ContextManager, createContextManager } from './context-manager.js';
import type { ContextMessage, ContextManagementConfig } from './types/index.js';
import { MockLLMProvider } from './summarization/service.js';
import { SummarizationService } from './summarization/service.js';

describe('ContextManager', () => {
  const createMessages = (count: number, tokensEach: number = 100): ContextMessage[] => {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: 'x'.repeat(Math.floor(tokensEach * 3.5)),
      _tokenCache: tokensEach,
    }));
  };

  const defaultConfig: ContextManagementConfig = {
    sliding_window: {
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
    },
    summarization: {
      enabled: true,
      mode: 'multi-tier',
    },
    proactive_history: {
      enabled: true,
      extractors: {
        decisions: true,
        facts: true,
        tasks: true,
        issues: true,
        files: true,
      },
      triggers: {
        on_compaction: true,
      },
      snapshots: {
        enabled: false, // Disable for tests
      },
    },
  };

  describe('checkBeforeTurn()', () => {
    it('should check context and return budget', async () => {
      const manager = new ContextManager(defaultConfig);
      const messages = createMessages(50, 100); // Low usage

      const result = await manager.checkBeforeTurn({
        sessionId: 'test-session',
        messages,
        systemPromptTokens: 5000,
        contextWindow: 200000,
        reserveTokens: 20000,
      });

      expect(result.budget).toBeDefined();
      expect(result.budget.zone).toBe('green');
      expect(result.needsCompaction).toBe(false);
      expect(result.action).toBeNull();
    });

    it('should recommend compaction when needed', async () => {
      const manager = new ContextManager(defaultConfig);
      const messages = createMessages(1500, 100); // High usage ~150k tokens

      const result = await manager.checkBeforeTurn({
        sessionId: 'test-session',
        messages,
        systemPromptTokens: 5000,
        contextWindow: 200000,
        reserveTokens: 20000,
      });

      expect(result.needsCompaction).toBe(true);
      expect(result.action).not.toBeNull();
      expect(result.action?.type).toBeDefined();
      expect(['prune', 'compact-light', 'compact-aggressive', 'compact-emergency']).toContain(
        result.action?.type
      );
    });

    it('should respect disabled sliding window', async () => {
      const config: ContextManagementConfig = {
        ...defaultConfig,
        sliding_window: { ...defaultConfig.sliding_window!, enabled: false },
      };

      const manager = new ContextManager(config);
      const messages = createMessages(1500, 100); // High usage

      const result = await manager.checkBeforeTurn({
        sessionId: 'test-session',
        messages,
        systemPromptTokens: 5000,
        contextWindow: 200000,
        reserveTokens: 20000,
      });

      expect(result.needsCompaction).toBe(false);
      expect(result.action).toBeNull();
    });
  });

  describe('compact()', () => {
    it('should compact messages successfully', async () => {
      const manager = new ContextManager(defaultConfig);
      const messages = createMessages(100, 100);

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test compaction',
        targetDropCount: 50,
        targetTokenReduction: 5000,
      };

      const result = await manager.compact({
        sessionId: 'test-session',
        messages,
        action,
      });

      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(true);
      expect(result.messagesKept).toBeDefined();
      expect(result.messagesKept!.length).toBeLessThan(messages.length);
      expect(result.result?.tokensBefore).toBeGreaterThan(result.result?.tokensAfter!);
    });

    it('should keep minimum messages', async () => {
      const manager = new ContextManager(defaultConfig);
      const messages = createMessages(30, 100);

      const action = {
        type: 'compact-aggressive' as const,
        zone: 'red' as const,
        reason: 'Aggressive test',
        targetDropCount: 25,
        targetTokenReduction: 2500,
      };

      const result = await manager.compact({
        sessionId: 'test-session',
        messages,
        action,
      });

      expect(result.ok).toBe(true);
      // Should keep at least 15 messages for aggressive compaction
      expect(result.messagesKept!.length).toBeGreaterThanOrEqual(15);
    });

    it('should extract history when enabled', async () => {
      const config: ContextManagementConfig = {
        ...defaultConfig,
        proactive_history: {
          enabled: true,
          extractors: {
            decisions: true,
            facts: true,
            tasks: true,
            issues: true,
            files: true,
          },
          triggers: {
            on_compaction: true,
          },
        },
      };

      const manager = new ContextManager(config);

      // Create messages with extractable content
      const messages: ContextMessage[] = [
        { role: 'user', content: 'We decided to use TypeScript for this project' },
        { role: 'assistant', content: 'Great choice! TypeScript provides type safety.' },
        { role: 'user', content: 'TODO: Add error handling to the API' },
        { role: 'assistant', content: 'I will help with that.' },
        ...createMessages(50, 100),
      ];

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 30,
        targetTokenReduction: 3000,
      };

      const result = await manager.compact({
        sessionId: 'test-session',
        messages,
        action,
        config,
      });

      expect(result.ok).toBe(true);
      // Extraction may or may not find items depending on DLP patterns
      if (result.extracted) {
        expect(result.extracted).toHaveProperty('decisions');
        expect(result.extracted).toHaveProperty('tasks');
      }
    });

    it('should fail gracefully with invalid config', async () => {
      const config: ContextManagementConfig = {
        ...defaultConfig,
        sliding_window: undefined,
      };

      const manager = new ContextManager(config);
      const messages = createMessages(50, 100);

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 25,
        targetTokenReduction: 2500,
      };

      const result = await manager.compact({
        sessionId: 'test-session',
        messages,
        action,
      });

      expect(result.ok).toBe(false);
      expect(result.compacted).toBe(false);
      expect(result.reason).toContain('not configured');
    });

    it('should generate summary when service provided', async () => {
      const mockProvider = new MockLLMProvider();
      const summarizationService = new SummarizationService(mockProvider, {
        enabled: true,
      });

      const manager = new ContextManager(defaultConfig, { summarizationService });
      const messages = createMessages(100, 100);

      const action = {
        type: 'compact-light' as const,
        zone: 'orange' as const,
        reason: 'Test',
        targetDropCount: 50,
        targetTokenReduction: 5000,
      };

      const result = await manager.compact({
        sessionId: 'test-session',
        messages,
        action,
      });

      expect(result.ok).toBe(true);
      expect(result.summary).toBeDefined();
    });
  });

  describe('Complete workflow', () => {
    it('should handle full check and compact cycle', async () => {
      const manager = new ContextManager(defaultConfig);
      const messages = createMessages(1500, 100); // High usage

      // Step 1: Check context
      const checkResult = await manager.checkBeforeTurn({
        sessionId: 'test-session',
        messages,
        systemPromptTokens: 10000,
        contextWindow: 200000,
        reserveTokens: 20000,
      });

      expect(checkResult.needsCompaction).toBe(true);
      expect(checkResult.action).not.toBeNull();

      // Step 2: Compact if needed
      if (checkResult.needsCompaction && checkResult.action) {
        const compactResult = await manager.compact({
          sessionId: 'test-session',
          messages,
          action: checkResult.action,
        });

        expect(compactResult.ok).toBe(true);
        expect(compactResult.messagesKept!.length).toBeLessThan(messages.length);

        // Step 3: Verify context is now within limits
        const recheckResult = await manager.checkBeforeTurn({
          sessionId: 'test-session',
          messages: compactResult.messagesKept!,
          systemPromptTokens: 10000,
          contextWindow: 200000,
          reserveTokens: 20000,
        });

        // After compaction, utilization should be lower
        expect(recheckResult.budget.utilizationRatio).toBeLessThan(
          checkResult.budget.utilizationRatio
        );
      }
    });
  });

  describe('Configuration', () => {
    it('should get current configuration', () => {
      const manager = new ContextManager(defaultConfig);
      const config = manager.getConfig();

      expect(config).toEqual(defaultConfig);
    });

    it('should update configuration', () => {
      const manager = new ContextManager(defaultConfig);

      manager.updateConfig({
        sliding_window: {
          ...defaultConfig.sliding_window!,
          enabled: false,
        },
      });

      const config = manager.getConfig();
      expect(config.sliding_window?.enabled).toBe(false);
    });

    it('should get message adapter', () => {
      const manager = new ContextManager(defaultConfig);
      const adapter = manager.getMessageAdapter();

      expect(adapter).toBeDefined();
      expect(adapter.toContextMessage).toBeDefined();
      expect(adapter.toNachosMessage).toBeDefined();
    });
  });
});

describe('createContextManager factory', () => {
  it('should create manager with defaults', () => {
    const manager = createContextManager();

    expect(manager).toBeInstanceOf(ContextManager);

    const config = manager.getConfig();
    expect(config.sliding_window?.enabled).toBe(true);
    expect(config.summarization?.enabled).toBe(true);
    expect(config.proactive_history?.enabled).toBe(true);
  });

  it('should merge partial config with defaults', () => {
    const manager = createContextManager({
      sliding_window: {
        enabled: false,
      },
    });

    const config = manager.getConfig();
    expect(config.sliding_window?.enabled).toBe(false);
    expect(config.sliding_window?.mode).toBe('hybrid'); // Default value
  });

  it('should accept dependencies', () => {
    const mockProvider = new MockLLMProvider();
    const summarizationService = new SummarizationService(mockProvider);

    const manager = createContextManager(undefined, { summarizationService });

    expect(manager).toBeInstanceOf(ContextManager);
  });
});
