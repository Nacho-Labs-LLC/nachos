/**
 * @nachos/context-manager - Context Management System for NACHOS
 *
 * Enables indefinite AI assistant sessions through intelligent context handling.
 *
 * @example
 * ```typescript
 * import { createContextManager } from '@nachos/context-manager';
 *
 * const contextManager = createContextManager({
 *   sliding_window: { enabled: true, mode: 'hybrid' },
 *   proactive_history: { enabled: true },
 * });
 *
 * const check = await contextManager.checkBeforeTurn({
 *   sessionId: 'session-123',
 *   messages: nachosMessages,
 *   systemPromptTokens: 15000,
 *   contextWindow: 200000,
 *   reserveTokens: 20000,
 * });
 *
 * if (check.needsCompaction) {
 *   const result = await contextManager.compact({
 *     sessionId: 'session-123',
 *     messages: nachosMessages,
 *     action: check.action!,
 *   });
 * }
 * ```
 */

// ============================================================================
// Main Exports
// ============================================================================

export {
  ContextManager,
  createContextManager,
  type ContextManagerDependencies,
} from './context-manager.js';

// ============================================================================
// Core Components
// ============================================================================

export {
  ContextBudgetCalculator,
  formatContextBudget,
  shouldCompact,
  getCompactionUrgency,
} from './budget/calculator.js';

export {
  SlidingWindowManager,
  estimateAverageTokensPerMessage,
  findTurnBoundaries,
  describeSlidingAction,
} from './sliding/manager.js';

export { DLPExtractionAdapter, getDefaultAdapter } from './extraction/dlp-adapter.js';

export { MessageAdapter, messageAdapter } from './integration/message-adapter.js';

export {
  TokenEstimator,
  tokenEstimator,
  estimateTokens,
  estimateMessageTokens,
  type TokenEstimationStats,
} from './utils/token-counter.js';

export {
  ContextSnapshotService,
  createSnapshotService,
  type CreateSnapshotOptions,
  type ListSnapshotsOptions,
  type SnapshotServiceConfig,
} from './snapshot/service.js';

export {
  SnapshotRotation,
  createSnapshotRotation,
  formatBytes,
  type SnapshotCleanupConfig,
  type CleanupResult,
} from './snapshot/rotation.js';

export {
  SnapshotRestorer,
  createSnapshotRestorer,
  type RestoreResult,
  type RestoreOptions,
} from './snapshot/restore.js';

export {
  SummarizationService,
  createSummarizationService,
  MockLLMProvider,
  type LLMProvider,
} from './summarization/service.js';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Message types
  ContextMessage,
  ContentBlock,
  ToolCall,

  // Budget types
  ContextBudget,
  ContextZone,
  ContextZoneThresholds,

  // Configuration types
  ContextManagementConfig,
  SlidingWindowConfig,
  SummarizationConfig,
  SummarizationTier,
  SummarizationResult,
  ProactiveHistoryConfig,

  // Classification types
  MessageImportance,
  MessageCategory,
  MessageClassification,
  ClassificationRules,

  // Operation types
  SlidingAction,
  SlidingResult,
  ContextCheckResult,
  EnhancedCompactionResult,

  // Extraction types
  HistoryExtractor,
  ExtractedItem,

  // Snapshot types
  ContextSnapshot,

  // State types
  ContextManagerState,
  CompactionEvent,

  // Service interfaces
  IContextBudgetCalculator,
  ISlidingWindowManager,
  ISummarizationService,
  IHistoryExtractorService,
  IContextSnapshotService,
} from './types/index.js';
