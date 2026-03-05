import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdminChatSessionStore } from '../admin-chat-session-store.js';
import type { AdminChatSession } from '../admin-chat-session-store.js';

let tempDir: string;
let store: AdminChatSessionStore;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-chat-store-test-'));
  store = new AdminChatSessionStore(path.join(tempDir, 'test.db'));
});

afterEach(() => {
  store.close();
  try {
    fs.rmSync(tempDir, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
});

function makeSession(overrides: Partial<AdminChatSession> = {}): AdminChatSession {
  return {
    id: 'sess-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AdminChatSessionStore', () => {
  it('returns undefined for a missing session', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves a session', () => {
    const session = makeSession();
    store.set(session);
    const retrieved = store.get(session.id);
    expect(retrieved).toEqual(session);
  });

  it('upserts an existing session', () => {
    const session = makeSession();
    store.set(session);

    const updated = makeSession({
      conversationId: 'conv-2',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    store.set(updated);

    const retrieved = store.get(session.id);
    expect(retrieved?.conversationId).toBe('conv-2');
    expect(retrieved?.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('deletes a session', () => {
    const session = makeSession();
    store.set(session);
    store.delete(session.id);
    expect(store.get(session.id)).toBeUndefined();
  });

  it('delete is a no-op for missing session', () => {
    expect(() => store.delete('nonexistent')).not.toThrow();
  });

  it('handles multiple sessions independently', () => {
    const s1 = makeSession({ id: 'a', conversationId: 'ca', userId: 'u1' });
    const s2 = makeSession({ id: 'b', conversationId: 'cb', userId: 'u2' });
    store.set(s1);
    store.set(s2);

    expect(store.get('a')?.userId).toBe('u1');
    expect(store.get('b')?.userId).toBe('u2');

    store.delete('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
  });

  it('persists across store instances', () => {
    const dbPath = path.join(tempDir, 'persist.db');
    const store1 = new AdminChatSessionStore(dbPath);
    store1.set(makeSession());
    store1.close();

    const store2 = new AdminChatSessionStore(dbPath);
    expect(store2.get('sess-1')).toBeDefined();
    expect(store2.get('sess-1')?.conversationId).toBe('conv-1');
    store2.close();
  });
});
