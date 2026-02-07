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

  it('allows traffic when disabled', async () => {
    const limiter = new RateLimiter({
      enabled: false,
      limits: { messagesPerMinute: 1 },
    });

    const result = await limiter.check('user-1', 'message');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('enforces sliding window limits', async () => {
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

  it('selects limits by security mode', () => {
    const config = createDefaultRateLimiterConfig();
    const limiter = new RateLimiter(config);

    expect(limiter.getLimitsForMode('strict').messagesPerMinute).toBe(20);
    expect(limiter.getLimitsForMode('standard').messagesPerMinute).toBe(30);
    expect(limiter.getLimitsForMode('permissive').messagesPerMinute).toBe(120);
  });

  it('falls back to memory store when primary store fails', async () => {
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
});
