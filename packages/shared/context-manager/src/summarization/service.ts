/**
 * NACHOS Context Management - Summarization Service
 *
 * Generates compressed summaries of conversation history using LLM.
 * Supports multi-tier compression for different context pressures.
 */

import type {
  ContextMessage,
  SummarizationTier,
  ISummarizationService,
  SummarizationConfig,
  SummarizationResult,
} from '../types/index.js';
import { tokenEstimator } from '../utils/token-counter.js';

/**
 * LLM Provider interface for summarization
 *
 * This is a minimal interface for calling the LLM Proxy.
 * The actual implementation will be injected by the caller.
 */
export interface LLMProvider {
  /**
   * Generate a completion from the LLM
   */
  complete(params: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
}

/**
 * Summarization Service
 *
 * Generates intelligent summaries of message history using LLM.
 * Preserves critical information while reducing token count.
 */
export class SummarizationService implements ISummarizationService {
  private llmProvider: LLMProvider;
  private config: SummarizationConfig;

  constructor(llmProvider: LLMProvider, config: SummarizationConfig = {}) {
    this.llmProvider = llmProvider;
    this.config = {
      enabled: config.enabled ?? true,
      mode: config.mode ?? 'multi-tier',
      preserveRules: config.preserveRules ?? this.getDefaultPreserveRules(),
    };
  }

  /**
   * Summarize messages at a specific compression tier
   */
  async summarize(messages: ContextMessage[], tier: SummarizationTier): Promise<SummarizationResult> {
    if (!this.config.enabled) {
      throw new Error('Summarization is disabled');
    }

    // Calculate original token count
    const originalTokens = tokenEstimator.estimateMessages(messages);

    // Convert messages to text format
    const conversationText = this.messagesToText(messages);

    // Get summarization prompt for tier
    const prompt = this.getSummarizationPrompt(tier, conversationText);

    // Call LLM to generate summary
    const summary = await this.llmProvider.complete({
      messages: [
        {
          role: 'system',
          content: this.getSystemPrompt(tier),
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3, // Low temperature for consistent summaries
      maxTokens: this.getMaxTokensForTier(tier, originalTokens),
    });

    // Calculate summary tokens
    const summaryTokens = tokenEstimator.estimate(summary);
    const compressionRatio = summaryTokens / originalTokens;

    return {
      summary,
      tier,
      originalTokens,
      summaryTokens,
      compressionRatio,
      messagesCount: messages.length,
    };
  }

  /**
   * Summarize with automatic tier selection
   */
  async summarizeAuto(messages: ContextMessage[], targetReduction: number): Promise<SummarizationResult> {
    // Select tier based on target reduction
    let tier: SummarizationTier;
    if (targetReduction >= 0.9) {
      tier = 'archival';
    } else if (targetReduction >= 0.7) {
      tier = 'compressed';
    } else {
      tier = 'condensed';
    }

    return this.summarize(messages, tier);
  }

  /**
   * Get system prompt for summarization
   */
  private getSystemPrompt(tier: SummarizationTier): string {
    const basePrompt = `You are an expert conversation summarizer for an AI assistant system. Your task is to create ${tier} summaries of conversation history that preserve critical information while reducing length.`;

    const preserveRules = this.config.preserveRules;
    const preserveList = [
      preserveRules?.decisions && 'Key decisions and agreements',
      preserveRules?.tasks && 'Action items and TODOs',
      preserveRules?.errors && 'Errors and issues encountered',
      preserveRules?.code && 'Code examples and technical details',
      preserveRules?.context && 'Important context and background',
    ]
      .filter(Boolean)
      .join('\n- ');

    return `${basePrompt}

CRITICAL: Always preserve:
- ${preserveList}

NEVER summarize:
- Error messages (preserve verbatim)
- Code blocks (preserve structure and key details)
- File paths and technical identifiers
- User preferences and requirements`;
  }

  /**
   * Get summarization prompt for a specific tier
   */
  private getSummarizationPrompt(tier: SummarizationTier, conversationText: string): string {
    const tierInstructions = {
      condensed: `Create a CONDENSED summary (target: 50% reduction).
- Preserve key points and decisions
- Keep important details and context
- Remove redundant exchanges and small talk
- Maintain chronological flow`,

      compressed: `Create a COMPRESSED summary (target: 80% reduction).
- Focus on essential outcomes and decisions
- Preserve critical errors and solutions
- Combine related topics
- Be concise but clear`,

      archival: `Create an ARCHIVAL summary (target: 95% reduction).
- Ultra-brief overview of main topics
- Only most critical decisions and outcomes
- List format acceptable
- Extreme compression while preserving must-know information`,
    };

    return `${tierInstructions[tier]}

CONVERSATION TO SUMMARIZE:
${conversationText}

Generate a ${tier.toUpperCase()} summary that preserves critical information:`;
  }

  /**
   * Convert messages to readable text format
   */
  private messagesToText(messages: ContextMessage[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      const content = typeof msg.content === 'string' ? msg.content : this.contentBlocksToText(msg.content);

      lines.push(`[${role}]: ${content}`);

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          const toolName = toolCall.function?.name ?? toolCall.name ?? 'unknown-tool';
          const toolArgs = toolCall.function?.arguments ?? toolCall.input ?? {};
          lines.push(`  → Tool: ${toolName}(${JSON.stringify(toolArgs)})`);
        }
      }
    }

    return lines.join('\n\n');
  }

