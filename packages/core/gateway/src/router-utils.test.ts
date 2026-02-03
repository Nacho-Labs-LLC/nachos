import { describe, it, expect } from 'vitest'
import { getRateLimitUserId } from './router-utils.js'

describe('getRateLimitUserId', () => {
  it('returns sessionId when available', () => {
    expect(getRateLimitUserId({ sessionId: 'session-123' })).toBe('session-123')
  })

  it('falls back to sender.id when sessionId missing', () => {
    expect(getRateLimitUserId({ sender: { id: 'user-456' } })).toBe('user-456')
  })

  it('returns undefined when payload has no identifiers', () => {
    expect(getRateLimitUserId({})).toBeUndefined()
  })

  it('returns undefined for non-object payloads', () => {
    expect(getRateLimitUserId(null)).toBeUndefined()
    expect(getRateLimitUserId('test')).toBeUndefined()
  })
})
