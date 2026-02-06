/**
 * NACHOS Context Management System - Type Definitions
 *
 * Core types for sliding window, summarization, and proactive history saving.
 * Adapted from context-management-prototype for NACHOS architecture.
 */

// ============================================================================
// Message Types (NACHOS-compatible)
// ============================================================================

/**
 * Internal message format for context management operations.
 * Compatible with NACHOS Message type via MessageAdapter.
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];

  /** Optional message ID (for tracking) */
  id?: string;

  /** Optional timestamp */
  timestamp?: number;

  /** Cached token count (set by MessageAdapter) */
  _tokenCache?: number;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  content?: string;
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  name?: string;
  input?: Record<string, unknown>;
  function?: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

// ============================================================================
// Context Budget & Tracking
// ============================================================================

export interface ContextBudget {
  /** Total context window in tokens (from model) */
  total: number;

  /** Estimated system prompt size in tokens */
  systemPrompt: number;

  /** Reserved tokens for model response */
  reserved: number;

  /** Available tokens for conversation history */
  historyBudget: number;

  /** Current history token usage */
  currentUsage: number;

  /** Utilization ratio (0.0 - 1.0+) */
  utilizationRatio: number;

  /** Current zone */
  zone: ContextZone;
}

export type ContextZone = 'green' | 'yellow' | 'orange' | 'red' | 'critical';

export interface ContextZoneThresholds {
  /** Green zone: 0 - proactivePrune */
  proactivePrune: number;  // default: 0.60

  /** Yellow zone: proactivePrune - lightCompaction */
  lightCompaction: number;  // default: 0.75

  /** Orange zone: lightCompaction - aggressiveCompaction */
  aggressiveCompaction: number;  // default: 0.85

  /** Red zone: aggressiveCompaction - emergency */
  emergency: number;  // default: 0.95

  /** Critical zone: emergency+ */
}

// ============================================================================
// Sliding Window Configuration
// ============================================================================

export interface SlidingWindowConfig {
  enabled: boolean;
  mode: 'token-based' | 'message-based' | 'hybrid';

  thresholds: ContextZoneThresholds;

  keepRecent: {
    /** Always keep last N turns (user+assistant pairs) */
    turns: number;

    /** Always keep last N individual messages */
    messages: number;

    /** Minimum tokens to preserve in recent history */
    tokenBudget: number;
  };

  /** How to slide: by chunk, individual message, or turn pair */
  slideStrategy: 'chunk' | 'message' | 'turn';

  /** Messages per slide operation (if slideStrategy = 'chunk') */
  chunkSize?: number;
}

// ============================================================================
// Summarization Configuration
// ============================================================================

export interface SummarizationConfig {
  enabled?: boolean;
  mode?: 'single' | 'multi-tier';

  tiers?: {
    /** Ultra-compressed (oldest history) */
    archival?: SummarizationTierConfig;

    /** Compressed (mid-range history) */
    compressed?: SummarizationTierConfig;

    /** Lightly summarized (recent history) */
    condensed?: SummarizationTierConfig;
  };

  contentClassification?: {
    enabled?: boolean;
    preserveCritical?: boolean;
    preserveCode?: boolean;
    preserveErrors?: boolean;
  };

  /** Optional preservation rules for system prompts */
  preserveRules?: {
    decisions?: boolean;
    tasks?: boolean;
    errors?: boolean;
    code?: boolean;
    context?: boolean;
  };

  /** User-provided instructions for summarization */
  customInstructions?: string;
}

export type SummarizationTier = 'archival' | 'compressed' | 'condensed';

export interface SummarizationTierConfig {
  /** Target compression ratio (0.0 - 1.0) */
  compressionRatio: number;

  /** Output format */
  format: 'bullet-points' | 'structured-summary' | 'detailed-summary';

  /** What to preserve */
  preserves?: string[];
}

export interface SummarizationResult {
  /** The generated summary */
  summary: string;

  /** Compression tier used */
  tier: SummarizationTier;

