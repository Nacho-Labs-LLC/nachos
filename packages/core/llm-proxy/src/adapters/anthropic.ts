import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages';
import type { LLMRequestType, LLMMessageType } from '@nachos/types';
import { createLogger } from '@nachos/types';
import {
  ProviderError,
  type AdapterResponse,
  type AdapterSendOptions,
  type AdapterStreamOptions,
  type StreamChunkHandler,
} from './types.js';

function extractSystemPrompt(messages: LLMRequestType['messages']): string | undefined {
  const systemMessages = messages.filter(
    (message: LLMRequestType['messages'][number]) => message.role === 'system'
  );
  if (systemMessages.length === 0) return undefined;
  return systemMessages
    .map((message: LLMRequestType['messages'][number]) =>
      typeof message.content === 'string' ? message.content : ''
    )
    .filter(Boolean)
    .join('\n\n');
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  tool_result?: unknown;
  content?: unknown;
  is_error?: boolean;
}

function toAnthropicMessages(
  messages: LLMRequestType['messages']
): MessageCreateParams['messages'] {
  return messages
    .filter((message: LLMRequestType['messages'][number]) => message.role !== 'system')
    .map((message: LLMRequestType['messages'][number]) => {
      // Handle tool result messages: convert to Anthropic's expected format
      if (message.role === 'tool') {
        const contentArray = Array.isArray(message.content) ? message.content : [];
        const toolResultBlocks = contentArray
          .filter(
            (block: unknown): block is ToolResultBlock =>
              typeof block === 'object' &&
              block !== null &&
              (block as ToolResultBlock).type === 'tool_result'
          )
          .map((block: ToolResultBlock) => {
            // Anthropic expects { type: 'tool_result', tool_use_id, content }
            // Gateway sends { type: 'tool_result', tool_use_id, tool_result }
            const resultContent = block.tool_result ?? block.content ?? '';
            const contentStr =
              typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: contentStr,
              ...(block.is_error ? { is_error: true } : {}),
            };
          });

        if (toolResultBlocks.length > 0) {
          return {
            role: 'user' as const,
            content: toolResultBlocks,
          };
        }

        // Fallback: if content has tool_call_id at message level (OpenAI style)
        const toolCallId = (message as Record<string, unknown>).tool_call_id as string | undefined;
        if (toolCallId) {
          const contentStr =
            typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          return {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: toolCallId,
                content: contentStr,
              },
            ],
          };
        }
      }

      // Handle assistant messages with tool_use content blocks (pass through structured)
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const hasToolUse = (message.content as Array<{ type?: string }>).some(
          (block) => block && typeof block === 'object' && block.type === 'tool_use'
        );
        if (hasToolUse) {
          return {
            role: 'assistant' as const,
            content:
              message.content as unknown as MessageCreateParams['messages'][number]['content'],
          };
        }
      }

      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

      return {
        role: message.role === 'tool' ? 'user' : (message.role as 'user' | 'assistant'),
        content,
      };
    });
}

function toAnthropicTools(tools: LLMRequestType['tools']): MessageCreateParams['tools'] {
  if (!tools) return undefined;
  return tools.map((tool: NonNullable<LLMRequestType['tools']>[number]) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      ...(tool.parameters as Record<string, unknown>),
    },
  }));
}

type ToolCall = { id: string; name: string; arguments: string };

interface AnthropicContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

function mapToolCalls(content: AnthropicContentBlock[] | undefined): ToolCall[] | undefined {
  if (!content) return undefined;
  const calls = content.filter(
    (part): part is AnthropicContentBlock & { type: 'tool_use' } => part.type === 'tool_use'
  );
  if (calls.length === 0) return undefined;
  return calls.map((call) => ({
    id: call.id ?? '',
    name: call.name ?? 'unknown',
    arguments: JSON.stringify(call.input ?? {}),
  }));
}

function extractText(content: AnthropicContentBlock[] | undefined): string {
  if (!content) return '';
  return content
    .filter(
      (part): part is AnthropicContentBlock & { text: string } =>
        part.type === 'text' && Boolean(part.text)
    )
    .map((part) => part.text)
    .join('');
}

const logger = createLogger('anthropic-adapter');

const DEFAULT_TIMEOUT_MS = 120_000;

/** Detect OAuth / setup tokens (sk-ant-oat-*) */
function isOAuthToken(key: string): boolean {
  return key.startsWith('sk-ant-oat');
}

/** Claude Code identity headers required for OAuth token auth */
const OAUTH_HEADERS: Record<string, string> = {
  'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
  'user-agent': 'claude-cli/2.1.2 (external, cli)',
  'x-app': 'cli',
};

export class AnthropicAdapter {
  public readonly name = 'anthropic';
  public readonly type = 'anthropic' as const;
  private clientCache = new Map<string, Anthropic>();

  constructor(
    private readonly baseUrl?: string,
    private readonly defaultApiKey?: string
  ) {}

