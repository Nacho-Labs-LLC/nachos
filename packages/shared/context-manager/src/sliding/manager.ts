/**
 * NACHOS Context Management - Sliding Window Manager
 *
 * Manages sliding window operations: determines when to slide and how much.
 * Ported from context-management-prototype for NACHOS architecture.
 */

import type {
  ContextBudget,
  SlidingWindowConfig,
  SlidingAction,
  SlidingResult,
  ISlidingWindowManager,
  ContextMessage,
} from '../types/index.js';
import { tokenEstimator } from '../utils/token-counter.js';

export class SlidingWindowManager implements ISlidingWindowManager {
  /**
   * Check if sliding is needed based on current budget and config
   */
  shouldSlide(budget: ContextBudget, config: SlidingWindowConfig): SlidingAction | null {
    if (!config.enabled) return null;

    const { zone, utilizationRatio } = budget;
    const { thresholds } = config;

    // Determine action based on zone
    if (utilizationRatio >= thresholds.emergency) {
      return {
        type: 'compact-emergency',
        zone: 'critical',
        reason: 'Context critically full (≥95%), emergency compaction required',
        targetDropCount: this.calculateDropCount(budget, 0.6),
        targetTokenReduction: Math.floor(budget.currentUsage * 0.6),
      };
    }

    if (utilizationRatio >= thresholds.aggressiveCompaction) {
      return {
        type: 'compact-aggressive',
        zone: 'red',
        reason: 'Context very full (≥85%), aggressive compaction recommended',
        targetDropCount: this.calculateDropCount(budget, 0.4),
        targetTokenReduction: Math.floor(budget.currentUsage * 0.4),
      };
    }

    if (utilizationRatio >= thresholds.lightCompaction) {
      return {
        type: 'compact-light',
        zone: 'orange',
        reason: 'Context filling up (≥75%), light compaction recommended',
        targetDropCount: this.calculateDropCount(budget, 0.3),
        targetTokenReduction: Math.floor(budget.currentUsage * 0.3),
      };
    }

    if (utilizationRatio >= thresholds.proactivePrune) {
      return {
        type: 'prune',
        zone: 'yellow',
        reason: 'Context growing (≥60%), proactive pruning recommended',
        targetDropCount: this.calculateDropCount(budget, 0.15),
        targetTokenReduction: Math.floor(budget.currentUsage * 0.15),
      };
    }

    return null; // Green zone, no action needed
  }

  /**
   * Execute sliding window operation
   */
  slide(params: {
    messages: ContextMessage[];
    action: SlidingAction;
    config: SlidingWindowConfig;
  }): SlidingResult {
    const { messages, action, config } = params;

    // Calculate how many messages to keep based on action and config
    const keepRecent = this.calculateKeepRecent(messages, action, config);

    // Split messages into kept and dropped
    const splitIndex = Math.max(0, messages.length - keepRecent);
    const messagesDropped = messages.slice(0, splitIndex);
    const messagesKept = messages.slice(splitIndex);

    // Calculate tokens removed
    const tokensRemoved = tokenEstimator.estimateMessages(messagesDropped);

    // Determine if summarization is needed
    const needsSummarization = action.type !== 'prune';
    const summaryTier = this.getSummaryTier(action.type);

    return {
      messagesKept,
      messagesDropped,
      tokensRemoved,
      needsSummarization,
      summaryTier,
    };
  }

  /**
   * Calculate how many messages to keep
   */
  private calculateKeepRecent(
    messages: ContextMessage[],
    action: SlidingAction,
    config: SlidingWindowConfig,
  ): number {
    const { keepRecent } = config;

    if (config.mode === 'message-based') {
      return Math.max(keepRecent.messages, this.getMinMessagesToKeep(action));
    }

    if (config.mode === 'token-based') {
      return this.calculateKeepByTokenBudget(messages, action, keepRecent.tokenBudget);
    }

    // Hybrid mode: use token budget but respect minimum message counts
    const byTokens = this.calculateKeepByTokenBudget(messages, action, keepRecent.tokenBudget);
    const byMessages = Math.max(keepRecent.messages, this.getMinMessagesToKeep(action));

    return Math.max(byTokens, byMessages);
  }

  /**
   * Calculate how many messages to keep based on token budget
   */
  private calculateKeepByTokenBudget(
    messages: ContextMessage[],
    action: SlidingAction,
    tokenBudget: number,
  ): number {
    let tokensAccumulated = 0;
    let keepCount = 0;

    // Walk backward from most recent
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = tokenEstimator.estimateMessage(messages[i]);

      if (tokensAccumulated + msgTokens <= tokenBudget) {
        tokensAccumulated += msgTokens;
        keepCount++;
      } else {
        break; // Exceeded budget
      }
    }

