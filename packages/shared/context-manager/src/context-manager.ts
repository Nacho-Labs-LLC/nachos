/**
 * NACHOS Context Manager - Main Orchestration Class
 *
 * Primary entry point for context management functionality.
 * Coordinates budget calculation, sliding windows, and history extraction.
 */

import type {
  ContextManagementConfig,
  ContextCheckResult,
  ContextMessage,
  EnhancedCompactionResult,
  SlidingAction,
  IContextSnapshotService,
  ISummarizationService,
} from './types/index.js';
import { ContextBudgetCalculator } from './budget/calculator.js';
import { SlidingWindowManager } from './sliding/manager.js';
import { DLPExtractionAdapter } from './extraction/dlp-adapter.js';
import { MessageAdapter } from './integration/message-adapter.js';

/**
 * Context Manager dependencies (optional)
 */
/**
 * H2: Memory search function type for semantic search integration
 */
export type MemorySearchFunction = (query: {
  text: string;
  limit?: number;
  semantic?: boolean;
  minSimilarity?: number;
}) => Promise<{
  entries: Array<{
    kind: string;
    content: string;
    confidence?: number;
    tags?: string[];
  }>;
}>;

export interface ContextManagerDependencies {
  snapshotService?: IContextSnapshotService;
  summarizationService?: ISummarizationService;
  memorySearch?: MemorySearchFunction; // H2: Semantic search integration
}

/**
 * Main Context Manager class for NACHOS
 *
 * Provides high-level API for context management operations.
 * Used by Gateway to perform pre-turn checks and compaction.
 */
export class ContextManager {
  private config: ContextManagementConfig;
  private budgetCalculator: ContextBudgetCalculator;
  private slidingManager: SlidingWindowManager;
  private extractionAdapter: DLPExtractionAdapter;
  private messageAdapter: MessageAdapter;
  private snapshotService?: IContextSnapshotService;
  private summarizationService?: ISummarizationService;
  private memorySearch?: MemorySearchFunction; // H2: Semantic search

  constructor(config: ContextManagementConfig, dependencies?: ContextManagerDependencies) {
    this.config = config;
    this.budgetCalculator = new ContextBudgetCalculator();
    this.slidingManager = new SlidingWindowManager();
    this.extractionAdapter = new DLPExtractionAdapter(config.proactive_history);
    this.messageAdapter = new MessageAdapter();
    this.snapshotService = dependencies?.snapshotService;
    this.summarizationService = dependencies?.summarizationService;
    this.memorySearch = dependencies?.memorySearch; // H2
  }

  /**
   * Check context before turn and determine if action needed
   *
   * This is the primary entry point called by Gateway before each LLM request.
   *
   * @param params - Session context parameters
   * @returns Check result with budget state and recommended action
   */
  async checkBeforeTurn(params: {
    sessionId: string;
    messages: ContextMessage[];
    systemPromptTokens: number;
    contextWindow: number;
    reserveTokens: number;
    channel?: string; // C1: Cross-channel isolation
    userId?: string; // C1: Cross-channel isolation
    injectMemory?: boolean; // H2: Enable semantic search injection
  }): Promise<ContextCheckResult> {
    const { messages, systemPromptTokens, contextWindow, reserveTokens, injectMemory = true } = params;
    
    // C1: channel and userId are used in compact() method, validated there

    // H2: Auto-inject semantic search results before calculating budget
    if (injectMemory && this.memorySearch && messages.length > 0) {
      await this.injectSemanticMemory(messages);
    }

    // Calculate current budget
    const budget = this.budgetCalculator.calculate({
      messages,
      systemPromptTokens,
      contextWindow,
      reserveTokens,
    });

    // Check if sliding/compaction needed
    const action = this.config.sliding_window?.enabled
      ? this.slidingManager.shouldSlide(budget, this.config.sliding_window)
      : null;

    return {
      budget,
      needsCompaction: action !== null,
      action,
    };
  }

