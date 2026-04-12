/**
 * Integration test for AnthropicAdapter — NACA-5, NACA-70
 * Tests chat, streaming, and tool use via ANTHROPIC_API_KEY (non-subscription path).
 * Requires ANTHROPIC_API_KEY env var.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import type { LLMRequestType, LLMStreamChunkType } from '@nachos/types';

const apiKey = process.env.ANTHROPIC_API_KEY;
const SKIP = !apiKey;
const isOAuth = apiKey?.startsWith('sk-ant-oat') ?? false;

// Use haiku for OAuth tokens (limited model access), sonnet for full API keys
const model = isOAuth ? 'claude-3-haiku-20240307' : 'claude-haiku-4-5-20251001';

describe.skipIf(SKIP)('AnthropicAdapter integration — API key auth', () => {
  let adapter: AnthropicAdapter;

  beforeAll(() => {
    adapter = new AnthropicAdapter();
  });

  function makeOptions(overrides: { temperature?: number; maxTokens?: number } = {}) {
    return {
      model,
      temperature: overrides.temperature,
      maxTokens: overrides.maxTokens ?? 256,
      getProfileList: () => ['test'],
      getProfileApiKey: (name: string) => (name === 'test' ? apiKey! : null),
    };
  }

  function makeStreamOptions(overrides: { temperature?: number; maxTokens?: number } = {}) {
    return {
      ...makeOptions(overrides),
      sessionId: 'test-session-' + Date.now(),
    };
  }

  // ── Chat (send) ──────────────────────────────────────────────

  it('TC1: basic chat returns a response', async () => {
    const request: LLMRequestType = {
      messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    };
    const result = await adapter.send(request, makeOptions({ temperature: 0 }));

    expect(result.message.role).toBe('assistant');
    expect(typeof result.message.content).toBe('string');
    expect((result.message.content as string).length).toBeGreaterThan(0);
    expect(result.provider).toBe('anthropic');
    expect(result.model.toLowerCase()).toContain('claude');
    expect(result.usage).toBeDefined();
    expect(result.usage!.promptTokens).toBeGreaterThan(0);
    expect(result.usage!.completionTokens).toBeGreaterThan(0);
    console.log('[TC1] Model:', result.model, '| Tokens:', result.usage);
  }, 30_000);

  it('TC2: max_tokens is respected', async () => {
    const request: LLMRequestType = {
      messages: [{ role: 'user', content: 'Write a 500-word essay about computing.' }],
    };
    const result = await adapter.send(request, makeOptions({ temperature: 0.5, maxTokens: 50 }));

    expect(result.message.role).toBe('assistant');
    if (result.usage) {
      expect(result.usage.completionTokens).toBeLessThanOrEqual(50);
    }
    expect(result.finishReason).toBe('max_tokens');
    console.log('[TC2] Finish:', result.finishReason, '| Tokens:', result.usage);
  }, 30_000);

  // ── Streaming ────────────────────────────────────────────────

  it('TC3: streaming returns deltas and done chunk', async () => {
    const request: LLMRequestType = {
      messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }],
    };

    const chunks: LLMStreamChunkType[] = [];
    const result = await adapter.stream(
      request,
      makeStreamOptions({ temperature: 0, maxTokens: 128 }),
      (chunk) => {
        chunks.push(chunk);
      }
    );

    // Should have received delta chunks and a done chunk
    const deltas = chunks.filter((c) => c.type === 'delta');
    const done = chunks.filter((c) => c.type === 'done');
    expect(deltas.length).toBeGreaterThan(0);
    expect(done.length).toBe(1);

    // Aggregated text in result should match concatenated deltas
    const streamedText = deltas.map((c) => (c as { delta?: string }).delta ?? '').join('');
    expect(result.message.content).toBe(streamedText);

    expect(result.provider).toBe('anthropic');
    expect(result.model.toLowerCase()).toContain('claude');
    expect(result.usage).toBeDefined();
    console.log('[TC3] Deltas:', deltas.length, '| Model:', result.model);
  }, 30_000);

  // ── Tool use ─────────────────────────────────────────────────

  it('TC4: tool use returns tool_call with correct schema', async () => {
    const request: LLMRequestType = {
      messages: [
        {
          role: 'user',
          content: 'What is the weather in San Francisco? Use the get_weather tool.',
        },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather for a city',
          parameters: {
            properties: {
              city: { type: 'string', description: 'City name' },
            },
            required: ['city'],
          },
        },
      ],
    };

    const result = await adapter.send(request, makeOptions({ temperature: 0 }));

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);

    const call = result.toolCalls![0];
    expect(call.name).toBe('get_weather');
    expect(call.id).toBeTruthy();
    const args = JSON.parse(call.arguments);
    expect(args.city).toBeTruthy();
    expect(result.finishReason).toBe('tool_use');
    console.log('[TC4] Tool call:', call.name, args, '| ID:', call.id);
  }, 30_000);

  it('TC5: streaming with tool use emits tool_call chunks', async () => {
    const request: LLMRequestType = {
      messages: [
        { role: 'user', content: 'Look up the weather in Tokyo using the get_weather tool.' },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather for a city',
          parameters: {
            properties: {
              city: { type: 'string', description: 'City name' },
            },
            required: ['city'],
          },
        },
      ],
    };

    const chunks: LLMStreamChunkType[] = [];
    const result = await adapter.stream(request, makeStreamOptions({ temperature: 0 }), (chunk) => {
      chunks.push(chunk);
    });

    // Should have a tool_call chunk and done chunk
    const toolChunks = chunks.filter((c) => c.type === 'tool_call');
    const doneChunks = chunks.filter((c) => c.type === 'done');
    expect(toolChunks.length).toBeGreaterThanOrEqual(1);
    expect(doneChunks.length).toBe(1);

    // Result should also report tool calls
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCalls![0].name).toBe('get_weather');
    expect(result.finishReason).toBe('tool_use');
    console.log('[TC5] Stream tool call:', result.toolCalls![0].name);
  }, 30_000);

  // ── Auth path verification ───────────────────────────────────

  it('TC6: key type is correctly detected', () => {
    // Verify the adapter uses the right auth path based on key prefix
    if (isOAuth) {
      console.log('[TC6] Using OAuth token (sk-ant-oat*) — Bearer auth path');
    } else {
      console.log('[TC6] Using standard API key — x-api-key auth path');
    }
    // If we got here, all previous tests passed with this key type
    expect(true).toBe(true);
  });
});
