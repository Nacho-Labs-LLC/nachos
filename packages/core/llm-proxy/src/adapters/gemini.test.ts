import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiAdapter } from './gemini.js';
import { ProviderError } from './types.js';

// Use vi.hoisted to create mocks before vi.mock factory runs
const { mockGenerateContent, mockGenerateContentStream } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGenerateContentStream: vi.fn(),
}));

// Mock the Gemini SDK
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
      }),
    })),
    GoogleGenerativeAIFetchError: class GoogleGenerativeAIFetchError extends Error {
      status?: number;
      statusText?: string;
      constructor(message: string, status?: number, statusText?: string) {
        super(message);
        this.status = status;
        this.statusText = statusText;
      }
    },
    SchemaType: {
      STRING: 'string',
      NUMBER: 'number',
      INTEGER: 'integer',
      BOOLEAN: 'boolean',
      ARRAY: 'array',
      OBJECT: 'object',
    },
  };
});

function makeResponse(opts: {
  text?: string;
  functionCalls?: Array<{ name: string; args: object }>;
  finishReason?: string;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}) {
  return {
    response: {
      text: () => opts.text ?? '',
      functionCalls: () => opts.functionCalls ?? undefined,
      candidates: opts.finishReason
        ? [{ finishReason: opts.finishReason }]
        : [{ finishReason: 'STOP' }],
      usageMetadata: opts.usageMetadata ?? undefined,
    },
  };
}

