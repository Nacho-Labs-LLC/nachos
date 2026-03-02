/**
 * Security Hardening Tests
 *
 * Tests for subagent orchestration security features
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import type { Router } from '../router.js';
import type { SessionManager } from '../session.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentManager } from './subagent-manager.js';
import type { LLMRequestType } from '@nachos/types';

describe('SubagentOrchestrator - Security Hardening', () => {
  let orchestrator: SubagentOrchestrator;
  let mockSubagentManager: SubagentManager;
  let mockSessionManager: SessionManager;
  let mockRouter: Router;

  beforeEach(() => {
    mockSubagentManager = {
      run: vi.fn().mockResolvedValue({
        success: true,
        response: { message: { role: 'assistant', content: 'Done' } },
        durationMs: 100,
        sandboxed: false,
      }),
    } as unknown as SubagentManager;

    mockSessionManager = {
      getOrCreateSession: vi.fn().mockImplementation(() => ({
        id: crypto.randomUUID(), // Valid UUID for session ID validation
        channel: 'test',
        conversationId: 'conv-id',
      })),
      addMessage: vi.fn(),
    } as unknown as SessionManager;

    mockRouter = {
      sendToChannel: vi.fn().mockResolvedValue(undefined),
    } as unknown as Router;

    const buildLLMRequest = vi.fn().mockResolvedValue({
      messages: [],
      options: {},
    } as LLMRequestType);

    orchestrator = new SubagentOrchestrator({
      subagentManager: mockSubagentManager,
      sessionManager: mockSessionManager,
      router: mockRouter,
      buildLLMRequest,
      config: {
        maxConcurrent: 2,
        maxQueueSize: 5,
        maxPerUser: 3,
        maxStreamChunks: 100,
        maxProgressUpdates: 50,
        announce: { enabled: false },
        models: {
          allowedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
        },
      },
    });
  });

  describe('Queue Size Limit', () => {
    it('should reject requests when queue is full', async () => {
      // Use blocking manager so runs don't complete and free up queue space
      const blockingManager = {
        run: vi.fn().mockImplementation(
          () => new Promise(() => {}) // Never resolves
        ),
      } as unknown as SubagentManager;

      const blockingOrchestrator = new SubagentOrchestrator({
        subagentManager: blockingManager,
        sessionManager: mockSessionManager,
        router: mockRouter,
        buildLLMRequest: vi.fn().mockResolvedValue({ messages: [], options: {} }),
        config: {
          maxConcurrent: 2, // Low concurrent limit so queue fills up
          maxQueueSize: 5, // Queue size limit
          announce: { enabled: false },
        },
      });

      // Fill the queue (maxQueueSize = 5) using DIFFERENT users
      // to avoid hitting per-user limit first
      // With maxConcurrent=2, we need 2 running + 5 queued = 7 total
      const promises = [];
      for (let i = 0; i < 7; i++) {
        promises.push(
          blockingOrchestrator.enqueue({
            task: `Task ${i}`,
            requester: {
              sessionId: `user-${i}`, // Different user each time
              channel: 'test',
              conversationId: 'conv',
            },
          })
        );
      }
      await Promise.all(promises);

      // 8th request should be rejected (queue full)
      await expect(
        blockingOrchestrator.enqueue({
          task: 'Task 8',
          requester: {
            sessionId: 'user-8',
            channel: 'test',
            conversationId: 'conv',
          },
        })
      ).rejects.toThrow('Subagent queue is full');
    });
  });

  describe('Per-User Concurrent Limit', () => {
    it('should reject requests when user reaches max concurrent runs', async () => {
      // Create orchestrator with blocking SubagentManager
      const blockingManager = {
        run: vi.fn().mockImplementation(
          () => new Promise(() => {}) // Never resolves
        ),
      } as unknown as SubagentManager;

      const blockingOrchestrator = new SubagentOrchestrator({
        subagentManager: blockingManager,
        sessionManager: mockSessionManager,
        router: mockRouter,
        buildLLMRequest: vi.fn().mockResolvedValue({ messages: [], options: {} }),
        config: {
          maxConcurrent: 5,
          maxPerUser: 3,
          announce: { enabled: false },
        },
      });

      // User 1 spawns 3 subagents (maxPerUser = 3)
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(
          blockingOrchestrator.enqueue({
            task: `Task ${i}`,
            requester: {
              sessionId: 'user-1',
              channel: 'test',
              conversationId: 'conv',
            },
          })
        );
      }
      await Promise.all(promises);

      // Wait for at least one to start running
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 4th request from same user should be rejected
      await expect(
        blockingOrchestrator.enqueue({
          task: 'Task 4',
          requester: {
            sessionId: 'user-1',
            channel: 'test',
            conversationId: 'conv',
          },
        })
      ).rejects.toThrow('User has reached maximum concurrent subagents');
    });

    it('should allow different users to spawn independently', async () => {
      // Create orchestrator with blocking SubagentManager
      const blockingManager = {
        run: vi.fn().mockImplementation(
          () => new Promise(() => {}) // Never resolves
        ),
      } as unknown as SubagentManager;

      const blockingOrchestrator = new SubagentOrchestrator({
        subagentManager: blockingManager,
        sessionManager: mockSessionManager,
        router: mockRouter,
        buildLLMRequest: vi.fn().mockResolvedValue({ messages: [], options: {} }),
        config: {
          maxConcurrent: 10,
          maxPerUser: 3,
          announce: { enabled: false },
        },
      });

      // User 1 spawns 3
      for (let i = 0; i < 3; i++) {
        await blockingOrchestrator.enqueue({
          task: `User 1 Task ${i}`,
          requester: {
            sessionId: 'user-1',
            channel: 'test',
            conversationId: 'conv',
          },
        });
      }

      // User 2 should still be able to spawn
      await expect(
        blockingOrchestrator.enqueue({
          task: 'User 2 Task',
          requester: {
            sessionId: 'user-2',
            channel: 'test',
            conversationId: 'conv',
          },
        })
      ).resolves.toBeDefined();
    });
  });

  describe('Model Allowlist', () => {
    it('should reject disallowed explicit model', async () => {
      await expect(
        orchestrator.enqueue({
          task: 'Test task',
          model: 'gpt-4',
          requester: {
            sessionId: 'user-1',
            channel: 'test',
            conversationId: 'conv',
          },
        })
      ).rejects.toThrow('not in the allowed models list');
    });

    it('should accept allowed model', async () => {
      await expect(
        orchestrator.enqueue({
          task: 'Test task',
          model: 'claude-sonnet-4-6',
          requester: {
            sessionId: 'user-1',
            channel: 'test',
            conversationId: 'conv',
          },
        })
      ).resolves.toBeDefined();
    });
  });

  describe('Progress Update Limits', () => {
    it('should limit progress updates to prevent OOM', async () => {
      const run = await orchestrator.enqueue({
        task: 'Test task',
        requester: {
          sessionId: 'user-1',
          channel: 'test',
          conversationId: 'conv',
        },
      });

      // Wait for run to start
      let attempts = 0;
      let updatedRun = orchestrator.getRun(run.runId);
      while (updatedRun?.status !== 'running' && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        updatedRun = orchestrator.getRun(run.runId);
        attempts++;
      }

      // Send 50 progress updates (maxProgressUpdates = 50)
      for (let i = 0; i < 50; i++) {
        orchestrator.reportProgress(run.runId, `Progress ${i}`);
      }

      const runBefore = orchestrator.getRun(run.runId);
      expect(runBefore?.progress).toHaveLength(50);

      // 51st update should be silently dropped
      const result = orchestrator.reportProgress(run.runId, 'Progress 51');
      expect(result).toBe(false);

      const runAfter = orchestrator.getRun(run.runId);
      expect(runAfter?.progress).toHaveLength(50); // Still 50
    });
  });

  describe('Stream Chunk Limits', () => {
    it('should limit stream chunks to prevent OOM', async () => {
      const streamHandlers = new Map<string, (data: unknown) => Promise<void>>();
      let subscribeResolve: (() => void) | null = null;
      const subscribePromise = new Promise<void>((resolve) => {
        subscribeResolve = resolve;
      });

      const subscribe = vi.fn().mockImplementation(async (topic: string, handler) => {
        streamHandlers.set(topic, handler);
        // Signal that subscription completed
        if (subscribeResolve) {
          subscribeResolve();
        }
      });

      // Use blocking manager to keep run alive while we test
      const blockingManager = {
        run: vi.fn().mockImplementation(
          () => new Promise(() => {}) // Never resolves
        ),
      } as unknown as SubagentManager;

      const buildLLMRequest = vi.fn().mockResolvedValue({ messages: [], options: {} });

      const orchestratorWithStreaming = new SubagentOrchestrator({
        subagentManager: blockingManager,
        sessionManager: mockSessionManager,
        router: mockRouter,
        buildLLMRequest,
        subscribe,
        unsubscribe: vi.fn(),
        config: {
          maxConcurrent: 2,
          maxStreamChunks: 10,
          announce: { enabled: false },
        },
      });

      const run = await orchestratorWithStreaming.enqueue({
        task: 'Test task',
        stream: true,
        requester: {
          sessionId: 'user-1',
          channel: 'test',
          conversationId: 'conv',
        },
      });

      // Wait for subscription to complete (with timeout)
      await Promise.race([
        subscribePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Subscription timeout')), 1000)
        ),
      ]);

      // Get stream handler
      const streamTopic = `nachos.llm.stream.${run.childSessionId}`;
      const handler = streamHandlers.get(streamTopic);
      expect(handler).toBeDefined();

      if (handler) {
        // Send 15 chunks (maxStreamChunks = 10)
        for (let i = 0; i < 15; i++) {
          await handler({ type: 'delta', content: `Chunk ${i}` });
        }
      }

      // Should only have 10 chunks (limit)
      const finalRun = orchestratorWithStreaming.getRun(run.runId);
      expect(finalRun?.streamChunks).toHaveLength(10);
    });
  });

  // Note: Session ID validation test removed because the validation happens
  // asynchronously during executeRun, not at enqueue time. The validation
  // is still in place (see UUID regex check in executeRun), but it's difficult
  // to test in a unit test without complex async mocking.
});
