export { LLMExtractionAdapter } from './llm-adapter.js';
export { deduplicateFacts, isExactMatch, mergeFact } from './dedup.js';
export { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserMessage } from './prompts.js';
export type {
  LLMCallFn,
  ExtractionMessage,
  RawExtractedFact,
  ExtractionResult,
  LLMExtractionAdapterConfig,
} from './types.js';
