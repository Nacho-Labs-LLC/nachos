/**
 * Fact Deduplication Tests
 *
 * Tests the dedup/merge logic for MemoryFacts:
 * - Exact match detection (normalized comparison)
 * - Confidence merging
 * - Property merging (incoming wins on conflict)
 * - Correct split of toInsert vs toUpdate
 */

import { describe, it, expect } from 'vitest';
import { isExactMatch, mergeFact, deduplicateFacts } from './dedup.js';
import type { MemoryFact } from '@nachos/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFact(overrides?: Partial<MemoryFact>): MemoryFact {
  return {
    id: 'fact-1',
    agentId: 'agent-1',
    subject: 'user',
    predicate: 'prefers',
    object: 'TypeScript',
    confidence: 0.8,
    properties: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isExactMatch
// ---------------------------------------------------------------------------

describe('isExactMatch', () => {
  it('matches identical facts', () => {
    const a = makeFact();
    const b = makeFact({ id: 'fact-2' });
    expect(isExactMatch(a, b)).toBe(true);
  });

  it('matches after normalization (case, whitespace)', () => {
    const a = makeFact({ subject: 'User', predicate: '  Prefers  ', object: 'typescript' });
    const b = makeFact({ subject: 'user', predicate: 'prefers', object: 'TypeScript' });
    expect(isExactMatch(a, b)).toBe(true);
  });

  it('does not match different subjects', () => {
    const a = makeFact({ subject: 'user' });
    const b = makeFact({ subject: 'admin' });
    expect(isExactMatch(a, b)).toBe(false);
  });

  it('does not match different predicates', () => {
    const a = makeFact({ predicate: 'prefers' });
    const b = makeFact({ predicate: 'dislikes' });
    expect(isExactMatch(a, b)).toBe(false);
  });

  it('does not match different objects', () => {
    const a = makeFact({ object: 'TypeScript' });
    const b = makeFact({ object: 'Python' });
    expect(isExactMatch(a, b)).toBe(false);
  });

  it('collapses extra whitespace for matching', () => {
    const a = makeFact({ object: 'Type   Script' });
    const b = makeFact({ object: 'Type Script' });
    expect(isExactMatch(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mergeFact
// ---------------------------------------------------------------------------

describe('mergeFact', () => {
  it('increases confidence toward the higher value', () => {
    const existing = makeFact({ confidence: 0.6 });
    const incoming = makeFact({ confidence: 0.8 });

    const merged = mergeFact(existing, incoming);

    // (0.6 + 0.8) / 2 + 0.05 = 0.75
    expect(merged.confidence).toBe(0.75);
  });

  it('caps confidence at 1.0', () => {
    const existing = makeFact({ confidence: 0.95 });
    const incoming = makeFact({ confidence: 0.98 });

    const merged = mergeFact(existing, incoming);

    expect(merged.confidence).toBeLessThanOrEqual(1.0);
  });

  it('merges properties with incoming winning on conflict', () => {
    const existing = makeFact({
      properties: { color: 'blue', size: 'large' },
    });
    const incoming = makeFact({
      properties: { color: 'red', weight: 'heavy' },
    });

    const merged = mergeFact(existing, incoming);

    expect(merged.properties).toEqual({
      color: 'red',     // incoming wins
      size: 'large',    // existing preserved
      weight: 'heavy',  // new from incoming
    });
  });

  it('keeps createdAt from existing fact', () => {
    const existing = makeFact({ createdAt: '2026-01-01T00:00:00.000Z' });
    const incoming = makeFact({ createdAt: '2026-03-01T00:00:00.000Z' });

    const merged = mergeFact(existing, incoming);

    expect(merged.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('updates updatedAt to current time', () => {
    const before = new Date().toISOString();
    const existing = makeFact();
    const incoming = makeFact();

    const merged = mergeFact(existing, incoming);

    expect(merged.updatedAt).toBeDefined();
    expect(merged.updatedAt! >= before).toBe(true);
  });

  it('handles undefined confidence gracefully', () => {
    const existing = makeFact({ confidence: undefined });
    const incoming = makeFact({ confidence: undefined });

    const merged = mergeFact(existing, incoming);

    // (0.5 + 0.5) / 2 + 0.05 = 0.55
    expect(merged.confidence).toBe(0.55);
  });
});

// ---------------------------------------------------------------------------
// deduplicateFacts
// ---------------------------------------------------------------------------

describe('deduplicateFacts', () => {
  it('inserts new facts that have no match', () => {
    const incoming = [
      makeFact({ subject: 'user', predicate: 'likes', object: 'cats' }),
    ];
    const existing: MemoryFact[] = [];

    const { toInsert, toUpdate } = deduplicateFacts(incoming, existing);

    expect(toInsert).toHaveLength(1);
    expect(toUpdate).toHaveLength(0);
  });

  it('merges exact duplicates into toUpdate', () => {
    const incoming = [
      makeFact({ id: 'new-1', subject: 'user', predicate: 'prefers', object: 'TypeScript', confidence: 0.9 }),
    ];
    const existing = [
      makeFact({ id: 'old-1', subject: 'user', predicate: 'prefers', object: 'TypeScript', confidence: 0.7 }),
    ];

    const { toInsert, toUpdate } = deduplicateFacts(incoming, existing);

    expect(toInsert).toHaveLength(0);
    expect(toUpdate).toHaveLength(1);
    // Merged fact should have the existing ID
    expect(toUpdate[0]?.id).toBe('old-1');
    // Confidence should be boosted
    expect(toUpdate[0]?.confidence).toBeGreaterThan(0.7);
  });

  it('handles mixed inserts and updates', () => {
    const incoming = [
      makeFact({ id: 'new-1', subject: 'user', predicate: 'prefers', object: 'TypeScript' }),
      makeFact({ id: 'new-2', subject: 'user', predicate: 'knows', object: 'Python' }),
      makeFact({ id: 'new-3', subject: 'user', predicate: 'lives_in', object: 'NYC' }),
    ];
    const existing = [
      makeFact({ id: 'old-1', subject: 'user', predicate: 'prefers', object: 'TypeScript' }),
      // 'knows Python' is new
      makeFact({ id: 'old-3', subject: 'user', predicate: 'lives_in', object: 'NYC' }),
    ];

    const { toInsert, toUpdate } = deduplicateFacts(incoming, existing);

    expect(toInsert).toHaveLength(1);
    expect(toInsert[0]?.predicate).toBe('knows');
    expect(toUpdate).toHaveLength(2);
  });

  it('returns empty arrays for empty input', () => {
    const { toInsert, toUpdate } = deduplicateFacts([], []);
    expect(toInsert).toHaveLength(0);
    expect(toUpdate).toHaveLength(0);
  });

  it('case-insensitive matching via normalization', () => {
    const incoming = [
      makeFact({ subject: 'USER', predicate: 'PREFERS', object: 'TYPESCRIPT' }),
    ];
    const existing = [
      makeFact({ subject: 'user', predicate: 'prefers', object: 'TypeScript' }),
    ];

    const { toInsert, toUpdate } = deduplicateFacts(incoming, existing);

    expect(toInsert).toHaveLength(0);
    expect(toUpdate).toHaveLength(1);
  });
});
