import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  type BedrockRuntimeClient as BedrockRuntimeClientType,
} from '@aws-sdk/client-bedrock-runtime';
import type { LLMRequestType, LLMMessageType } from '@nachos/types';
import {
  ProviderError,
  type AdapterResponse,
  type AdapterSendOptions,
  type AdapterStreamOptions,
  type StreamChunkHandler,
  type LLMProviderAdapter,
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

function toBedrockMessages(messages: LLMRequestType['messages']): unknown[] {
  return messages
    .filter((message: LLMRequestType['messages'][number]) => message.role !== 'system')
    .map((message: LLMRequestType['messages'][number]) => {
      // Handle tool result messages
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

        // Fallback for OpenAI-style tool_call_id
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

      // Handle assistant messages with tool_use blocks
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const hasToolUse = (message.content as Array<{ type?: string }>).some(
          (block) => block && typeof block === 'object' && block.type === 'tool_use'
        );
        if (hasToolUse) {
          return {
            role: 'assistant' as const,
            content: message.content,
          };
        }
      }

      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

      return {
        role: message.role,
        content,
      };
    });
}

function toBedrockTools(tools: LLMRequestType['tools']) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool: NonNullable<LLMRequestType['tools']>[number]) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters, // Bedrock uses input_schema, Nachos uses parameters
  }));
}

type BedrockMessage = {
  role: 'user' | 'assistant';
  content: string | unknown[];
};

type BedrockRequestBody = {
  anthropic_version: string;
  max_tokens: number;
  messages: BedrockMessage[];
  system?: string;
  temperature?: number;
  tools?: unknown[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
};

type BedrockTextBlock = {
  type: 'text';
  text: string;
};

type BedrockToolUseBlock = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type BedrockContentBlock = BedrockTextBlock | BedrockToolUseBlock;

type BedrockResponseBody = {
  id: string;
  type: 'message';
  role: 'assistant';
  content: BedrockContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

type BedrockStreamChunk = {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop';
  index?: number;
  message?: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: BedrockContentBlock[];
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  content_block?: BedrockContentBlock;
  delta?: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens: number };
};

type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/**
 * Parse AWS credentials from a profile's env var value.
 * Supports JSON: {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."}
 * Or plain access key ID (looks up corresponding secret from *_SECRET_ACCESS_KEY env var).
 */
function parseAwsCredentials(envValue: string): AwsCredentials | null {
  const trimmed = envValue.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.accessKeyId === 'string' && typeof parsed.secretAccessKey === 'string') {
        return {
          accessKeyId: parsed.accessKeyId,
          secretAccessKey: parsed.secretAccessKey,
          sessionToken: typeof parsed.sessionToken === 'string' ? parsed.sessionToken : undefined,
        };
      }
    } catch {
      // Not valid JSON, fall through
    }
  }
  return null;
}

