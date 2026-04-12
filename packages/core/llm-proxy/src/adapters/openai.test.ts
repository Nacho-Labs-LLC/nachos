import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAdapter } from './openai.js';
import { ProviderError } from './types.js';

// Use vi.hoisted to create mock before vi.mock factory runs
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

describe('OpenAIAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('constructor', () => {
    it('should create adapter with correct name and type', () => {
      const adapter = new OpenAIAdapter();
      expect(adapter.name).toBe('openai');
      expect(adapter.type).toBe('openai');
    });

    it('should accept baseUrl and defaultApiKey', () => {
      expect(() => new OpenAIAdapter('https://custom.api.com', 'sk-custom')).not.toThrow();
    });
  });

  describe('send - message transformation', () => {
    it('should correctly transform simple text responses', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'Hello there!' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gpt-4o' }
      );

      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Hello there!');
      expect(response.provider).toBe('openai');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(5);
      expect(response.usage?.totalTokens).toBe(15);
    });

    it('should handle null content as empty string', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: null },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gpt-4o' }
      );

      expect(response.message.content).toBe('');
    });

    it('should pass system messages through as-is (OpenAI supports system role)', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      await adapter.send(
        {
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hi' },
          ],
        },
        { model: 'gpt-4o' }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0].role).toBe('system');
      expect(callArgs.messages[0].content).toBe('You are helpful');
    });
  });

  describe('send - tool calling', () => {
    it('should transform tool calls from OpenAI format', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"San Francisco","units":"celsius"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
      });

      const response = await adapter.send(
        {
          messages: [{ role: 'user', content: 'Weather in SF?' }],
          tools: [
            {
              name: 'get_weather',
              description: 'Get weather',
              parameters: {
                type: 'object',
                properties: {
                  city: { type: 'string' },
                  units: { type: 'string' },
                },
                required: ['city'],
              },
            },
          ],
        },
        { model: 'gpt-4o' }
      );

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].id).toBe('call_abc');
      expect(response.toolCalls![0].name).toBe('get_weather');

      const args = JSON.parse(response.toolCalls![0].arguments);
      expect(args.city).toBe('San Francisco');
      expect(args.units).toBe('celsius');
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should handle multiple tool calls in single response', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"SF"}' },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'get_time', arguments: '{"timezone":"PST"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
      });

      const response = await adapter.send(
        {
          messages: [{ role: 'user', content: 'Weather and time in SF?' }],
          tools: [
            {
              name: 'get_weather',
              description: 'Weather',
              parameters: { type: 'object', properties: {}, required: [] },
            },
            {
              name: 'get_time',
              description: 'Time',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
        },
        { model: 'gpt-4o' }
      );

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![1].name).toBe('get_time');
    });

    it('should convert Nachos tool schema to OpenAI function format', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'Ok' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
      });

      await adapter.send(
        {
          messages: [{ role: 'user', content: 'Test' }],
          tools: [
            {
              name: 'search',
              description: 'Search the web',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' },
                  limit: { type: 'number' },
                },
                required: ['query'],
              },
            },
          ],
        },
        { model: 'gpt-4o' }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].type).toBe('function');
      expect(callArgs.tools[0].function.name).toBe('search');
      expect(callArgs.tools[0].function.parameters.properties.query).toBeDefined();
    });
  });

  describe('send - error handling', () => {
    it('should throw ProviderError with rate_limit kind for 429', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockRejectedValue({ status: 429, message: 'Rate limit exceeded' });

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });

    it('should throw ProviderError with auth kind for 401', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockRejectedValue({ status: 401, message: 'Invalid API key' });

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
      }
    });

    it('should throw ProviderError with auth kind for 403', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockRejectedValue({ status: 403, message: 'Forbidden' });

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
        expect((error as ProviderError).message).toBe('Authentication failed');
      }
    });

    it('should throw ProviderError with billing kind for 402', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockRejectedValue({ status: 402, message: 'Payment required' });

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('billing');
      }
    });

    it('should throw ProviderError with limit_reached kind for 500+', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockRejectedValue({ status: 500, message: 'Internal server error' });

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('limit_reached');
      }
    });

    it('should throw generic ProviderError for unknown errors', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockRejectedValue(new Error('Network timeout'));

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('unknown');
      }
    });

    it('should call onProfileCooldown for rate_limit with profile', async () => {
      const adapter = new OpenAIAdapter();
      const onProfileCooldown = vi.fn();

      mockCreate.mockRejectedValue({ status: 429, message: 'Rate limited' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          {
            model: 'gpt-4o',
            onProfileCooldown,
            getProfileList: () => ['profile-1'],
            getProfileApiKey: () => 'sk-prof-key',
          }
        );
      } catch {
        // expected
      }

      expect(onProfileCooldown).toHaveBeenCalledWith('profile-1', 'rate_limit');
    });

    it('should call onProfileCooldown for billing with profile', async () => {
      const adapter = new OpenAIAdapter();
      const onProfileCooldown = vi.fn();

      mockCreate.mockRejectedValue({ status: 402, message: 'Payment required' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          {
            model: 'gpt-4o',
            onProfileCooldown,
            getProfileList: () => ['billing-profile'],
            getProfileApiKey: () => 'sk-billing-key',
          }
        );
      } catch {
        // expected
      }

      expect(onProfileCooldown).toHaveBeenCalledWith('billing-profile', 'billing');
    });
  });

  describe('send - request formatting', () => {
    it('should include temperature when specified', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gpt-4o', temperature: 0.7 }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
    });

    it('should use maxTokens from options as max_completion_tokens', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gpt-4o', maxTokens: 2000 }
      );

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.max_completion_tokens).toBe(2000);
    });

    it('should set stream to false for send', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream).toBe(false);
    });
  });

  describe('API key resolution', () => {
    it('should use profile API key when available', async () => {
      delete process.env.OPENAI_API_KEY;
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Ok' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          model: 'gpt-4o',
          getProfileList: () => ['my-profile'],
          getProfileApiKey: (name: string) => (name === 'my-profile' ? 'sk-profile-key' : null),
        }
      );

      // Should not throw - profile key was used
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should use defaultApiKey when no profile and no env var', async () => {
      delete process.env.OPENAI_API_KEY;
      const adapter = new OpenAIAdapter(undefined, 'sk-default');

      mockCreate.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Ok' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should use OPENAI_API_KEY env var as fallback', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Ok' }, finish_reason: 'stop' }],
        model: 'gpt-4o',
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should throw ProviderError with auth kind when no API key available', async () => {
      delete process.env.OPENAI_API_KEY;
      const adapter = new OpenAIAdapter();

      await expect(
        adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' })
      ).rejects.toThrow(ProviderError);

      try {
        await adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
      }
    });
  });

  describe('send - no choices', () => {
    it('should throw ProviderError when no choices returned', async () => {
      const adapter = new OpenAIAdapter();

      mockCreate.mockResolvedValue({
        choices: [],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      await expect(
        adapter.send({ messages: [{ role: 'user', content: 'Hi' }] }, { model: 'gpt-4o' })
      ).rejects.toThrow(ProviderError);
    });
  });
});
