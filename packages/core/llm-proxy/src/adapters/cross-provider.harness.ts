/**
 * Cross-provider test harness — NACA-72
 *
 * Defines provider-agnostic test scenarios that validate identical behavior
 * across all LLM adapters: basic chat, tool use, streaming, and error mapping.
 *
 * Usage:
 *   - Unit tests: pass mocked adapters
 *   - Integration tests: pass real adapters with live API keys
 */
import { expect } from 'vitest';
import type { LLMRequestType, LLMStreamChunkType } from '@nachos/types';
import type {
  AdapterResponse,
  AdapterSendOptions,
  AdapterStreamOptions,
  LLMProviderAdapter,
} from './types.js';

// ── Shared fixtures ───────────────────────────────────────────

export const FIXTURES = {
  basicChat: {
    request: {
      messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    } as LLMRequestType,
  },

  toolUse: {
    request: {
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
    } as LLMRequestType,
  },

  streaming: {
    request: {
      messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }],
    } as LLMRequestType,
  },

  multiTool: {
    request: {
      messages: [
        { role: 'user', content: 'Get the weather in SF and the time in PST.' },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
        {
          name: 'get_time',
          description: 'Get time',
          parameters: { type: 'object', properties: { timezone: { type: 'string' } }, required: ['timezone'] },
        },
      ],
    } as LLMRequestType,
  },
};

// ── Assertions ────────────────────────────────────────────────

/** Validates common properties of any successful send() response */
export function assertBasicChatResponse(result: AdapterResponse, expectedProvider: string) {
  expect(result.message.role).toBe('assistant');
  expect(typeof result.message.content).toBe('string');
  expect((result.message.content as string).length).toBeGreaterThan(0);
  expect(result.provider).toBe(expectedProvider);
  expect(result.usage).toBeDefined();
  expect(result.usage!.promptTokens).toBeGreaterThan(0);
  expect(result.usage!.completionTokens).toBeGreaterThan(0);
}

/** Validates a tool-use response has well-formed tool calls */
export function assertToolUseResponse(result: AdapterResponse) {
  expect(result.toolCalls).toBeDefined();
  expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);

  const call = result.toolCalls![0];
  expect(call.id).toBeTruthy();
  expect(call.name).toBe('get_weather');
  const args = JSON.parse(call.arguments);
  expect(args.city).toBeTruthy();
}

/** Validates streaming produced delta chunks and a done chunk */
export function assertStreamResponse(
  chunks: LLMStreamChunkType[],
  result: AdapterResponse,
  expectedProvider: string
) {
  const deltas = chunks.filter((c) => c.type === 'delta');
  const done = chunks.filter((c) => c.type === 'done');

  expect(deltas.length).toBeGreaterThan(0);
  expect(done.length).toBe(1);

  // Aggregated text should match concatenated deltas
  const streamedText = deltas.map((c) => c.delta ?? '').join('');
  expect(result.message.content).toBe(streamedText);
  expect(result.provider).toBe(expectedProvider);
}

/** Validates streaming with tool use emits tool_call chunks */
export function assertStreamToolResponse(
  chunks: LLMStreamChunkType[],
  result: AdapterResponse
) {
  const toolChunks = chunks.filter((c) => c.type === 'tool_call');
  const doneChunks = chunks.filter((c) => c.type === 'done');

  expect(toolChunks.length).toBeGreaterThanOrEqual(1);
  expect(doneChunks.length).toBe(1);
  expect(result.toolCalls).toBeDefined();
  expect(result.toolCalls!.length).toBeGreaterThanOrEqual(1);
}

// ── Provider config ───────────────────────────────────────────

export interface ProviderTestConfig {
  name: string;
  /** Factory to create the adapter under test */
  createAdapter: () => LLMProviderAdapter;
  /** The provider name returned in responses (e.g. 'openai', 'anthropic') */
  expectedProvider: string;
  /** Model ID to use */
  model: string;
  /** Whether the provider supports streaming */
  supportsStreaming: boolean;
  /** Optional API key resolver for integration tests */
  getApiKey?: () => string | null;
  /** Optional profile-based options builder */
  makeSendOptions?: (overrides?: { temperature?: number; maxTokens?: number }) => AdapterSendOptions;
  makeStreamOptions?: (overrides?: { temperature?: number; maxTokens?: number }) => AdapterStreamOptions;
}

/** Build standard send options from a provider config */
export function defaultSendOptions(
  config: ProviderTestConfig,
  overrides: { temperature?: number; maxTokens?: number } = {}
): AdapterSendOptions {
  if (config.makeSendOptions) return config.makeSendOptions(overrides);
  const apiKey = config.getApiKey?.();
  return {
    model: config.model,
    temperature: overrides.temperature,
    maxTokens: overrides.maxTokens ?? 256,
    ...(apiKey
      ? {
          getProfileList: () => ['test'],
          getProfileApiKey: (name: string) => (name === 'test' ? apiKey : null),
        }
      : {}),
  };
}

/** Build standard stream options from a provider config */
export function defaultStreamOptions(
  config: ProviderTestConfig,
  overrides: { temperature?: number; maxTokens?: number } = {}
): AdapterStreamOptions {
  if (config.makeStreamOptions) return config.makeStreamOptions(overrides);
  return {
    ...defaultSendOptions(config, overrides),
    sessionId: `test-session-${Date.now()}`,
  };
}
