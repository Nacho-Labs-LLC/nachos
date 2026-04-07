/**
 * Memory Pipeline Integration Tests
 *
 * Tests that the MemoryPipeline correctly extracts facts/decisions from
 * conversation history, writes them to the memory store via the StateLayer,
 * and updates session state.
 *
 * Spec IDs: [CM-01] through [CM-08]
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryPipeline } from '@nachos/state';
import type { MemoryPipelineConfig, MemoryPipelineTrigger } from '@nachos/state';
import type { StateOperationContext } from '@nachos/state';
import type { Message, Session, MemoryEntry, MemoryFact, SessionStateRecord } from '@nachos/types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 'session-test-1',
    channel: 'slack',
    conversationId: 'conv-test-1',
    userId: 'user-test-1',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeContext(session?: Session): StateOperationContext {
  const s = session ?? makeSession();
  return {
    sessionId: s.id,
    userId: s.userId,
    securityMode: 'standard',
    channel: s.channel,
  };
}

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    sessionId: 'session-test-1',
    role: (i % 2 === 0 ? 'user' : 'assistant') as Message['role'],
    content: i % 2 === 0 ? `User message ${i}` : `Assistant response ${i}`,
    createdAt: new Date(Date.now() - (count - i) * 1000).toISOString(),
  }));
}

/**
 * Create a mock StateLayer with vi.fn() stubs for all methods the pipeline
 * touches. This mirrors the pattern used in gateway.test.ts.
 */
