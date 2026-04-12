/**
 * Shared rate limiter for tool integrations (GitHub, Bitbucket, etc.)
 *
 * Provides a sliding-window rate limiter keyed by user/session ID.
 */

export interface RateLimitState {
  calls: number;
  windowStart: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  message?: string;
}

export class ToolRateLimiter {
  private state = new Map<string, RateLimitState>();
  // Clean up stale entries every 5 windows to prevent unbounded memory growth
  private readonly cleanupIntervalMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly windowMs: number = 60 * 1000,
    private readonly maxCalls: number = 30,
    private readonly toolName: string = 'tool'
  ) {
    this.cleanupIntervalMs = this.windowMs * 5;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs).unref();
  }

  check(userId: string): RateLimitCheckResult {
    const now = Date.now();
    let entry = this.state.get(userId);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      entry = { calls: 0, windowStart: now };
      this.state.set(userId, entry);
    }

    if (entry.calls >= this.maxCalls) {
      const resetIn = Math.max(1, Math.ceil((this.windowMs - (now - entry.windowStart)) / 1000));
      return {
        allowed: false,
        message: `Rate limit exceeded. Maximum ${this.maxCalls} ${this.toolName} calls per minute. Try again in ${resetIn}s.`,
      };
    }

    entry.calls++;
    return { allowed: true };
  }

  /** Remove entries for users whose window has long expired. */
  private cleanup(): void {
    const staleThreshold = Date.now() - this.windowMs * 2;
    for (const [userId, entry] of this.state) {
      if (entry.windowStart < staleThreshold) {
        this.state.delete(userId);
      }
    }
  }

  /** Stop the background cleanup timer (call on shutdown). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
