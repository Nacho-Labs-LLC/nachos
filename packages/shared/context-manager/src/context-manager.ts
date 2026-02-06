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
export interface ContextManagerDependencies {
  snapshotService?: IContextSnapshotService;
  summarizationService?: ISummarizationService;
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

  constructor(config: ContextManagementConfig, dependencies?: ContextManagerDependencies) {
    this.config = config;
    this.budgetCalculator = new ContextBudgetCalculator();
    this.slidingManager = new SlidingWindowManager();
    this.extractionAdapter = new DLPExtractionAdapter(config.proactive_history);
    this.messageAdapter = new MessageAdapter();
    this.snapshotService = dependencies?.snapshotService;
    this.summarizationService = dependencies?.summarizationService;
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
  }): Promise<ContextCheckResult> {
    const { messages, systemPromptTokens, contextWindow, reserveTokens } = params;

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
  }): Promise<EnhancedCompactionResult> {
    const { sessionId, messages, action } = params;
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
          },
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
        slidingConfig.slide_strategy === 'turn'
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
      let summaryText: string | undefined;
      if (
        this.summarizationService &&
        config.summarization?.enabled &&
        slidingResult.needsSummarization &&
        slidingResult.summaryTier
      ) {
        try {
          const summaryResult = await this.summarizationService.summarize(
            slidingResult.messagesDropped,
            slidingResult.summaryTier
          );
          summaryText = summaryResult.summary;
        } catch (error) {
          console.warn('[ContextManager] Summarization failed:', error);
          // Continue without summary - not critical
        }
      }

      // Step 6: Extract history if enabled
      let extracted = undefined;
      if (config.proactive_history?.enabled) {
        // Check if we should extract
        const shouldExtract =
          config.proactive_history.triggers?.on_compaction ||
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
        0,
      );
      const tokensAfter = slidingResult.messagesKept.reduce(
        (sum, m) => sum + this.messageAdapter.estimateMessageTokens(m),
        0,
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
    result: { messagesKept: ContextMessage[]; messagesDropped: ContextMessage[]; tokensRemoved: number },
    action: SlidingAction,
  ): string {
    const { messagesKept, messagesDropped, tokensRemoved } = result;

    return `${action.type} compaction: Dropped ${messagesDropped.length} messages (${tokensRemoved.toLocaleString()} tokens), kept ${messagesKept.length} messages`;
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
}

/**
 * Factory function to create ContextManager with defaults
 */
export function createContextManager(
  config?: Partial<ContextManagementConfig>,
  dependencies?: ContextManagerDependencies,
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
