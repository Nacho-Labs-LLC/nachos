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
    rmSync(`${logPath}.1`, { force: true });
  });

  it('should write audit events to a file', async () => {
    const provider = new FileAuditProvider({ path: logPath, batchSize: 1 });
    await provider.init();

    await provider.log(createEvent());
    await provider.close();

    const content = readFileSync(logPath, 'utf-8').trim();
    expect(content).toContain('"eventType":"tool_execute"');
  });

  it('should rotate log files when size exceeds threshold', async () => {
    const provider = new FileAuditProvider({
      path: logPath,
      batchSize: 1,
      rotateSize: 1, // Force rotation immediately for test coverage.
      maxFiles: 1,
    });
    await provider.init();

    await provider.log(createEvent({ id: 'event-2' }));
    await provider.close();

    const rotatedContent = readFileSync(`${logPath}.1`, 'utf-8').trim();
    expect(rotatedContent).toContain('"id":"event-2"');
  });
});
