/**
 * Postgres IdentityStore implementation.
 */

import type { Pool } from 'pg';
import type { IdentityProfile, IdentityStore } from '@nachos/types';

export class PostgresIdentityStore implements IdentityStore {
  private initialized = false;
  private schema: string;

  constructor(
    private pool: Pool,
    schema?: string
  ) {
    this.schema = schema ?? 'public';
  }

  async get(agentId: string): Promise<IdentityProfile | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT agent_id, soul, identity, user_profile, tools_notes, updated_at, version, source
       FROM ${this.qualified('identity_profiles')}
       WHERE agent_id = $1`,
      [agentId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0] as {
      agent_id: string;
      soul: string;
      identity: string;
      user_profile: string;
      tools_notes: string | null;
      updated_at: string;
      version: number;
      source: string | null;
    };

    return {
      agentId: row.agent_id,
      soul: row.soul,
      identity: row.identity,
      userProfile: row.user_profile,
      toolsNotes: row.tools_notes ?? undefined,
      updatedAt: row.updated_at,
      version: row.version,
      source: (row.source ?? 'db') as IdentityProfile['source'],
    };
  }

  async put(profile: IdentityProfile): Promise<IdentityProfile> {
    await this.ensureSchema();
    const updated = {
      ...profile,
      source: profile.source ?? 'db',
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
    };

    await this.pool.query(
      `INSERT INTO ${this.qualified('identity_profiles')} (
        agent_id, soul, identity, user_profile, tools_notes, updated_at, version, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (agent_id) DO UPDATE SET
        soul = EXCLUDED.soul,
        identity = EXCLUDED.identity,
        user_profile = EXCLUDED.user_profile,
        tools_notes = EXCLUDED.tools_notes,
        updated_at = EXCLUDED.updated_at,
        version = EXCLUDED.version,
        source = EXCLUDED.source`,
      [
        updated.agentId,
        updated.soul,
        updated.identity,
        updated.userProfile,
        updated.toolsNotes ?? null,
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
      `DELETE FROM ${this.qualified('identity_profiles')} WHERE agent_id = $1`,
      [agentId]
    );
  }

  private qualified(table: string): string {
    return `"${this.schema}".${table}`;
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;

    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('identity_profiles')} (
        agent_id TEXT PRIMARY KEY,
        soul TEXT NOT NULL,
        identity TEXT NOT NULL,
        user_profile TEXT NOT NULL,
        tools_notes TEXT,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL,
        source TEXT
      )`
    );

    this.initialized = true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
