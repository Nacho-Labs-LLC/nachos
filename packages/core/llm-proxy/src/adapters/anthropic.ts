import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages';
import type { LLMRequestType, LLMMessageType } from '@nachos/types';
import { ProviderError, type AdapterResponse, type AdapterSendOptions, type AdapterStreamOptions, type StreamChunkHandler } from './types.js';

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

function toAnthropicMessages(messages: LLMRequestType['messages']): MessageCreateParams['messages'] {
  return messages
    .filter((message: LLMRequestType['messages'][number]) => message.role !== 'system')
    .map((message: LLMRequestType['messages'][number]) => {
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);

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
  const calls = content.filter((part): part is AnthropicContentBlock & { type: 'tool_use' } => part.type === 'tool_use');
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
    .filter((part): part is AnthropicContentBlock & { text: string } => part.type === 'text' && Boolean(part.text))
    .map((part) => part.text)
    .join('');
}

export class AnthropicAdapter {
  public readonly name = 'anthropic';
  public readonly type = 'anthropic' as const;
  constructor(
    private readonly baseUrl?: string,
    private readonly defaultApiKey?: string
  ) {}

  async send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse> {
    const { apiKey, profileName } = this.resolveApiKey(options);
    try {
      const client = new Anthropic({ apiKey, baseURL: this.baseUrl });
      const response = await client.messages.create({
        model: options.model,
        system: extractSystemPrompt(request.messages),
        messages: toAnthropicMessages(request.messages),
        tools: toAnthropicTools(request.tools),
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature,
      });

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
        options.onProfileCooldown?.(profileName, mapped.kind === 'billing' ? 'billing' : 'rate_limit');
      }
      throw mapped;
    }
  }

  async stream(
    request: LLMRequestType,
    options: AdapterStreamOptions,
    onChunk: StreamChunkHandler
  ): Promise<AdapterResponse> {
    const response = await this.send(request, options);
    await onChunk({
      sessionId: options.sessionId,
      index: 0,
      type: 'delta',
      delta: typeof response.message.content === 'string' ? response.message.content : '',
      provider: this.name,
      model: response.model ?? options.model,
    });
    await onChunk({
      sessionId: options.sessionId,
      index: 1,
      type: 'done',
      provider: this.name,
      model: response.model ?? options.model,
    });
    return response;
  }

  private mapError(error: unknown): ProviderError {
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

    throw new ProviderError('Anthropic API key missing', 'auth');
  }
}