  /** Original token count (before summarization) */
  originalTokens: number;

  /** Summary token count (after summarization) */
  summaryTokens: number;

  /** Compression ratio (0-1, where 1 = no compression) */
  compressionRatio: number;

  /** Messages that were summarized */
  messagesCount: number;
}

// ============================================================================
// Content Classification
// ============================================================================

export type MessageImportance = 'critical' | 'high' | 'medium' | 'low';

export type MessageCategory =
  | 'decision'
  | 'fact'
  | 'task'
  | 'context'
  | 'ephemeral'
  | 'code'
  | 'error'
  | 'tool-result';

export interface MessageClassification {
  importance: MessageImportance;
  category: MessageCategory;

  /** Reasons for this classification */
  reasons: string[];

  /** Confidence score (0.0 - 1.0) */
  confidence: number;
}

export interface ClassificationRules {
  critical: RegExp[];
  high: RegExp[];
  medium: RegExp[];
  low: RegExp[];
}

// ============================================================================
// Proactive History Saving
// ============================================================================

export interface ProactiveHistoryConfig {
  enabled: boolean;

  extractors: {
    decisions: boolean;
    facts: boolean;
    tasks: boolean;
    issues: boolean;
    files: boolean;
  };

  triggers: {
    onCompaction: boolean;
    onThreshold: number;  // Context ratio to trigger
    onMemoryFlush: boolean;
    periodic?: string;  // e.g., '1h', '30m'
  };

  snapshots: {
    enabled: boolean;
    dir?: string;
    maxSnapshots: number;
  };

  summaryArchive?: {
    enabled: boolean;
    dir: string;
    maxSummaries: number;
  };

  /** Custom YAML pattern files for DLP extraction */
  customPatternFiles?: string[];
}

export interface HistoryExtractor {
  type: 'decisions' | 'facts' | 'tasks' | 'issues' | 'files';
  pattern: RegExp;
  storage: string;

  /** Extract matches from messages */
  extract(messages: ContextMessage[]): ExtractedItem[];
}

