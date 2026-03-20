/**
 * Integration test for AnthropicAdapter — NACA-5
 * Tests model selection, max_tokens, and temperature config values.
 * Requires ANTHROPIC_API_KEY env var.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import type { LLMRequestType } from '@nachos/types';

const SKIP = !process.env.ANTHROPIC_API_KEY;

describe.skipIf(SKIP)('AnthropicAdapter integration — NACA-5', () => {
  let adapter: AnthropicAdapter;
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  // NOTE: The OAuth setup token (sk-ant-oat*) on this instance only has access to
  // claude-3-haiku-20240307 via direct API calls. claude-sonnet-4-6 returns 400
  // invalid_request_error with this token type. Tests use haiku to verify adapter
  // behavior (param passing, response parsing, token limiting). When a full API key
  // is configured, replace with 'claude-sonnet-4-6' per the issue config.
  const model = 'claude-3-haiku-20240307';

  beforeAll(() => {
    adapter = new AnthropicAdapter();
  });

  function makeOptions(overrides: { temperature?: number; maxTokens?: number }) {
    return {
      model,
      temperature: overrides.temperature,
      maxTokens: overrides.maxTokens ?? 4096,
      getProfileList: () => ['test'],
      getProfileApiKey: (name: string) => (name === 'test' ? apiKey : null),
    };
  }

  // Test Case 1: Basic message — confirm response comes from Claude
  it('TC1: basic message returns a response from Claude', async () => {
    const request: LLMRequestType = {
      messages: [{ role: 'user', content: 'Say hello and identify yourself in one sentence.' }],
    };
    const result = await adapter.send(request, makeOptions({ temperature: 0.5 }));

    expect(result.message.role).toBe('assistant');
    expect(typeof result.message.content).toBe('string');
    expect((result.message.content as string).length).toBeGreaterThan(0);
    expect(result.provider).toBe('anthropic');
    // Model string should contain 'claude'
    expect(result.model.toLowerCase()).toContain('claude');
    console.log('[TC1] Response:', result.message.content);
    console.log('[TC1] Model:', result.model);
    console.log('[TC1] Usage:', result.usage);
  }, 30_000);

  // Test Case 2: temperature=0.0, factual question — deterministic, concise response
  it('TC2: temperature=0.0 returns deterministic factual answer', async () => {
    const request: LLMRequestType = {
      messages: [{ role: 'user', content: 'What is 2 + 2? Answer with only the number.' }],
    };
    const result = await adapter.send(request, makeOptions({ temperature: 0.0 }));

    expect(result.message.role).toBe('assistant');
    const content = result.message.content as string;
    expect(content).toBeTruthy();
    // Should contain "4"
    expect(content).toContain('4');
    console.log('[TC2] Response:', content);
  }, 30_000);

  // Test Case 3: temperature=1.0, creative story — varied output
  it('TC3: temperature=1.0 returns a creative story response', async () => {
    const request: LLMRequestType = {
      messages: [
        {
          role: 'user',
          content:
            'Write a single opening sentence for a short story about a raccoon who discovers a hidden treasure.',
        },
      ],
    };
    const result = await adapter.send(request, makeOptions({ temperature: 1.0 }));

    expect(result.message.role).toBe('assistant');
    const content = result.message.content as string;
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(20);
    console.log('[TC3] Response:', content);
  }, 30_000);

  // Test Case 4: max_tokens=50, long-answer prompt — response cut off at limit
  it('TC4: max_tokens=50 truncates the response at the token limit', async () => {
    const request: LLMRequestType = {
      messages: [
        {
          role: 'user',
          content:
            'Write a detailed 500-word essay about the history of computing and its impact on modern society.',
        },
      ],
    };
    const result = await adapter.send(request, makeOptions({ temperature: 0.5, maxTokens: 50 }));

    expect(result.message.role).toBe('assistant');
    const content = result.message.content as string;
    expect(content).toBeTruthy();
    // With max_tokens=50, usage output tokens should be ≤ 50
    if (result.usage) {
      expect(result.usage.completionTokens).toBeLessThanOrEqual(50);
    }
    // The finish reason should indicate max_tokens stop
    expect(result.finishReason).toBe('max_tokens');
    console.log('[TC4] Response (truncated):', content);
    console.log('[TC4] Finish reason:', result.finishReason);
    console.log('[TC4] Usage:', result.usage);
  }, 30_000);
});
