import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresUserProfileStore } from './postgres-user-profile-store.js';

function createMockPool(handler: (text: string, values?: unknown[]) => Promise<unknown>) {
  return {
    query: vi.fn(handler),
  } as unknown as Pool;
}

describe('PostgresUserProfileStore', () => {
  it('maps rows into user profiles', async () => {
    const pool = createMockPool(async (text: string) => {
      if (text.includes('SELECT agent_id')) {
        return {
          rowCount: 1,
          rows: [
            {
              agent_id: 'agent-1',
              user_id: 'user-1',
              profile: 'Likes weekly summaries.',
              updated_at: '2026-02-08T01:00:00.000Z',
              version: 2,
              source: 'db',
            },
          ],
        };
      }
      return { rowCount: 0, rows: [] };
    });

    const store = new PostgresUserProfileStore(pool, 'test_schema');
    const profile = await store.get('agent-1', 'user-1');

    expect(profile).not.toBeNull();
    expect(profile?.userId).toBe('user-1');
    expect(profile?.agentId).toBe('agent-1');
    expect(profile?.version).toBe(2);
  });

  it('upserts user profiles with composite keys', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = createMockPool(async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return { rowCount: 0, rows: [] };
    });

    const store = new PostgresUserProfileStore(pool, 'test_schema');
    await store.put({
      userId: 'user-2',
      agentId: 'agent-2',
      profile: 'Prefers detailed answers.',
      updatedAt: '2026-02-08T02:00:00.000Z',
      version: 1,
      source: 'db',
    });

    const insertQuery = queries.find((query) => query.text.includes('INSERT INTO'));
    expect(insertQuery?.text).toContain('ON CONFLICT (agent_id, user_id)');
    expect(insertQuery?.values?.[0]).toBe('agent-2');
    expect(insertQuery?.values?.[1]).toBe('user-2');
  });
});