export interface ExtractedItem {
  type: MessageCategory;
  content: string;
  sourceMessageId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Context Snapshot
// ============================================================================

export interface ContextSnapshot {
  id: string;
  timestamp: string;
  sessionId: string;
  trigger: 'manual' | 'auto-compaction' | 'auto-threshold' | 'periodic';
  messageCount: number;
  messages: ContextMessage[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Compaction Result (Enhanced)
// ============================================================================

export interface EnhancedCompactionResult {
  ok: boolean;
  compacted: boolean;

  /** Compaction details */
  result?: {
    summary: string;
    tokensBefore: number;
    tokensAfter: number;
    compressionRatio: number;
    messagesDropped: number;
    messagesKept: number;
    firstKeptEntryId?: string;
    tier?: SummarizationTier;
  };

  /** Context snapshot created */
  snapshot?: ContextSnapshot;
  snapshotId?: string;

  /** Extracted history items */
  extracted?: {
    decisions: ExtractedItem[];
    facts: ExtractedItem[];
    tasks: ExtractedItem[];
    issues: ExtractedItem[];
    files: ExtractedItem[];
  };

  /** Messages kept after compaction (NACHOS format) */
  messagesKept?: ContextMessage[];
  messagesDropped?: ContextMessage[];
  slidingResult?: SlidingResult;
  budget?: ContextBudget;
  summary?: string;

  /** Error reason if not ok */
  reason?: string;
}

// ============================================================================
// Context Manager State
// ============================================================================

export interface ContextManagerState {
  sessionId: string;
  sessionKey?: string;

  /** Current context budget */
  budget: ContextBudget;

  /** Compaction history */
  compactions: CompactionEvent[];

  /** Last extraction timestamp */
  lastExtraction?: number;

  /** Configuration */
  config: ContextManagementConfig;
}

export interface CompactionEvent {
  timestamp: number;
  trigger: 'manual' | 'auto-yellow' | 'auto-orange' | 'auto-red' | 'auto-critical';
  zone: ContextZone;
  utilizationBefore: number;
  utilizationAfter: number;
  tokensSaved: number;
  messagesDropped: number;
  tier?: 'archival' | 'compressed' | 'condensed';
  snapshotPath?: string;
}

// ============================================================================
// Main Configuration
// ============================================================================

export interface ContextManagementConfig {
  sliding_window?: SlidingWindowConfig;
  summarization?: SummarizationConfig;
  proactive_history?: ProactiveHistoryConfig;

  /** Enhanced memory flush */
  memoryFlush?: {
    enabled: boolean;
    softThresholdTokens: number;
    extractStructured: boolean;
    createSnapshot: boolean;
    validateExtraction: boolean;
    systemPrompt: string;
    prompt: string;
  };
}

// ============================================================================
// Service Interfaces
// ============================================================================

export interface IContextBudgetCalculator {
  calculate(params: {
    messages: ContextMessage[];
    systemPromptTokens: number;
    contextWindow: number;
    reserveTokens: number;
  }): ContextBudget;

  determineZone(utilization: number, thresholds: ContextZoneThresholds): ContextZone;
}

export interface ISlidingWindowManager {
  /** Check if sliding is needed and return action */
  shouldSlide(budget: ContextBudget, config: SlidingWindowConfig): SlidingAction | null;

  /** Execute sliding window operation */
  slide(params: {
    messages: ContextMessage[];
    action: SlidingAction;
    config: SlidingWindowConfig;
  }): SlidingResult;
}

export interface SlidingAction {
  type: 'prune' | 'compact-light' | 'compact-aggressive' | 'compact-emergency';
  zone: ContextZone;
  reason: string;

  /** Recommended messages to drop/compress */
  targetDropCount?: number;
  targetTokenReduction?: number;
}

export interface SlidingResult {
  messagesKept: ContextMessage[];
  messagesDropped: ContextMessage[];
  tokensRemoved: number;

  /** Should trigger summarization? */
  needsSummarization: boolean;
  summaryTier?: 'archival' | 'compressed' | 'condensed';
}

export interface ISummarizationService {
  /** Summarize messages with given tier */
  summarize(messages: ContextMessage[], tier: SummarizationTier): Promise<SummarizationResult>;
}

export interface IHistoryExtractorService {
  /** Extract important items from messages */
  extract(params: {
    messages: ContextMessage[];
    config: ProactiveHistoryConfig;
  }): Promise<{
    decisions: ExtractedItem[];
    facts: ExtractedItem[];
    tasks: ExtractedItem[];
    issues: ExtractedItem[];
    files: ExtractedItem[];
  }>;

  /** Save extracted items to memory files */
  save(params: {
    sessionId: string;
    extracted: Record<string, ExtractedItem[]>;
  }): Promise<void>;
}

export interface IContextSnapshotService {
  /** Create context snapshot before compaction */
  createSnapshot(params: {
    sessionId: string;
    messages: ContextMessage[];
    trigger: 'manual' | 'auto-compaction' | 'auto-threshold' | 'periodic';
    metadata?: Record<string, unknown>;
  }): Promise<ContextSnapshot>;

  /** Get snapshot by ID */
  getSnapshot(sessionId: string, snapshotId: string): Promise<ContextSnapshot | null>;

  /** List all snapshots for session */
  listSnapshots(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ContextSnapshot[]>;

  /** Get latest snapshot for session */
  getLatestSnapshot(sessionId: string): Promise<ContextSnapshot | null>;

  /** Delete snapshot */
  deleteSnapshot(sessionId: string, snapshotId: string): Promise<boolean>;

  /** Delete all snapshots for session */
  deleteAllSnapshots(sessionId: string): Promise<number>;

  /** Get snapshot count */
  getSnapshotCount(sessionId: string): Promise<number>;
}

// ============================================================================
// Context Check Result (for Gateway integration)
// ============================================================================

export interface ContextCheckResult {
  budget: ContextBudget;
  needsCompaction: boolean;
  action: SlidingAction | null;
}
