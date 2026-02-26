import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBedrockAdapter } from './bedrock.js';
import { ProviderError } from './types.js';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// Mock the AWS SDK
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    InvokeModelCommand: vi.fn().mockImplementation((params) => params),
    InvokeModelWithResponseStreamCommand: vi.fn().mockImplementation((params) => params),
  };
});

describe('BedrockAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
  });

  describe('createBedrockAdapter', () => {
    it('should create adapter with correct name and type', () => {
      const adapter = createBedrockAdapter();
      expect(adapter.name).toBe('bedrock');
      expect(adapter.type).toBe('custom');
    });

    it('should accept region parameter', () => {
      // Verify it doesn't throw - actual region config tested via integration
      expect(() => createBedrockAdapter('eu-west-1')).not.toThrow();
    });

    it('should accept custom AWS credentials', () => {
      // Verify it doesn't throw - actual auth tested via integration
      expect(() => createBedrockAdapter('us-west-2', {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      })).not.toThrow();
    });
  });

  describe('send - message transformation', () => {
    it('should correctly transform simple text responses', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello there!' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      });

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Hello there!');
      expect(response.provider).toBe('bedrock');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(5);
      expect(response.usage?.totalTokens).toBe(15);
    });

    it('should handle multiple text blocks by concatenating', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'text', text: 'First part. ' },
            { type: 'text', text: 'Second part.' },
          ],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 8 },
        })),
      });

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      expect(response.message.content).toBe('First part. Second part.');
    });

    it('should correctly separate system messages from user messages', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 10 },
        })),
      });

      await adapter.send(
        {
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hi' },
          ],
        },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      // Verify the command was called with system separated
      const commandCall = mockSend.mock.calls[0][0];
      const bodyJson = JSON.parse(commandCall.body);
      
      expect(bodyJson.system).toBe('You are helpful');
      expect(bodyJson.messages).toHaveLength(1);
      expect(bodyJson.messages[0].role).toBe('user');
    });
  });

  describe('send - tool calling', () => {
    it('should transform tool use blocks into toolCalls array', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check that.' },
            { 
              type: 'tool_use', 
              id: 'tool_abc', 
              name: 'get_weather', 
              input: { city: 'San Francisco', units: 'celsius' } 
            },
          ],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'tool_use',
          usage: { input_tokens: 30, output_tokens: 15 },
        })),
      });

      const response = await adapter.send(
        {
          messages: [{ role: 'user', content: 'Weather in SF?' }],
          tools: [{
            name: 'get_weather',
            description: 'Get weather',
            input_schema: {
              type: 'object',
              properties: { 
                city: { type: 'string' },
                units: { type: 'string' }
              },
              required: ['city'],
            },
          }],
        },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].id).toBe('tool_abc');
      expect(response.toolCalls![0].name).toBe('get_weather');
      
      const args = JSON.parse(response.toolCalls![0].arguments);
      expect(args.city).toBe('San Francisco');
      expect(args.units).toBe('celsius');
      expect(response.finishReason).toBe('tool_use');
    });

    it('should handle multiple tool calls in single response', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'get_weather', input: { city: 'SF' } },
            { type: 'tool_use', id: 'tool_2', name: 'get_time', input: { timezone: 'PST' } },
          ],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'tool_use',
          usage: { input_tokens: 30, output_tokens: 20 },
        })),
      });

      const response = await adapter.send(
        {
          messages: [{ role: 'user', content: 'Weather and time in SF?' }],
          tools: [
            { name: 'get_weather', description: 'Weather', input_schema: { type: 'object', properties: {}, required: [] } },
            { name: 'get_time', description: 'Time', input_schema: { type: 'object', properties: {}, required: [] } },
          ],
        },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![1].name).toBe('get_time');
    });

    it('should convert Nachos tool schema to Bedrock format', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Ok' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 5 },
        })),
      });

      await adapter.send(
        {
          messages: [{ role: 'user', content: 'Test' }],
          tools: [{
            name: 'search',
            description: 'Search the web',
            parameters: {  // Nachos uses 'parameters'
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'number' },
              },
              required: ['query'],
            },
          }],
        },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      // Verify transformation to Bedrock's input_schema
      const commandCall = mockSend.mock.calls[0][0];
      const bodyJson = JSON.parse(commandCall.body);
      
      expect(bodyJson.tools).toHaveLength(1);
      expect(bodyJson.tools[0].input_schema).toBeDefined(); // Bedrock uses input_schema
      expect(bodyJson.tools[0].input_schema.properties.query).toBeDefined();
    });
  });

  describe('send - error handling', () => {
    it('should throw ProviderError with rate_limit kind for ThrottlingException', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockRejectedValue({
        name: 'ThrottlingException',
        message: 'Rate limit exceeded',
        $metadata: { httpStatusCode: 429 },
      });

      await expect(
        adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
        )
      ).rejects.toThrow(ProviderError);

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });

    it('should throw ProviderError with invalid_request kind for ValidationException', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockRejectedValue({
        name: 'ValidationException',
        message: 'Invalid model ID',
        $metadata: { httpStatusCode: 400 },
      });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'invalid-model' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('invalid_request');
      }
    });

    it('should throw ProviderError with auth kind for AccessDeniedException', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockRejectedValue({
        name: 'AccessDeniedException',
        message: 'User not authorized',
        $metadata: { httpStatusCode: 403 },
      });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
        expect((error as ProviderError).message).toBe('Authentication failed');
      }
    });

    it('should throw ProviderError with limit_reached kind for ServiceQuotaExceededException', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockRejectedValue({
        name: 'ServiceQuotaExceededException',
        message: 'Service quota exceeded',
      });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('limit_reached');
      }
    });

    it('should throw generic ProviderError for unknown errors', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockRejectedValue(new Error('Network timeout'));

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('unknown');
        expect((error as ProviderError).message).toContain('Network timeout');
      }
    });
  });

  describe('send - request formatting', () => {
    it('should include temperature when specified', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      });

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { 
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          temperature: 0.7,
        }
      );

      const commandCall = mockSend.mock.calls[0][0];
      const bodyJson = JSON.parse(commandCall.body);
      
      expect(bodyJson.temperature).toBe(0.7);
    });

    it('should use maxTokens from options', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      });

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { 
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          maxTokens: 2000,
        }
      );

      const commandCall = mockSend.mock.calls[0][0];
      const bodyJson = JSON.parse(commandCall.body);
      
      expect(bodyJson.max_tokens).toBe(2000);
    });

    it('should default to 4096 max_tokens if not specified', async () => {
      const adapter = createBedrockAdapter();
      
      mockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Response' }],
          model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        })),
      });

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'anthropic.claude-3-5-sonnet-20241022-v2:0' }
      );

      const commandCall = mockSend.mock.calls[0][0];
      const bodyJson = JSON.parse(commandCall.body);
      
      expect(bodyJson.max_tokens).toBe(4096);
    });
  });
});