  /**
   * Convert content blocks to text
   */
  private contentBlocksToText(blocks: Array<{ type: string; text?: string; [key: string]: unknown }>): string {
    return blocks
      .map((block) => {
        if (block.type === 'text' && block.text) {
          return block.text;
        }
        return `[${block.type}]`;
      })
      .join(' ');
  }

  /**
   * Get maximum tokens for summary based on tier
   */
  private getMaxTokensForTier(tier: SummarizationTier, originalTokens: number): number {
    const ratios = {
      condensed: 0.5, // 50% of original
      compressed: 0.2, // 20% of original
      archival: 0.05, // 5% of original
    };

    const ratio = ratios[tier];
    return Math.max(100, Math.floor(originalTokens * ratio)); // Minimum 100 tokens
  }

  /**
   * Get default preservation rules
   */
  private getDefaultPreserveRules() {
    return {
      decisions: true,
      tasks: true,
      errors: true,
      code: true,
      context: true,
    };
  }

  /**
   * Validate that summary meets compression target
   */
  validateSummary(result: SummarizationResult): { valid: boolean; reason?: string } {
    const { tier, compressionRatio } = result;

    // Expected compression ratios (with 20% tolerance)
    const expectedRatios = {
      condensed: 0.5,
      compressed: 0.2,
      archival: 0.05,
    };

    const expected = expectedRatios[tier];
    const tolerance = 0.2;

    if (compressionRatio > expected + tolerance) {
      return {
        valid: false,
        reason: `Insufficient compression for ${tier} tier: ${(compressionRatio * 100).toFixed(1)}% (expected ≤${((expected + tolerance) * 100).toFixed(1)}%)`,
      };
    }

    return { valid: true };
  }
}

/**
 * Create a summarization service
 */
export function createSummarizationService(
  llmProvider: LLMProvider,
  config?: SummarizationConfig
): SummarizationService {
  return new SummarizationService(llmProvider, config);
}

/**
 * Mock LLM Provider for testing
 */
export class MockLLMProvider implements LLMProvider {
  async complete(params: {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    // Simple mock: truncate user message to maxTokens approximation
    const userMessage = params.messages.find((m) => m.role === 'user');
    if (!userMessage) {
      return 'Summary unavailable';
    }

    const content = userMessage.content;
    const maxChars = (params.maxTokens ?? 500) * 3.5; // Approximate chars from tokens

    if (content.length <= maxChars) {
      return content;
    }

    return content.substring(0, maxChars) + '... [truncated]';
  }
}
