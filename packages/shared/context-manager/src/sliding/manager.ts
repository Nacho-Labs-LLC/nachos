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
import { createLogger } from '@nachos/types';
import { tokenEstimator } from '../utils/token-counter.js';

const logger = createLogger('sliding-manager');

export class SlidingWindowManager implements ISlidingWindowManager {
  /**
   * Check if sliding is needed based on current budget and config
   */
  shouldSlide(budget: ContextBudget, config: SlidingWindowConfig): SlidingAction | null {
    if (!config.enabled) return null;

    const { utilizationRatio } = budget;
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
   * M4: Preserve important tool results during sliding
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
    let messagesDropped = messages.slice(0, splitIndex);
    let messagesKept = messages.slice(splitIndex);

    // M4: Preserve important tool results from dropped messages
    const preservedMessages = this.preserveImportantMessages(messagesDropped, action);
    if (preservedMessages.length > 0) {
      // Add preserved messages to kept messages
      messagesKept = [...preservedMessages, ...messagesKept];
      
      // Remove preserved messages from dropped list
      const preservedIds = new Set(preservedMessages.map(m => m.id || m.timestamp));
      messagesDropped = messagesDropped.filter(m => {
        const id = m.id || m.timestamp;
        return id === undefined || !preservedIds.has(id);
      });

      logger.info({ count: preservedMessages.length }, 'Preserved important tool results');
    }

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
    config: SlidingWindowConfig
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
    tokenBudget: number
  ): number {
    let tokensAccumulated = 0;
    let keepCount = 0;

    // Walk backward from most recent
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message) {
        continue;
      }

      const msgTokens = tokenEstimator.estimateMessage(message);

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
    type: SlidingAction['type']
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
    config: SlidingWindowConfig
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

    // Check that we actually removed tokens (unless keepRecent constraints prevent it)
    if (action.targetTokenReduction && result.tokensRemoved < action.targetTokenReduction * 0.5) {
      const totalTokens = tokensKept + result.tokensRemoved;
      const maxPossibleReduction = totalTokens - config.keepRecent.tokenBudget;
      // Only fail if there was meaningful room to compact beyond keepRecent constraints
      if (maxPossibleReduction > action.targetTokenReduction * 0.5) {
        return {
          valid: false,
          reason: `Insufficient token reduction (${result.tokensRemoved} < ${action.targetTokenReduction * 0.5})`,
        };
      }
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

    // Calculate minimum turns to keep based on action severity
    let turnsToKeep = Math.max(config.keepRecent.turns, this.getMinTurnsToKeep(action));

    // Also ensure we keep enough turns to meet the token budget
    if (config.keepRecent.tokenBudget > 0) {
      let tokensAccumulated = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (!turn) {
          continue;
        }

        tokensAccumulated += tokenEstimator.estimateMessages(turn);
        const turnsFromEnd = turns.length - i;
        if (tokensAccumulated >= config.keepRecent.tokenBudget) {
          turnsToKeep = Math.max(turnsToKeep, turnsFromEnd);
          break;
        }
      }
      // If all turns together don't meet the budget, keep them all
      if (tokensAccumulated < config.keepRecent.tokenBudget) {
        turnsToKeep = turns.length;
      }
    }

    // Also respect minimum message count
    if (config.keepRecent.messages > 0) {
      let msgCount = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (!turn) {
          continue;
        }

        msgCount += turn.length;
        if (msgCount >= config.keepRecent.messages) {
          turnsToKeep = Math.max(turnsToKeep, turns.length - i);
          break;
        }
      }
    }

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

  /**
   * M4: Preserve important tool results from dropped messages
   * 
   * Identifies and extracts important tool results (file operations, searches)
   * to prevent loss of critical context during sliding.
   * 
   * Returns the N most important messages to preserve.
   */
  private preserveImportantMessages(
    messages: ContextMessage[],
    action: SlidingAction
  ): ContextMessage[] {
    // Determine how many important messages to preserve based on action severity
    const maxToPreserve = this.getMaxPreservableMessages(action);
    
    if (maxToPreserve === 0) {
      return [];
    }

    // Score messages by importance
    const scoredMessages = messages
      .map(msg => ({
        message: msg,
        score: this.getMessageImportance(msg),
      }))
      .filter(item => item.score > 0) // Only consider messages with importance
      .sort((a, b) => b.score - a.score); // Highest score first

    // Take top N most important
    return scoredMessages
      .slice(0, maxToPreserve)
      .map(item => item.message);
  }

  /**
   * M4: Calculate importance score for a message
   * 
   * Scores based on content type and patterns:
   * - File operations (read, write, edit): 100
   * - Search results: 80
   * - Error messages: 70
   * - Tool results with significant content: 50
   * - Regular messages: 0
   */
  private getMessageImportance(message: ContextMessage): number {
    // Only assistant and tool messages can be important
    if (message.role === 'user') {
      return 0;
    }

    const content = typeof message.content === 'string'
      ? message.content
      : message.content
          .map(block => {
            if (block.type === 'text') return block.text || block.content || '';
            if (block.type === 'tool_result') return block.content || '';
            return '';
          })
          .join(' ');

    const lowerContent = content.toLowerCase();

    // File operations (highest priority)
    if (
      /\b(read|wrote|edited|created|deleted|moved|renamed)\s+(file|directory)/i.test(content) ||
      /file_path|filepath|file path/i.test(content) ||
      lowerContent.includes('successfully wrote') ||
      lowerContent.includes('successfully read') ||
      lowerContent.includes('successfully edited')
    ) {
      return 100;
    }

    // Search results
    if (
      lowerContent.includes('search result') ||
      lowerContent.includes('found') && lowerContent.includes('match') ||
      /\d+\s+(result|match|hit)s?\s+found/i.test(content)
    ) {
      return 80;
    }

    // Error messages
    if (
      lowerContent.includes('error:') ||
      lowerContent.includes('failed') ||
      lowerContent.includes('exception') ||
      /\berror\b/i.test(content) && content.length < 1000
    ) {
      return 70;
    }

    // Tool results with significant content
    if (message.role === 'tool' && content.length > 200) {
      return 50;
    }

    // Assistant messages with code blocks
    if (message.role === 'assistant' && /```[\s\S]+```/.test(content)) {
      return 40;
    }

    return 0;
  }

  /**
   * M4: Get maximum preservable messages based on action severity
   */
  private getMaxPreservableMessages(action: SlidingAction): number {
    switch (action.type) {
      case 'compact-emergency':
        return 3; // Preserve only top 3 critical items
      case 'compact-aggressive':
        return 5;
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
    const message = messages[i];
    if (message?.role === 'user') {
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
