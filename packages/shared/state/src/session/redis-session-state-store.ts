/**
 * Redis SessionStateStore implementation.
 */

import { createClient, type RedisClientType } from 'redis';
import { createLogger } from '@nachos/types';
import type { SessionStateRecord, SessionStateStore } from '@nachos/types';

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

  async touch(sessionId: string, ttlSeconds?: number): Promise<void> {
    await this.ensureConnected();
    const ttl = ttlSeconds ?? this.ttlSeconds;
    if (ttl) {
      await this.client.expire(this.key(sessionId), ttl);
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(this.key(sessionId));
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

export class InMemorySessionStateStore implements SessionStateStore {
  private records = new Map<string, SessionStateRecord>();

  async get(sessionId: string): Promise<SessionStateRecord | null> {
    return this.records.get(sessionId) ?? null;
  }

  async set(record: SessionStateRecord): Promise<SessionStateRecord> {
    this.records.set(record.sessionId, record);
    return record;
  }

  async touch(_sessionId: string, _ttlSeconds?: number): Promise<void> {
    // No-op for in-memory store.
  }

  async delete(sessionId: string): Promise<void> {
    this.records.delete(sessionId);
  }
}
