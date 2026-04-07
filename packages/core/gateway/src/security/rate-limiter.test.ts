import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MemoryRateLimitStore,
  RateLimiter,
  createDefaultRateLimiterConfig,
  type RateLimitStore,
} from './rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------
  // Existing tests
  // ---------------------------------------------------------------

  it('[RL-01] allows traffic when disabled', async () => {
    const limiter = new RateLimiter({
      enabled: false,
      limits: { messagesPerMinute: 1 },
    });

    const result = await limiter.check('user-1', 'message');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('[RL-02] enforces sliding window limits', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 2 },
    });

    vi.setSystemTime(1_000);
    const first = await limiter.check('user-1', 'message');
    const second = await limiter.check('user-1', 'message');
    const third = await limiter.check('user-1', 'message');

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);

    vi.setSystemTime(62_000);
    const reset = await limiter.check('user-1', 'message');
    expect(reset.allowed).toBe(true);
  });

  it('[RL-04] selects limits by security mode', () => {
    const config = createDefaultRateLimiterConfig();
    const limiter = new RateLimiter(config);

    expect(limiter.getLimitsForMode('strict').messagesPerMinute).toBe(20);
    expect(limiter.getLimitsForMode('standard').messagesPerMinute).toBe(30);
    expect(limiter.getLimitsForMode('permissive').messagesPerMinute).toBe(120);
  });

  it('[RL-05] falls back to memory store when primary store fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 1 },
      redisUrl: 'redis://invalid:6379',
    });
    const fallbackStore = new MemoryRateLimitStore();

    const store: {
      record: (key: string, timestampMs: number, windowMs: number) => Promise<number>;
      disconnect: () => Promise<void>;
      getSource: () => 'redis';
    } = {
      record: vi.fn().mockRejectedValue(new Error('redis down')),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getSource: () => 'redis',
    };
    const limiterInternals = limiter as unknown as {
      store: RateLimitStore;
      fallbackStore: RateLimitStore;
    };
    limiterInternals.store = store;
    limiterInternals.fallbackStore = fallbackStore;

    const result = await limiter.recordWithFallback('rate:key', Date.now(), 60_000);

    expect(result.source).toBe('memory');
    expect(result.count).toBe(1);
    expect(store.record).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ---------------------------------------------------------------
  // New tests — per-category limits
  // ---------------------------------------------------------------

  it('[RL-02] per-category limits: message, tool, and llm have independent limits', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: {
        messagesPerMinute: 2,
        toolCallsPerMinute: 1,
        llmRequestsPerMinute: 3,
      },
    });

    vi.setSystemTime(1_000);

    // Exhaust tool limit (1)
    const tool1 = await limiter.check('user-1', 'tool');
    const tool2 = await limiter.check('user-1', 'tool');
    expect(tool1.allowed).toBe(true);
    expect(tool2.allowed).toBe(false);

    // Message limit (2) should still be independent
    const msg1 = await limiter.check('user-1', 'message');
    const msg2 = await limiter.check('user-1', 'message');
    const msg3 = await limiter.check('user-1', 'message');
    expect(msg1.allowed).toBe(true);
    expect(msg2.allowed).toBe(true);
    expect(msg3.allowed).toBe(false);

    // LLM limit (3) should also be independent
    const llm1 = await limiter.check('user-1', 'llm');
    const llm2 = await limiter.check('user-1', 'llm');
    const llm3 = await limiter.check('user-1', 'llm');
    const llm4 = await limiter.check('user-1', 'llm');
    expect(llm1.allowed).toBe(true);
    expect(llm2.allowed).toBe(true);
    expect(llm3.allowed).toBe(true);
    expect(llm4.allowed).toBe(false);
  });

  // ---------------------------------------------------------------
  // Multi-user isolation
  // ---------------------------------------------------------------

  it('[RL-02] multi-user isolation: user A requests do not affect user B', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 2 },
    });

    vi.setSystemTime(1_000);

    // Exhaust user-A's limit
    await limiter.check('user-A', 'message');
    await limiter.check('user-A', 'message');
    const userABlocked = await limiter.check('user-A', 'message');
    expect(userABlocked.allowed).toBe(false);

    // user-B should be unaffected
    const userB1 = await limiter.check('user-B', 'message');
    const userB2 = await limiter.check('user-B', 'message');
    expect(userB1.allowed).toBe(true);
    expect(userB2.allowed).toBe(true);
  });

  // ---------------------------------------------------------------
  // Window reset — requests expire after window period
  // ---------------------------------------------------------------

  it('[RL-03] window reset: requests expire after 60s window', async () => {
    // Note: every check() call records a timestamp even if blocked.
    // Use a limit of 2 so we can verify the sliding window correctly.
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 2 },
    });

    vi.setSystemTime(1_000);
    const first = await limiter.check('user-1', 'message');
    expect(first.allowed).toBe(true);

    const second = await limiter.check('user-1', 'message');
    expect(second.allowed).toBe(true);

    const blocked = await limiter.check('user-1', 'message');
    expect(blocked.allowed).toBe(false);

    // Move past 60s from ALL previous timestamps — all old entries expire.
    // The earliest was at 1_000, window is 60_000, so after 61_001 it expires.
    // But we also recorded at 1_000 three times (all with same timestamp).
    // At 62_000: windowStart = 62_000 - 60_000 = 2_000. All entries at 1_000 are <= 2_000, so filtered.
    vi.setSystemTime(62_000);
    const afterReset = await limiter.check('user-1', 'message');
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(1); // 1 of 2 used
  });

  // ---------------------------------------------------------------
  // Remaining count decrements correctly
  // ---------------------------------------------------------------

  it('[RL-02] remaining count decrements correctly', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 5 },
    });

    vi.setSystemTime(1_000);

    const r1 = await limiter.check('user-1', 'message');
    expect(r1.remaining).toBe(4);
    expect(r1.total).toBe(5);

    const r2 = await limiter.check('user-1', 'message');
    expect(r2.remaining).toBe(3);

    const r3 = await limiter.check('user-1', 'message');
    expect(r3.remaining).toBe(2);

    const r4 = await limiter.check('user-1', 'message');
    expect(r4.remaining).toBe(1);

    const r5 = await limiter.check('user-1', 'message');
    expect(r5.remaining).toBe(0);
    expect(r5.allowed).toBe(true);

    // 6th request — blocked
    const r6 = await limiter.check('user-1', 'message');
    expect(r6.remaining).toBe(0);
    expect(r6.allowed).toBe(false);
    expect(r6.retryAfterSeconds).toBe(60);
  });

  // ---------------------------------------------------------------
  // Per-mode preset limits are different per category
  // ---------------------------------------------------------------

  it('[RL-04] per-mode presets have distinct limits per category', () => {
    const config = createDefaultRateLimiterConfig();
    const limiter = new RateLimiter(config);

    const strict = limiter.getLimitsForMode('strict');
    expect(strict.messagesPerMinute).toBe(20);
    expect(strict.toolCallsPerMinute).toBe(5);
    expect(strict.llmRequestsPerMinute).toBe(20);

    const standard = limiter.getLimitsForMode('standard');
    expect(standard.messagesPerMinute).toBe(30);
    expect(standard.toolCallsPerMinute).toBe(15);
    expect(standard.llmRequestsPerMinute).toBe(30);

    const permissive = limiter.getLimitsForMode('permissive');
    expect(permissive.messagesPerMinute).toBe(120);
    expect(permissive.toolCallsPerMinute).toBe(60);
    expect(permissive.llmRequestsPerMinute).toBe(120);
  });

  // ---------------------------------------------------------------
  // Limit override via check()
  // ---------------------------------------------------------------

  it('[RL-04] check() respects limitOverride over default config', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 100 }, // very generous default
    });

    vi.setSystemTime(1_000);

    // Override with a strict limit of 1
    const r1 = await limiter.check('user-1', 'message', { messagesPerMinute: 1 });
    expect(r1.allowed).toBe(true);

    const r2 = await limiter.check('user-1', 'message', { messagesPerMinute: 1 });
    expect(r2.allowed).toBe(false);
  });

  // ---------------------------------------------------------------
  // Undefined action limit allows all traffic
  // ---------------------------------------------------------------

  it('[RL-02] allows all traffic when action has no defined limit', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 1 }, // only message defined
    });

    vi.setSystemTime(1_000);

    // tool and llm have no defined limits — should be allowed
    const tool = await limiter.check('user-1', 'tool');
    expect(tool.allowed).toBe(true);
    expect(tool.remaining).toBe(Number.MAX_SAFE_INTEGER);

    const llm = await limiter.check('user-1', 'llm');
    expect(llm.allowed).toBe(true);
    expect(llm.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  // ---------------------------------------------------------------
  // Memory store fallback preserves functionality
  // ---------------------------------------------------------------

  it('[RL-05] memory store fallback records and enforces limits correctly', async () => {
    const store = new MemoryRateLimitStore();

    // Record three entries at t=1_000 (same timestamp)
    const c1 = await store.record('rate:message:u1', 1_000, 60_000);
    const c2 = await store.record('rate:message:u1', 1_000, 60_000);
    const c3 = await store.record('rate:message:u1', 1_000, 60_000);

    expect(c1).toBe(1);
    expect(c2).toBe(2);
    expect(c3).toBe(3);

    // After window expires (windowStart = 62_000 - 60_000 = 2_000),
    // all entries at 1_000 are NOT > 2_000, so they are filtered out.
    // Only the new entry at 62_000 remains.
    const c4 = await store.record('rate:message:u1', 62_000, 60_000);
    expect(c4).toBe(1); // all old entries expired

    store.destroy();
  });
});
