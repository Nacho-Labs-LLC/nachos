import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FileAuditProvider } from './file.js';
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

describe('FileAuditProvider', () => {
  const logPath = join(process.cwd(), 'tmp-audit.log');

  afterEach(() => {
    rmSync(logPath, { force: true });
  });

  it('should write audit events to a file', async () => {
    const provider = new FileAuditProvider({ path: logPath, batchSize: 1 });
    await provider.init();

    await provider.log(createEvent());
    await provider.close();

    const content = readFileSync(logPath, 'utf-8').trim();
    expect(content).toContain('"eventType":"tool_execute"');
  });
});
