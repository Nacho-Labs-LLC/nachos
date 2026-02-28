import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemUserProfileStore } from './filesystem-user-profile-store.js';
import type { UserProfile } from '@nachos/types';

async function createTempDir(): Promise<string> {
  const base = path.join(os.tmpdir(), 'nachos-user-profile-');
  return fs.mkdtemp(base);
}

describe('FilesystemUserProfileStore', () => {
  it('stores, loads, and deletes user profiles', async () => {
    const dir = await createTempDir();
    const store = new FilesystemUserProfileStore(dir);

    const profile: UserProfile = {
      userId: 'user-123',
      agentId: 'agent-1',
      profile: 'Prefers concise status updates.',
      updatedAt: '2026-02-08T00:00:00.000Z',
      version: 1,
    };

    await store.put(profile);
    const loaded = await store.get('agent-1', 'user-123');

    expect(loaded).not.toBeNull();
    expect(loaded?.userId).toBe(profile.userId);
    expect(loaded?.agentId).toBe(profile.agentId);
    expect(loaded?.profile).toBe(profile.profile);

    await store.delete('agent-1', 'user-123');
    const missing = await store.get('agent-1', 'user-123');
    expect(missing).toBeNull();
  });
});
