import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type FunctionDeclarationSchema,
  type FunctionDeclarationSchemaProperty,
  type Part,
  type EnhancedGenerateContentResponse,
} from '@google/generative-ai';
import type { LLMRequestType, LLMMessageType } from '@nachos/types';
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

function toGeminiContents(messages: LLMRequestType['messages']): Content[] {
  return messages
    .filter((message: LLMRequestType['messages'][number]) => message.role !== 'system')
    .map((message: LLMRequestType['messages'][number]) => {
      // Map tool result messages to function response parts
      if (message.role === 'tool') {
        const toolCallId = (message as Record<string, unknown>).tool_call_id as string | undefined;
        if (toolCallId && typeof message.content === 'string') {
          let responseObj: object;
          try {
            responseObj = JSON.parse(message.content) as object;
          } catch {
            responseObj = { result: message.content };
          }
          return {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: toolCallId,
                  response: responseObj,
                },
              },
            ],
          } as Content;
        }

        // Array-based tool results (Anthropic-style)
        if (Array.isArray(message.content)) {
          const parts: Part[] = (message.content as Array<Record<string, unknown>>)
            .filter((block) => block.type === 'tool_result')
            .map((block) => {
              const resultContent = (block.tool_result ?? block.content ?? '') as string | object;
              let responseObj: object;
              if (typeof resultContent === 'string') {
                try {
                  responseObj = JSON.parse(resultContent) as object;
                } catch {
                  responseObj = { result: resultContent };
                }
              } else {
                responseObj = resultContent;
              }
              return {
                functionResponse: {
                  name: (block.tool_use_id as string) ?? 'unknown',
                  response: responseObj,
                },
              };
            });
          if (parts.length > 0) {
            return { role: 'user', parts } as Content;
          }
        }
      }

      // Handle assistant messages that may contain function calls
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const parts: Part[] = [];
        for (const block of message.content as Array<Record<string, unknown>>) {
          if (block.type === 'tool_use') {
            parts.push({
              functionCall: {
                name: block.name as string,
                args: (block.input as object) ?? {},
              },
            });
          } else if (block.type === 'text' && block.text) {
            parts.push({ text: block.text as string });
          }
        }
        if (parts.length > 0) {
          return { role: 'model', parts } as Content;
        }
      }

      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      } as Content;
    });
}

/** Map JSON Schema type string to Gemini SchemaType enum */
function mapSchemaType(type: string): SchemaType {
  switch (type) {
    case 'string':
      return SchemaType.STRING;
    case 'number':
      return SchemaType.NUMBER;
    case 'integer':
      return SchemaType.INTEGER;
    case 'boolean':
      return SchemaType.BOOLEAN;
    case 'array':
      return SchemaType.ARRAY;
    case 'object':
      return SchemaType.OBJECT;
    default:
      return SchemaType.STRING;
  }
}

function toGeminiFunctionDeclarationSchema(
  params: Record<string, unknown>
): FunctionDeclarationSchema {
  const properties: Record<string, FunctionDeclarationSchemaProperty> = {};
  const props = (params.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, value] of Object.entries(props)) {
    properties[key] = mapPropertySchema(value);
  }
  return {
    type: SchemaType.OBJECT,
    properties,
    description: params.description as string | undefined,
    required: params.required as string[] | undefined,
  };
}

function mapPropertySchema(prop: Record<string, unknown>): FunctionDeclarationSchemaProperty {
  const type = mapSchemaType((prop.type as string) ?? 'string');
  const description = prop.description as string | undefined;

  // Build a schema that satisfies the discriminated union based on type
  switch (type) {
    case SchemaType.OBJECT: {
      const nested: Record<string, FunctionDeclarationSchemaProperty> = {};
      const nestedProps = (prop.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [k, v] of Object.entries(nestedProps)) {
        nested[k] = mapPropertySchema(v);
      }
      return {
        type: SchemaType.OBJECT,
        properties: nested,
        description,
      } as FunctionDeclarationSchemaProperty;
    }
    case SchemaType.ARRAY:
      return {
        type: SchemaType.ARRAY,
        items: mapPropertySchema((prop.items ?? { type: 'string' }) as Record<string, unknown>),
        description,
      } as FunctionDeclarationSchemaProperty;
    default:
      return { type, description } as FunctionDeclarationSchemaProperty;
  }
}

