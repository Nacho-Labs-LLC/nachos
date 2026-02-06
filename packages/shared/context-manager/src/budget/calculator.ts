/**
 * NACHOS Context Management - Context Budget Calculator
 *
 * Calculates available context budget and determines utilization zones.
 * Ported from context-management-prototype for NACHOS architecture.
 */

import type {
  ContextBudget,
  ContextZone,
  ContextZoneThresholds,
  IContextBudgetCalculator,
  ContextMessage,
} from '../types/index.js';
import { tokenEstimator } from '../utils/token-counter.js';

export class ContextBudgetCalculator implements IContextBudgetCalculator {
  /**
   * Calculate context budget from current session state
   */
  calculate(params: {
    messages: ContextMessage[];
    systemPromptTokens: number;
    contextWindow: number;
    reserveTokens: number;
  }): ContextBudget {
    const { messages, systemPromptTokens, contextWindow, reserveTokens } = params;

    // Calculate current history token usage
    const currentUsage = tokenEstimator.estimateMessages(messages);

    // Calculate available budget for history
    // Total - system prompt - reserve for response
    const historyBudget = Math.max(0, contextWindow - systemPromptTokens - reserveTokens);

    // Calculate utilization ratio
    const utilizationRatio = historyBudget > 0 ? currentUsage / historyBudget : 0;

    return {
      total: contextWindow,
      systemPrompt: systemPromptTokens,
      reserved: reserveTokens,
      historyBudget,
      currentUsage,
      utilizationRatio,
      zone: this.determineZone(utilizationRatio, this.getDefaultThresholds()),
    };
  }

  /**
   * Determine context zone based on utilization ratio
   */
  determineZone(utilization: number, thresholds: ContextZoneThresholds): ContextZone {
    if (utilization >= thresholds.emergency) return 'critical';
    if (utilization >= thresholds.aggressiveCompaction) return 'red';
    if (utilization >= thresholds.lightCompaction) return 'orange';
    if (utilization >= thresholds.proactivePrune) return 'yellow';
    return 'green';
  }

  /**
   * Get default thresholds
   */
  private getDefaultThresholds(): ContextZoneThresholds {
    return {
      proactivePrune: 0.6,
      lightCompaction: 0.75,
      aggressiveCompaction: 0.85,
      emergency: 0.95,
    };
  }

  /**
   * Estimate system prompt token size
   *
   * This is a rough estimate. In production, should be calculated from actual
   * system prompt components (tools, skills, workspace files, runtime info).
   */
  estimateSystemPromptTokens(params: {
    toolCount: number;
    skillCount: number;
    workspaceFiles: number;
    avgWorkspaceFileSize: number;
  }): number {
    const { toolCount, skillCount, workspaceFiles, avgWorkspaceFileSize } = params;

    // Rough estimates:
    // - Base system prompt: ~2000 tokens
    // - Tool schemas: ~500 tokens per tool (varies widely)
    // - Skills list: ~50 tokens per skill
    // - Workspace files: actual size / 4 (chars to tokens)
    // - Runtime info: ~500 tokens

    const base = 2000;
    const tools = toolCount * 500;
    const skills = skillCount * 50;
    const workspace = (workspaceFiles * avgWorkspaceFileSize) / 4;
    const runtime = 500;

    return Math.ceil(base + tools + skills + workspace + runtime);
  }

  /**
   * Calculate tokens remaining before next zone
   */
  tokensUntilNextZone(budget: ContextBudget, thresholds: ContextZoneThresholds): number {
    const { currentUsage, historyBudget, zone } = budget;

    let nextThreshold: number;
    switch (zone) {
      case 'green':
        nextThreshold = thresholds.proactivePrune;
        break;
      case 'yellow':
        nextThreshold = thresholds.lightCompaction;
        break;
      case 'orange':
        nextThreshold = thresholds.aggressiveCompaction;
        break;
      case 'red':
        nextThreshold = thresholds.emergency;
        break;
      case 'critical':
        return 0; // Already at max
    }

    const nextThresholdTokens = historyBudget * nextThreshold;
    return Math.max(0, Math.floor(nextThresholdTokens - currentUsage));
  }

  /**
   * Estimate turns until next zone (rough approximation)
   */
  estimateTurnsUntilNextZone(
    budget: ContextBudget,
    thresholds: ContextZoneThresholds,
    avgTokensPerTurn: number,
  ): number {
    const tokensRemaining = this.tokensUntilNextZone(budget, thresholds);

    if (tokensRemaining === 0) return 0;
    if (avgTokensPerTurn === 0) return Infinity;

    return Math.floor(tokensRemaining / avgTokensPerTurn);
  }

  /**
   * Calculate recommended target after compaction
   */
  calculateCompactionTarget(
    budget: ContextBudget,
    zone: ContextZone,
  ): { targetTokens: number; dropRatio: number } {
    const { historyBudget } = budget;

    // Target different utilization levels based on zone
    let targetUtilization: number;
    let dropRatio: number;

    switch (zone) {
      case 'critical':
        // Emergency: drop to 50% to avoid immediate re-compaction
        targetUtilization = 0.5;
        dropRatio = 0.6;
        break;
      case 'red':
        // Aggressive: drop to 55%
        targetUtilization = 0.55;
        dropRatio = 0.4;
        break;
      case 'orange':
        // Moderate: drop to 60%
        targetUtilization = 0.6;
        dropRatio = 0.3;
        break;
      case 'yellow':
        // Light: drop to 65%
        targetUtilization = 0.65;
        dropRatio = 0.2;
        break;
      default:
        // Green: shouldn't compact, but if forced, minimal drop
        targetUtilization = 0.7;
        dropRatio = 0.15;
    }

    const targetTokens = Math.floor(historyBudget * targetUtilization);

    return { targetTokens, dropRatio };
  }
}

/**
 * Utility: Format budget for display
 */
export function formatContextBudget(budget: ContextBudget): string {
  const pct = (budget.utilizationRatio * 100).toFixed(1);
  const zoneEmoji = {
    green: '🟢',
    yellow: '🟡',
    orange: '🟠',
    red: '🔴',
    critical: '🚨',
  }[budget.zone];

  return `${zoneEmoji} ${pct}% (${budget.currentUsage.toLocaleString()}/${budget.historyBudget.toLocaleString()} tokens)`;
}

/**
 * Utility: Check if compaction is recommended
 */
export function shouldCompact(budget: ContextBudget, thresholds: ContextZoneThresholds): boolean {
  return budget.utilizationRatio >= thresholds.lightCompaction;
}

/**
 * Utility: Get compaction urgency
 */
export function getCompactionUrgency(
  budget: ContextBudget,
): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  switch (budget.zone) {
    case 'critical':
      return 'critical';
    case 'red':
      return 'high';
    case 'orange':
      return 'medium';
    case 'yellow':
      return 'low';
    default:
      return 'none';
  }
}
