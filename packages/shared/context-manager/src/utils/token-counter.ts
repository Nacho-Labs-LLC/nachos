/**
 * Token Counter - Token estimation utilities for context management
 *
 * Provides heuristic-based token estimation using the OpenAI rule of thumb.
 * Uses a conservative multiplier of 3.5 chars/token for ~80-90% accuracy.
 *
 * NOTE: Configurable chars-per-token ratio and safety buffer added
 * to reduce 10-20% error margin. Use 90% threshold instead of 95% for critical zone.
 */

import { createLogger } from '@nachos/types';
import type { ContextMessage, ContentBlock } from '../types/index.js';

const logger = createLogger('token-estimator');

/**
 * Token estimation configuration
 */
export interface TokenEstimatorConfig {
  /**
   * Character-to-token ratio
   * Default: 3.5 (conservative for English)
   * Lower values = more conservative (estimate higher token counts)
   */
  charsPerToken?: number;

  /**
   * Safety buffer multiplier (applied to estimates)
   * Default: 1.1 (10% safety margin)
   * Helps account for estimation errors
   */
  safetyBuffer?: number;

  /**
   * Overhead tokens per message (role, structure, formatting)
   * Default: 4
   */
  messageOverhead?: number;

  /**
   * Average tokens per tool call (rough estimate)
   * Default: 10
   */
  toolCallOverhead?: number;
}

/**
 * Token estimation class using character-based heuristics
 */
export class TokenEstimator {
  /**
   * Character-to-token ratio (configurable)
   * OpenAI suggests ~4 chars/token for English, we use 3.5 to be conservative
   */
  private charsPerToken: number;

  /**
   * Safety buffer multiplier (configurable)
   * Applied to all token estimates to add safety margin
   */
  private safetyBuffer: number;

  /**
   * Overhead tokens per message (role, structure, formatting)
   */
  private messageOverhead: number;

  /**
   * Average tokens per tool call (rough estimate)
   */
  private toolCallOverhead: number;

  /**
   * Calibration history for adaptive estimation
   * Tracks actual vs estimated token ratios
   */
  private calibrationHistory: Array<{ estimated: number; actual: number; timestamp: number }> = [];
  private maxCalibrationHistory = 100;

  constructor(config: TokenEstimatorConfig = {}) {
    this.charsPerToken = config.charsPerToken ?? 3.5;
    this.safetyBuffer = config.safetyBuffer ?? 1.1; // 10% safety margin
    this.messageOverhead = config.messageOverhead ?? 4;
    this.toolCallOverhead = config.toolCallOverhead ?? 10;
  }

