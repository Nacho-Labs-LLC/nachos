/**
 * Cross-provider unit test — NACA-72
 *
 * Validates that all adapters (Anthropic, OpenAI, Ollama, Bedrock) produce
 * consistent AdapterResponse shapes for identical scenarios using mocked SDKs.
 *
 * Scenarios: basic chat, tool use, streaming, error mapping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderError } from './types.js';
import type { LLMStreamChunkType } from '@nachos/types';
import {
  FIXTURES,
  assertBasicChatResponse,
  assertToolUseResponse,
} from './cross-provider.harness.js';

// ── SDK mocks ─────────────────────────────────────────────────

// OpenAI mock (also used by Ollama)
const { mockOpenAICreate } = vi.hoisted(() => ({ mockOpenAICreate: vi.fn() }));
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}));

// Anthropic mock
const { mockAnthropicCreate, mockAnthropicStream: _mockAnthropicStream } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicStream: vi.fn(),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockAnthropicCreate,
    },
  })),
}));

// Bedrock mock
const { mockBedrockSend } = vi.hoisted(() => ({ mockBedrockSend: vi.fn() }));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: vi.fn().mockImplementation((params) => params),
  InvokeModelWithResponseStreamCommand: vi.fn().mockImplementation((params) => params),
}));

// ── Helpers ───────────────────────────────────────────────────

function openAIChatResponse(
  content: string,
  toolCalls?: Array<{ id: string; name: string; args: string }>
) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: toolCalls ? null : content,
          tool_calls: toolCalls?.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
          })),
        },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function anthropicChatResponse(
  content: string,
  toolUse?: { id: string; name: string; input: Record<string, unknown> }
) {
  const contentBlocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }> = [{ type: 'text', text: content }];
  if (toolUse) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
    });
  }
  return {
    id: 'msg_123',
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    model: 'claude-haiku-4-5-20251001',
    stop_reason: toolUse ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function bedrockResponse(
  content: string,
  toolUse?: { id: string; name: string; input: Record<string, unknown> }
) {
  const contentBlocks: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }> = [{ type: 'text', text: content }];
  if (toolUse) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
    });
  }
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: contentBlocks,
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        stop_reason: toolUse ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    ),
  };
}

// ── Adapter factories ─────────────────────────────────────────

async function loadAdapters() {
  const { OpenAIAdapter } = await import('./openai.js');
  const { OllamaAdapter } = await import('./ollama.js');
  const { AnthropicAdapter } = await import('./anthropic.js');
  const { createBedrockAdapter } = await import('./bedrock.js');
  return { OpenAIAdapter, OllamaAdapter, AnthropicAdapter, createBedrockAdapter };
}

// ── Tests ─────────────────────────────────────────────────────

describe('Cross-provider unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenAICreate.mockReset();
    mockAnthropicCreate.mockReset();
    mockBedrockSend.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.AWS_ACCESS_KEY_ID = 'test-key-id';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.AWS_DEFAULT_REGION = 'us-east-1';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_DEFAULT_REGION;
  });

  // ── Basic chat: all adapters return consistent shape ──

  describe('basic chat — consistent response shape', () => {
    it('OpenAI returns well-formed response', async () => {
      const { OpenAIAdapter } = await loadAdapters();
      mockOpenAICreate.mockResolvedValue(openAIChatResponse('Hello there!'));

      const adapter = new OpenAIAdapter();
      const result = await adapter.send(FIXTURES.basicChat.request, { model: 'gpt-4o-mini' });

      assertBasicChatResponse(result, 'openai');
      expect(result.message.content).toBe('Hello there!');
    });

    it('Ollama returns well-formed response (delegates to OpenAI)', async () => {
      const { OllamaAdapter } = await loadAdapters();
      mockOpenAICreate.mockResolvedValue(openAIChatResponse('Hello from Ollama!'));

      const adapter = new OllamaAdapter('http://localhost:11434/v1');
      const result = await adapter.send(FIXTURES.basicChat.request, { model: 'llama3.2' });

      assertBasicChatResponse(result, 'openai');
      expect(result.message.content).toBe('Hello from Ollama!');
    });

    it('Anthropic returns well-formed response', async () => {
      const { AnthropicAdapter } = await loadAdapters();
      mockAnthropicCreate.mockResolvedValue(anthropicChatResponse('Hello there!'));

      const adapter = new AnthropicAdapter();
      const result = await adapter.send(FIXTURES.basicChat.request, {
        model: 'claude-haiku-4-5-20251001',
        getProfileList: () => ['test'],
        getProfileApiKey: () => 'test-key',
      });

      assertBasicChatResponse(result, 'anthropic');
      expect(result.message.content).toBe('Hello there!');
    });

    it('Bedrock returns well-formed response', async () => {
      const { createBedrockAdapter } = await loadAdapters();
      mockBedrockSend.mockResolvedValue(bedrockResponse('Hello there!'));

      const adapter = createBedrockAdapter();
      const result = await adapter.send(FIXTURES.basicChat.request, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      });

      assertBasicChatResponse(result, 'bedrock');
      expect(result.message.content).toBe('Hello there!');
    });
  });

  // ── Tool use: all adapters return tool calls consistently ──

  describe('tool use — consistent tool call shape', () => {
    it('OpenAI transforms tool calls correctly', async () => {
      const { OpenAIAdapter } = await loadAdapters();
      mockOpenAICreate.mockResolvedValue(
        openAIChatResponse('', [
          { id: 'call_1', name: 'get_weather', args: '{"city":"San Francisco"}' },
        ])
      );

      const adapter = new OpenAIAdapter();
      const result = await adapter.send(FIXTURES.toolUse.request, { model: 'gpt-4o-mini' });

      assertToolUseResponse(result);
      expect(result.finishReason).toBe('tool_calls');
    });

    it('Ollama transforms tool calls correctly', async () => {
      const { OllamaAdapter } = await loadAdapters();
      mockOpenAICreate.mockResolvedValue(
        openAIChatResponse('', [
          { id: 'call_1', name: 'get_weather', args: '{"city":"San Francisco"}' },
        ])
      );

      const adapter = new OllamaAdapter();
      const result = await adapter.send(FIXTURES.toolUse.request, { model: 'llama3.2' });

      assertToolUseResponse(result);
    });

    it('Anthropic transforms tool calls correctly', async () => {
      const { AnthropicAdapter } = await loadAdapters();
      mockAnthropicCreate.mockResolvedValue(
        anthropicChatResponse('Let me check that.', {
          id: 'tool_abc',
          name: 'get_weather',
          input: { city: 'San Francisco' },
        })
      );

      const adapter = new AnthropicAdapter();
      const result = await adapter.send(FIXTURES.toolUse.request, {
        model: 'claude-haiku-4-5-20251001',
        getProfileList: () => ['test'],
        getProfileApiKey: () => 'test-key',
      });

      assertToolUseResponse(result);
      expect(result.finishReason).toBe('tool_use');
    });

    it('Bedrock transforms tool calls correctly', async () => {
      const { createBedrockAdapter } = await loadAdapters();
      mockBedrockSend.mockResolvedValue(
        bedrockResponse('Let me check.', {
          id: 'tool_abc',
          name: 'get_weather',
          input: { city: 'San Francisco' },
        })
      );

      const adapter = createBedrockAdapter();
      const result = await adapter.send(FIXTURES.toolUse.request, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      });

      assertToolUseResponse(result);
      expect(result.finishReason).toBe('tool_use');
    });
  });

  // ── Streaming: OpenAI/Ollama produce consistent stream chunks ──

  describe('streaming — consistent chunk shape', () => {
    it('OpenAI streaming produces delta and done chunks', async () => {
      const { OpenAIAdapter } = await loadAdapters();

      // Mock async iterator for streaming
      const streamChunks = [
        { choices: [{ delta: { content: 'Hello ' } }] },
        { choices: [{ delta: { content: 'world!' } }] },
      ];
      mockOpenAICreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of streamChunks) yield chunk;
        },
      });

      const adapter = new OpenAIAdapter();
      const chunks: LLMStreamChunkType[] = [];
      const result = await adapter.stream(
        FIXTURES.streaming.request,
        { model: 'gpt-4o-mini', sessionId: 'test-stream' },
        (chunk) => {
          chunks.push(chunk);
        }
      );

      const deltas = chunks.filter((c) => c.type === 'delta');
      const done = chunks.filter((c) => c.type === 'done');
      expect(deltas.length).toBe(2);
      expect(done.length).toBe(1);
      expect(result.message.content).toBe('Hello world!');
      expect(result.provider).toBe('openai');
    });

    it('Ollama streaming delegates to OpenAI correctly', async () => {
      const { OllamaAdapter } = await loadAdapters();

      const streamChunks = [
        { choices: [{ delta: { content: '1\n' } }] },
        { choices: [{ delta: { content: '2\n' } }] },
      ];
      mockOpenAICreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of streamChunks) yield chunk;
        },
      });

      const adapter = new OllamaAdapter();
      const chunks: LLMStreamChunkType[] = [];
      const result = await adapter.stream(
        FIXTURES.streaming.request,
        { model: 'llama3.2', sessionId: 'test-stream' },
        (chunk) => {
          chunks.push(chunk);
        }
      );

      const deltas = chunks.filter((c) => c.type === 'delta');
      expect(deltas.length).toBe(2);
      expect(result.message.content).toBe('1\n2\n');
    });

    it('OpenAI streaming with tool calls emits tool_call chunks', async () => {
      const { OpenAIAdapter } = await loadAdapters();

      const streamChunks = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"SF"}' } },
                ],
              },
            },
          ],
        },
      ];
      mockOpenAICreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of streamChunks) yield chunk;
        },
      });

      const adapter = new OpenAIAdapter();
      const chunks: LLMStreamChunkType[] = [];
      await adapter.stream(
        FIXTURES.toolUse.request,
        { model: 'gpt-4o-mini', sessionId: 'test-stream' },
        (chunk) => {
          chunks.push(chunk);
        }
      );

      const toolChunks = chunks.filter((c) => c.type === 'tool_call');
      const doneChunks = chunks.filter((c) => c.type === 'done');
      expect(toolChunks.length).toBe(1);
      expect(doneChunks.length).toBe(1);
    });
  });

  // ── Error mapping: all adapters map to ProviderError consistently ──

  describe('error mapping — consistent ProviderError kinds', () => {
    it('OpenAI maps 429 to rate_limit', async () => {
      const { OpenAIAdapter } = await loadAdapters();
      mockOpenAICreate.mockRejectedValue({ status: 429, message: 'Rate limited' });

      const adapter = new OpenAIAdapter();
      try {
        await adapter.send(FIXTURES.basicChat.request, { model: 'gpt-4o-mini' });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });

    it('OpenAI maps 401 to auth', async () => {
      const { OpenAIAdapter } = await loadAdapters();
      mockOpenAICreate.mockRejectedValue({ status: 401, message: 'Unauthorized' });

      const adapter = new OpenAIAdapter();
      try {
        await adapter.send(FIXTURES.basicChat.request, { model: 'gpt-4o-mini' });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
      }
    });

    it('Anthropic maps rate_limit_error to rate_limit', async () => {
      const { AnthropicAdapter } = await loadAdapters();
      mockAnthropicCreate.mockRejectedValue({
        status: 429,
        error: { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited' } },
      });

      const adapter = new AnthropicAdapter();
      try {
        await adapter.send(FIXTURES.basicChat.request, {
          model: 'claude-haiku-4-5-20251001',
          getProfileList: () => ['test'],
          getProfileApiKey: () => 'test-key',
        });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });

    it('Bedrock maps ThrottlingException to rate_limit', async () => {
      const { createBedrockAdapter } = await loadAdapters();
      mockBedrockSend.mockRejectedValue({
        name: 'ThrottlingException',
        message: 'Rate limit exceeded',
        $metadata: { httpStatusCode: 429 },
      });

      const adapter = createBedrockAdapter();
      try {
        await adapter.send(FIXTURES.basicChat.request, {
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });

    it('all providers map unknown errors to ProviderError', async () => {
      const { OpenAIAdapter, AnthropicAdapter, createBedrockAdapter } = await loadAdapters();

      // OpenAI
      mockOpenAICreate.mockRejectedValue(new Error('Network failure'));
      const openai = new OpenAIAdapter();
      await expect(
        openai.send(FIXTURES.basicChat.request, { model: 'gpt-4o-mini' })
      ).rejects.toThrow(ProviderError);

      // Anthropic
      mockAnthropicCreate.mockRejectedValue(new Error('Network failure'));
      const anthropic = new AnthropicAdapter();
      await expect(
        anthropic.send(FIXTURES.basicChat.request, {
          model: 'claude-haiku-4-5-20251001',
          getProfileList: () => ['test'],
          getProfileApiKey: () => 'test-key',
        })
      ).rejects.toThrow(ProviderError);

      // Bedrock
      mockBedrockSend.mockRejectedValue(new Error('Network failure'));
      const bedrock = createBedrockAdapter();
      await expect(
        bedrock.send(FIXTURES.basicChat.request, {
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        })
      ).rejects.toThrow(ProviderError);
    });
  });

  // ── Response shape consistency ──

  describe('response shape consistency across providers', () => {
    it('all providers include provider field in response', async () => {
      const { OpenAIAdapter, AnthropicAdapter, createBedrockAdapter } = await loadAdapters();

      mockOpenAICreate.mockResolvedValue(openAIChatResponse('Hi'));
      mockAnthropicCreate.mockResolvedValue(anthropicChatResponse('Hi'));
      mockBedrockSend.mockResolvedValue(bedrockResponse('Hi'));

      const openai = new OpenAIAdapter();
      const anthropic = new AnthropicAdapter();
      const bedrock = createBedrockAdapter();

      const opts = { model: 'test' };
      const anthOpts = {
        ...opts,
        model: 'claude-haiku-4-5-20251001',
        getProfileList: () => ['test'],
        getProfileApiKey: () => 'test-key',
      };

      const [r1, r2, r3] = await Promise.all([
        openai.send(FIXTURES.basicChat.request, { ...opts, model: 'gpt-4o-mini' }),
        anthropic.send(FIXTURES.basicChat.request, anthOpts),
        bedrock.send(FIXTURES.basicChat.request, {
          ...opts,
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        }),
      ]);

      expect(r1.provider).toBe('openai');
      expect(r2.provider).toBe('anthropic');
      expect(r3.provider).toBe('bedrock');

      // All have message.role === 'assistant'
      for (const r of [r1, r2, r3]) {
        expect(r.message.role).toBe('assistant');
        expect(typeof r.message.content).toBe('string');
      }
    });

    it('all providers include usage metrics', async () => {
      const { OpenAIAdapter, AnthropicAdapter, createBedrockAdapter } = await loadAdapters();

      mockOpenAICreate.mockResolvedValue(openAIChatResponse('Hi'));
      mockAnthropicCreate.mockResolvedValue(anthropicChatResponse('Hi'));
      mockBedrockSend.mockResolvedValue(bedrockResponse('Hi'));

      const openai = new OpenAIAdapter();
      const anthropic = new AnthropicAdapter();
      const bedrock = createBedrockAdapter();

      const [r1, r2, r3] = await Promise.all([
        openai.send(FIXTURES.basicChat.request, { model: 'gpt-4o-mini' }),
        anthropic.send(FIXTURES.basicChat.request, {
          model: 'claude-haiku-4-5-20251001',
          getProfileList: () => ['test'],
          getProfileApiKey: () => 'test-key',
        }),
        bedrock.send(FIXTURES.basicChat.request, {
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        }),
      ]);

      for (const r of [r1, r2, r3]) {
        expect(r.usage).toBeDefined();
        expect(r.usage!.promptTokens).toBeGreaterThan(0);
        expect(r.usage!.completionTokens).toBeGreaterThan(0);
      }
    });
  });
});
