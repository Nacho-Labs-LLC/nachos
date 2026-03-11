/**
 * Types for the LLM-powered knowledge extraction pipeline.
 *
 * Extraction runs once when a session closes, producing permanent MemoryFacts
 * from the conversation history.
 */

import type { MemoryFact } from '@nachos/types';

/**
 * A single LLM call function — accepts messages and returns the assistant response.
 * The gateway injects this so the extraction adapter stays decoupled from LLM providers.
 */
export type LLMCallFn = (params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}) => Promise<string>;

/**
 * A conversation turn as seen by the extraction adapter.
 */
export interface ExtractionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * One extracted fact as returned by the LLM (before validation/mapping).
 */
export interface RawExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  type?: string;
  confidence?: number;
  properties?: Record<string, unknown>;
  sourceContext?: string;
}

/**
 * Result from the LLM extraction adapter.
 */
export interface ExtractionResult {
  facts: MemoryFact[];
  /** Number of facts the LLM returned before filtering/validation */
  rawCount: number;
  /** Whether the LLM output was well-formed JSON */
  parseSuccess: boolean;
}

/**
 * Configuration for the LLM extraction adapter.
 */
export interface LLMExtractionAdapterConfig {
  /** Agent ID for attribution */
  agentId: string;
  /** Session ID for source tracking */
  sessionId: string;
  /** Maximum tokens to use for the extraction response */
  maxTokens?: number;
  /**
   * Maximum characters of conversation to send to the LLM.
   * Long conversations are truncated from the beginning to fit.
   * Default: 50000 chars.
   */
  maxConversationChars?: number;
}
