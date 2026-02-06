/**
 * Token Counter - Token estimation utilities for context management
 *
 * Provides heuristic-based token estimation using the OpenAI rule of thumb.
 * Uses a conservative multiplier of 3.5 chars/token for ~80-90% accuracy.
 */

import type { ContextMessage, ContentBlock } from '../types/index.js';

/**
 * Token estimation class using character-based heuristics
 */
export class TokenEstimator {
  /**
   * Character-to-token ratio (conservative estimate)
   * OpenAI suggests ~4 chars/token for English, we use 3.5 to be conservative
   */
  private readonly CHARS_PER_TOKEN = 3.5;

  /**
   * Overhead tokens per message (role, structure, formatting)
   */
  private readonly MESSAGE_OVERHEAD = 4;

  /**
   * Average tokens per tool call (rough estimate)
   */
  private readonly TOOL_CALL_OVERHEAD = 10;

  /**
   * Estimate tokens for a text string
   *
   * @param text - Text content to estimate
   * @returns Estimated token count
   */
  estimate(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Estimate tokens for content (string or ContentBlock array)
   *
   * @param content - Message content
   * @returns Estimated token count
   */
  estimateContent(content: string | ContentBlock[]): number {
    if (typeof content === 'string') {
      return this.estimate(content);
    }

    // Extract text from content blocks
    const textContent = this.extractTextFromBlocks(content);
    return this.estimate(textContent);
  }

  /**
   * Estimate tokens for a single message
   *
   * @param message - ContextMessage to estimate
   * @returns Estimated token count
   */
  estimateMessage(message: ContextMessage): number {
    // Check for cached token count
    if (message._tokenCache !== undefined) {
      return message._tokenCache;
    }

    let tokens = this.estimateContent(message.content);

    // Add message overhead (role, structure)
    tokens += this.MESSAGE_OVERHEAD;

    // Add tool call overhead if present
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      tokens += message.toolCalls.length * this.TOOL_CALL_OVERHEAD;
    }

    return tokens;
  }

  /**
   * Estimate total tokens for an array of messages
   *
   * @param messages - Array of ContextMessages
   * @returns Total estimated token count
   */
  estimateMessages(messages: ContextMessage[]): number {
    return messages.reduce((total, msg) => total + this.estimateMessage(msg), 0);
  }

  /**
   * Estimate system prompt tokens based on components
   *
   * @param params - System prompt components
   * @returns Estimated token count
   */
  estimateSystemPrompt(params: {
    basePrompt: string;
    toolCount?: number;
    skillCount?: number;
    contextFiles?: string[];
  }): number {
    let tokens = this.estimate(params.basePrompt);

    // Tool schemas: ~500 tokens each (varies widely by tool complexity)
    if (params.toolCount) {
      tokens += params.toolCount * 500;
    }

    // Skills: ~50 tokens each (shorter than full tool schemas)
    if (params.skillCount) {
      tokens += params.skillCount * 50;
    }

    // Context files: estimate from actual content
    if (params.contextFiles && params.contextFiles.length > 0) {
      for (const file of params.contextFiles) {
        tokens += Math.ceil(file.length / 4); // Slightly less conservative for file content
      }
    }

    return tokens;
  }

  /**
   * Extract text content from ContentBlock array
   *
   * @param blocks - Array of ContentBlocks
   * @returns Concatenated text content
   */
  private extractTextFromBlocks(blocks: ContentBlock[]): string {
    return blocks
      .map((block) => {
        switch (block.type) {
          case 'text':
            return block.text || block.content || '';
          case 'tool_result':
            return block.content || '';
          case 'tool_use':
            // Tool use blocks have structured data, estimate conservatively
            return JSON.stringify(block);
          case 'image':
            // Image tokens are handled separately by providers
            // For estimation purposes, assign a fixed cost
            return '[IMAGE_PLACEHOLDER_~1000_TOKENS]';
          default:
            return '';
        }
      })
      .join(' ');
  }

  /**
   * Get the character-to-token ratio used for estimation
   *
   * @returns Current chars/token ratio
   */
  getCharsPerToken(): number {
    return this.CHARS_PER_TOKEN;
  }

  /**
   * Calculate accuracy percentage based on actual vs estimated tokens
   *
   * @param estimated - Estimated token count
   * @param actual - Actual token count from LLM provider
   * @returns Accuracy as percentage (0-100)
   */
  calculateAccuracy(estimated: number, actual: number): number {
    if (actual === 0) {
      return estimated === 0 ? 100 : 0;
    }

    const error = Math.abs(estimated - actual);
    const accuracy = 100 - (error / actual) * 100;

    return Math.max(0, Math.min(100, accuracy));
  }

  /**
   * Get token estimation statistics for a set of messages
   *
   * @param messages - Array of messages to analyze
   * @returns Statistics object
   */
  getStatistics(messages: ContextMessage[]): TokenEstimationStats {
    const totalTokens = this.estimateMessages(messages);
    const messageCount = messages.length;
    const avgTokensPerMessage = messageCount > 0 ? totalTokens / messageCount : 0;

    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    const toolMessages = messages.filter((m) => m.role === 'tool');

    return {
      totalTokens,
      messageCount,
      avgTokensPerMessage,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      toolMessages: toolMessages.length,
      estimatedAccuracy: '80-90%', // Based on heuristic method
      method: 'heuristic',
      charsPerToken: this.CHARS_PER_TOKEN,
    };
  }
}

/**
 * Token estimation statistics
 */
export interface TokenEstimationStats {
  totalTokens: number;
  messageCount: number;
  avgTokensPerMessage: number;
  userMessages: number;
  assistantMessages: number;
  toolMessages: number;
  estimatedAccuracy: string;
  method: 'heuristic' | 'tiktoken' | 'provider-api';
  charsPerToken: number;
}

/**
 * Singleton instance of TokenEstimator for convenience
 */
export const tokenEstimator = new TokenEstimator();

/**
 * Convenience function to estimate tokens for a string
 *
 * @param text - Text to estimate
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return tokenEstimator.estimate(text);
}

/**
 * Convenience function to estimate tokens for messages
 *
 * @param messages - Messages to estimate
 * @returns Total estimated token count
 */
export function estimateMessageTokens(messages: ContextMessage[]): number {
  return tokenEstimator.estimateMessages(messages);
}