describe('GeminiAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  describe('constructor', () => {
    it('should create adapter with correct name and type', () => {
      const adapter = new GeminiAdapter();
      expect(adapter.name).toBe('gemini');
      expect(adapter.type).toBe('custom');
    });

    it('should accept defaultApiKey', () => {
      expect(() => new GeminiAdapter('custom-key')).not.toThrow();
    });
  });

  describe('send - basic chat', () => {
    it('should correctly transform simple text responses', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(
        makeResponse({
          text: 'Hello there!',
          finishReason: 'STOP',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        })
      );

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(response.message.role).toBe('assistant');
      expect(response.message.content).toBe('Hello there!');
      expect(response.provider).toBe('gemini');
      expect(response.usage?.promptTokens).toBe(10);
      expect(response.usage?.completionTokens).toBe(5);
      expect(response.usage?.totalTokens).toBe(15);
      expect(response.finishReason).toBe('stop');
    });

    it('should handle empty text response', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(
        makeResponse({ text: '' })
      );

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(response.message.content).toBe('');
    });

    it('should handle response without usage metadata', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(
        makeResponse({ text: 'Hello' })
      );

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(response.usage).toBeUndefined();
    });
  });

  describe('send - tool calling', () => {
    it('should transform function calls from Gemini format', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(
        makeResponse({
          text: '',
          functionCalls: [
            { name: 'get_weather', args: { city: 'San Francisco', units: 'celsius' } },
          ],
          finishReason: 'STOP',
          usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 15, totalTokenCount: 45 },
        })
      );

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
        { model: 'gemini-1.5-flash' }
      );

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');

      const args = JSON.parse(response.toolCalls![0].arguments);
      expect(args.city).toBe('San Francisco');
      expect(args.units).toBe('celsius');
    });

    it('should handle multiple function calls', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(
        makeResponse({
          text: '',
          functionCalls: [
            { name: 'get_weather', args: { city: 'SF' } },
            { name: 'get_time', args: { timezone: 'PST' } },
          ],
        })
      );

      const response = await adapter.send(
        {
          messages: [{ role: 'user', content: 'Weather and time in SF?' }],
          tools: [
            { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: {}, required: [] } },
            { name: 'get_time', description: 'Time', parameters: { type: 'object', properties: {}, required: [] } },
          ],
        },
        { model: 'gemini-1.5-flash' }
      );

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls![0].name).toBe('get_weather');
      expect(response.toolCalls![1].name).toBe('get_time');
    });

    it('should return undefined toolCalls when no function calls in response', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(
        makeResponse({ text: 'No tools needed' })
      );

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(response.toolCalls).toBeUndefined();
    });
  });

  describe('send - error handling', () => {
    it('should throw ProviderError with rate_limit kind for 429', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockRejectedValue({ status: 429, message: 'Rate limit exceeded' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('rate_limit');
      }
    });

    it('should throw ProviderError with auth kind for 401', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockRejectedValue({ status: 401, message: 'Invalid API key' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
      }
    });

    it('should throw ProviderError with auth kind for 403', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockRejectedValue({ status: 403, message: 'Forbidden' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
      }
    });

    it('should throw ProviderError with billing kind for 402', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockRejectedValue({ status: 402, message: 'Payment required' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('billing');
      }
    });

    it('should throw ProviderError with limit_reached kind for 500+', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockRejectedValue({ status: 500, message: 'Internal server error' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('limit_reached');
      }
    });

    it('should throw generic ProviderError for unknown errors', async () => {
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockRejectedValue(new Error('Network timeout'));

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('unknown');
      }
    });

    it('should call onProfileCooldown for rate_limit with profile', async () => {
      const adapter = new GeminiAdapter();
      const onProfileCooldown = vi.fn();

      mockGenerateContent.mockRejectedValue({ status: 429, message: 'Rate limited' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          {
            model: 'gemini-1.5-flash',
            onProfileCooldown,
            getProfileList: () => ['profile-1'],
            getProfileApiKey: () => 'gemini-prof-key',
          }
        );
      } catch {
        // expected
      }

      expect(onProfileCooldown).toHaveBeenCalledWith('profile-1', 'rate_limit');
    });

    it('should call onProfileCooldown for billing with profile', async () => {
      const adapter = new GeminiAdapter();
      const onProfileCooldown = vi.fn();

      mockGenerateContent.mockRejectedValue({ status: 402, message: 'Payment required' });

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          {
            model: 'gemini-1.5-flash',
            onProfileCooldown,
            getProfileList: () => ['billing-profile'],
            getProfileApiKey: () => 'gemini-billing-key',
          }
        );
      } catch {
        // expected
      }

      expect(onProfileCooldown).toHaveBeenCalledWith('billing-profile', 'billing');
    });
  });

  describe('send - finish reason mapping', () => {
    it('should map STOP to stop', async () => {
      const adapter = new GeminiAdapter();
      mockGenerateContent.mockResolvedValue(makeResponse({ text: 'Hi', finishReason: 'STOP' }));

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );
      expect(response.finishReason).toBe('stop');
    });

    it('should map MAX_TOKENS to length', async () => {
      const adapter = new GeminiAdapter();
      mockGenerateContent.mockResolvedValue(makeResponse({ text: 'Hi', finishReason: 'MAX_TOKENS' }));

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );
      expect(response.finishReason).toBe('length');
    });

    it('should map SAFETY to content_filter', async () => {
      const adapter = new GeminiAdapter();
      mockGenerateContent.mockResolvedValue(makeResponse({ text: '', finishReason: 'SAFETY' }));

      const response = await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );
      expect(response.finishReason).toBe('content_filter');
    });
  });

  describe('stream', () => {
    it('should stream text chunks and return aggregated response', async () => {
      const adapter = new GeminiAdapter();
      const chunks = [
        { text: () => 'Hello', functionCalls: () => undefined },
        { text: () => ' world', functionCalls: () => undefined },
      ];

      mockGenerateContentStream.mockResolvedValue({
        stream: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
        response: Promise.resolve({
          text: () => 'Hello world',
          functionCalls: () => undefined,
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
        }),
      });

      const receivedChunks: Array<{ type: string; delta?: string }> = [];
      const response = await adapter.stream(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash', sessionId: 'test-session' },
        async (chunk) => {
          receivedChunks.push({ type: chunk.type, delta: 'delta' in chunk ? (chunk as { delta: string }).delta : undefined });
        }
      );

      expect(response.message.content).toBe('Hello world');
      expect(response.provider).toBe('gemini');
      expect(response.usage?.promptTokens).toBe(5);
      expect(response.usage?.completionTokens).toBe(3);

      // Should have 2 delta chunks + 1 done chunk
      expect(receivedChunks).toHaveLength(3);
      expect(receivedChunks[0]).toEqual({ type: 'delta', delta: 'Hello' });
      expect(receivedChunks[1]).toEqual({ type: 'delta', delta: ' world' });
      expect(receivedChunks[2]).toEqual({ type: 'done', delta: undefined });
    });

    it('should stream tool calls', async () => {
      const adapter = new GeminiAdapter();
      const chunks = [
        {
          text: () => '',
          functionCalls: () => [{ name: 'get_weather', args: { city: 'SF' } }],
        },
      ];

      mockGenerateContentStream.mockResolvedValue({
        stream: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
        response: Promise.resolve({
          text: () => '',
          functionCalls: () => [{ name: 'get_weather', args: { city: 'SF' } }],
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: undefined,
        }),
      });

      const receivedChunks: Array<{ type: string }> = [];
      const response = await adapter.stream(
        { messages: [{ role: 'user', content: 'Weather?' }] },
        { model: 'gemini-1.5-flash', sessionId: 'test-session' },
        async (chunk) => {
          receivedChunks.push({ type: chunk.type });
        }
      );

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('get_weather');
      // tool_call chunk + done chunk
      expect(receivedChunks.some((c) => c.type === 'tool_call')).toBe(true);
      expect(receivedChunks.some((c) => c.type === 'done')).toBe(true);
    });
  });

  describe('API key resolution', () => {
    it('should use profile API key when available', async () => {
      delete process.env.GEMINI_API_KEY;
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(makeResponse({ text: 'Ok' }));

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        {
          model: 'gemini-1.5-flash',
          getProfileList: () => ['my-profile'],
          getProfileApiKey: (name: string) => (name === 'my-profile' ? 'gemini-profile-key' : null),
        }
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should use defaultApiKey when no profile and no env var', async () => {
      delete process.env.GEMINI_API_KEY;
      const adapter = new GeminiAdapter('default-gemini-key');

      mockGenerateContent.mockResolvedValue(makeResponse({ text: 'Ok' }));

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should use GEMINI_API_KEY env var as fallback', async () => {
      process.env.GEMINI_API_KEY = 'env-gemini-key';
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(makeResponse({ text: 'Ok' }));

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should use GOOGLE_API_KEY env var as fallback', async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = 'google-api-key';
      const adapter = new GeminiAdapter();

      mockGenerateContent.mockResolvedValue(makeResponse({ text: 'Ok' }));

      await adapter.send(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { model: 'gemini-1.5-flash' }
      );

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should throw ProviderError with auth kind when no API key available', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const adapter = new GeminiAdapter();

      await expect(
        adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        )
      ).rejects.toThrow(ProviderError);

      try {
        await adapter.send(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { model: 'gemini-1.5-flash' }
        );
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as ProviderError).kind).toBe('auth');
      }
    });
  });
});