  /**
   * Execute compaction operation
   *
   * Called when checkBeforeTurn indicates compaction is needed.
   * Performs sliding window operation and optional history extraction.
   *
   * @param params - Compaction parameters
   * @returns Enhanced compaction result with extracted items and statistics
   */
  async compact(params: {
    sessionId: string;
    messages: ContextMessage[];
    action: SlidingAction;
    config?: ContextManagementConfig;
    channel?: string; // C1: Cross-channel isolation
    userId?: string; // C1: Cross-channel isolation
  }): Promise<EnhancedCompactionResult> {
    const { sessionId, messages, action, channel, userId } = params;
    const config = params.config || this.config;

    try {
      // Step 1: Create snapshot before compaction (if enabled)
      let snapshotId: string | undefined;
      if (this.snapshotService && config.proactive_history?.snapshots?.enabled) {
        const snapshot = await this.snapshotService.createSnapshot({
          sessionId,
          messages,
          trigger: 'auto-compaction',
          metadata: {
            action: action.type,
            zone: action.zone,
            reason: action.reason,
            // C1: Include channel and userId for cross-channel isolation
            channel,
            userId,
          },
          // C1: Pass channel and userId for composite key storage
          channel,
          userId,
        });
        snapshotId = snapshot.id;
      }

      // Step 2: Determine sliding strategy
      const slidingConfig = config.sliding_window;
      if (!slidingConfig) {
        return {
          ok: false,
          compacted: false,
          reason: 'Sliding window not configured',
        };
      }

      // Step 3: Execute sliding operation
      const slidingResult =
        slidingConfig.slideStrategy === 'turn'
          ? this.slidingManager.slideByTurns({ messages, action, config: slidingConfig })
          : this.slidingManager.slide({ messages, action, config: slidingConfig });

      // Step 4: Validate result
      const validation = this.slidingManager.validateResult(slidingResult, action, slidingConfig);
      if (!validation.valid) {
        return {
          ok: false,
          compacted: false,
          reason: validation.reason,
        };
      }

      // Step 5: Generate summary of dropped messages (if enabled and needed)
      // H1: Retry logic for summarization failures
      let summaryText: string | undefined;
      if (
        this.summarizationService &&
        config.summarization?.enabled &&
        slidingResult.needsSummarization &&
        slidingResult.summaryTier
      ) {
        const maxRetries = 3;
        let attempt = 0;
        let lastError: Error | null = null;

        while (attempt < maxRetries) {
          try {
            const summaryResult = await this.summarizationService.summarize(
              slidingResult.messagesDropped,
              slidingResult.summaryTier
            );
            summaryText = summaryResult.summary;
            break; // Success, exit retry loop
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            attempt++;
            console.warn(`[ContextManager] Summarization attempt ${attempt}/${maxRetries} failed:`, error);
            
            if (attempt < maxRetries) {
              // Exponential backoff: 1s, 2s, 4s
              const backoffMs = Math.pow(2, attempt - 1) * 1000;
              await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
          }
        }

        // H1: If all retries exhausted, fall back to message concatenation
        if (!summaryText && lastError) {
          console.error(`[ContextManager] Summarization failed after ${maxRetries} retries. Falling back to concatenation.`);
          summaryText = this.fallbackMessageConcatenation(slidingResult.messagesDropped);
        }
      }

      // Step 6: Extract history if enabled
      let extracted = undefined;
      if (config.proactive_history?.enabled) {
        // Check if we should extract
        const shouldExtract =
          config.proactive_history.triggers?.onCompaction ||
          this.extractionAdapter.shouldExtract({
            messageCount: slidingResult.messagesDropped.length,
            utilizationRatio: action.zone === 'critical' ? 1.0 : 0.75,
          });

        if (shouldExtract) {
          extracted = await this.extractionAdapter.extract(slidingResult.messagesDropped);
        }
      }

      // Step 7: Calculate token statistics
      const tokensBefore = messages.reduce(
        (sum, m) => sum + this.messageAdapter.estimateMessageTokens(m),
        0
      );
      const tokensAfter = slidingResult.messagesKept.reduce(
        (sum, m) => sum + this.messageAdapter.estimateMessageTokens(m),
        0
      );

      // Step 8: Recalculate budget after compaction
      const budgetAfter = this.budgetCalculator.calculate({
        messages: slidingResult.messagesKept,
        systemPromptTokens: 0, // Not relevant for post-compaction budget
        contextWindow: 200000,
        reserveTokens: 0,
      });

      return {
        ok: true,
        compacted: true,
        result: {
          summary: summaryText || this.generateCompactionSummary(slidingResult, action),
          tokensBefore,
          tokensAfter,
          compressionRatio: tokensAfter / tokensBefore,
          messagesDropped: slidingResult.messagesDropped.length,
          messagesKept: slidingResult.messagesKept.length,
          tier: slidingResult.summaryTier,
        },
        extracted,
        messagesKept: slidingResult.messagesKept,
        messagesDropped: slidingResult.messagesDropped,
        slidingResult,
        budget: budgetAfter,
        summary: summaryText,
        snapshotId,
      };
    } catch (error) {
      return {
        ok: false,
        compacted: false,
        reason: error instanceof Error ? error.message : 'Unknown error during compaction',
      };
    }
  }

  /**
   * Generate human-readable summary of compaction
   */
  private generateCompactionSummary(
    result: {
      messagesKept: ContextMessage[];
      messagesDropped: ContextMessage[];
      tokensRemoved: number;
    },
    action: SlidingAction
  ): string {
    const { messagesKept, messagesDropped, tokensRemoved } = result;

    return `${action.type} compaction: Dropped ${messagesDropped.length} messages (${tokensRemoved.toLocaleString()} tokens), kept ${messagesKept.length} messages`;
  }

  /**
   * H1: Fallback message concatenation when summarization fails
   * 
   * Instead of losing context entirely, concatenate dropped messages
   * into a simple text format for context preservation.
   */
  private fallbackMessageConcatenation(messages: ContextMessage[]): string {
    if (messages.length === 0) {
      return '[No messages to summarize]';
    }

    const lines: string[] = [
      '=== Context Summary (Fallback - Summarization Failed) ===',
      `Preserved ${messages.length} messages without LLM summarization:`,
      '',
    ];

    for (const msg of messages) {
      const role = msg.role.toUpperCase();
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : msg.content.map(block => {
            if (block.type === 'text') return block.text || block.content || '';
            if (block.type === 'tool_result') return `[Tool: ${block.content || ''}]`;
            if (block.type === 'tool_use') return '[Tool Use]';
            return '';
          }).join(' ');

      // Truncate very long messages to keep fallback summary reasonable
      const truncated = content.length > 500 ? content.substring(0, 500) + '...' : content;
      
      lines.push(`[${role}] ${truncated}`);
    }

    lines.push('');
    lines.push('=== End Context Summary ===');

    return lines.join('\n');
  }

  /**
   * Get current configuration
   */
  getConfig(): ContextManagementConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagementConfig>): void {
    this.config = { ...this.config, ...config };

    // Recreate extraction adapter if proactive history config changed
    if (config.proactive_history) {
      this.extractionAdapter = new DLPExtractionAdapter(config.proactive_history);
    }
  }

