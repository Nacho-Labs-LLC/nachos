import type { LLMConfig } from '@nachos/config';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { OllamaAdapter } from './ollama.js';
import type { LLMProviderAdapter } from './types.js';

export interface AdapterRegistry {
  getAdapter(provider: string): LLMProviderAdapter | undefined;
}

export function createAdapterRegistry(config: LLMConfig): AdapterRegistry {
  const adapters = new Map<string, LLMProviderAdapter>();

  adapters.set('anthropic', new AnthropicAdapter());
  adapters.set('openai', new OpenAIAdapter());
  adapters.set('ollama', new OllamaAdapter(config.base_url));

  return {
    getAdapter(provider: string) {
      return adapters.get(provider);
    },
  };
}
