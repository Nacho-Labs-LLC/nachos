/**
 * Fact deduplication for the memory extraction pipeline.
 *
 * Design principle: memory maintenance is dedup/merge, not deletion.
 * Facts are permanent — we only consolidate when the same fact is observed again.
 */

import type { MemoryFact } from '@nachos/types';
import { createLogger } from '@nachos/types';

const logger = createLogger('extraction-dedup');

/**
 * Normalize a string for comparison (lowercase, trim, collapse whitespace).
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check whether two facts are an exact match (same subject, predicate, object after normalization).
 */
export function isExactMatch(a: MemoryFact, b: MemoryFact): boolean {
  return (
    normalize(a.subject) === normalize(b.subject) &&
    normalize(a.predicate) === normalize(b.predicate) &&
    normalize(a.object) === normalize(b.object)
  );
}

/**
 * Merge a new fact into an existing fact (in-place update of the existing fact).
 *
 * - Bumps confidence toward the higher value (weighted average, capped at 1.0)
 * - Merges properties (new values win on conflict)
 * - Updates `updatedAt`
 * - Keeps `createdAt` from the original
 */
export function mergeFact(existing: MemoryFact, incoming: MemoryFact): MemoryFact {
  const existingConf = existing.confidence ?? 0.5;
  const incomingConf = incoming.confidence ?? 0.5;

  // Weighted average biased toward the higher confidence
  const merged = Math.min(1.0, (existingConf + incomingConf) / 2 + 0.05);

  return {
    ...existing,
    confidence: merged,
    properties: {
      ...(existing.properties ?? {}),
      ...(incoming.properties ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deduplicate a list of incoming facts against existing facts for the same agent+subject.
 *
 * Returns:
 * - `toInsert`: new facts with no match in existing
 * - `toUpdate`: existing facts that should be updated (merged with incoming)
 */
export function deduplicateFacts(
  incoming: MemoryFact[],
  existing: MemoryFact[]
): { toInsert: MemoryFact[]; toUpdate: MemoryFact[] } {
  const toInsert: MemoryFact[] = [];
  const toUpdate: MemoryFact[] = [];

  for (const fact of incoming) {
    const match = existing.find((e) => isExactMatch(e, fact));
    if (match) {
      logger.debug(
        { subject: fact.subject, predicate: fact.predicate },
        'Merging duplicate fact'
      );
      toUpdate.push(mergeFact(match, fact));
    } else {
      toInsert.push(fact);
    }
  }

  return { toInsert, toUpdate };
}
