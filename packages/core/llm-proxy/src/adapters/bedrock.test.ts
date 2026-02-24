import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBedrockAdapter } from './bedrock.js';
import { ProviderError } from './types.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
    InvokeModelCommand: vi.fn(),
    InvokeModelWithResponseStreamCommand: vi.fn(),
  };
});

describe('BedrockAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBedrockAdapter', () => {
    it('should create a bedrock adapter with default region', () => {
      const adapter = createBedrockAdapter();
      expect(adapter.name).toBe('bedrock');
      expect(adapter.type).toBe('custom');
    });

    it('should create a bedrock adapter with custom region', () => {
      const adapter = createBedrockAdapter('eu-west-1');
      expect(adapter.name).toBe('bedrock');
    });

    it('should create a bedrock adapter with custom credentials', () => {
      const adapter = createBedrockAdapter('us-west-2', {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      });
      expect(adapter.name).toBe('bedrock');
    });
  });

  describe('send', () => {
    it('should send a request and return a response', async () => {
      const adapter = createBedrockAdapter();
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      };

      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      const mockSend = vi.fn().mockResolvedValue(mockResponse);
      (BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      const request = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
      };

      const response = await adapter.send(request, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      });

      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Hello!');
      expect(response.provider).toBe('bedrock');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(5);
    });

    it('should handle system prompts', async () => {
      const adapter = createBedrockAdapter();
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 10 },
        })),
      };

      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      const mockSend = vi.fn().mockResolvedValue(mockResponse);
      (BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      const request = {
        messages: [
          { role: 'system' as const, content: 'You are a helpful assistant' },
          { role: 'user' as const, content: 'Hi' },
        ],
      };

      const response = await adapter.send(request, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      });

      expect(response.message.content).toBe('Response');
    });

    it('should handle tool calls', async () => {
      const adapter = createBedrockAdapter();
      const mockResponse = {
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check that.' },
            { type: 'tool_use', id: 'tool_123', name: 'get_weather', input: { city: 'SF' } },
          ],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'tool_use',
          usage: { input_tokens: 30, output_tokens: 15 },
        })),
      };

      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      const mockSend = vi.fn().mockResolvedValue(mockResponse);
      (BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      const request = {
        messages: [{ role: 'user' as const, content: 'What is the weather in SF?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: {
              type: 'object' as const,
              properties: { city: { type: 'string' as const } },
              required: ['city'],
            },
          },
        ],
      };

      const response = await adapter.send(request, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      });

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe('get_weather');
      expect(response.toolCalls?.[0].id).toBe('tool_123');
    });

    it('should handle rate limit errors', async () => {
      const adapter = createBedrockAdapter();
      
      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      const mockSend = vi.fn().mockRejectedValue({
        name: 'ThrottlingException',
        message: 'Rate limit exceeded',
      });
      (BedrockRuntimeClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        send: mockSend,
      }));

      const request = {
        messages: [{ role: 'user' as const, content: 'Hi' }],
      };

      await expect(adapter.send(request, {
        model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      })).rejects.toThrow(ProviderError);

      try {
        await adapter.send(request, {
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        });
      } catch (error) {
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });
  });
});
