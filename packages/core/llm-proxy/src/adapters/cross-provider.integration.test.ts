/**
 * Cross-provider integration test — NACA-72
 *
 * Runs identical test scenarios against every configured provider.
 * Each provider is skipped when its API key / service is unavailable.
 *
 * Providers: Anthropic (claude-3-haiku), OpenAI (gpt-4o-mini), Ollama (llama3.2)
 *
 * Requires env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY
 * Ollama requires a running instance at http://localhost:11434
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { LLMStreamChunkType } from '@nachos/types';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { OllamaAdapter } from './ollama.js';
import type { LLMProviderAdapter } from './types.js';
import {
  FIXTURES,
  assertBasicChatResponse,
  assertToolUseResponse,
  assertStreamResponse,
  assertStreamToolResponse,
  type ProviderTestConfig,
  defaultSendOptions,
  defaultStreamOptions,
} from './cross-provider.harness.js';

// ── Provider configs ──────────────────────────────────────────

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const isOAuth = anthropicKey?.startsWith('sk-ant-oat') ?? false;

const openaiKey = process.env.OPENAI_API_KEY;

// Ollama detection: try to reach the local server
let ollamaAvailable = false;
try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  const res = await fetch('http://localhost:11434/v1/models', { signal: controller.signal }).catch(
    () => null
  );
  clearTimeout(timeout);
  ollamaAvailable = res?.ok ?? false;
} catch {
  ollamaAvailable = false;
}

const providers: ProviderTestConfig[] = [
  {
    name: 'Anthropic',
    createAdapter: () => new AnthropicAdapter(),
    expectedProvider: 'anthropic',
    model: isOAuth ? 'claude-3-haiku-20240307' : 'claude-haiku-4-5-20251001',
    supportsStreaming: true,
    getApiKey: () => anthropicKey ?? null,
  },
  {
    name: 'OpenAI',
    createAdapter: () => new OpenAIAdapter(),
    expectedProvider: 'openai',
    model: 'gpt-4o-mini',
    supportsStreaming: true,
    getApiKey: () => openaiKey ?? null,
  },
  {
    name: 'Ollama',
    createAdapter: () => new OllamaAdapter('http://localhost:11434/v1'),
    expectedProvider: 'openai', // Ollama delegates to OpenAI adapter
    model: 'llama3.2',
    supportsStreaming: true,
    getApiKey: () => 'ollama', // Ollama doesn't need a real key
  },
];

function isAvailable(config: ProviderTestConfig): boolean {
  if (config.name === 'Ollama') return ollamaAvailable;
  return !!config.getApiKey?.();
}

// ── Test matrix ───────────────────────────────────────────────

for (const config of providers) {
  const skip = !isAvailable(config);

  describe.skipIf(skip)(`Cross-provider: ${config.name}`, () => {
    let adapter: LLMProviderAdapter;

    beforeAll(() => {
      adapter = config.createAdapter();
    });

    // ── Basic chat ──

    it('TC-X1: basic chat returns well-formed response', async () => {
      const result = await adapter.send(
        FIXTURES.basicChat.request,
        defaultSendOptions(config, { temperature: 0 })
      );

      assertBasicChatResponse(result, config.expectedProvider);
      console.log(`[${config.name}] TC-X1 Model: ${result.model} | Tokens: ${JSON.stringify(result.usage)}`);
    }, 30_000);

    it('TC-X2: max_tokens is respected', async () => {
      const result = await adapter.send(
        { messages: [{ role: 'user', content: 'Write a 500-word essay about computing.' }] },
        defaultSendOptions(config, { temperature: 0.5, maxTokens: 50 })
      );

      expect(result.message.role).toBe('assistant');
      if (result.usage) {
        expect(result.usage.completionTokens).toBeLessThanOrEqual(60); // small tolerance
      }
      console.log(`[${config.name}] TC-X2 Finish: ${result.finishReason} | Tokens: ${JSON.stringify(result.usage)}`);
    }, 30_000);

    // ── Tool use ──

    it('TC-X3: tool use returns valid tool call', async () => {
      const result = await adapter.send(
        FIXTURES.toolUse.request,
        defaultSendOptions(config, { temperature: 0 })
      );

      assertToolUseResponse(result);
      console.log(`[${config.name}] TC-X3 Tool: ${result.toolCalls![0].name} | Args: ${result.toolCalls![0].arguments}`);
    }, 30_000);

    // ── Streaming ──

    it('TC-X4: streaming returns deltas and done chunk', async () => {
      if (!adapter.stream) {
        console.log(`[${config.name}] TC-X4 SKIP: no stream support`);
        return;
      }

      const chunks: LLMStreamChunkType[] = [];
      const result = await adapter.stream(
        FIXTURES.streaming.request,
        defaultStreamOptions(config, { temperature: 0, maxTokens: 128 }),
        (chunk) => { chunks.push(chunk); }
      );

      assertStreamResponse(chunks, result, config.expectedProvider);
      console.log(`[${config.name}] TC-X4 Deltas: ${chunks.filter((c) => c.type === 'delta').length}`);
    }, 30_000);

    it('TC-X5: streaming with tool use emits tool_call chunks', async () => {
      if (!adapter.stream) {
        console.log(`[${config.name}] TC-X5 SKIP: no stream support`);
        return;
      }

      const chunks: LLMStreamChunkType[] = [];
      const result = await adapter.stream(
        FIXTURES.toolUse.request,
        defaultStreamOptions(config, { temperature: 0 }),
        (chunk) => { chunks.push(chunk); }
      );

      assertStreamToolResponse(chunks, result);
      console.log(`[${config.name}] TC-X5 Tool chunks: ${chunks.filter((c) => c.type === 'tool_call').length}`);
    }, 30_000);

    // ── System message handling ──

    it('TC-X6: system messages are handled correctly', async () => {
      const result = await adapter.send(
        {
          messages: [
            { role: 'system', content: 'You are a helpful pirate. Respond with "Arrr!" only.' },
            { role: 'user', content: 'Hello' },
          ],
        },
        defaultSendOptions(config, { temperature: 0, maxTokens: 64 })
      );

      expect(result.message.role).toBe('assistant');
      expect(typeof result.message.content).toBe('string');
      expect((result.message.content as string).length).toBeGreaterThan(0);
      console.log(`[${config.name}] TC-X6 Response: ${(result.message.content as string).slice(0, 80)}`);
    }, 30_000);
  });
}
