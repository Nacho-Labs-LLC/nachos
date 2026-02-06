/**
 * Tool Cache
 *
 * Caches tool execution results to avoid redundant executions.
 * Supports both memory and Redis backends.
 */

import crypto from 'node:crypto';
import type { ToolCall, ToolResult } from '@nachos/types';

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
  private defaultTTL: number;
  private maxMemoryEntries: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: CacheConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.defaultTTL = config.defaultTTL ?? 300; // 5 minutes
    this.maxMemoryEntries = config.maxMemoryEntries ?? 1000;

    // Initialize Redis if URL provided
    if (config.redisUrl) {
      this.initializeRedis(config.redisUrl);
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
   * Clear all cached entries
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();

    if (this.redis) {
      // Note: This is a simple implementation
      // In production, use a more sophisticated approach
      // (e.g., key prefix pattern for tool cache keys)
      await this.redis.flushdb();
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
      console.error('Error getting from Redis:', error);
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
      console.error('Error setting in Redis:', error);
    }
  }

  /**
   * Initialize Redis connection
   */
  private initializeRedis(url: string): void {
    try {
      // Dynamic import to avoid hard dependency on Redis
      import('redis')
        .then((redisModule) => {
          const client = redisModule.createClient({ url });

          client.on('error', (error) => {
            console.error('Redis error:', error);
            // Fall back to memory-only caching
            this.redis = null;
          });

          client.on('ready', () => {
            console.log('Redis cache connected');
          });

          client.connect().catch((error) => {
            console.error('Failed to connect to Redis:', error);
            this.redis = null;
          });

          this.redis = client as unknown as RedisClient;
        })
        .catch((error) => {
          console.error('Failed to load Redis module:', error);
          this.redis = null;
        });
    } catch (error) {
      console.error('Error initializing Redis:', error);
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
      console.log(`Cleaned up ${keysToDelete.length} expired cache entries`);
    }
  }
}

/**
 * Simple Redis client interface
 * (matches the redis package interface we need)
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<void>;
  del(key: string): Promise<void>;
  flushdb(): Promise<void>;
  quit(): Promise<void>;
}