export function createBedrockAdapter(
  region = 'us-east-1',
  credentials?: AwsCredentials
): LLMProviderAdapter {
  const clientCache = new Map<string, BedrockRuntimeClientType>();

  function getClient(creds?: AwsCredentials): BedrockRuntimeClientType {
    const cacheKey = creds ? creds.accessKeyId : '__default__';
    let client = clientCache.get(cacheKey);
    if (!client) {
      if (clientCache.size >= 10) {
        const firstKey = clientCache.keys().next().value as string;
        clientCache.delete(firstKey);
      }
      client = new BedrockRuntimeClient({ region, credentials: creds });
      clientCache.set(cacheKey, client);
    }
    return client;
  }

  function resolveCredentials(options: AdapterSendOptions): {
    credentials?: AwsCredentials;
    profileName?: string;
  } {
    // Try profiles first (multi-profile auth)
    const profileList = options.getProfileList?.() ?? [];
    for (const profileName of profileList) {
      const envValue = options.getProfileApiKey?.(profileName);
      if (envValue) {
        const parsed = parseAwsCredentials(envValue);
        if (parsed) {
          return { credentials: parsed, profileName };
        }
      }
    }

    // Fall back to constructor-provided credentials
    if (credentials) {
      return { credentials };
    }

    // Fall back to default AWS credential chain (SDK handles this)
    return {};
  }

  return {
    name: 'bedrock',
    type: 'custom',

    async send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse> {
      const { credentials: resolvedCreds, profileName } = resolveCredentials(options);
      const bedrockClient = getClient(resolvedCreds);

      const system = extractSystemPrompt(request.messages);
      const messages = toBedrockMessages(request.messages) as BedrockMessage[];
      const tools = toBedrockTools(request.tools);

      const body: BedrockRequestBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: options.maxTokens ?? 4096,
        messages,
        ...(system && { system }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(tools && tools.length > 0 && { tools }),
      };

      const command = new InvokeModelCommand({
        modelId: options.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      });

      try {
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(
          new TextDecoder().decode(response.body)
        ) as BedrockResponseBody;

        const textBlocks = responseBody.content.filter(
          (block): block is BedrockTextBlock => block.type === 'text'
        );
        const toolUseBlocks = responseBody.content.filter(
          (block): block is BedrockToolUseBlock => block.type === 'tool_use'
        );

        const message: LLMMessageType = {
          role: 'assistant',
          content: textBlocks.length > 0 ? textBlocks.map((b) => b.text).join('') : '',
        };

        const toolCalls = toolUseBlocks.map((block) => ({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        }));

        return {
          message,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: {
            promptTokens: responseBody.usage.input_tokens,
            completionTokens: responseBody.usage.output_tokens,
            totalTokens: responseBody.usage.input_tokens + responseBody.usage.output_tokens,
          },
          provider: 'bedrock',
          model: responseBody.model,
          finishReason: responseBody.stop_reason,
        };
      } catch (error: unknown) {
        const mapped = mapBedrockError(error);
        if (profileName && (mapped.kind === 'rate_limit' || mapped.kind === 'billing')) {
          options.onProfileCooldown?.(
            profileName,
            mapped.kind === 'billing' ? 'billing' : 'rate_limit'
          );
        }
        throw mapped;
      }
    },

    async stream(
      request: LLMRequestType,
      options: AdapterStreamOptions,
      onChunk: StreamChunkHandler
    ): Promise<AdapterResponse> {
      const { credentials: resolvedCreds, profileName } = resolveCredentials(options);
      const bedrockClient = getClient(resolvedCreds);

      const system = extractSystemPrompt(request.messages);
      const messages = toBedrockMessages(request.messages) as BedrockMessage[];
      const tools = toBedrockTools(request.tools);

      const body: BedrockRequestBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: options.maxTokens ?? 4096,
        messages,
        ...(system && { system }),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(tools && tools.length > 0 && { tools }),
      };

      const command = new InvokeModelWithResponseStreamCommand({
        modelId: options.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      });

      try {
        const response = await bedrockClient.send(command);

        let fullText = '';
        let modelName = '';
        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason: string | undefined;
        let chunkIndex = 0;
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        const toolInputBuffers: Record<string, string> = {};

        if (response.body) {
          for await (const event of response.body) {
            if (!event.chunk) continue;

            const chunkData = JSON.parse(
              new TextDecoder().decode(event.chunk.bytes)
            ) as BedrockStreamChunk;

            if (chunkData.type === 'message_start' && chunkData.message) {
              modelName = chunkData.message.model;
              inputTokens = chunkData.message.usage.input_tokens;
            } else if (chunkData.type === 'content_block_start' && chunkData.content_block) {
              if (chunkData.content_block.type === 'tool_use') {
                toolInputBuffers[chunkData.content_block.id] = '';
                toolCalls.push({
                  id: chunkData.content_block.id,
                  name: chunkData.content_block.name,
                  arguments: '',
                });
              }
            } else if (chunkData.type === 'content_block_delta' && chunkData.delta) {
              if (chunkData.delta.type === 'text_delta' && chunkData.delta.text) {
                fullText += chunkData.delta.text;
                await onChunk({
                  type: 'delta',
                  delta: chunkData.delta.text,
                  sessionId: options.sessionId,
                  index: chunkIndex++,
                  provider: 'bedrock',
                  model: options.model,
                });
              } else if (
                chunkData.delta.type === 'input_json_delta' &&
                chunkData.delta.partial_json &&
                chunkData.index !== undefined
              ) {
                const toolCall = toolCalls[chunkData.index];
                if (toolCall) {
                  toolInputBuffers[toolCall.id] += chunkData.delta.partial_json;
                }
              }
            } else if (chunkData.type === 'content_block_stop' && chunkData.index !== undefined) {
              const toolCall = toolCalls[chunkData.index];
              if (toolCall) {
                toolCall.arguments = toolInputBuffers[toolCall.id] ?? '';
                await onChunk({
                  type: 'tool_call',
                  toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments },
                  sessionId: options.sessionId,
                  index: chunkIndex++,
                  provider: 'bedrock',
                  model: options.model,
                });
              }
            } else if (chunkData.type === 'message_delta' && chunkData.delta) {
              if (chunkData.delta.stop_reason) {
                stopReason = chunkData.delta.stop_reason;
              }
              if (chunkData.usage) {
                outputTokens = chunkData.usage.output_tokens;
              }
            }
          }
        }

        const message: LLMMessageType = {
          role: 'assistant',
          content: fullText,
        };

        return {
          message,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
          provider: 'bedrock',
          model: modelName,
          finishReason: stopReason ?? 'end_turn',
        };
      } catch (error: unknown) {
        const mapped = mapBedrockError(error);
        if (profileName && (mapped.kind === 'rate_limit' || mapped.kind === 'billing')) {
          options.onProfileCooldown?.(
            profileName,
            mapped.kind === 'billing' ? 'billing' : 'rate_limit'
          );
        }
        throw mapped;
      }
    },
  };
}

function mapBedrockError(error: unknown): ProviderError {
  if (error && typeof error === 'object' && 'name' in error) {
    const awsError = error as {
      name: string;
      message: string;
      $metadata?: { httpStatusCode?: number };
    };

    if (awsError.name === 'ThrottlingException' || awsError.$metadata?.httpStatusCode === 429) {
      return new ProviderError('Rate limit exceeded', 'rate_limit', awsError.name);
    }
    if (awsError.name === 'ValidationException' || awsError.$metadata?.httpStatusCode === 400) {
      return new ProviderError(awsError.message, 'invalid_request', awsError.name);
    }
    if (awsError.name === 'AccessDeniedException' || awsError.$metadata?.httpStatusCode === 403) {
      return new ProviderError('Authentication failed', 'auth', awsError.name);
    }
    if (awsError.name === 'ServiceQuotaExceededException') {
      return new ProviderError('Quota exceeded', 'limit_reached', awsError.name);
    }
  }

  return new ProviderError(error instanceof Error ? error.message : 'Unknown error', 'unknown');
}
