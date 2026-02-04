import OpenAI from 'openai';
import type { LLMRequestType, LLMMessageType } from '@nachos/types';
import { ProviderError, type AdapterResponse, type AdapterSendOptions, type AdapterStreamOptions, type StreamChunkHandler } from './types.js';

function toOpenAiMessages(messages: LLMRequestType['messages']): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message: LLMRequestType['messages'][number]) => {
    const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const base = {
      role: message.role,
      content,
      name: message.name,
    } as OpenAI.ChatCompletionMessageParam;

    if (message.role === 'tool') {
      return {
        ...base,
        role: 'tool',
        tool_call_id: message.tool_call_id ?? '',
      } as OpenAI.ChatCompletionMessageParam;
    }

    return base;
  });
}

function toOpenAiTools(tools: LLMRequestType['tools']) {
  if (!tools) return undefined;
  return tools.map((tool: NonNullable<LLMRequestType['tools']>[number]) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

type ToolCall = { id: string; name: string; arguments: string };

function mapToolCalls(toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> | null | undefined): ToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls
    .filter((call) => call.function?.name)
    .map((call) => ({
      id: call.id ?? '',
      name: call.function?.name ?? 'unknown',
      arguments: call.function?.arguments ?? '{}',
    }));
}

function mapFinishReason(reason: string | null | undefined): string | undefined {
  return reason ?? undefined;
}

export class OpenAIAdapter {
  public readonly name = 'openai';
  public readonly type = 'openai' as const;
  constructor(
    private readonly baseUrl?: string,
    private readonly defaultApiKey?: string
  ) {}

  async send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse> {
    const { apiKey, profileName } = this.resolveApiKey(options);
    try {
      const client = new OpenAI({ apiKey, baseURL: this.baseUrl });
      const response = await client.chat.completions.create({
        model: options.model,
        messages: toOpenAiMessages(request.messages),
        tools: toOpenAiTools(request.tools),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: false,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new ProviderError('No completion choice returned', 'invalid_request');
      }
      const messageContent = choice.message?.content ?? '';

      const message: LLMMessageType = {
        role: 'assistant',
        content: messageContent,
      };

      return {
        message,
        toolCalls: mapToolCalls(choice.message?.tool_calls),
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        provider: this.name,
        model: response.model ?? options.model,
        finishReason: mapFinishReason(choice.finish_reason),
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
    const { apiKey, profileName } = this.resolveApiKey(options);
    try {
      const client = new OpenAI({ apiKey, baseURL: this.baseUrl });
      const stream = await client.chat.completions.create({
        model: options.model,
        messages: toOpenAiMessages(request.messages),
        tools: toOpenAiTools(request.tools),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      });

      let index = 0;
      let aggregated = '';
      let toolCalls: ToolCall[] | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) {
          continue;
        }

        if (delta.content) {
          aggregated += delta.content;
          await onChunk({
            sessionId: options.sessionId,
            index: index++,
            type: 'delta',
            delta: delta.content,
            provider: this.name,
            model: options.model,
          });
        }

        if (delta.tool_calls) {
          const mapped = mapToolCalls(delta.tool_calls);
          if (mapped && mapped.length > 0) {
            toolCalls = mapped;
            for (const toolCall of mapped) {
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
        }
      }

      await onChunk({
        sessionId: options.sessionId,
        index: index++,
        type: 'done',
        provider: this.name,
        model: options.model,
      });

      const message: LLMMessageType = {
        role: 'assistant',
        content: aggregated,
      };

      return {
        message,
        toolCalls,
        provider: this.name,
        model: options.model,
      };
    } catch (error) {
      const mapped = this.mapError(error);
      if (profileName && (mapped.kind === 'rate_limit' || mapped.kind === 'billing')) {
        options.onProfileCooldown?.(profileName, mapped.kind === 'billing' ? 'billing' : 'rate_limit');
      }
      throw mapped;
    }
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

    return new ProviderError('OpenAI provider error', 'unknown');
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

    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
      return { apiKey: envKey };
    }

    throw new ProviderError('OpenAI API key missing', 'auth');
  }
}
