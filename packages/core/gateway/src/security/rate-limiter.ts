/**
 * Sliding window rate limiter with Redis optional backend.
 */
import { createClient, type RedisClientType } from 'redis';
import { v4 as uuid } from 'uuid';
import { createInternalError, createLogger } from '@nachos/types';

const logger = createLogger('rate-limiter');

export type RateLimitAction = 'message' | 'tool' | 'llm';

export interface RateLimitPresets {
  strict: RateLimiterLimits;
  standard: RateLimiterLimits;
  permissive: RateLimiterLimits;
}

export interface RateLimiterLimits {
  messagesPerMinute?: number;
  toolCallsPerMinute?: number;
  llmRequestsPerMinute?: number;
}

export interface RateLimiterConfig {
  enabled: boolean;
  limits: RateLimiterLimits;
  redisUrl?: string;
  presets?: RateLimitPresets;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  total: number;
  retryAfterSeconds?: number;
  source: 'memory' | 'redis';
}

export interface RateLimitStore {
  record(key: string, timestampMs: number, windowMs: number): Promise<number>;
  disconnect(): Promise<void>;
  getSource(): 'memory' | 'redis';
}

const DEFAULT_WINDOW_MS = 60_000;

export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, number[]>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Periodically purge entries whose timestamps are entirely outside
    // the rate-limit window so the map does not grow without bound.
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const windowStart = now - DEFAULT_WINDOW_MS;
      for (const [key, timestamps] of this.entries) {
        const valid = timestamps.filter((t) => t > windowStart);
        if (valid.length === 0) {
          this.entries.delete(key);
        } else {
          this.entries.set(key, valid);
        }
      }
    }, 60_000);
  }

  async record(key: string, timestampMs: number, windowMs: number): Promise<number> {
    const windowStart = timestampMs - windowMs;
    const entries = this.entries.get(key) ?? [];
    const filtered = entries.filter((value) => value > windowStart);
    filtered.push(timestampMs);
    this.entries.set(key, filtered);
    return filtered.length;
  }

  async disconnect(): Promise<void> {
    this.destroy();
    this.entries.clear();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  getSource(): 'memory' | 'redis' {
    return 'memory';
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClientType;
  // See RedisSessionStateStore for the rationale: connect() must be called
  // exactly once. node-redis v4 handles reconnection and command queueing
  // internally after that.
  private connectCalled = false;
  private connecting: Promise<void> | null = null;

  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
    this.client.on('error', (error) => {
      logger.warn({ err: error }, 'Redis error (auto-reconnect in progress)');
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectCalled) return;

    if (!this.connecting) {
      this.connectCalled = true;
      this.connecting = this.client
        .connect()
        .then(() => {
          this.connecting = null;
        })
        .catch((err: Error) => {
          this.connectCalled = false;
          this.connecting = null;
          throw err;
        });
    }
    await this.connecting;
  }

  async record(key: string, timestampMs: number, windowMs: number): Promise<number> {
    await this.ensureConnected();
    const windowStart = timestampMs - windowMs;
    const pipeline = this.client.multi();
    pipeline.zRemRangeByScore(key, 0, windowStart);
    pipeline.zAdd(key, [{ score: timestampMs, value: uuid() }]);
    pipeline.zCard(key);
    pipeline.pExpire(key, windowMs);
    const results = await pipeline.exec();
    if (!results) {
      throw createInternalError('Redis rate limit pipeline failed', { component: 'gateway' });
    }
    const countResult = results[2] as [Error | null, number] | undefined;
    if (!countResult || countResult[0]) {
      throw createInternalError('Redis rate limit count failed', { component: 'gateway' });
    }
    return Number(countResult[1]);
  }

  async disconnect(): Promise<void> {
    if (this.connectCalled) {
      await this.client.disconnect();
      this.connectCalled = false;
    }
  }

  getSource(): 'memory' | 'redis' {
    return 'redis';
  }
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private store: RateLimitStore;
  private fallbackStore: RateLimitStore;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.fallbackStore = new MemoryRateLimitStore();
    this.store = config.redisUrl ? new RedisRateLimitStore(config.redisUrl) : this.fallbackStore;
  }

  getLimitsForMode(securityMode: 'strict' | 'standard' | 'permissive'): RateLimiterLimits {
    return this.config.presets?.[securityMode] ?? this.config.limits;
  }

  async check(
    userId: string,
    action: RateLimitAction,
    limitOverride?: RateLimiterLimits
  ): Promise<RateLimitCheckResult> {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        resetAt: Date.now() + DEFAULT_WINDOW_MS,
        total: Number.MAX_SAFE_INTEGER,
        source: this.store.getSource(),
      };
    }

    const limits = limitOverride ?? this.config.limits;
    const limit = this.getLimitForAction(action, limits);
    if (!limit || limit <= 0) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        resetAt: Date.now() + DEFAULT_WINDOW_MS,
        total: Number.MAX_SAFE_INTEGER,
        source: this.store.getSource(),
      };
    }

    const windowMs = DEFAULT_WINDOW_MS;
    const timestampMs = Date.now();
    const key = `rate:${action}:${userId}`;

    const { count, source } = await this.recordWithFallback(key, timestampMs, windowMs);
    const remaining = Math.max(limit - count, 0);
    const allowed = count <= limit;
    const resetAt = timestampMs + windowMs;

    return {
      allowed,
      remaining,
      resetAt,
      total: limit,
      retryAfterSeconds: allowed ? undefined : Math.ceil(windowMs / 1000),
      source,
    };
  }

  async recordWithFallback(
    key: string,
    timestampMs: number,
    windowMs: number
  ): Promise<{ count: number; source: 'memory' | 'redis' }> {
    try {
      const count = await this.store.record(key, timestampMs, windowMs);
      return { count, source: this.store.getSource() };
    } catch (error) {
      logger.warn(
        { err: error, source: this.store.getSource() },
        'Rate limit store failed; falling back to memory'
      );
      if (this.store instanceof RedisRateLimitStore) {
        await this.store.disconnect();
      }
      if (this.store !== this.fallbackStore) {
        const count = await this.fallbackStore.record(key, timestampMs, windowMs);
        return { count, source: this.fallbackStore.getSource() };
      }
      throw createInternalError('Rate limit storage unavailable', { component: 'gateway' });
    }
  }

  async shutdown(): Promise<void> {
    await this.store.disconnect();
    if (this.store !== this.fallbackStore) {
      await this.fallbackStore.disconnect();
    }
  }

  private getLimitForAction(
    action: RateLimitAction,
    limits: RateLimiterLimits
  ): number | undefined {
    switch (action) {
      case 'message':
        return limits.messagesPerMinute;
      case 'tool':
        return limits.toolCallsPerMinute;
      case 'llm':
        return limits.llmRequestsPerMinute;
      default:
        return undefined;
    }
  }
}

export function createDefaultRateLimiterConfig(): RateLimiterConfig {
  return {
    enabled: true,
    limits: {
      messagesPerMinute: 30,
      toolCallsPerMinute: 15,
      llmRequestsPerMinute: 30,
    },
    presets: {
      strict: {
        messagesPerMinute: 20,
        toolCallsPerMinute: 5,
        llmRequestsPerMinute: 20,
      },
      standard: {
        messagesPerMinute: 30,
        toolCallsPerMinute: 15,
        llmRequestsPerMinute: 30,
      },
      permissive: {
        messagesPerMinute: 120,
        toolCallsPerMinute: 60,
        llmRequestsPerMinute: 120,
      },
    },
  };
}
