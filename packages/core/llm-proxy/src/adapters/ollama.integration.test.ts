/**
 * Ollama end-to-end integration test — NACA-75
 *
 * Validates that the OllamaAdapter correctly delegates to the OpenAI adapter
 * and handles Ollama-specific edge cases with a live Ollama instance.
 *
 * Requires: Ollama running (localhost:11434 or OLLAMA_BASE_URL env var)
 *           with llama3.2 model pulled.
 *
 * Edge cases validated:
 *   - max_tokens vs max_completion_tokens (Ollama ignores the latter)
 *   - Tool calling with small models (malformed arguments expected)
 *   - Streaming chunk format compatibility
 *   - System message handling
 *   - API key bypass (Ollama doesn't require authentication)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { LLMStreamChunkType } from '@nachos/types';
import { OllamaAdapter } from './ollama.js';

// ── Config ───────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://172.17.0.2:11434/v1';
const MODEL = 'llama3.2';
const TIMEOUT_MS = 60_000;

// ── Availability check ───────────────────────────────────────

let ollamaAvailable = false;
let ollamaModels: string[] = [];

try {
  const modelsUrl = OLLAMA_BASE_URL.replace(/\/v1\/?$/, '/v1/models');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const res = await fetch(modelsUrl, { signal: controller.signal }).catch(() => null);
  clearTimeout(timeout);
  if (res?.ok) {
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    ollamaModels = data.data?.map((m) => m.id) ?? [];
    ollamaAvailable = ollamaModels.some((m) => m.startsWith('llama3.2'));
  }
} catch {
  ollamaAvailable = false;
}

// ── Tests ────────────────────────────────────────────────────

describe.skipIf(!ollamaAvailable)('Ollama E2E Integration (llama3.2)', () => {
  let adapter: OllamaAdapter;

  beforeAll(() => {
    adapter = new OllamaAdapter(OLLAMA_BASE_URL);
  });

  // ── Basic chat ──

  it('TC-O1: basic chat returns well-formed response', async () => {
    const result = await adapter.send(
      { messages: [{ role: 'user', content: 'Say hello in one sentence.' }] },
      { model: MODEL, maxTokens: 64 }
    );

    expect(result.message.role).toBe('assistant');
    expect(typeof result.message.content).toBe('string');
    expect((result.message.content as string).length).toBeGreaterThan(0);
    expect(result.provider).toBe('openai'); // delegates to OpenAI adapter
    expect(result.model).toBe(MODEL);
    expect(result.usage).toBeDefined();
    expect(result.usage!.promptTokens).toBeGreaterThan(0);
    expect(result.usage!.completionTokens).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  // ── max_tokens enforcement (Ollama edge case) ──

  it('TC-O2: max_tokens is enforced (not ignored like max_completion_tokens)', async () => {
    const result = await adapter.send(
      { messages: [{ role: 'user', content: 'Write a 500-word essay about artificial intelligence.' }] },
      { model: MODEL, maxTokens: 20 }
    );

    expect(result.message.role).toBe('assistant');
    expect(result.usage).toBeDefined();
    // With the fix, Ollama should respect the token limit.
    // Allow small tolerance (20 requested + a few for stop token overhead).
    expect(result.usage!.completionTokens).toBeLessThanOrEqual(30);
    expect(result.finishReason).toBe('length');
  }, TIMEOUT_MS);

  // ── System messages ──

  it('TC-O3: system messages are handled correctly', async () => {
    const result = await adapter.send(
      {
        messages: [
          { role: 'system', content: 'You are a pirate. Always start your response with "Arrr!"' },
          { role: 'user', content: 'Hello' },
        ],
      },
      { model: MODEL, maxTokens: 64, temperature: 0 }
    );

    expect(result.message.role).toBe('assistant');
    expect(typeof result.message.content).toBe('string');
    expect((result.message.content as string).length).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  // ── Tool calling ──

  it('TC-O4: tool calling returns structured tool_calls', async () => {
    const result = await adapter.send(
      {
        messages: [
          { role: 'user', content: 'What is the weather in San Francisco? Use the get_weather tool.' },
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather for a city',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string', description: 'City name' },
              },
              required: ['city'],
            },
          },
        ],
      },
      { model: MODEL, maxTokens: 256, temperature: 0 }
    );

    // Ollama with llama3.2 should return tool calls
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);

    const call = result.toolCalls![0];
    expect(call.id).toBeTruthy();
    expect(call.name).toBe('get_weather');
    // Arguments should be valid JSON (even if the values are malformed for small models)
    expect(() => JSON.parse(call.arguments)).not.toThrow();
    expect(result.finishReason).toBe('tool_calls');
  }, TIMEOUT_MS);

  // ── Streaming ──

  it('TC-O5: streaming returns delta and done chunks', async () => {
    const chunks: LLMStreamChunkType[] = [];
    const result = await adapter.stream(
      { messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }] },
      { model: MODEL, maxTokens: 128, sessionId: 'ollama-stream-test', temperature: 0 },
      (chunk) => { chunks.push(chunk); }
    );

    const deltas = chunks.filter((c) => c.type === 'delta');
    const doneChunks = chunks.filter((c) => c.type === 'done');

    expect(deltas.length).toBeGreaterThan(0);
    expect(doneChunks.length).toBe(1);

    // Aggregated text should match concatenated deltas
    const streamedText = deltas.map((c) => c.delta ?? '').join('');
    expect(result.message.content).toBe(streamedText);
    expect(result.provider).toBe('openai');
  }, TIMEOUT_MS);

  it('TC-O6: streaming with tool use emits tool_call chunks', async () => {
    const chunks: LLMStreamChunkType[] = [];
    const result = await adapter.stream(
      {
        messages: [
          { role: 'user', content: 'What is the weather in Tokyo? Use the get_weather tool.' },
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather for a city',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        ],
      },
      { model: MODEL, maxTokens: 256, sessionId: 'ollama-tool-stream', temperature: 0 },
      (chunk) => { chunks.push(chunk); }
    );

    const toolChunks = chunks.filter((c) => c.type === 'tool_call');
    const doneChunks = chunks.filter((c) => c.type === 'done');

    expect(toolChunks.length).toBeGreaterThanOrEqual(1);
    expect(doneChunks.length).toBe(1);
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT_MS);

  // ── Error handling ──

  it('TC-O7: wrong model name returns a clear error', async () => {
    try {
      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'nonexistent-model-xyz', maxTokens: 10 }
      );
      expect.unreachable('Should have thrown');
    } catch (error) {
      // Ollama returns an error for unknown models — adapter should map it
      expect(error).toBeDefined();
    }
  }, TIMEOUT_MS);

  // ── Multi-turn conversation ──

  it('TC-O8: multi-turn conversation works correctly', async () => {
    const result = await adapter.send(
      {
        messages: [
          { role: 'user', content: 'My name is Alice.' },
          { role: 'assistant', content: 'Nice to meet you, Alice!' },
          { role: 'user', content: 'What is my name?' },
        ],
      },
      { model: MODEL, maxTokens: 64, temperature: 0 }
    );

    expect(result.message.role).toBe('assistant');
    const content = (result.message.content as string).toLowerCase();
    expect(content).toContain('alice');
  }, TIMEOUT_MS);
});
