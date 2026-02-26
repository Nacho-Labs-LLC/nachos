/**
 * Postgres BootstrapStore implementation.
 */

import type { Pool } from 'pg';
import type { BootstrapProfile, BootstrapStore } from '@nachos/types';

export class PostgresBootstrapStore implements BootstrapStore {
  private initialized = false;
  private schemaPromise: Promise<void> | null = null;
  private schema: string;

  constructor(
    private pool: Pool,
    schema?: string
  ) {
    this.schema = schema ?? 'public';
  }

  async get(agentId: string): Promise<BootstrapProfile | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT agent_id, content, updated_at, version, source
       FROM ${this.qualified('bootstrap_profiles')}
       WHERE agent_id = $1`,
      [agentId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0] as {
      agent_id: string;
      content: Record<string, string>;
      updated_at: string;
      version: number;
      source: string | null;
    };

    return {
      agentId: row.agent_id,
      content: row.content ?? {},
      updatedAt: row.updated_at,
      version: row.version,
      source: (row.source ?? 'db') as BootstrapProfile['source'],
    };
  }

  async put(profile: BootstrapProfile): Promise<BootstrapProfile> {
    await this.ensureSchema();
    const updated: BootstrapProfile = {
      ...profile,
      source: profile.source ?? 'db',
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
      version: profile.version ?? 1,
    };

    await this.pool.query(
      `INSERT INTO ${this.qualified('bootstrap_profiles')} (
        agent_id, content, updated_at, version, source
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (agent_id) DO UPDATE SET
        content = EXCLUDED.content,
        updated_at = EXCLUDED.updated_at,
        version = EXCLUDED.version,
        source = EXCLUDED.source`,
      [
        updated.agentId,
        JSON.stringify(updated.content ?? {}),
        updated.updatedAt,
        updated.version,
        updated.source,
      ]
    );

    return updated;
  }

  async delete(agentId: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `DELETE FROM ${this.qualified('bootstrap_profiles')} WHERE agent_id = $1`,
      [agentId]
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
      `CREATE TABLE IF NOT EXISTS ${this.qualified('bootstrap_profiles')} (
        agent_id TEXT PRIMARY KEY,
        content JSONB NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL,
        source TEXT
      )`
    );
  }

  async close(): Promise<void> {
    // Pool lifecycle is managed by the StateLayer that created this store.
  }
}
