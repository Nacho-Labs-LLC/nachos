/**
 * Tests for memory manifest generator
 */

import { describe, it, expect, vi } from 'vitest';
import { buildMemoryManifest, formatManifestForPrompt } from './memory-manifest.js';
import { PromptAssembler } from './prompt-assembler.js';
import type { MemoryStore, MemoryFact, MemoryEntry } from '@nachos/types';

function createMockMemoryStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    appendEntry: vi.fn(),
    appendFacts: vi.fn(),
    query: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
    deleteEntry: vi.fn(),
    queryFacts: vi.fn().mockResolvedValue([]),
    updateFact: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

const AGENT_ID = 'test-agent';

describe('buildMemoryManifest', () => {
  it('should return empty manifest when no data exists', async () => {
    const store = createMockMemoryStore();
    const manifest = await buildMemoryManifest(AGENT_ID, store);

    expect(manifest.preferences).toEqual([]);
    expect(manifest.recentTopics).toEqual([]);
    expect(manifest.factCounts).toEqual([]);
    expect(manifest.totalFacts).toBe(0);
    expect(manifest.generatedAt).toBeTruthy();
  });

  it('should include preferences when available', async () => {
    const prefEntries: MemoryEntry[] = [
      {
        id: 'p1',
        agentId: AGENT_ID,
        kind: 'preference',
        content: 'Dark mode: user prefers dark themes',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'p2',
        agentId: AGENT_ID,
        kind: 'preference',
        content: 'Code style: prefers functional patterns',
        createdAt: new Date().toISOString(),
      },
    ];

    const store = createMockMemoryStore({
      query: vi.fn().mockImplementation(async (q) => {
        if (q.kinds?.includes('preference')) {
          return { entries: prefEntries, facts: [] };
        }
        return { entries: [], facts: [] };
      }),
    });

    const manifest = await buildMemoryManifest(AGENT_ID, store);

    expect(manifest.preferences).toHaveLength(2);
    expect(manifest.preferences[0]?.value).toContain('Dark mode');
    expect(manifest.preferences[1]?.value).toContain('Code style');
  });

  it('should include recent topics from summaries', async () => {
    const summaries: MemoryEntry[] = [
      {
        id: 's1',
        agentId: AGENT_ID,
        kind: 'summary',
        content: 'Discussed TypeScript migration strategy',
        createdAt: new Date(Date.now() - 3600_000).toISOString(), // 1h ago
      },
    ];

    const store = createMockMemoryStore({
      query: vi.fn().mockImplementation(async (q) => {
        if (q.kinds?.includes('summary')) {
          return { entries: summaries, facts: [] };
        }
        return { entries: [], facts: [] };
      }),
    });

    const manifest = await buildMemoryManifest(AGENT_ID, store);

    expect(manifest.recentTopics).toHaveLength(1);
    expect(manifest.recentTopics[0]?.topic).toContain('TypeScript migration');
    expect(manifest.recentTopics[0]?.sessionAge).toContain('h ago');
  });

  it('should group fact counts by type', async () => {
    const facts: MemoryFact[] = [
      {
        id: 'f1',
        agentId: AGENT_ID,
        subject: 'user',
        predicate: 'prefers',
        object: 'dark mode',
        type: 'preference',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'f2',
        agentId: AGENT_ID,
        subject: 'user',
        predicate: 'knows',
        object: 'TypeScript',
        type: 'skill',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'f3',
        agentId: AGENT_ID,
        subject: 'user',
        predicate: 'prefers',
        object: 'vim',
        type: 'preference',
        createdAt: new Date().toISOString(),
      },
    ];

    const store = createMockMemoryStore({
      queryFacts: vi.fn().mockResolvedValue(facts),
    });

    const manifest = await buildMemoryManifest(AGENT_ID, store);

    expect(manifest.totalFacts).toBe(3);
    expect(manifest.factCounts).toHaveLength(2);
    // preference: 2, skill: 1
    const prefCount = manifest.factCounts.find((fc) => fc.category === 'preference');
    expect(prefCount?.count).toBe(2);
  });

  it('should respect includePreferences=false config', async () => {
    const store = createMockMemoryStore({
      query: vi.fn().mockResolvedValue({
        entries: [
          {
            id: 'p1',
            agentId: AGENT_ID,
            kind: 'preference',
            content: 'test',
            createdAt: new Date().toISOString(),
          },
        ],
        facts: [],
      }),
    });

    const manifest = await buildMemoryManifest(AGENT_ID, store, undefined, {
      includePreferences: false,
    });

    expect(manifest.preferences).toEqual([]);
  });

  it('should respect recentTopicCount=0 config', async () => {
    const store = createMockMemoryStore();
    const manifest = await buildMemoryManifest(AGENT_ID, store, undefined, {
      recentTopicCount: 0,
    });

    expect(manifest.recentTopics).toEqual([]);
  });

  it('should handle query errors gracefully', async () => {
    const store = createMockMemoryStore({
      query: vi.fn().mockRejectedValue(new Error('DB error')),
      queryFacts: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const manifest = await buildMemoryManifest(AGENT_ID, store);

    // Should not throw, just return empty
    expect(manifest.preferences).toEqual([]);
    expect(manifest.factCounts).toEqual([]);
    expect(manifest.totalFacts).toBe(0);
  });
});

describe('formatManifestForPrompt', () => {
  it('should format empty manifest with header and hint', () => {
    const manifest = {
      preferences: [],
      recentTopics: [],
      factCounts: [],
      totalEntries: 0,
      totalFacts: 0,
      generatedAt: new Date().toISOString(),
    };

    const text = formatManifestForPrompt(manifest);

    expect(text).toContain('## Memory Manifest');
    expect(text).toContain('memory_recall');
    expect(text).toContain('0 stored facts');
  });

  it('should include preferences section', () => {
    const manifest = {
      preferences: [{ key: 'Dark mode', value: 'User prefers dark themes' }],
      recentTopics: [],
      factCounts: [],
      totalEntries: 1,
      totalFacts: 5,
      generatedAt: new Date().toISOString(),
    };

    const text = formatManifestForPrompt(manifest);

    expect(text).toContain('Known Preferences');
    expect(text).toContain('Dark mode');
  });

  it('should include recent topics section', () => {
    const manifest = {
      preferences: [],
      recentTopics: [{ topic: 'TypeScript migration', sessionAge: '2h ago' }],
      factCounts: [],
      totalEntries: 1,
      totalFacts: 0,
      generatedAt: new Date().toISOString(),
    };

    const text = formatManifestForPrompt(manifest);

    expect(text).toContain('Recent Topics');
    expect(text).toContain('TypeScript migration');
    expect(text).toContain('2h ago');
  });

  it('should include fact categories', () => {
    const manifest = {
      preferences: [],
      recentTopics: [],
      factCounts: [
        { category: 'preference', count: 5 },
        { category: 'skill', count: 3 },
      ],
      totalEntries: 8,
      totalFacts: 8,
      generatedAt: new Date().toISOString(),
    };

    const text = formatManifestForPrompt(manifest);

    expect(text).toContain('Fact Categories');
    expect(text).toContain('preference: 5');
    expect(text).toContain('skill: 3');
  });

  it('should truncate when exceeding maxTokens', () => {
    const manifest = {
      preferences: Array.from({ length: 50 }, (_, i) => ({
        key: `pref-${i}`,
        value: `This is preference number ${i} which is reasonably long content for testing purposes`,
      })),
      recentTopics: [],
      factCounts: [],
      totalEntries: 50,
      totalFacts: 0,
      generatedAt: new Date().toISOString(),
    };

    const text = formatManifestForPrompt(manifest, { maxTokens: 100 });

    // 100 tokens ≈ 400 chars — should be truncated
    expect(text.length).toBeLessThan(500);
    // Should still have header and hint
    expect(text).toContain('## Memory Manifest');
    expect(text).toContain('memory_recall');
  });
});

describe('PromptAssembler integration', () => {
  it('should include memory_manifest section when provided', () => {
    const assembler = new PromptAssembler();
    const manifest = '## Memory Manifest\nYou have 5 stored facts.';

    const result = assembler.assemble({
      basePrompt: 'You are a helpful assistant.',
      memoryManifest: manifest,
    });

    expect(result.prompt).toContain('## Memory Manifest');
    expect(result.prompt).toContain('5 stored facts');

    const manifestSection = result.report.sections.find((s) => s.name === 'memory_manifest');
    expect(manifestSection).toBeDefined();
    expect(manifestSection?.source).toBe('memory-manifest');
  });

  it('should position manifest before memory entries', () => {
    const assembler = new PromptAssembler();
    const manifest = '## Memory Manifest\nOverview here.';

    const result = assembler.assemble({
      basePrompt: 'System prompt.',
      memoryManifest: manifest,
      memoryEntries: [
        {
          id: 'e1',
          agentId: 'a1',
          kind: 'fact',
          content: 'A specific memory entry',
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const manifestIdx = result.prompt.indexOf('## Memory Manifest');
    const memoryIdx = result.prompt.indexOf('Memory Entries:');
    expect(manifestIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeGreaterThan(-1);
    expect(manifestIdx).toBeLessThan(memoryIdx);
  });

  it('should skip manifest section when null', () => {
    const assembler = new PromptAssembler();

    const result = assembler.assemble({
      basePrompt: 'You are a helpful assistant.',
      memoryManifest: null,
    });

    const manifestSection = result.report.sections.find((s) => s.name === 'memory_manifest');
    expect(manifestSection).toBeUndefined();
  });

  it('should keep existing memory_search tool unchanged (backward compat)', () => {
    const assembler = new PromptAssembler();

    const result = assembler.assemble({
      basePrompt: 'System prompt.',
      includeMemoryInstructions: true,
      memoryManifest: '## Memory Manifest\nSome data.',
    });

    // Both sections should coexist
    expect(result.prompt).toContain('memory_search');
    expect(result.prompt).toContain('## Memory Manifest');
  });
});
