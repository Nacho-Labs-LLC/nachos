/**
 * Memory Manifest Generator
 *
 * Builds a lightweight manifest (~200-400 tokens) summarizing what the system
 * knows: preference keys, recent topics, fact counts. Injected into the system
 * prompt so the LLM can decide whether to call `memory_recall` for full details.
 */

import type { MemoryEntry, MemoryFact, MemoryStore, MemoryQueryResult } from '@nachos/types';
import type { SessionsStore } from '../sessions/sessions-store-interface.js';
import { createLogger } from '@nachos/types';

const logger = createLogger('memory-manifest');

// ── Types ──────────────────────────────────────────────────────────────────

export interface MemoryManifest {
  preferences: { key: string; value: string }[];
  recentTopics: { topic: string; sessionAge: string }[];
  factCounts: { category: string; count: number }[];
  totalEntries: number;
  totalFacts: number;
  generatedAt: string;
}

export interface MemoryManifestConfig {
  /** Maximum tokens the rendered manifest should target (default: 400). */
  maxTokens: number;
  /** Include user/agent preferences in the manifest (default: true). */
  includePreferences: boolean;
  /** Number of recent topics to surface (default: 5). */
  recentTopicCount: number;
  /** Include grouped fact counts (default: true). */
  includeFactCounts: boolean;
}

const DEFAULT_CONFIG: MemoryManifestConfig = {
  maxTokens: 400,
  includePreferences: true,
  recentTopicCount: 5,
  includeFactCounts: true,
};

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Build a memory manifest by querying the memory and sessions stores for
 * metadata only — no full content is loaded into the prompt.
 */
export async function buildMemoryManifest(
  agentId: string,
  memoryStore: MemoryStore,
  sessionsStore?: SessionsStore,
  config?: Partial<MemoryManifestConfig>,
): Promise<MemoryManifest> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 1. Query preference entries
  let preferences: MemoryManifest['preferences'] = [];
  if (cfg.includePreferences) {
    try {
      const prefResult: MemoryQueryResult = await memoryStore.query({
        agentId,
        kinds: ['preference'],
        limit: 20,
      });
      preferences = prefResult.entries.map((e: MemoryEntry) => ({
        key: extractPreferenceKey(e.content),
        value: truncate(e.content, 60),
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to query preferences for manifest');
    }
  }

  // 2. Gather recent topics from session summaries
  let recentTopics: MemoryManifest['recentTopics'] = [];
  if (cfg.recentTopicCount > 0) {
    try {
      const summaryResult: MemoryQueryResult = await memoryStore.query({
        agentId,
        kinds: ['summary'],
        limit: cfg.recentTopicCount,
      });
      recentTopics = summaryResult.entries.map((e: MemoryEntry) => ({
        topic: truncate(e.content, 80),
        sessionAge: relativeAge(e.createdAt),
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to query summaries for manifest');
    }
  }

  // 3. Fact counts by type
  let factCounts: MemoryManifest['factCounts'] = [];
  let totalFacts = 0;
  if (cfg.includeFactCounts) {
    try {
      const allFacts: MemoryFact[] = await memoryStore.queryFacts(agentId);
      totalFacts = allFacts.length;
      const groups = new Map<string, number>();
      for (const fact of allFacts) {
        const cat = fact.type ?? 'general';
        groups.set(cat, (groups.get(cat) ?? 0) + 1);
      }
      factCounts = Array.from(groups.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count }));
    } catch (err) {
      logger.warn({ err }, 'Failed to query facts for manifest');
    }
  }

  // 4. Total entry count (cheap query)
  let totalEntries = 0;
  try {
    const countResult: MemoryQueryResult = await memoryStore.query({
      agentId,
      limit: 1,
    });
    // Entries returned will be at most 1, but we want total.
    // Re-use fact total + entries count as approximation.
    totalEntries =
      preferences.length + recentTopics.length + totalFacts;
  } catch {
    // Non-critical
  }

  return {
    preferences,
    recentTopics,
    factCounts,
    totalEntries,
    totalFacts,
    generatedAt: new Date().toISOString(),
  };
}

// ── Formatter ──────────────────────────────────────────────────────────────

/**
 * Render a MemoryManifest into a compact text section suitable for system
 * prompt injection. Targets ~200-400 tokens depending on content.
 */
export function formatManifestForPrompt(
  manifest: MemoryManifest,
  config?: Partial<MemoryManifestConfig>,
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const lines: string[] = [];

  lines.push('## Memory Manifest');
  lines.push(
    `You have ${manifest.totalFacts} stored facts and ${manifest.totalEntries} memory entries.`,
  );

  // Preferences
  if (cfg.includePreferences && manifest.preferences.length > 0) {
    lines.push('');
    lines.push('**Known Preferences:**');
    for (const pref of manifest.preferences) {
      lines.push(`- ${pref.value}`);
    }
  }

  // Recent topics
  if (manifest.recentTopics.length > 0) {
    lines.push('');
    lines.push('**Recent Topics:**');
    for (const topic of manifest.recentTopics) {
      lines.push(`- ${topic.topic} (${topic.sessionAge})`);
    }
  }

  // Fact counts
  if (cfg.includeFactCounts && manifest.factCounts.length > 0) {
    lines.push('');
    lines.push('**Fact Categories:**');
    const cats = manifest.factCounts
      .slice(0, 8)
      .map((fc) => `${fc.category}: ${fc.count}`)
      .join(', ');
    lines.push(cats);
  }

  // Hint to use memory_recall
  lines.push('');
  lines.push(
    'Use `memory_recall` to retrieve full details about any topic, preference, or past conversation listed above.',
  );

  // Respect token budget — rough estimate: 1 token ≈ 4 chars
  const text = lines.join('\n');
  const estimatedTokens = Math.ceil(text.length / 4);

  if (estimatedTokens > cfg.maxTokens) {
    // Truncate from the bottom up, keeping header and hint
    return truncateManifest(text, cfg.maxTokens);
  }

  return text;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract a concise key from a preference content string. */
function extractPreferenceKey(content: string): string {
  // Use first clause before a colon, period, or dash
  const match = content.match(/^([^:.–—\n]{3,50})/);
  return match ? match[1].trim() : truncate(content, 40);
}

/** Truncate a string to maxLen chars, adding '...' if needed. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/** Compute a human-readable relative age from an ISO timestamp. */
function relativeAge(isoDate: string): string {
  try {
    const then = new Date(isoDate).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks}w ago`;
  } catch {
    return 'unknown';
  }
}

/** Truncate manifest text to fit within a token budget. */
function truncateManifest(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  const lines = text.split('\n');
  // Always keep first 2 lines (header) and last line (hint)
  const header = lines.slice(0, 2);
  const hint = lines[lines.length - 1] ?? '';

  // Fill from top until budget exhausted
  const budget = maxChars - header.join('\n').length - hint.length - 4; // 4 for newlines
  const middle: string[] = [];
  let used = 0;
  for (let i = 2; i < lines.length - 1; i++) {
    const line = lines[i] ?? '';
    if (used + line.length + 1 > budget) break;
    middle.push(line);
    used += line.length + 1;
  }

  return [...header, ...middle, '', hint].join('\n');
}
