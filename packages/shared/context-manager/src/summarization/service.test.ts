/**
 * Summarization Service Tests
 */

import { describe, it, expect } from 'vitest';
import {
  SummarizationService,
  MockLLMProvider,
  type LLMProvider,
  type SummarizationResult,
} from './service.js';
import type { ContextMessage } from '../types/index.js';

describe('SummarizationService', () => {
  const createMessages = (count: number): ContextMessage[] => {
    return Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `This is message number ${i + 1}. It contains some content that can be summarized.`,
    }));
  };

  describe('summarize()', () => {
    it('should summarize with condensed tier', async () => {
      const mockProvider: LLMProvider = {
        complete: async (params) => {
          expect(params.messages).toBeDefined();
          expect(params.messages.length).toBeGreaterThan(0);
          return 'Condensed summary of the conversation';
        },
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(10);

      const result = await service.summarize(messages, 'condensed');

      expect(result.summary).toBeDefined();
      expect(result.tier).toBe('condensed');
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.summaryTokens).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.messagesCount).toBe(10);
    });

    it('should summarize with compressed tier', async () => {
      const mockProvider: LLMProvider = {
        complete: async () => 'Brief summary',
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(20);

      const result = await service.summarize(messages, 'compressed');

      expect(result.tier).toBe('compressed');
      expect(result.summary).toBe('Brief summary');
    });

    it('should summarize with archival tier', async () => {
      const mockProvider: LLMProvider = {
        complete: async () => 'Ultra-brief overview',
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(50);

      const result = await service.summarize(messages, 'archival');

      expect(result.tier).toBe('archival');
      expect(result.summary).toBe('Ultra-brief overview');
    });

    it('should calculate compression ratio', async () => {
      const mockProvider: LLMProvider = {
        complete: async () => 'Short summary', // Much shorter than original
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(30);

      const result = await service.summarize(messages, 'compressed');

      expect(result.compressionRatio).toBeLessThan(1); // Compressed
      expect(result.summaryTokens).toBeLessThan(result.originalTokens);
    });

    it('should throw error when disabled', async () => {
      const mockProvider = new MockLLMProvider();
      const service = new SummarizationService(mockProvider, { enabled: false });
      const messages = createMessages(10);

      await expect(service.summarize(messages, 'condensed')).rejects.toThrow('disabled');
    });
  });

  describe('summarizeAuto()', () => {
    it('should select archival tier for high reduction', async () => {
      const mockProvider: LLMProvider = {
        complete: async () => 'Summary',
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(20);

      const result = await service.summarizeAuto(messages, 0.95); // 95% reduction

      expect(result.tier).toBe('archival');
    });

    it('should select compressed tier for moderate reduction', async () => {
      const mockProvider: LLMProvider = {
        complete: async () => 'Summary',
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(20);

      const result = await service.summarizeAuto(messages, 0.8); // 80% reduction

      expect(result.tier).toBe('compressed');
    });

    it('should select condensed tier for light reduction', async () => {
      const mockProvider: LLMProvider = {
        complete: async () => 'Summary',
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(20);

      const result = await service.summarizeAuto(messages, 0.5); // 50% reduction

      expect(result.tier).toBe('condensed');
    });
  });

  describe('validateSummary()', () => {
    it('should validate good compression', () => {
      const mockProvider = new MockLLMProvider();
      const service = new SummarizationService(mockProvider);

      const result: SummarizationResult = {
        summary: 'Test summary',
        tier: 'compressed',
        originalTokens: 1000,
        summaryTokens: 200, // 20% of original (good for compressed tier)
        compressionRatio: 0.2,
        messagesCount: 10,
      };

      const validation = service.validateSummary(result);
      expect(validation.valid).toBe(true);
    });

    it('should fail insufficient compression', () => {
      const mockProvider = new MockLLMProvider();
      const service = new SummarizationService(mockProvider);

      const result: SummarizationResult = {
        summary: 'Test summary',
        tier: 'compressed',
        originalTokens: 1000,
        summaryTokens: 600, // 60% of original (too high for compressed tier)
        compressionRatio: 0.6,
        messagesCount: 10,
      };

      const validation = service.validateSummary(result);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('Insufficient compression');
    });

    it('should validate with tolerance', () => {
      const mockProvider = new MockLLMProvider();
      const service = new SummarizationService(mockProvider);

      const result: SummarizationResult = {
        summary: 'Test summary',
        tier: 'compressed',
        originalTokens: 1000,
        summaryTokens: 350, // 35% (within tolerance of 20% target)
        compressionRatio: 0.35,
        messagesCount: 10,
      };

      const validation = service.validateSummary(result);
      expect(validation.valid).toBe(true); // 35% is within 20% + 20% tolerance = 40%
    });
  });

  describe('System prompts', () => {
    it('should include preservation rules', async () => {
      let capturedSystemPrompt = '';

      const mockProvider: LLMProvider = {
        complete: async (params) => {
          const systemMsg = params.messages.find((m) => m.role === 'system');
          if (systemMsg) {
            capturedSystemPrompt = systemMsg.content;
          }
          return 'Summary';
        },
      };

      const service = new SummarizationService(mockProvider, {
        enabled: true,
        preserveRules: {
          decisions: true,
          tasks: true,
          errors: true,
          code: true,
          context: true,
        },
      });

      const messages = createMessages(10);
      await service.summarize(messages, 'condensed');

      expect(capturedSystemPrompt).toContain('preserve');
      expect(capturedSystemPrompt).toContain('decisions');
      expect(capturedSystemPrompt).toContain('Errors'); // Capital E in actual prompt
    });

    it('should use appropriate temperature', async () => {
      let capturedTemp = 1.0;

      const mockProvider: LLMProvider = {
        complete: async (params) => {
          capturedTemp = params.temperature ?? 1.0;
          return 'Summary';
        },
      };

      const service = new SummarizationService(mockProvider);
      const messages = createMessages(10);

      await service.summarize(messages, 'condensed');

      expect(capturedTemp).toBe(0.3); // Low temperature for consistency
    });
  });

  describe('Message conversion', () => {
    it('should convert text messages', async () => {
      let capturedUserMessage = '';

      const mockProvider: LLMProvider = {
        complete: async (params) => {
          const userMsg = params.messages.find((m) => m.role === 'user');
          if (userMsg) {
            capturedUserMessage = userMsg.content;
          }
          return 'Summary';
        },
      };

      const service = new SummarizationService(mockProvider);
      const messages: ContextMessage[] = [
        { role: 'user', content: 'Question 1' },
        { role: 'assistant', content: 'Answer 1' },
      ];

      await service.summarize(messages, 'condensed');

      expect(capturedUserMessage).toContain('[USER]');
      expect(capturedUserMessage).toContain('Question 1');
      expect(capturedUserMessage).toContain('[ASSISTANT]');
      expect(capturedUserMessage).toContain('Answer 1');
    });

    it('should handle content blocks', async () => {
      let capturedContent = '';

      const mockProvider: LLMProvider = {
        complete: async (params) => {
          const userMsg = params.messages.find((m) => m.role === 'user');
          if (userMsg) {
            capturedContent = userMsg.content;
          }
          return 'Summary';
        },
      };

      const service = new SummarizationService(mockProvider);
      const messages: ContextMessage[] = [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: 'Part 2' },
          ],
        },
      ];

      await service.summarize(messages, 'condensed');

      expect(capturedContent).toContain('Part 1');
      expect(capturedContent).toContain('Part 2');
    });

    it('should include tool calls', async () => {
      let capturedContent = '';

      const mockProvider: LLMProvider = {
        complete: async (params) => {
          const userMsg = params.messages.find((m) => m.role === 'user');
          if (userMsg) {
            capturedContent = userMsg.content;
          }
          return 'Summary';
        },
      };

      const service = new SummarizationService(mockProvider);
      const messages: ContextMessage[] = [
        {
          role: 'assistant',
          content: 'Using tool',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'search',
                arguments: '{"query":"test"}',
              },
            },
          ],
        },
      ];

      await service.summarize(messages, 'condensed');

      expect(capturedContent).toContain('Tool');
      expect(capturedContent).toContain('search');
    });
  });
});

describe('MockLLMProvider', () => {
  it('should truncate content', async () => {
    const provider = new MockLLMProvider();
    const longContent = 'x'.repeat(10000);

    const result = await provider.complete({
      messages: [{ role: 'user', content: longContent }],
      maxTokens: 100,
    });

    expect(result.length).toBeLessThan(longContent.length);
    expect(result).toContain('[truncated]');
  });

  it('should return full content if within limit', async () => {
    const provider = new MockLLMProvider();
    const shortContent = 'Short message';

    const result = await provider.complete({
      messages: [{ role: 'user', content: shortContent }],
      maxTokens: 100,
    });

    expect(result).toBe(shortContent);
  });
});
