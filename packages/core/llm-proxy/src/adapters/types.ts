import type { LLMMessageType, LLMRequestType, LLMStreamChunkType } from '@nachos/types';

type LLMToolCallType = {
  id: string;
  name: string;
  arguments: string;
};

type LLMUsageType = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export interface AdapterResponse {
  message: LLMMessageType;
  toolCalls?: LLMToolCallType[];
  usage?: LLMUsageType;
  provider?: string;
  model?: string;
  finishReason?: string;
}

export type StreamChunkHandler = (chunk: LLMStreamChunkType) => Promise<void> | void;

export interface AdapterSendOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  onProfileCooldown?: (profileName: string, reason: 'rate_limit' | 'billing') => void;
  getProfileApiKey?: (profileName: string) => string | null;
  getProfileList?: () => string[];
}

export interface AdapterStreamOptions extends AdapterSendOptions {
  sessionId: string;
}

export interface LLMProviderAdapter {
  readonly name: string;
  readonly type: 'anthropic' | 'openai' | 'ollama' | 'custom';
  send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse>;
  stream?(
    request: LLMRequestType,
    options: AdapterStreamOptions,
    onChunk: StreamChunkHandler
  ): Promise<AdapterResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'rate_limit'
      | 'limit_reached'
      | 'billing'
      | 'auth'
      | 'network'
      | 'invalid_request'
      | 'unknown',
    public readonly providerCode?: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
