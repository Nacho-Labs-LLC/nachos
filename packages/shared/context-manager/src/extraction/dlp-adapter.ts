/**
 * DLP Extraction Adapter - Uses nachos-dlp Scanner for pattern-based extraction
 *
 * Leverages the existing nachos-dlp infrastructure to extract important
 * information from conversation history before compaction.
 */

import { Scanner, type Finding } from '@nacho-labs/nachos-dlp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContextMessage, ExtractedItem, ProactiveHistoryConfig } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Adapter for extracting important items using DLP pattern matching
 */
export class DLPExtractionAdapter {
  private scanner: Scanner;
  private patternFile: string;

  constructor(config?: ProactiveHistoryConfig) {
    // Default to bundled extraction patterns
    this.patternFile =
      config?.customPatternFiles?.[0] ||
      path.join(__dirname, '../../patterns/extraction-patterns.yaml');

    // Initialize scanner with extraction patterns
    this.scanner = new Scanner({
      customPatternFiles: [this.patternFile],
      patterns: [], // Don't use built-in secret patterns
      minConfidence: 0.5,
    });
  }

  /**
   * Extract all categories from messages
   */
  async extract(messages: ContextMessage[]): Promise<{
    decisions: ExtractedItem[];
    facts: ExtractedItem[];
    tasks: ExtractedItem[];
    issues: ExtractedItem[];
    files: ExtractedItem[];
  }> {
    const results = {
      decisions: [] as ExtractedItem[],
      facts: [] as ExtractedItem[],
      tasks: [] as ExtractedItem[],
      issues: [] as ExtractedItem[],
      files: [] as ExtractedItem[],
    };

    for (const message of messages) {
      const content = this.extractTextContent(message);
      if (!content || content.length === 0) continue;

      // Scan message content
      const findings = this.scanner.scan(content);

      // Categorize findings
      for (const finding of findings) {
        const item = this.findingToExtractedItem(finding, message);

        // Route to appropriate category based on pattern ID
        if (finding.patternId.startsWith('decision-')) {
          results.decisions.push(item);
        } else if (finding.patternId.startsWith('task-')) {
          results.tasks.push(item);
        } else if (finding.patternId.startsWith('fact-')) {
          results.facts.push(item);
        } else if (finding.patternId.startsWith('issue-')) {
          results.issues.push(item);
        } else if (finding.patternId.startsWith('file-')) {
          results.files.push(item);
        }
      }
    }

    // Deduplicate items in each category
    return {
      decisions: this.deduplicateItems(results.decisions),
      facts: this.deduplicateItems(results.facts),
      tasks: this.deduplicateItems(results.tasks),
      issues: this.deduplicateItems(results.issues),
      files: this.deduplicateItems(results.files),
    };
  }

  /**
   * Extract specific category from messages
   */
  async extractCategory(
    messages: ContextMessage[],
    category: 'decisions' | 'tasks' | 'facts' | 'issues' | 'files',
  ): Promise<ExtractedItem[]> {
    const items: ExtractedItem[] = [];
    const prefix = category.slice(0, -1); // Remove 's' to get pattern prefix

    for (const message of messages) {
      const content = this.extractTextContent(message);
      if (!content) continue;

      const findings = this.scanner.scan(content);

      // Filter to only this category
      const categoryFindings = findings.filter((f) => f.patternId.startsWith(prefix));

      for (const finding of categoryFindings) {
        items.push(this.findingToExtractedItem(finding, message));
      }
    }

    return this.deduplicateItems(items);
  }

  /**
   * Convert DLP Finding to ExtractedItem
   */
  private findingToExtractedItem(finding: Finding, message: ContextMessage): ExtractedItem {
    // Determine category from pattern ID
    let category: ExtractedItem['type'] = 'context';
    if (finding.patternId.startsWith('decision-')) category = 'decision';
    else if (finding.patternId.startsWith('task-')) category = 'task';
    else if (finding.patternId.startsWith('fact-')) category = 'fact';
    else if (finding.patternId.startsWith('issue-')) category = 'error';
    else if (finding.patternId.startsWith('file-')) category = 'code';

    return {
      type: category,
      content: finding.match,
      sourceMessageId: message.id,
      timestamp: message.timestamp || Date.now(),
      metadata: {
        patternId: finding.patternId,
        patternName: finding.patternName,
        confidence: finding.confidence,
        severity: finding.severity,
      },
    };
  }

  /**
   * Extract text content from message (handles string and ContentBlock[])
   */
  private extractTextContent(message: ContextMessage): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    // Extract text from content blocks
    return message.content
      .map((block) => {
        if (block.type === 'text') {
          return block.text || block.content || '';
        }
        if (block.type === 'tool_result') {
          return block.content || '';
        }
        return '';
      })
      .join('\n\n');
  }

  /**
   * Deduplicate extracted items by content
   */
  private deduplicateItems(items: ExtractedItem[]): ExtractedItem[] {
    const seen = new Set<string>();
    const unique: ExtractedItem[] = [];

    for (const item of items) {
      // Normalize content for comparison
      const normalized = item.content.toLowerCase().trim();

      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(item);
      }
    }

    return unique;
  }

  /**
   * Get statistics about extraction
   */
  getStatistics(results: Record<string, ExtractedItem[]>): {
    total: number;
    byCategory: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    let total = 0;

    for (const [category, items] of Object.entries(results)) {
      byCategory[category] = items.length;
      total += items.length;
    }

    return { total, byCategory };
  }

  /**
   * Check if extraction should be performed
   */
  shouldExtract(params: {
    messageCount: number;
    utilizationRatio: number;
    timeSinceLastExtraction?: number;
  }): boolean {
    const { messageCount, utilizationRatio, timeSinceLastExtraction } = params;

    // Always extract if utilization is high
    if (utilizationRatio >= 0.7) {
      return true;
    }

    // Extract periodically (every 50 messages)
    if (messageCount % 50 === 0) {
      return true;
    }

    // Extract if it's been a while (1 hour = 3600000ms)
    if (timeSinceLastExtraction && timeSinceLastExtraction > 3600000) {
      return true;
    }

    return false;
  }
}

/**
 * Singleton instance for convenience
 */
let defaultAdapter: DLPExtractionAdapter | null = null;

/**
 * Get or create default DLP extraction adapter
 */
export function getDefaultAdapter(config?: ProactiveHistoryConfig): DLPExtractionAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new DLPExtractionAdapter(config);
  }
  return defaultAdapter;
}