function toGeminiTools(
  tools: LLMRequestType['tools']
): { functionDeclarations: FunctionDeclaration[] }[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const declarations: FunctionDeclaration[] = tools.map(
    (tool: NonNullable<LLMRequestType['tools']>[number]) => {
      const decl: FunctionDeclaration = {
        name: tool.name,
        description: tool.description,
      };
      if (tool.parameters && typeof tool.parameters === 'object') {
        decl.parameters = toGeminiFunctionDeclarationSchema(
          tool.parameters as Record<string, unknown>
        );
      }
      return decl;
    }
  );
  return [{ functionDeclarations: declarations }];
}

type ToolCall = { id: string; name: string; arguments: string };

function mapToolCalls(response: EnhancedGenerateContentResponse): ToolCall[] | undefined {
  const calls = response.functionCalls();
  if (!calls || calls.length === 0) return undefined;
  return calls.map((call, i) => ({
    id: `gemini-call-${i}`,
    name: call.name,
    arguments: JSON.stringify(call.args ?? {}),
  }));
}

function mapFinishReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
      return 'content_filter';
    case 'MALFORMED_FUNCTION_CALL':
      return 'tool_calls';
    default:
      return reason.toLowerCase();
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class GeminiAdapter {
  public readonly name = 'gemini';
  public readonly type = 'custom' as const;

  constructor(private readonly defaultApiKey?: string) {}

  async send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse> {
    const { apiKey, profileName } = this.resolveApiKey(options);
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel(
        {
          model: options.model,
          systemInstruction: extractSystemPrompt(request.messages),
          tools: toGeminiTools(request.tools),
          generationConfig: {
            maxOutputTokens: options.maxTokens,
            temperature: options.temperature,
          },
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS }
      );

      const result = await model.generateContent({
        contents: toGeminiContents(request.messages),
      });

      const response = result.response;
      const text = response.text();
      const toolCalls = mapToolCalls(response);
      const candidate = response.candidates?.[0];

      const message: LLMMessageType = {
        role: 'assistant',
        content: text,
      };

      return {
        message,
        toolCalls,
        usage: response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount,
              completionTokens: response.usageMetadata.candidatesTokenCount,
              totalTokens: response.usageMetadata.totalTokenCount,
            }
          : undefined,
        provider: this.name,
        model: options.model,
        finishReason: mapFinishReason(candidate?.finishReason),
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
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel(
        {
          model: options.model,
          systemInstruction: extractSystemPrompt(request.messages),
          tools: toGeminiTools(request.tools),
          generationConfig: {
            maxOutputTokens: options.maxTokens,
            temperature: options.temperature,
          },
        },
        { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS }
      );

      const streamResult = await model.generateContentStream({
        contents: toGeminiContents(request.messages),
      });

      let index = 0;
      let toolCallIndex = 0;
      let aggregatedText = '';

      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) {
          aggregatedText += text;
          await onChunk({
            sessionId: options.sessionId,
            index: index++,
            type: 'delta',
            delta: text,
            provider: this.name,
            model: options.model,
          });
        }

        const calls = chunk.functionCalls();
        if (calls && calls.length > 0) {
          for (const call of calls) {
            const callId = `gemini-call-${toolCallIndex++}`;
            await onChunk({
              sessionId: options.sessionId,
              index: index++,
              type: 'tool_call',
              toolCall: {
                id: callId,
                name: call.name,
                arguments: JSON.stringify(call.args ?? {}),
              },
              provider: this.name,
              model: options.model,
            });
          }
        }
      }

      const aggregatedResponse = await streamResult.response;
      const toolCalls = mapToolCalls(aggregatedResponse);
      const candidate = aggregatedResponse.candidates?.[0];

      await onChunk({
        sessionId: options.sessionId,
        index: index++,
        type: 'done',
        provider: this.name,
        model: options.model,
      });

      const message: LLMMessageType = {
        role: 'assistant',
        content: aggregatedText,
      };

      return {
        message,
        toolCalls,
        usage: aggregatedResponse.usageMetadata
          ? {
              promptTokens: aggregatedResponse.usageMetadata.promptTokenCount,
              completionTokens: aggregatedResponse.usageMetadata.candidatesTokenCount,
              totalTokens: aggregatedResponse.usageMetadata.totalTokenCount,
            }
          : undefined,
        provider: this.name,
        model: options.model,
        finishReason: mapFinishReason(candidate?.finishReason),
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
    if (error instanceof GoogleGenerativeAIFetchError) {
      const status = error.status ?? 0;
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

    return new ProviderError('Gemini provider error', 'unknown');
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

    const envKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (envKey) {
      return { apiKey: envKey };
    }

    throw new ProviderError('Gemini API key missing', 'auth');
  }
}
