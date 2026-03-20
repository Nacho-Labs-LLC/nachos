import { describe, expect, it } from 'vitest';
import type { Session } from '@nachos/types';
import { SubagentTools } from './subagent-tools.js';
import type { SubagentRunRecord } from '../subagents/types.js';

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    channel: 'slack',
    conversationId: 'conv-1',
    userId: 'user-1',
    status: 'active',
    config: {},
    metadata: {},
    isPinned: false,
    isArchived: false,
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

describe('SubagentTools', () => {
  it('allows requester session to access run', () => {
    const tools = new SubagentTools({});
    const session = createSession({ id: 'requester-session' });
    const run = {
      requester: { sessionId: 'requester-session', userId: 'user-1' },
    } as unknown as SubagentRunRecord;

    expect(tools.canAccessSubagentRun(session, run)).toBe(true);
  });

  it('always includes subagent_progress in tool definitions', () => {
    const tools = new SubagentTools({});
    const defs = tools.buildSubagentToolDefinitions(createSession());

    expect(defs?.some((tool) => tool.name === 'subagent_progress')).toBe(true);
  });
});
