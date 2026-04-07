/**
 * LLM Extraction Adapter Tests
 *
 * Tests the end-of-session knowledge extraction pipeline:
 * - Prompt construction and conversation truncation
 * - JSON parsing and validation of LLM output
 * - Fact validation (required fields, confidence clamping, type validation)
 * - Graceful error handling (LLM failures, malformed output)
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMExtractionAdapter } from './llm-adapter.js';
import type { LLMCallFn, ExtractionMessage } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLLMCall(response: string): LLMCallFn {
  return vi.fn().mockResolvedValue(response);
}

function makeMessages(count: number): ExtractionMessage[] {
  const messages: ExtractionMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1} content here.`,
    });
  }
  return messages;
}

const VALID_LLM_RESPONSE = JSON.stringify([
  {
    subject: 'user',
    predicate: 'prefers',
    object: 'TypeScript over JavaScript',
    type: 'preference',
    confidence: 0.95,
    properties: { context: 'programming' },
  },
  {
    subject: 'user',
    predicate: 'works_at',
    object: 'Acme Corp',
    type: 'attribute',
    confidence: 0.9,
    properties: {},
  },
]);

const DEFAULT_CONFIG = {
  agentId: 'agent-1',
  sessionId: 'session-1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLMExtractionAdapter', () => {
  describe('extract()', () => {
    it('extracts facts from valid LLM response', async () => {
      const llmCall = makeLLMCall(VALID_LLM_RESPONSE);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(4));

      expect(result.parseSuccess).toBe(true);
      expect(result.rawCount).toBe(2);
      expect(result.facts).toHaveLength(2);

      expect(result.facts[0]).toMatchObject({
        agentId: 'agent-1',
        subject: 'user',
        predicate: 'prefers',
        object: 'TypeScript over JavaScript',
        type: 'preference',
        confidence: 0.95,
        sourceContext: 'session:session-1',
      });

      expect(result.facts[1]).toMatchObject({
        subject: 'user',
        predicate: 'works_at',
        object: 'Acme Corp',
        type: 'attribute',
      });
    });

    it('returns empty result for empty messages', async () => {
      const llmCall = makeLLMCall('[]');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract([]);

      expect(result.facts).toHaveLength(0);
      expect(result.parseSuccess).toBe(true);
      expect(llmCall).not.toHaveBeenCalled();
    });

    it('filters out system messages before extraction', async () => {
      const llmCall = makeLLMCall('[]');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const messages: ExtractionMessage[] = [
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'system', content: 'Another system message' },
      ];

      const result = await adapter.extract(messages);

      expect(result.facts).toHaveLength(0);
      expect(llmCall).not.toHaveBeenCalled();
    });

    it('passes system prompt and formatted conversation to LLM', async () => {
      const llmCall = makeLLMCall('[]');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const messages: ExtractionMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      await adapter.extract(messages);

      expect(llmCall).toHaveBeenCalledWith({
        systemPrompt: expect.stringContaining('knowledge extraction'),
        userMessage: expect.stringContaining('Hello'),
        maxTokens: expect.any(Number),
      });
    });
  });

  describe('JSON parsing', () => {
    it('strips markdown code fences from LLM output', async () => {
      const response = '```json\n' + VALID_LLM_RESPONSE + '\n```';
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.parseSuccess).toBe(true);
      expect(result.facts).toHaveLength(2);
    });

    it('handles non-JSON LLM output gracefully', async () => {
      const llmCall = makeLLMCall('I found some interesting facts about the user...');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.parseSuccess).toBe(false);
      expect(result.facts).toHaveLength(0);
    });

    it('handles non-array JSON output', async () => {
      const llmCall = makeLLMCall('{"subject": "user", "predicate": "likes", "object": "cats"}');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.parseSuccess).toBe(false);
      expect(result.facts).toHaveLength(0);
    });

    it('handles empty array response', async () => {
      const llmCall = makeLLMCall('[]');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.parseSuccess).toBe(true);
      expect(result.facts).toHaveLength(0);
      expect(result.rawCount).toBe(0);
    });
  });

  describe('fact validation', () => {
    it('skips facts with missing required fields', async () => {
      const response = JSON.stringify([
        { subject: 'user', predicate: 'likes' }, // missing object
        { subject: '', predicate: 'likes', object: 'cats' }, // empty subject
        { subject: 'user', predicate: '', object: 'cats' }, // empty predicate
        { subject: 'user', predicate: 'likes', object: 'cats' }, // valid
      ]);
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.rawCount).toBe(4);
      expect(result.facts).toHaveLength(1);
      expect(result.facts[0]?.subject).toBe('user');
    });

    it('clamps confidence to 0.0–1.0 range', async () => {
      const response = JSON.stringify([
        { subject: 'a', predicate: 'b', object: 'c', confidence: 1.5 },
        { subject: 'd', predicate: 'e', object: 'f', confidence: -0.5 },
      ]);
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.facts[0]?.confidence).toBe(1.0);
      expect(result.facts[1]?.confidence).toBe(0.0);
    });

    it('defaults confidence to 0.7 when missing', async () => {
      const response = JSON.stringify([{ subject: 'a', predicate: 'b', object: 'c' }]);
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.facts[0]?.confidence).toBe(0.7);
    });

    it('maps unknown types to "general"', async () => {
      const response = JSON.stringify([
        { subject: 'a', predicate: 'b', object: 'c', type: 'unknown_type' },
      ]);
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.facts[0]?.type).toBe('general');
    });

    it('accepts all valid fact types', async () => {
      const types = [
        'attribute',
        'relationship',
        'preference',
        'skill',
        'event',
        'decision',
        'general',
      ];
      const response = JSON.stringify(
        types.map((type, i) => ({
          subject: `s${i}`,
          predicate: `p${i}`,
          object: `o${i}`,
          type,
        }))
      );
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.facts).toHaveLength(7);
      for (let i = 0; i < types.length; i++) {
        expect(result.facts[i]?.type).toBe(types[i]);
      }
    });

    it('assigns UUID ids and correct sourceContext', async () => {
      const response = JSON.stringify([{ subject: 'user', predicate: 'likes', object: 'cats' }]);
      const llmCall = makeLLMCall(response);
      const adapter = new LLMExtractionAdapter(llmCall, {
        agentId: 'agent-42',
        sessionId: 'sess-abc',
      });

      const result = await adapter.extract(makeMessages(2));

      expect(result.facts[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(result.facts[0]?.agentId).toBe('agent-42');
      expect(result.facts[0]?.sourceContext).toBe('session:sess-abc');
    });
  });

  describe('error handling', () => {
    it('returns empty result when LLM call fails', async () => {
      const llmCall = vi.fn().mockRejectedValue(new Error('LLM timeout'));
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.parseSuccess).toBe(false);
      expect(result.facts).toHaveLength(0);
    });

    it('returns empty result when LLM returns empty string', async () => {
      const llmCall = makeLLMCall('');
      const adapter = new LLMExtractionAdapter(llmCall, DEFAULT_CONFIG);

      const result = await adapter.extract(makeMessages(2));

      expect(result.parseSuccess).toBe(false);
      expect(result.facts).toHaveLength(0);
    });
  });

  describe('conversation truncation', () => {
    it('truncates long conversations from the beginning', async () => {
      const llmCall = makeLLMCall('[]');
      const adapter = new LLMExtractionAdapter(llmCall, {
        ...DEFAULT_CONFIG,
        maxConversationChars: 100,
      });

      // Create messages that total > 100 chars
      const messages: ExtractionMessage[] = [
        { role: 'user', content: 'A'.repeat(60) },
        { role: 'assistant', content: 'B'.repeat(60) },
        { role: 'user', content: 'C'.repeat(30) },
      ];

      await adapter.extract(messages);

      // The LLM should have been called — older messages dropped
      expect(llmCall).toHaveBeenCalled();
      const callArgs = (llmCall as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      // The user message should NOT contain the first message's 'A' content
      // (it was truncated to fit)
      expect(callArgs.userMessage).not.toContain('A'.repeat(60));
    });
  });
});
