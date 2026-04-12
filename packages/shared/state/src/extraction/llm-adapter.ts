/**
 * LLM-powered knowledge extraction adapter.
 *
 * When a session closes, this adapter:
 *  1. Formats the full conversation as a transcript
 *  2. Calls the LLM with an extraction prompt
 *  3. Parses and validates the structured JSON output
 *  4. Returns typed MemoryFacts ready for storage
 *
 * The adapter is decoupled from LLM providers — it accepts an `llmCall` function
 * injected at the call site (gateway wires in the actual provider).
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@nachos/types';
import type { MemoryFact, MemoryFactType } from '@nachos/types';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_FACT_TYPES,
  buildExtractionUserMessage,
} from './prompts.js';
import type {
  LLMCallFn,
  ExtractionMessage,
  RawExtractedFact,
  ExtractionResult,
  LLMExtractionAdapterConfig,
} from './types.js';

const logger = createLogger('llm-extraction-adapter');

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_MAX_CONVERSATION_CHARS = 50_000;
const MIN_CONFIDENCE = 0.0;
const MAX_CONFIDENCE = 1.0;

/**
 * LLM-based knowledge extraction adapter.
 *
 * Usage:
 * ```ts
 * const adapter = new LLMExtractionAdapter(llmCallFn, { agentId, sessionId });
 * const result = await adapter.extract(messages);
 * // result.facts: MemoryFact[] ready to append to the store
 * ```
 */
export class LLMExtractionAdapter {
  constructor(
    private llmCall: LLMCallFn,
    private config: LLMExtractionAdapterConfig
  ) {}

  /**
   * Extract MemoryFacts from conversation messages.
   *
   * Errors are caught and logged — never propagated to avoid blocking session close.
   */
  async extract(messages: ExtractionMessage[]): Promise<ExtractionResult> {
    const filteredMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

    if (filteredMessages.length === 0) {
      return { facts: [], rawCount: 0, parseSuccess: true };
    }

    const truncated = this.truncateConversation(filteredMessages);
    const userMessage = buildExtractionUserMessage(truncated);

    let rawOutput: string;
    try {
      rawOutput = await this.llmCall({
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userMessage,
        maxTokens: this.config.maxTokens ?? DEFAULT_MAX_TOKENS,
      });
    } catch (err) {
      logger.error(
        { err, sessionId: this.config.sessionId },
        'LLM call failed during knowledge extraction'
      );
      return { facts: [], rawCount: 0, parseSuccess: false };
    }

    return this.parseAndValidate(rawOutput);
  }

  /**
   * Parse and validate the raw LLM output into MemoryFacts.
   */
  private parseAndValidate(rawOutput: string): ExtractionResult {
    const trimmed = rawOutput.trim();

    // Strip any markdown code fences the LLM might have added
    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn(
        { sessionId: this.config.sessionId, rawOutputLength: cleaned.length },
        'LLM extraction returned non-JSON output'
      );
      return { facts: [], rawCount: 0, parseSuccess: false };
    }

    if (!Array.isArray(parsed)) {
      logger.warn({ sessionId: this.config.sessionId }, 'LLM extraction returned non-array JSON');
      return { facts: [], rawCount: 0, parseSuccess: false };
    }

    const rawCount = parsed.length;
    const facts: MemoryFact[] = [];
    const now = new Date().toISOString();

    for (const item of parsed) {
      const fact = this.validateRawFact(item as Record<string, unknown>);
      if (!fact) continue;

      facts.push({
        id: randomUUID(),
        agentId: this.config.agentId,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        type: this.validateFactType(fact.type),
        confidence: this.clampConfidence(fact.confidence),
        properties: fact.properties ?? {},
        sourceContext: `session:${this.config.sessionId}`,
        createdAt: now,
      });
    }

    logger.info(
      {
        sessionId: this.config.sessionId,
        agentId: this.config.agentId,
        rawCount,
        validCount: facts.length,
      },
      'Knowledge extraction complete'
    );

    return { facts, rawCount, parseSuccess: true };
  }

  /**
   * Validate a raw fact object from the LLM output.
   * Returns null if the fact is malformed.
   */
  private validateRawFact(item: Record<string, unknown>): RawExtractedFact | null {
    if (typeof item !== 'object' || item === null) return null;

    const subject = typeof item['subject'] === 'string' ? item['subject'].trim() : '';
    const predicate = typeof item['predicate'] === 'string' ? item['predicate'].trim() : '';
    const object = typeof item['object'] === 'string' ? item['object'].trim() : '';

    if (!subject || !predicate || !object) {
      const missingFields: string[] = [];
      if (!subject) missingFields.push('subject');
      if (!predicate) missingFields.push('predicate');
      if (!object) missingFields.push('object');
      logger.debug(
        { sessionId: this.config.sessionId, missingFields, itemKeys: Object.keys(item) },
        'Skipping malformed extraction fact (missing required fields)'
      );
      return null;
    }

    const properties =
      item['properties'] !== null &&
      typeof item['properties'] === 'object' &&
      !Array.isArray(item['properties'])
        ? (item['properties'] as Record<string, unknown>)
        : {};

    return {
      subject,
      predicate,
      object,
      type: typeof item['type'] === 'string' ? item['type'] : undefined,
      confidence: typeof item['confidence'] === 'number' ? item['confidence'] : 0.7,
      properties,
    };
  }

  private validateFactType(type: string | undefined): MemoryFactType | undefined {
    if (!type) return undefined;
    return (EXTRACTION_FACT_TYPES as ReadonlyArray<string>).includes(type)
      ? (type as MemoryFactType)
      : 'general';
  }

  private clampConfidence(value: number | undefined): number {
    if (value === undefined) return 0.7;
    return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value));
  }

  /**
   * Truncate conversation to fit within maxConversationChars.
   * Removes messages from the beginning to preserve the most recent context.
   */
  private truncateConversation(messages: ExtractionMessage[]): ExtractionMessage[] {
    const maxChars = this.config.maxConversationChars ?? DEFAULT_MAX_CONVERSATION_CHARS;
    let totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

    if (totalChars <= maxChars) return messages;

    // Drop messages from the front until we fit
    const truncated = [...messages];
    while (truncated.length > 0 && totalChars > maxChars) {
      const removed = truncated.shift();
      if (removed) totalChars -= removed.content.length;
    }

    logger.debug(
      {
        sessionId: this.config.sessionId,
        originalCount: messages.length,
        truncatedCount: truncated.length,
      },
      'Conversation truncated for extraction'
    );

    return truncated;
  }
}
