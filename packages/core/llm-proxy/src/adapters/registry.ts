import type { LLMConfig } from '@nachos/config';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { OllamaAdapter } from './ollama.js';
import { createBedrockAdapter } from './bedrock.js';
import type { LLMProviderAdapter } from './types.js';

export interface AdapterRegistry {
  getAdapter(provider: string): LLMProviderAdapter | undefined;
}

export function createAdapterRegistry(config: LLMConfig): AdapterRegistry {
  const adapters = new Map<string, LLMProviderAdapter>();

  adapters.set('anthropic', new AnthropicAdapter());
  adapters.set('openai', new OpenAIAdapter());
  adapters.set('ollama', new OllamaAdapter(config.base_url));
  
  // Bedrock adapter uses AWS credentials from environment or AWS config
  const awsRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  adapters.set('bedrock', createBedrockAdapter(awsRegion));

  return {
    getAdapter(provider: string) {
      return adapters.get(provider);
    },
  };
}