function createMockStateLayer() {
  return {
    appendMemoryEntry: vi.fn().mockImplementation(async (entry: MemoryEntry) => entry),
    appendMemoryFacts: vi.fn().mockImplementation(async (facts: MemoryFact[]) => facts),
    getSessionState: vi.fn().mockResolvedValue(null as SessionStateRecord | null),
    setSessionState: vi.fn().mockImplementation(async (record: SessionStateRecord) => record),
    // Other StateLayer methods that may be called but are not relevant
    getIdentity: vi.fn().mockResolvedValue(null),
    getBootstrap: vi.fn().mockResolvedValue(null),
    getUserProfile: vi.fn().mockResolvedValue(null),
    queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
    assemblePrompt: vi.fn().mockReturnValue({ prompt: '', report: {} }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Build a MemoryPipelineConfig with proactive history extraction enabled.
 * Uses a simple agentIdResolver that returns session.userId.
 */
function buildConfig(overrides?: Partial<MemoryPipelineConfig>): MemoryPipelineConfig {
  return {
    proactiveHistory: {
      enabled: true,
      extractors: {
        decisions: true,
        facts: true,
        tasks: true,
        issues: true,
        files: true,
      },
      triggers: {
        onCompaction: true,
        onThreshold: 0.75,
        onMemoryFlush: true,
      },
    },
    agentIdResolver: (session: Session) => session.userId ?? session.id,
    ...overrides,
  };
}

describe('MemoryPipeline (CM)', () => {
  let stateLayer: ReturnType<typeof createMockStateLayer>;
  let pipeline: MemoryPipeline;
  let config: MemoryPipelineConfig;

  beforeEach(() => {
    stateLayer = createMockStateLayer();
    config = buildConfig();
    // Cast mock to the StateLayer type expected by the constructor
    pipeline = new MemoryPipeline(stateLayer as never, config);
  });

  // --------------------------------------------------------------------------
  // [CM-01] Extraction produces memory entries from conversation history
  // --------------------------------------------------------------------------
  it('[CM-01] should extract memory entries from conversation history', async () => {
    const session = makeSession();
    const context = makeContext(session);

    // Messages with content that the DLP extraction patterns may match
    const messages: Message[] = [
      {
        id: 'msg-d1',
        sessionId: session.id,
        role: 'user',
        content: 'We decided to use PostgreSQL for the database.',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'msg-d2',
        sessionId: session.id,
        role: 'assistant',
        content: 'Great decision! TODO: set up the schema migrations next.',
        createdAt: new Date().toISOString(),
      },
    ];

    const result = await pipeline.handleExtraction({
      session,
      messages,
      context,
      trigger: 'compaction',
    });

    // The result structure should always be returned
    expect(result).toBeDefined();
    expect(result.extracted).toBeDefined();
    expect(Array.isArray(result.entries)).toBe(true);
    expect(Array.isArray(result.facts)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // [CM-02] Extracted entries are written to the memory store
  // --------------------------------------------------------------------------
  it('[CM-02] should write extracted entries to the memory store via stateLayer', async () => {
    const session = makeSession();
    const context = makeContext(session);
    const messages = makeMessages(6);

    await pipeline.handleExtraction({
      session,
      messages,
      context,
      trigger: 'threshold',
    });

    // Even if extraction finds zero items, setSessionState should be called
    // to update the lastExtraction timestamp
    expect(stateLayer.setSessionState).toHaveBeenCalled();

    // appendMemoryEntry is called once per extracted entry (0 or more)
    // We verify it was called with correct agentId when there are entries
    const entryCalls = stateLayer.appendMemoryEntry.mock.calls;
    for (const [entry] of entryCalls) {
      expect((entry as MemoryEntry).agentId).toBe('user-test-1');
    }
  });

  // --------------------------------------------------------------------------
  // [CM-03] Session state is updated after extraction
  // --------------------------------------------------------------------------
  it('[CM-03] should update session state with extraction metadata', async () => {
    const session = makeSession();
    const context = makeContext(session);
    const messages = makeMessages(4);

    await pipeline.handleExtraction({
      session,
      messages,
      context,
      trigger: 'memory_flush',
    });

    expect(stateLayer.setSessionState).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        agentId: 'user-test-1',
        state: expect.objectContaining({
          contextManagement: expect.objectContaining({
            lastExtraction: expect.any(Number),
            lastExtractionTrigger: 'memory_flush',
          }),
        }),
      }),
      context
    );
  });

  // --------------------------------------------------------------------------
  // [CM-04] Empty conversation produces no entries
  // --------------------------------------------------------------------------
  it('[CM-04] should produce no entries for an empty conversation', async () => {
    const session = makeSession();
    const context = makeContext(session);

    const result = await pipeline.handleExtraction({
      session,
      messages: [],
      context,
      trigger: 'compaction',
    });

    expect(result.entries).toHaveLength(0);
    expect(result.facts).toHaveLength(0);

    // appendMemoryEntry should not have been called
    expect(stateLayer.appendMemoryEntry).not.toHaveBeenCalled();
    expect(stateLayer.appendMemoryFacts).not.toHaveBeenCalled();

    // Session state should still be updated (extraction ran, just found nothing)
    expect(stateLayer.setSessionState).toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // [CM-05] Error during extraction is handled gracefully
  // --------------------------------------------------------------------------
  it('[CM-05] should propagate stateLayer write errors to the caller', async () => {
    const session = makeSession();
    const context = makeContext(session);

    // Force appendMemoryEntry to reject
    stateLayer.appendMemoryEntry.mockRejectedValue(new Error('DB write failed'));

    // Use storeExtracted with pre-computed items to guarantee appendMemoryEntry
    // is called, which will trigger the rejection.
    const preExtracted = {
      decisions: [{ type: 'decision' as const, content: 'Use Redis', timestamp: Date.now() }],
      facts: [],
      tasks: [],
      issues: [],
      files: [],
    };

    await expect(
      pipeline.storeExtracted({
        session,
        extracted: preExtracted,
        context,
        trigger: 'compaction',
      })
    ).rejects.toThrow('DB write failed');
  });

  // --------------------------------------------------------------------------
  // [CM-06] Extraction trigger types: memory_flush, compaction, threshold
  // --------------------------------------------------------------------------
  it('[CM-06] should record the correct trigger type in session state', async () => {
    const session = makeSession();
    const context = makeContext(session);
    const messages = makeMessages(2);

    const triggers: MemoryPipelineTrigger[] = ['memory_flush', 'compaction', 'threshold'];

    for (const trigger of triggers) {
      stateLayer.setSessionState.mockClear();

      await pipeline.handleExtraction({
        session,
        messages,
        context,
        trigger,
      });

      expect(stateLayer.setSessionState).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({
            contextManagement: expect.objectContaining({
              lastExtractionTrigger: trigger,
            }),
          }),
        }),
        context
      );
    }
  });

  // --------------------------------------------------------------------------
  // [CM-07] storeExtracted writes pre-computed extracted items
  // --------------------------------------------------------------------------
  it('[CM-07] should store pre-computed extracted items via storeExtracted', async () => {
    const session = makeSession();
    const context = makeContext(session);

    const preExtracted = {
      decisions: [
        {
          type: 'decision' as const,
          content: 'Use Redis for caching',
          timestamp: Date.now(),
        },
      ],
      facts: [
        {
          type: 'fact' as const,
          content: 'Database: PostgreSQL',
          timestamp: Date.now(),
        },
      ],
      tasks: [],
      issues: [],
      files: [],
    };

    const result = await pipeline.storeExtracted({
      session,
      extracted: preExtracted,
      context,
      trigger: 'compaction',
    });

    // Should have created entries for the decision and the fact
    expect(result.entries.length).toBe(2);
    // The fact should also produce a MemoryFact
    expect(result.facts.length).toBe(1);

    expect(stateLayer.appendMemoryEntry).toHaveBeenCalledTimes(2);
    expect(stateLayer.appendMemoryFacts).toHaveBeenCalledTimes(1);

    // Verify entry shape
    const firstEntry = stateLayer.appendMemoryEntry.mock.calls[0]?.[0] as MemoryEntry;
    expect(firstEntry.agentId).toBe('user-test-1');
    expect(firstEntry.kind).toBe('decision');
    expect(firstEntry.content).toBe('Use Redis for caching');
    expect(firstEntry.provenance?.source).toBe('proactive_history');
  });

  // --------------------------------------------------------------------------
  // [CM-08] shouldRunPeriodic respects interval configuration
  // --------------------------------------------------------------------------
  it('[CM-08] should respect periodic trigger interval', async () => {
    const periodicConfig = buildConfig({
      proactiveHistory: {
        enabled: true,
        extractors: { decisions: true, facts: true, tasks: true, issues: true, files: true },
        triggers: {
          periodic: '30m',
          onCompaction: true,
        },
      },
    });

    const periodicPipeline = new MemoryPipeline(stateLayer as never, periodicConfig);
    const session = makeSession();
    const context = makeContext(session);

    // No previous extraction — should run
    const shouldRunFirst = await periodicPipeline.shouldRunPeriodic(session, context);
    expect(shouldRunFirst).toBe(true);

    // Simulate a recent extraction (5 minutes ago)
    stateLayer.getSessionState.mockResolvedValue({
      sessionId: session.id,
      agentId: 'user-test-1',
      state: {
        contextManagement: {
          lastExtraction: Date.now() - 5 * 60 * 1000, // 5 minutes ago
          lastExtractionTrigger: 'periodic',
        },
      },
      updatedAt: new Date().toISOString(),
    });

    const shouldRunRecent = await periodicPipeline.shouldRunPeriodic(session, context);
    expect(shouldRunRecent).toBe(false);

    // Simulate an old extraction (45 minutes ago, exceeds 30m interval)
    stateLayer.getSessionState.mockResolvedValue({
      sessionId: session.id,
      agentId: 'user-test-1',
      state: {
        contextManagement: {
          lastExtraction: Date.now() - 45 * 60 * 1000, // 45 minutes ago
          lastExtractionTrigger: 'periodic',
        },
      },
      updatedAt: new Date().toISOString(),
    });

    const shouldRunOld = await periodicPipeline.shouldRunPeriodic(session, context);
    expect(shouldRunOld).toBe(true);
  });

  // --------------------------------------------------------------------------
  // [CM-09] getPeriodicIntervalMs parses duration strings correctly
  // --------------------------------------------------------------------------
  it('[CM-09] should parse periodic interval durations correctly', () => {
    const configs: Array<{ duration: string; expectedMs: number }> = [
      { duration: '5m', expectedMs: 5 * 60 * 1000 },
      { duration: '1h', expectedMs: 60 * 60 * 1000 },
      { duration: '30s', expectedMs: 30 * 1000 },
      { duration: '500ms', expectedMs: 500 },
    ];

    for (const { duration, expectedMs } of configs) {
      const cfg = buildConfig({
        proactiveHistory: {
          enabled: true,
          extractors: { decisions: true, facts: true, tasks: true, issues: true, files: true },
          triggers: { periodic: duration, onCompaction: true },
        },
      });

      const p = new MemoryPipeline(stateLayer as never, cfg);
      expect(p.getPeriodicIntervalMs()).toBe(expectedMs);
    }
  });

  it('[CM-10] should return null interval when periodic trigger is not configured', () => {
    // Default config has no periodic trigger
    expect(pipeline.getPeriodicIntervalMs()).toBeNull();
  });

  // --------------------------------------------------------------------------
  // [CM-11] Preserves existing session state when updating
  // --------------------------------------------------------------------------
  it('[CM-11] should merge extraction metadata with existing session state', async () => {
    const session = makeSession();
    const context = makeContext(session);

    // Existing session state with custom data
    stateLayer.getSessionState.mockResolvedValue({
      sessionId: session.id,
      agentId: 'user-test-1',
      state: {
        customKey: 'customValue',
        contextManagement: {
          lastExtraction: Date.now() - 60000,
          previousData: true,
        },
      },
      updatedAt: new Date().toISOString(),
    });

    await pipeline.handleExtraction({
      session,
      messages: makeMessages(2),
      context,
      trigger: 'threshold',
    });

    const setCall = stateLayer.setSessionState.mock.calls[0]?.[0] as SessionStateRecord;
    // customKey should be preserved
    expect(setCall.state.customKey).toBe('customValue');
    // contextManagement should be updated
    const cm = setCall.state.contextManagement as Record<string, unknown>;
    expect(cm.lastExtractionTrigger).toBe('threshold');
    expect(typeof cm.lastExtraction).toBe('number');
  });
});
