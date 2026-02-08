/**
 * Redis SessionStateStore implementation.
 */

import { createClient, type RedisClientType } from 'redis';
import type { SessionStateRecord, SessionStateStore } from '@nachos/types';

export class RedisSessionStateStore implements SessionStateStore {
  private client: RedisClientType;
  private connected = false;
  private ttlSeconds?: number;

  constructor(redisUrl: string, ttlSeconds?: number, client?: RedisClientType) {
    this.client = client ?? createClient({ url: redisUrl });
    this.ttlSeconds = ttlSeconds;
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
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }

  private key(sessionId: string): string {
    return `session:state:${sessionId}`;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
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