  /**
   * Get message adapter instance
   */
  getMessageAdapter(): MessageAdapter {
    return this.messageAdapter;
  }

  /**
   * H2: Extract topic/query from the most recent user message
   * 
   * Analyzes the user's latest message to identify key topics for semantic search
   */
  private extractTopicFromMessage(message: ContextMessage): string | null {
    if (message.role !== 'user') {
      return null;
    }

    const content = typeof message.content === 'string'
      ? message.content
      : message.content
          .filter(block => block.type === 'text')
          .map(block => block.text || block.content || '')
          .join(' ');

    // Skip very short messages (likely not enough context)
    if (content.length < 10) {
      return null;
    }

    // Simple topic extraction: take the full message (could be enhanced with NLP)
    // For now, we'll use the full content and let semantic search handle similarity
    return content.trim();
  }

  /**
   * H2: Auto-inject semantic search results into context
   * 
   * Before each LLM turn, extract topic from user message, run semantic search
   * on memory, and inject top results into context.
   */
  private async injectSemanticMemory(messages: ContextMessage[]): Promise<void> {
    if (!this.memorySearch) {
      return;
    }

    // Get the most recent user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) {
      return;
    }

    // Extract topic for search
    const topic = this.extractTopicFromMessage(lastUserMessage);
    if (!topic) {
      return;
    }