    return Math.max(keepCount, this.getMinMessagesToKeep(action));
  }

  /**
   * Get minimum messages to keep based on action severity
   */
  private getMinMessagesToKeep(action: SlidingAction): number {
    switch (action.type) {
      case 'compact-emergency':
        return 10; // Keep bare minimum
      case 'compact-aggressive':
        return 15;
      case 'compact-light':
        return 20;
      case 'prune':
        return 30;
      default:
        return 20;
    }
  }

  /**
   * Calculate approximate drop count for a given drop ratio
   */
  private calculateDropCount(budget: ContextBudget, dropRatio: number): number {
    // Rough estimate: assume messages are evenly distributed
    const avgTokensPerMessage = 500; // Rough average
    const tokensToDrop = budget.currentUsage * dropRatio;
    return Math.floor(tokensToDrop / avgTokensPerMessage);
  }

  /**
   * Get appropriate summary tier for compaction type
   */
  private getSummaryTier(
    type: SlidingAction['type'],
  ): 'archival' | 'compressed' | 'condensed' | undefined {
    switch (type) {
      case 'compact-emergency':
        return 'archival'; // Ultra-compress
      case 'compact-aggressive':
        return 'compressed'; // Standard compression
      case 'compact-light':
        return 'condensed'; // Light compression
      case 'prune':
        return undefined; // No summarization for pruning
      default:
        return 'condensed';
    }
  }

  /**
   * Validate sliding result meets requirements
   */
  validateResult(
    result: SlidingResult,
    action: SlidingAction,
    config: SlidingWindowConfig,
  ): { valid: boolean; reason?: string } {
    // Check minimum messages kept
    if (result.messagesKept.length < config.keepRecent.messages) {
      return {
        valid: false,
        reason: `Too few messages kept (${result.messagesKept.length} < ${config.keepRecent.messages})`,
      };
    }

    // Check minimum tokens kept
    const tokensKept = tokenEstimator.estimateMessages(result.messagesKept);
    if (tokensKept < config.keepRecent.tokenBudget) {
      return {
        valid: false,
        reason: `Too few tokens kept (${tokensKept} < ${config.keepRecent.tokenBudget})`,
      };
    }

    // Check that we actually removed tokens
    if (action.targetTokenReduction && result.tokensRemoved < action.targetTokenReduction * 0.5) {
      return {
        valid: false,
        reason: `Insufficient token reduction (${result.tokensRemoved} < ${action.targetTokenReduction * 0.5})`,
      };
    }

    return { valid: true };
  }

  /**
   * Split messages into turns (user+assistant pairs)
   *
   * Useful for turn-based sliding strategy
   */
  splitIntoTurns(messages: ContextMessage[]): ContextMessage[][] {
    const turns: ContextMessage[][] = [];
    let currentTurn: ContextMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user' && currentTurn.length > 0) {
        // New turn starting
        turns.push(currentTurn);
        currentTurn = [msg];
      } else {
        currentTurn.push(msg);
      }
    }

    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }

    return turns;
  }

  /**
   * Slide by complete turns (never break mid-turn)
   */
  slideByTurns(params: {
    messages: ContextMessage[];
    action: SlidingAction;
    config: SlidingWindowConfig;
  }): SlidingResult {
    const { messages, action, config } = params;

    // Split into turns
    const turns = this.splitIntoTurns(messages);

    // Calculate how many turns to keep
    const turnsToKeep = Math.max(config.keepRecent.turns, this.getMinTurnsToKeep(action));

    const keptTurns = turns.slice(-turnsToKeep);
    const droppedTurns = turns.slice(0, -turnsToKeep);

    const messagesKept = keptTurns.flat();
    const messagesDropped = droppedTurns.flat();

    const tokensRemoved = tokenEstimator.estimateMessages(messagesDropped);

    return {
      messagesKept,
      messagesDropped,
      tokensRemoved,
      needsSummarization: action.type !== 'prune',
      summaryTier: this.getSummaryTier(action.type),
    };
  }

  /**
   * Get minimum turns to keep based on action
   */
  private getMinTurnsToKeep(action: SlidingAction): number {
    switch (action.type) {
      case 'compact-emergency':
        return 5;
      case 'compact-aggressive':
        return 8;
      case 'compact-light':
        return 10;
      case 'prune':
        return 15;
      default:
        return 10;
    }
  }
}

/**
 * Utility: Estimate average tokens per message
 */
export function estimateAverageTokensPerMessage(messages: ContextMessage[]): number {
  if (messages.length === 0) return 0;

  const totalTokens = tokenEstimator.estimateMessages(messages);
  return Math.floor(totalTokens / messages.length);
}

/**
 * Utility: Find message boundaries (complete turns)
 */
export function findTurnBoundaries(messages: ContextMessage[]): number[] {
  const boundaries: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      boundaries.push(i);
    }
  }

  return boundaries;
}

/**
 * Utility: Describe sliding action in human-readable format
 */
export function describeSlidingAction(action: SlidingAction): string {
  const { type, zone, targetDropCount } = action;

  const typeDesc = {
    prune: 'Pruning tool results',
    'compact-light': 'Light compaction',
    'compact-aggressive': 'Aggressive compaction',
    'compact-emergency': 'Emergency compaction',
  }[type];

  const count = targetDropCount ? ` (~${targetDropCount} messages)` : '';

  return `${typeDesc} [${zone} zone]${count}`;
}
