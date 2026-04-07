/**
 * Redis SessionStateStore implementation.
 */

import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '@nachos/types';
import type { SessionStateRecord, SessionStateStore } from '@nachos/types';
import { MAX_SESSION_STATE_SIZE_BYTES } from '@nachos/types';

const logger = createLogger('session-store');

export class RedisSessionStateStore implements SessionStateStore {
  private client: RedisClientType;
  private ttlSeconds?: number;
  // Tracks whether connect() has ever been called. node-redis v4 manages
  // reconnection internally after the first connect(), so we must never call
  // it a second time. Commands issued while reconnecting are queued by the
  // library (enableOfflineQueue: true is the default).
  private connectCalled = false;
  private connecting: Promise<void> | null = null;

  constructor(redisUrl: string, ttlSeconds?: number, client?: RedisClientType) {
    this.client = client ?? createClient({ url: redisUrl });
    this.ttlSeconds = ttlSeconds;
    this.client.on('error', (err: Error) => {
      logger.warn({ err }, 'Redis error (auto-reconnect in progress)');
    });
  }

  async get(sessionId: string): Promise<SessionStateRecord | null> {
    await this.ensureConnected();
    const value = await this.client.get(this.key(sessionId));
    if (!value) return null;
    return JSON.parse(value) as SessionStateRecord;
  }

  async set(record: SessionStateRecord): Promise<SessionStateRecord> {
    await this.ensureConnected();
    const serialized = JSON.stringify(record);
    if (this.ttlSeconds) {
      await this.client.set(this.key(record.sessionId), serialized, { EX: this.ttlSeconds });
    } else {
      await this.client.set(this.key(record.sessionId), serialized);
    }
    return record;
  }

  async touch(sessionId: string, ttlSeconds?: number): Promise<{ touched: boolean }> {
    await this.ensureConnected();
    const ttl = ttlSeconds ?? this.ttlSeconds;
    if (ttl) {
      // expire() returns true if the TTL was set, false if the key does not exist
      const result = await this.client.expire(this.key(sessionId), ttl);
      return { touched: result };
    }
    // No TTL configured — check if key exists (exists() returns count of found keys)
    const exists = await this.client.exists(this.key(sessionId));
    return { touched: exists > 0 };
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(this.key(sessionId));
  }

  /**
   * Attempt to acquire a distributed lock via SET NX EX.
   * Returns true if the lock was acquired, false if already held.
   * @param key   Lock key (without prefix)
   * @param ttlSeconds Lock TTL in seconds
   */
  async tryAcquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.client.set(`lock:${key}`, '1', { NX: true, EX: ttlSeconds });
    return result === 'OK';
  }

  /**
   * Release a distributed lock.
   */
  async releaseLock(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(`lock:${key}`);
  }

  async close(): Promise<void> {
    if (this.connectCalled) {
      await this.client.quit();
      this.connectCalled = false;
    }
  }

  private key(sessionId: string): string {
    return `session:state:${sessionId}`;
  }

  private async ensureConnected(): Promise<void> {
    // After the first connect(), let node-redis handle reconnection internally.
    // Commands will be queued during temporary disconnects.
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
}

/** Default TTL for in-memory session entries (30 minutes). */
const DEFAULT_INMEMORY_TTL_MS = 30 * 60 * 1000;

/** Interval between TTL cleanup sweeps (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface InMemoryEntry {
  record: SessionStateRecord;
  expiresAt: number;
}

export class InMemorySessionStateStore implements SessionStateStore {
  private entries = new Map<string, InMemoryEntry>();
  private ttlMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(ttlSeconds?: number) {
    this.ttlMs = (ttlSeconds ?? DEFAULT_INMEMORY_TTL_MS / 1000) * 1000;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Allow the process to exit even if the timer is still running.
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  async get(sessionId: string): Promise<SessionStateRecord | null> {
    const entry = this.entries.get(sessionId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(sessionId);
      return null;
    }
    return entry.record;
  }

  async set(record: SessionStateRecord): Promise<SessionStateRecord> {
    const serialized = JSON.stringify(record.state);
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    if (byteSize > MAX_SESSION_STATE_SIZE_BYTES) {
      throw new Error(
        `Session state for session "${record.sessionId}" exceeds maximum size of ${MAX_SESSION_STATE_SIZE_BYTES} bytes (actual: ${byteSize} bytes). Reduce the state payload.`
      );
    }
    this.entries.set(record.sessionId, {
      record,
      expiresAt: Date.now() + this.ttlMs,
    });
    return record;
  }

  async touch(sessionId: string, ttlSeconds?: number): Promise<{ touched: boolean }> {
    const entry = this.entries.get(sessionId);
    if (!entry || Date.now() > entry.expiresAt) {
      if (entry) this.entries.delete(sessionId);
      return { touched: false };
    }
    const extensionMs = ttlSeconds ? ttlSeconds * 1000 : this.ttlMs;
    entry.expiresAt = Date.now() + extensionMs;
    return { touched: true };
  }

  async delete(sessionId: string): Promise<void> {
    this.entries.delete(sessionId);
  }

  /** Stop the periodic cleanup timer (for graceful shutdown or tests). */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /** Remove expired entries. Called periodically by the cleanup timer. */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }
}
