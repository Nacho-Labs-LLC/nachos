import type { LLMRequestType } from '@nachos/types';
import { OpenAIAdapter } from './openai.js';
import type {
  AdapterResponse,
  AdapterSendOptions,
  AdapterStreamOptions,
  StreamChunkHandler,
} from './types.js';

export class OllamaAdapter {
  public readonly name = 'ollama';
  public readonly type = 'ollama' as const;
  private readonly delegate: OpenAIAdapter;

  constructor(baseUrl?: string) {
    this.delegate = new OpenAIAdapter(baseUrl ?? 'http://localhost:11434/v1', 'ollama');
  }

  async send(request: LLMRequestType, options: AdapterSendOptions): Promise<AdapterResponse> {
    return this.delegate.send(request, options);
  }

  async stream(
    request: LLMRequestType,
    options: AdapterStreamOptions,
    onChunk: StreamChunkHandler
  ): Promise<AdapterResponse> {
    return this.delegate.stream(request, options, onChunk);
  }
}