  private getClient(apiKey: string): Anthropic {
    let client = this.clientCache.get(apiKey);
    if (!client) {
      if (this.clientCache.size >= 10) {
        const firstKey = this.clientCache.keys().next().value as string;
        this.clientCache.delete(firstKey);
      }

      if (isOAuthToken(apiKey)) {
        // OAuth token: use Bearer auth + Claude Code identity headers
        // Must set apiKey to null so SDK uses authToken for Bearer auth
        client = new Anthropic({
          apiKey: null,
          authToken: apiKey,
          baseURL: this.baseUrl,
          defaultHeaders: OAUTH_HEADERS,
        });
      } else {
        client = new Anthropic({ apiKey, baseURL: this.baseUrl });
      }

      this.clientCache.set(apiKey, client);
    }
    return client;
  }

  async send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse> {
    const { apiKey, profileName } = this.resolveApiKey(options);
    logger.debug(
      {
        keyType: isOAuthToken(apiKey) ? 'oauth' : 'api',
        keyPrefix: apiKey.slice(0, 7) + '...',
        model: options.model,
      },
      'send()'
    );
    try {
      const client = this.getClient(apiKey);
      const response = await client.messages.create(
        {
          model: options.model,
          system: extractSystemPrompt(request.messages),
          messages: toAnthropicMessages(request.messages),
          tools: toAnthropicTools(request.tools),
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature,
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS }
      );

      const contentBlocks = response.content as unknown as AnthropicContentBlock[];

      const message: LLMMessageType = {
        role: 'assistant',
        content: extractText(contentBlocks),
      };

      return {
        message,
        toolCalls: mapToolCalls(contentBlocks),
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            }
          : undefined,
        provider: this.name,
        model: response.model ?? options.model,
        finishReason: response.stop_reason ?? undefined,
      };
    } catch (error) {
      const mapped = this.mapError(error);
      if (profileName && (mapped.kind === 'rate_limit' || mapped.kind === 'billing')) {
        options.onProfileCooldown?.(
          profileName,
          mapped.kind === 'billing' ? 'billing' : 'rate_limit'
        );
      }
      throw mapped;
    }
  }

  async stream(
    request: LLMRequestType,
    options: AdapterStreamOptions,
    onChunk: StreamChunkHandler
  ): Promise<AdapterResponse> {
    const { apiKey, profileName } = this.resolveApiKey(options);
    try {
      const client = this.getClient(apiKey);
      const stream = client.messages.stream(
        {
          model: options.model,
          system: extractSystemPrompt(request.messages),
          messages: toAnthropicMessages(request.messages),
          tools: toAnthropicTools(request.tools),
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature,
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS }
      );

      let index = 0;
      let aggregatedText = '';

      stream.on('text', (text) => {
        aggregatedText += text;
        void onChunk({
          sessionId: options.sessionId,
          index: index++,
          type: 'delta',
          delta: text,
          provider: this.name,
          model: options.model,
        });
      });

      const finalMessage = await stream.finalMessage();

      const contentBlocks = finalMessage.content as unknown as AnthropicContentBlock[];
      const toolCalls = mapToolCalls(contentBlocks);

      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await onChunk({
            sessionId: options.sessionId,
            index: index++,
            type: 'tool_call',
            toolCall,
            provider: this.name,
            model: options.model,
          });
        }
      }

      const usage = finalMessage.usage
        ? {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
            totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
          }
        : undefined;

      await onChunk({
        sessionId: options.sessionId,
        index: index++,
        type: 'done',
        provider: this.name,
        model: finalMessage.model ?? options.model,
      });

      return {
        message: { role: 'assistant', content: aggregatedText },
        toolCalls,
        usage,
        provider: this.name,
        model: finalMessage.model ?? options.model,
        finishReason: finalMessage.stop_reason ?? undefined,
      };
    } catch (error) {
      const mapped = this.mapError(error);
      if (profileName && (mapped.kind === 'rate_limit' || mapped.kind === 'billing')) {
        options.onProfileCooldown?.(
          profileName,
          mapped.kind === 'billing' ? 'billing' : 'rate_limit'
        );
      }
      throw mapped;
    }
  }

  private mapError(error: unknown): ProviderError {
    logger.error({ err: error }, 'Raw error');
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status?: number }).status ?? 0;
      if (status === 401 || status === 403) {
        return new ProviderError('Authentication failed', 'auth');
      }
      if (status === 402) {
        return new ProviderError('Billing issue', 'billing');
      }
      if (status === 429) {
        return new ProviderError('Rate limit exceeded', 'rate_limit');
      }
      if (status >= 500) {
        return new ProviderError('Provider unavailable', 'limit_reached');
      }
    }

    return new ProviderError('Anthropic provider error', 'unknown');
  }

  private resolveApiKey(options: AdapterSendOptions): { apiKey: string; profileName?: string } {
    const profileList = options.getProfileList?.() ?? [];
    for (const profileName of profileList) {
      const key = options.getProfileApiKey?.(profileName);
      if (key) {
        return { apiKey: key, profileName };
      }
    }

    if (this.defaultApiKey) {
      return { apiKey: this.defaultApiKey };
    }

    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      return { apiKey: envKey };
    }

    const setupToken = process.env.ANTHROPIC_SETUP_TOKEN || process.env.CLAUDE_SETUP_TOKEN;
    if (setupToken) {
      return { apiKey: setupToken };
    }

    throw new ProviderError('Anthropic API key missing', 'auth');
  }
}
