/**
 * Integration tests for SubagentOrchestrator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentOrchestratorDeps } from './subagent-orchestrator.js';
import type { SubagentRunRequest } from './types.js';
import type { LLMRequestType, Message, Session } from '@nachos/types';
import type { SubagentManager } from './subagent-manager.js';
import type { SessionManager } from '../session.js';
import type { Router } from '../router.js';

// Mock dependencies
const createMockDeps = (): SubagentOrchestratorDeps => {
  const messages = new Map<string, Message[]>();
  const sessions = new Map<string, { id: string; conversationId: string }>();

  return {
    subagentManager: {
      run: vi.fn(async () => ({
        success: true,
        response: {
          success: true,
          message: {
            role: 'assistant',
            content: 'Subagent completed the task successfully.',
          },
        },
        durationMs: 1000,
        sandboxed: false,
      })),
    } as unknown as SubagentManager,

    sessionManager: {
      getOrCreateSession: vi.fn((params) => {
        const session = {
          id: params.conversationId,
          channel: params.channel,
          conversationId: params.conversationId,
          userId: params.userId,
          config: params.config,
          metadata: params.metadata,
        };
        sessions.set(session.id, session);
        messages.set(session.id, []);
        return session as unknown as Session;
      }),
      addMessage: vi.fn((sessionId, message) => {
        const sessionMessages = messages.get(sessionId) ?? [];
        sessionMessages.push(message);
        messages.set(sessionId, sessionMessages);
      }),
      getMessages: vi.fn((sessionId) => messages.get(sessionId) ?? []),
    } as unknown as SessionManager,

    router: {
      sendToChannel: vi.fn(async () => {}),
    } as unknown as Router,

    buildLLMRequest: vi.fn(async (sessionId) => {
      const sessionMessages = messages.get(sessionId) ?? [];
      return {
        sessionId,
        messages: sessionMessages,
        options: {},
      } as LLMRequestType;
    }),

    defaultSystemPrompt: 'You are a helpful AI assistant.',
    config: {
      maxConcurrent: 2,
      announce: {
        enabled: true,
      },
    },
  };
};

describe('SubagentOrchestrator', () => {
  let orchestrator: SubagentOrchestrator;
  let deps: SubagentOrchestratorDeps;

  beforeEach(async () => {
    deps = createMockDeps();
    orchestrator = new SubagentOrchestrator(deps);
  });

  it('should enqueue and execute a subagent run', async () => {
    const request: SubagentRunRequest = {
      task: 'Research quantum computing',
      label: 'research-task',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
        userId: 'user-456',
      },
    };

    const run = await orchestrator.enqueue(request);

    expect(run).toBeDefined();
    // With slots available, drainQueue runs synchronously so status is 'running'
    expect(['queued', 'running']).toContain(run.status);
    expect(run.task).toBe('Research quantum computing');
    expect(run.label).toBe('research-task');
    expect(run.childSessionId).toBeDefined();

    // Wait for execution
    await new Promise((resolve) => setTimeout(resolve, 100));

    const updatedRun = orchestrator.getRun(run.runId);
    expect(updatedRun).toBeDefined();
    expect(['running', 'completed']).toContain(updatedRun!.status);
  });

  it('should list all runs', async () => {
    const request1: SubagentRunRequest = {
      task: 'Task 1',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const request2: SubagentRunRequest = {
      task: 'Task 2',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    await orchestrator.enqueue(request1);
    await orchestrator.enqueue(request2);

    const runs = orchestrator.listRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].task).toBe('Task 1');
    expect(runs[1].task).toBe('Task 2');
  });

  it('should stop a queued run', async () => {
    // Fill both concurrency slots (maxConcurrent: 2) so next enqueue stays queued
    deps.subagentManager.run = vi.fn(() => new Promise(() => {})); // never resolves
    await orchestrator.enqueue({
      task: 'Blocker 1',
      requester: { sessionId: 's', channel: 'discord', conversationId: 'c' },
    });
    await orchestrator.enqueue({
      task: 'Blocker 2',
      requester: { sessionId: 's', channel: 'discord', conversationId: 'c' },
    });

    const request: SubagentRunRequest = {
      task: 'Long running task',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const run = await orchestrator.enqueue(request);
    expect(run.status).toBe('queued');

    const stopped = orchestrator.stopRun(run.runId);
    expect(stopped).toBe(true);

    const updatedRun = orchestrator.getRun(run.runId);
    expect(updatedRun!.status).toBe('cancelled');
  });

  it('should not stop a running subagent', async () => {
    // Mock a long-running task
    deps.subagentManager.run = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                response: { success: true, message: { role: 'assistant', content: 'Done' } },
                durationMs: 5000,
                sandboxed: false,
              }),
            1000
          )
        )
    );

    const request: SubagentRunRequest = {
      task: 'Task that takes time',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const run = await orchestrator.enqueue(request);

    // Wait for it to start running
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stopped = orchestrator.stopRun(run.runId);
    expect(stopped).toBe(false); // Can't stop running tasks (only queued)
  });

  it('should steer a running subagent', async () => {
    // Mock a long-running task
    deps.subagentManager.run = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                response: { success: true, message: { role: 'assistant', content: 'Done' } },
                durationMs: 5000,
                sandboxed: false,
              }),
            1000
          )
        )
    );

    const request: SubagentRunRequest = {
      task: 'Research artificial intelligence',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const run = await orchestrator.enqueue(request);

    // Wait for it to start running
    await new Promise((resolve) => setTimeout(resolve, 50));

    const steered = await orchestrator.steerRun(run.runId, 'Focus on recent developments in 2026');
    expect(steered).toBe(true);

    // Verify message was added to subagent session
    expect(deps.sessionManager.addMessage).toHaveBeenCalledWith(run.childSessionId, {
      role: 'user',
      content: 'Focus on recent developments in 2026',
    });
  });

  it('should not steer a queued subagent', async () => {
    // Fill both concurrency slots so next enqueue stays queued
    deps.subagentManager.run = vi.fn(() => new Promise(() => {}));
    await orchestrator.enqueue({
      task: 'Blocker 1',
      requester: { sessionId: 's', channel: 'discord', conversationId: 'c' },
    });
    await orchestrator.enqueue({
      task: 'Blocker 2',
      requester: { sessionId: 's', channel: 'discord', conversationId: 'c' },
    });

    const request: SubagentRunRequest = {
      task: 'Task',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const run = await orchestrator.enqueue(request);

    // Try to steer before it starts running
    const steered = await orchestrator.steerRun(run.runId, 'Change direction');
    expect(steered).toBe(false); // Can't steer queued runs
  });

  it('should get run info', async () => {
    const request: SubagentRunRequest = {
      task: 'Test task',
      label: 'test-label',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const run = await orchestrator.enqueue(request);
    const info = orchestrator.getRun(run.runId);

    expect(info).toBeDefined();
    expect(info!.runId).toBe(run.runId);
    expect(info!.task).toBe('Test task');
    expect(info!.label).toBe('test-label');
  });

  it('should return null for non-existent run', () => {
    const info = orchestrator.getRun('nonexistent-run-id');
    expect(info).toBeNull();
  });

  it('should handle concurrent subagents up to maxConcurrent limit', async () => {
    // Use a never-resolving mock so running tasks hold their concurrency slots.
    // Without this, the default mock resolves instantly and executeRun can complete
    // between awaits, freeing slots before the 3rd task is enqueued.
    deps.subagentManager.run = vi.fn(() => new Promise(() => {}));

    const request1: SubagentRunRequest = {
      task: 'Task 1',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const request2: SubagentRunRequest = {
      task: 'Task 2',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    const request3: SubagentRunRequest = {
      task: 'Task 3',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    // Enqueue 3 tasks (maxConcurrent is 2)
    await orchestrator.enqueue(request1);
    await orchestrator.enqueue(request2);
    const run3 = await orchestrator.enqueue(request3);

    // Third task should be queued
    expect(run3.status).toBe('queued');
  });

  it('should reject empty task', async () => {
    const request: SubagentRunRequest = {
      task: '   ', // Empty after trim
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    await expect(orchestrator.enqueue(request)).rejects.toThrow('Subagent task is required');
  });

  it('should reject when stopped', async () => {
    await orchestrator.shutdown();

    const request: SubagentRunRequest = {
      task: 'Task after shutdown',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
      },
    };

    await expect(orchestrator.enqueue(request)).rejects.toThrow('orchestrator is stopped');
  });

  it('should announce results when enabled', async () => {
    const request: SubagentRunRequest = {
      task: 'Research task',
      requester: {
        sessionId: 'main-session',
        channel: 'discord',
        conversationId: 'channel-123',
        replyToMessageId: 'msg-456',
      },
    };

    await orchestrator.enqueue(request);

    // Wait for execution and announcement
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify announcement was sent
    expect(deps.router.sendToChannel).toHaveBeenCalled();
  });
});
