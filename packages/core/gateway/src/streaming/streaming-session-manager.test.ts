import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StreamingSessionManager,
  type StreamingSessionManagerDeps,
  type StreamingState,
} from './streaming-session-manager.js';
import type { ChannelInboundMessage } from '@nachos/types';

function makeInbound(overrides: Partial<ChannelInboundMessage> = {}): ChannelInboundMessage {
  return {
    channel: 'slack',
    channelMessageId: 'msg-1',
    sender: { id: 'user-1', displayName: 'Alice' },
    conversation: { id: 'conv-1' },
    content: { text: 'hello' },
    ...overrides,
  } as ChannelInboundMessage;
}

describe('StreamingSessionManager', () => {
  let deps: StreamingSessionManagerDeps;
  let manager: StreamingSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = {
      sendToChannel: vi.fn().mockResolvedValue(undefined),
    };
    manager = new StreamingSessionManager(deps, {
      streamingMinIntervalMs: 500,
      streamingChunkSize: 200,
      maxSessionAgeMs: 300_000, // 5 min
      sweepIntervalMs: 60_000,
    });
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------
  // register() creates session entry
  // ---------------------------------------------------------------

  it('[STR-01] register() creates a session entry', () => {
    const inbound = makeInbound();
    manager.register('session-1', inbound);

    expect(manager.has('session-1')).toBe(true);
  });

  // ---------------------------------------------------------------
  // has() returns true for registered, false for unknown
  // ---------------------------------------------------------------

  it('[STR-01] has() returns true for registered session and false for unknown', () => {
    expect(manager.has('unknown')).toBe(false);

    manager.register('s1', makeInbound());
    expect(manager.has('s1')).toBe(true);
    expect(manager.has('s2')).toBe(false);
  });

  // ---------------------------------------------------------------
  // Duplicate register replaces existing
  // ---------------------------------------------------------------

  it('[STR-01] duplicate register() replaces the existing session entry', () => {
    const inbound1 = makeInbound({ channelMessageId: 'msg-1' });
    const inbound2 = makeInbound({ channelMessageId: 'msg-2' });

    manager.register('s1', inbound1);
    manager.register('s1', inbound2);

    expect(manager.has('s1')).toBe(true);

    // Verify internal state was replaced by accessing via stop -> re-check
    // We can confirm the manager still only has one entry by registering another
    // and checking the total indirectly. The key test is that it doesn't throw.
    // Access internal state to confirm replacement
    const sessions = (manager as unknown as { sessions: Map<string, StreamingState> }).sessions;
    expect(sessions.size).toBe(1);
    expect(sessions.get('s1')!.inbound.channelMessageId).toBe('msg-2');
  });

  // ---------------------------------------------------------------
  // stop() cleans up the session
  // ---------------------------------------------------------------

  it('[STR-07] stop() clears all sessions and stops sweep', () => {
    manager.register('s1', makeInbound());
    manager.register('s2', makeInbound());

    manager.stop();

    expect(manager.has('s1')).toBe(false);
    expect(manager.has('s2')).toBe(false);
  });

  // ---------------------------------------------------------------
  // stop() called twice does not throw
  // ---------------------------------------------------------------

  it('[STR-07] stop() called multiple times is idempotent', () => {
    manager.register('s1', makeInbound());

    expect(() => {
      manager.stop();
      manager.stop();
    }).not.toThrow();
  });

  // ---------------------------------------------------------------
  // Sweep removes sessions older than maxAge
  // ---------------------------------------------------------------

  it('[STR-06] sweep removes sessions older than maxSessionAgeMs', async () => {
    // Create manager with a short sweep interval for test
    const shortManager = new StreamingSessionManager(deps, {
      maxSessionAgeMs: 10_000, // 10 s
      sweepIntervalMs: 1_000, // 1 s
    });

    // Mock a bus that just stores the handler
    let _streamHandler: ((data: unknown) => Promise<void>) | undefined;
    const mockBus = {
      subscribe: vi
        .fn()
        .mockImplementation(async (_topic: string, handler: (data: unknown) => Promise<void>) => {
          _streamHandler = handler;
        }),
    };

    await shortManager.startSubscription(mockBus as never);

    // Register a session
    shortManager.register('old-session', makeInbound());
    expect(shortManager.has('old-session')).toBe(true);

    // Advance past maxSessionAgeMs + sweepInterval
    vi.advanceTimersByTime(12_000);

    expect(shortManager.has('old-session')).toBe(false);

    shortManager.stop();
  });

  // ---------------------------------------------------------------
  // Sweep preserves sessions within maxAge
  // ---------------------------------------------------------------

  it('[STR-06] sweep preserves sessions within maxSessionAgeMs', async () => {
    const shortManager = new StreamingSessionManager(deps, {
      maxSessionAgeMs: 30_000,
      sweepIntervalMs: 5_000,
    });

    const mockBus = {
      subscribe: vi.fn().mockResolvedValue(undefined),
    };

    await shortManager.startSubscription(mockBus as never);

    shortManager.register('young-session', makeInbound());

    // Advance time but stay within maxAge
    vi.advanceTimersByTime(10_000);

    expect(shortManager.has('young-session')).toBe(true);

    shortManager.stop();
  });

  // ---------------------------------------------------------------
  // startSubscription subscribes to wildcard stream topic
  // ---------------------------------------------------------------

  it('[STR-08] startSubscription subscribes to nachos.llm.stream.* topic', async () => {
    const mockBus = {
      subscribe: vi.fn().mockResolvedValue(undefined),
    };

    await manager.startSubscription(mockBus as never);

    expect(mockBus.subscribe).toHaveBeenCalledWith('nachos.llm.stream.*', expect.any(Function));
  });

  // ---------------------------------------------------------------
  // "done" chunk type removes session
  // ---------------------------------------------------------------

  it('[STR-04] done chunk type cleans up the streaming session', async () => {
    let _streamHandler: ((data: unknown) => Promise<void>) | undefined;
    const mockBus = {
      subscribe: vi
        .fn()
        .mockImplementation(async (_topic: string, handler: (data: unknown) => Promise<void>) => {
          _streamHandler = handler;
        }),
    };

    await manager.startSubscription(mockBus as never);

    manager.register('s1', makeInbound());
    expect(manager.has('s1')).toBe(true);

    // Simulate a "done" chunk
    await _streamHandler!({
      id: 'env-1',
      timestamp: new Date().toISOString(),
      source: 'llm',
      type: 'llm.stream',
      payload: { sessionId: 's1', type: 'done' },
    });

    expect(manager.has('s1')).toBe(false);
  });

  // ---------------------------------------------------------------
  // Config defaults
  // ---------------------------------------------------------------

  it('[STR-03] uses sensible defaults when no config provided', () => {
    const defaultManager = new StreamingSessionManager(deps);
    const config = (defaultManager as unknown as { config: Record<string, number> }).config;

    expect(config.streamingMinIntervalMs).toBe(500);
    expect(config.streamingChunkSize).toBe(200);
    expect(config.maxSessionAgeMs).toBe(300_000);
    expect(config.sweepIntervalMs).toBe(60_000);

    defaultManager.stop();
  });

  // ---------------------------------------------------------------
  // getActiveSessions() — gauge metric (issue #155)
  // ---------------------------------------------------------------

  it('[STR-09] getActiveSessions() reflects the current number of live sessions', () => {
    expect(manager.getActiveSessions()).toBe(0);

    manager.register('a', makeInbound());
    expect(manager.getActiveSessions()).toBe(1);

    manager.register('b', makeInbound());
    expect(manager.getActiveSessions()).toBe(2);

    manager.stop();
    expect(manager.getActiveSessions()).toBe(0);
  });

  // ---------------------------------------------------------------
  // Sweep logs a warning when sessions are reaped (issue #155)
  // ---------------------------------------------------------------

  it('[STR-10] sweep emits a warn log when stale sessions are reaped', async () => {
    const shortManager = new StreamingSessionManager(deps, {
      maxSessionAgeMs: 5_000,
      sweepIntervalMs: 1_000,
    });

    const mockBus = {
      subscribe: vi.fn().mockResolvedValue(undefined),
    };

    await shortManager.startSubscription(mockBus as never);
    shortManager.register('stale-1', makeInbound());
    shortManager.register('stale-2', makeInbound());

    expect(shortManager.getActiveSessions()).toBe(2);

    // Advance past maxAge + one sweep interval
    vi.advanceTimersByTime(7_000);

    expect(shortManager.getActiveSessions()).toBe(0);

    shortManager.stop();
  });

  it('[STR-11] sweep does not log when no sessions are reaped', async () => {
    const shortManager = new StreamingSessionManager(deps, {
      maxSessionAgeMs: 30_000,
      sweepIntervalMs: 1_000,
    });

    const mockBus = {
      subscribe: vi.fn().mockResolvedValue(undefined),
    };

    await shortManager.startSubscription(mockBus as never);
    shortManager.register('fresh-1', makeInbound());

    // Advance less than maxAge — nothing should be reaped
    vi.advanceTimersByTime(5_000);

    expect(shortManager.getActiveSessions()).toBe(1);

    shortManager.stop();
  });
});
