import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SQLiteAuditProvider } from './sqlite.js';
import type { AuditEvent } from '../types.js';

const createEvent = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 'event-1',
  timestamp: new Date().toISOString(),
  instanceId: 'gateway',
  userId: 'user-1',
  sessionId: 'session-1',
  channel: 'webchat',
  eventType: 'tool_execute',
  action: 'tool.execute',
  outcome: 'allowed',
  securityMode: 'standard',
  ...overrides,
});

describe('SQLiteAuditProvider', () => {
  const dbPath = join(process.cwd(), 'tmp-audit.db');

  afterEach(() => {
    rmSync(dbPath, { force: true });
  });

  it('should persist and query audit events', async () => {
    const provider = new SQLiteAuditProvider({ path: dbPath, batchSize: 1 });
    await provider.init();

    await provider.log(createEvent({ eventType: 'session_create' }));
    await provider.flush();

    const results = await provider.query({ eventType: 'session_create' });
    expect(results).toHaveLength(1);
    expect(results[0]?.eventType).toBe('session_create');

    await provider.close();
  });

  it('should flush and close cleanly with no events', async () => {
    const provider = new SQLiteAuditProvider({ path: dbPath });
    await provider.init();
    await provider.flush();
    await provider.close();
  });
});
