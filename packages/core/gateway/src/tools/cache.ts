/**
 * Tool Cache
 *
 * Caches tool execution results to avoid redundant executions.
 * Supports both memory and Redis backends.
 */

import crypto from 'node:crypto';
import { createLogger } from '@nachos/types';
import type { ToolCall, ToolResult } from '@nachos/types';

const logger = createLogger('tool-cache');

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Enable caching */
  enabled?: boolean;

  /** Redis URL (if using Redis backend) */
  redisUrl?: string;

  /** Default TTL in seconds */
  defaultTTL?: number;

  /** Max memory cache size (number of entries) */
  maxMemoryEntries?: number;
}

/**
 * Cached result with expiration
 */
interface CachedEntry {
  result: ToolResult;
  expiresAt: number;
}

/**
 * Tool result cache
 */
export class ToolCache {
  private enabled: boolean;
  private memoryCache: Map<string, CachedEntry> = new Map();
  private redis: RedisClient | null = null;
  private redisReady: Promise<void> | null = null;
  private defaultTTL: number;
  private maxMemoryEntries: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: CacheConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.defaultTTL = config.defaultTTL ?? 300; // 5 minutes
    this.maxMemoryEntries = config.maxMemoryEntries ?? 1000;

    // Initialize Redis if URL provided — track the promise so callers can await readiness
    if (config.redisUrl) {
      this.redisReady = this.initializeRedis(config.redisUrl);
    }

    // Start cleanup interval (every minute)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Get a cached result for a tool call
   */
  async get(call: ToolCall): Promise<ToolResult | null> {
    if (!this.enabled) {
      return null;
    }

    // Await Redis init before first use to avoid the async race
    if (this.redisReady) {
      await this.redisReady;
      this.redisReady = null;
    }

    const key = this.generateKey(call);

    // Try memory cache first
    const memResult = this.getFromMemory(key);
    if (memResult) {
      return memResult;
    }

    // Try Redis if available
    if (this.redis) {
      const redisResult = await this.getFromRedis(key);
      if (redisResult) {
        // Warm memory cache
        this.setInMemory(key, redisResult, 60); // Cache in memory for 1 minute
        return redisResult;
      }
    }

    return null;
  }

  /**
   * Store a result in cache
   */
  async set(call: ToolCall, result: ToolResult, ttl?: number): Promise<void> {
    if (!this.enabled) {
      return;
    }

    // Await Redis init before first use to avoid the async race
    if (this.redisReady) {
      await this.redisReady;
      this.redisReady = null;
    }

    const key = this.generateKey(call);
    const effectiveTTL = ttl ?? this.defaultTTL;

    // Store in memory
    this.setInMemory(key, result, effectiveTTL);

    // Store in Redis if available
    if (this.redis) {
      await this.setInRedis(key, result, effectiveTTL);
    }
  }

  /**
   * Invalidate cache for a specific tool call
   */
  async invalidate(call: ToolCall): Promise<void> {
    const key = this.generateKey(call);

    // Remove from memory
    this.memoryCache.delete(key);

    // Remove from Redis if available
    if (this.redis) {
      await this.redis.del(key);
    }
  }

  /**
   * Clear all cached entries.
   * Uses SCAN to delete only tool:* keys so Redis data from other subsystems
   * (session state, rate limiting) is never touched.
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (this.redis) {
      let cursor = 0;
      do {
        const result = await this.redis.scan(cursor, { MATCH: 'tool:*', COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await this.redis.del(result.keys);
        }
      } while (cursor !== 0);
    }
  }

  /**
   * Shutdown the cache
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  /**
   * Generate a cache key for a tool call
   * Uses SHA256 hash of tool name + parameters
   */
  generateKey(call: ToolCall): string {
    const hash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          tool: call.tool,
          params: call.parameters,
        })
      )
      .digest('hex');

    return `tool:${call.tool}:${hash}`;
  }

  /**
   * Get result from memory cache
   */
  private getFromMemory(key: string): ToolResult | null {
    const entry = this.memoryCache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * Store result in memory cache
   */
  private setInMemory(key: string, result: ToolResult, ttl: number): void {
    // Check size limit
    if (this.memoryCache.size >= this.maxMemoryEntries) {
      // Remove oldest entry (simple LRU approximation)
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
      }
    }

    this.memoryCache.set(key, {
      result,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  /**
   * Get result from Redis
   */
  private async getFromRedis(key: string): Promise<ToolResult | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }

      return JSON.parse(data) as ToolResult;
    } catch (error) {
      logger.error({ err: error }, 'Error getting from Redis');
      return null;
    }
  }

  /**
   * Store result in Redis
   */
  private async setInRedis(key: string, result: ToolResult, ttl: number): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.setex(key, ttl, JSON.stringify(result));
    } catch (error) {
      logger.error({ err: error }, 'Error setting in Redis');
    }
  }

  /**
   * Initialize Redis connection. Returns a promise that resolves when ready
   * (or rejects/silently falls back if Redis is unavailable).
   */
  private async initializeRedis(url: string): Promise<void> {
    try {
      const redisModule = await import('redis');
      const client = redisModule.createClient({ url });

      client.on('error', (error) => {
        // Log but do NOT null out this.redis — the node-redis client auto-reconnects
        // internally. Clearing this.redis would permanently lose the backend.
        // getFromRedis/setInRedis have try/catch that handles transient failures.
        logger.error({ err: error }, 'Redis cache error (auto-reconnect in progress)');
      });

      await client.connect();
      logger.info('Redis cache connected');
      this.redis = client as unknown as RedisClient;
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to Redis cache, using memory-only');
      this.redis = null;
    }
  }

  /**
   * Clean up expired entries from memory cache
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.memoryCache) {
      if (entry.expiresAt <= now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.memoryCache.delete(key);
    }

    if (keysToDelete.length > 0) {
      logger.info({ count: keysToDelete.length }, 'Cleaned up expired cache entries');
    }
  }
}

/**
 * Redis client interface — scoped to the operations used by ToolCache.
 * Uses SCAN for key-pattern deletion to avoid touching data owned by other subsystems.
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  del(key: string | string[]): Promise<void>;
  scan(
    cursor: number,
    options: { MATCH: string; COUNT: number }
  ): Promise<{ cursor: number; keys: string[] }>;
  quit(): Promise<void>;
}
