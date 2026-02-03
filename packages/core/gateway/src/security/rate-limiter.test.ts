import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RateLimiter, createDefaultRateLimiterConfig } from './rate-limiter.js'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows traffic when disabled', async () => {
    const limiter = new RateLimiter({
      enabled: false,
      limits: { messagesPerMinute: 1 },
    })

    const result = await limiter.check('user-1', 'message')

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('enforces sliding window limits', async () => {
    const limiter = new RateLimiter({
      enabled: true,
      limits: { messagesPerMinute: 2 },
    })

    vi.setSystemTime(1_000)
    const first = await limiter.check('user-1', 'message')
    const second = await limiter.check('user-1', 'message')
    const third = await limiter.check('user-1', 'message')

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(false)

    vi.setSystemTime(62_000)
    const reset = await limiter.check('user-1', 'message')
    expect(reset.allowed).toBe(true)
  })

  it('selects limits by security mode', () => {
    const config = createDefaultRateLimiterConfig()
    const limiter = new RateLimiter(config)

    expect(limiter.getLimitsForMode('strict').messagesPerMinute).toBe(20)
    expect(limiter.getLimitsForMode('standard').messagesPerMinute).toBe(30)
    expect(limiter.getLimitsForMode('permissive').messagesPerMinute).toBe(120)
  })
})