  /**
   * Estimate tokens for a text string
   *
   * @param text - Text content to estimate
   * @returns Estimated token count (with safety buffer applied)
   */
  estimate(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    const baseEstimate = Math.ceil(text.length / this.charsPerToken);
    return Math.ceil(baseEstimate * this.safetyBuffer);
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
    tokens += this.messageOverhead;

    // Add tool call overhead if present
    if (message.toolCalls && Array.isArray(message.toolCalls)) {
      tokens += message.toolCalls.length * this.toolCallOverhead;
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
   * Record actual token count for calibration (M1: Token budget calibration)
   *
   * After LLM responds, compare estimated tokens vs actual (from LLM response metadata).
   * Log the ratio and use it to calibrate future estimates.
   *
   * @param estimated - Estimated token count
   * @param actual - Actual token count from LLM provider
   */
  recordCalibration(estimated: number, actual: number): void {
    if (estimated <= 0 || actual <= 0) {
      return;
    }

    this.calibrationHistory.push({
      estimated,
      actual,
      timestamp: Date.now(),
    });

    // Maintain history size
    if (this.calibrationHistory.length > this.maxCalibrationHistory) {
      this.calibrationHistory.shift();
    }

    // Log calibration data
    const ratio = actual / estimated;
    const accuracy = this.calculateAccuracy(estimated, actual);
    logger.info(
      { estimated, actual, ratio: ratio.toFixed(3), accuracy: accuracy.toFixed(1) },
      'Calibration recorded'
    );
  }

  /**
   * Get calibration statistics
   *
   * Returns statistics about estimation accuracy based on calibration history
   */
  getCalibrationStats(): {
    sampleCount: number;
    avgRatio: number;
    avgAccuracy: number;
    recommendedCharsPerToken: number;
    recommendedSafetyBuffer: number;
  } | null {
    if (this.calibrationHistory.length === 0) {
      return null;
    }

    const ratios = this.calibrationHistory.map((c) => c.actual / c.estimated);
    const accuracies = this.calibrationHistory.map((c) =>
      this.calculateAccuracy(c.estimated, c.actual)
    );

    const avgRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    const avgAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;

    // Recommend adjustments based on calibration data
    // If we consistently underestimate (ratio > 1), reduce charsPerToken or increase safetyBuffer
    // If we consistently overestimate (ratio < 1), increase charsPerToken or reduce safetyBuffer
    const recommendedCharsPerToken = this.charsPerToken / avgRatio;
    const recommendedSafetyBuffer = this.safetyBuffer * (1 + (1 - avgRatio));

    return {
      sampleCount: this.calibrationHistory.length,
      avgRatio,
      avgAccuracy,
      recommendedCharsPerToken: Math.max(2.0, Math.min(5.0, recommendedCharsPerToken)), // Clamp to reasonable range
      recommendedSafetyBuffer: Math.max(1.0, Math.min(1.3, recommendedSafetyBuffer)), // Clamp to reasonable range
    };
  }

  /**
   * Apply calibration adjustments
   *
   * Automatically adjusts charsPerToken and safetyBuffer based on calibration history
   */
  applyCalibration(): boolean {
    const stats = this.getCalibrationStats();
    if (!stats || stats.sampleCount < 10) {
      return false; // Need at least 10 samples
    }

    // Only adjust if accuracy is below 90%
    if (stats.avgAccuracy < 90) {
      this.charsPerToken = stats.recommendedCharsPerToken;
      this.safetyBuffer = stats.recommendedSafetyBuffer;
      logger.info(
        {
          charsPerToken: this.charsPerToken.toFixed(2),
          safetyBuffer: this.safetyBuffer.toFixed(2),
        },
        'Calibration applied'
      );
      return true;
    }

    return false;
  }

  /**
   * Get the character-to-token ratio used for estimation
   *
   * @returns Current chars/token ratio
   */
  getCharsPerToken(): number {
    return this.charsPerToken;
  }

  /**
   * Get the safety buffer multiplier
   *
   * @returns Current safety buffer
   */
  getSafetyBuffer(): number {
    return this.safetyBuffer;
  }

  /**
   * Update configuration
   *
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<TokenEstimatorConfig>): void {
    if (config.charsPerToken !== undefined) {
      this.charsPerToken = config.charsPerToken;
    }
    if (config.safetyBuffer !== undefined) {
      this.safetyBuffer = config.safetyBuffer;
    }
    if (config.messageOverhead !== undefined) {
      this.messageOverhead = config.messageOverhead;
    }
    if (config.toolCallOverhead !== undefined) {
      this.toolCallOverhead = config.toolCallOverhead;
    }
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

    // Use calibration stats if available
    const calibrationStats = this.getCalibrationStats();
    const estimatedAccuracy = calibrationStats
      ? `${calibrationStats.avgAccuracy.toFixed(1)}%`
      : '80-90%';

    return {
      totalTokens,
      messageCount,
      avgTokensPerMessage,
      userMessages: userMessages.length,
      assistantMessages: assistantMessages.length,
      toolMessages: toolMessages.length,
      estimatedAccuracy,
      method: 'heuristic',
      charsPerToken: this.charsPerToken,
      safetyBuffer: this.safetyBuffer,
      calibrationSamples: calibrationStats?.sampleCount ?? 0,
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
  safetyBuffer?: number;
  calibrationSamples?: number;
}

/**
 * Singleton instance of TokenEstimator for convenience
 * Uses default configuration with 10% safety buffer
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
