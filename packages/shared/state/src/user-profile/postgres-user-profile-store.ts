/**
 * Postgres UserProfileStore implementation.
 */

import type { Pool } from 'pg';
import type { UserProfile, UserProfileStore } from '@nachos/types';

export class PostgresUserProfileStore implements UserProfileStore {
  private initialized = false;
  private schemaPromise: Promise<void> | null = null;
  private schema: string;

  constructor(
    private pool: Pool,
    schema?: string
  ) {
    this.schema = schema ?? 'public';
  }

  async get(agentId: string, userId: string): Promise<UserProfile | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT agent_id, user_id, profile, updated_at, version, source
       FROM ${this.qualified('user_profiles')}
       WHERE agent_id = $1 AND user_id = $2`,
      [agentId, userId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0] as {
      agent_id: string;
      user_id: string;
      profile: string;
      updated_at: string;
      version: number;
      source: string | null;
    };

    return {
      agentId: row.agent_id,
      userId: row.user_id,
      profile: row.profile,
      updatedAt: row.updated_at,
      version: row.version,
      source: (row.source ?? 'db') as UserProfile['source'],
    };
  }

  async put(profile: UserProfile): Promise<UserProfile> {
    await this.ensureSchema();
    const updated: UserProfile = {
      ...profile,
      source: profile.source ?? 'db',
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
      version: profile.version ?? 1,
    };

    await this.pool.query(
      `INSERT INTO ${this.qualified('user_profiles')} (
        agent_id, user_id, profile, updated_at, version, source
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (agent_id, user_id) DO UPDATE SET
        profile = EXCLUDED.profile,
        updated_at = EXCLUDED.updated_at,
        version = EXCLUDED.version,
        source = EXCLUDED.source`,
      [
        updated.agentId,
        updated.userId,
        updated.profile,
        updated.updatedAt,
        updated.version,
        updated.source,
      ]
    );

    return updated;
  }

  async delete(agentId: string, userId: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `DELETE FROM ${this.qualified('user_profiles')} WHERE agent_id = $1 AND user_id = $2`,
      [agentId, userId]
    );
  }

  private qualified(table: string): string {
    return `"${this.schema}".${table}`;
  }

  private ensureSchema(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.schemaPromise) {
      this.schemaPromise = this.runSchema()
        .then(() => {
          this.initialized = true;
          this.schemaPromise = null;
        })
        .catch((err) => {
          this.schemaPromise = null;
          throw err;
        });
    }
    return this.schemaPromise;
  }

  private async runSchema(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('user_profiles')} (
        agent_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL,
        source TEXT,
        PRIMARY KEY (agent_id, user_id)
      )`
    );
  }

  async close(): Promise<void> {
    // Pool lifecycle is managed by the StateLayer that created this store.
  }
}