    try {
      // Run semantic search
      const searchResults = await this.memorySearch({
        text: topic,
        limit: 5, // Top 5 most relevant memories
        semantic: true,
        minSimilarity: 0.6,
      });

      // If we have results, inject them as a system-style context message
      if (searchResults.entries && searchResults.entries.length > 0) {
        const memoryContent = this.formatMemoryResults(searchResults.entries);
        
        // Create a context injection message
        const memoryMessage: ContextMessage = {
          role: 'system',
          content: memoryContent,
          timestamp: Date.now(),
          _tokenCache: this.messageAdapter.estimateMessageTokens({
            role: 'system',
            content: memoryContent,
          } as ContextMessage),
        };

        // Insert before the last user message (so it's fresh context for the LLM)
        const insertIndex = messages.indexOf(lastUserMessage);
        messages.splice(insertIndex, 0, memoryMessage);

        console.log(`[ContextManager] Injected ${searchResults.entries.length} semantic memory results`);
      }
    } catch (error) {
      console.warn('[ContextManager] Semantic memory injection failed:', error);
      // Non-critical, continue without memory injection
    }
  }

  /**
   * H2: Format memory search results for injection
   */
  private formatMemoryResults(entries: Array<{
    kind: string;
    content: string;
    confidence?: number;
    tags?: string[];
  }>): string {
    const lines: string[] = [
      '=== Relevant Context from Memory ===',
      'The following memories may be relevant to the current conversation:',
      '',
    ];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      
      const confidence = entry.confidence ? ` (${(entry.confidence * 100).toFixed(0)}% relevant)` : '';
      const tags = entry.tags && entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
      
      lines.push(`${i + 1}. [${entry.kind}]${tags}${confidence}`);
      lines.push(`   ${entry.content}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}

/**
 * Factory function to create ContextManager with defaults
 */
export function createContextManager(
  config?: Partial<ContextManagementConfig>,
  dependencies?: ContextManagerDependencies
): ContextManager {
  const defaultConfig: ContextManagementConfig = {
    sliding_window: {
      enabled: config?.sliding_window?.enabled ?? true,
      mode: config?.sliding_window?.mode ?? 'hybrid',
      thresholds: {
        proactivePrune: 0.6,
        lightCompaction: 0.75,
        aggressiveCompaction: 0.85,
        emergency: 0.95,
        ...config?.sliding_window?.thresholds,
      },
      keepRecent: {
        turns: 10,
        messages: 20,
        tokenBudget: 10000,
        ...config?.sliding_window?.keepRecent,
      },
      slideStrategy: config?.sliding_window?.slideStrategy ?? 'turn',
      ...config?.sliding_window,
    },
    summarization: {
      enabled: config?.summarization?.enabled ?? true,
      mode: config?.summarization?.mode ?? 'multi-tier',
      tiers: {
        archival: {
          compressionRatio: 0.05,
          format: 'bullet-points',
          ...config?.summarization?.tiers?.archival,
        },
        compressed: {
          compressionRatio: 0.2,
          format: 'structured-summary',
          ...config?.summarization?.tiers?.compressed,
        },
        condensed: {
          compressionRatio: 0.5,
          format: 'detailed-summary',
          ...config?.summarization?.tiers?.condensed,
        },
      },
      contentClassification: {
        enabled: true,
        preserveCritical: true,
        preserveCode: true,
        preserveErrors: true,
        ...config?.summarization?.contentClassification,
      },
      ...config?.summarization,
    },
    proactive_history: {
      enabled: config?.proactive_history?.enabled ?? true,
      extractors: {
        decisions: true,
        facts: true,
        tasks: true,
        issues: true,
        files: true,
        ...config?.proactive_history?.extractors,
      },
      triggers: {
        onCompaction: true,
        onThreshold: 0.75,
        onMemoryFlush: true,
        ...config?.proactive_history?.triggers,
      },
      snapshots: {
        enabled: true,
        maxSnapshots: 10,
        ...config?.proactive_history?.snapshots,
      },
      ...config?.proactive_history,
    },
  };

  return new ContextManager(defaultConfig, dependencies);
}
