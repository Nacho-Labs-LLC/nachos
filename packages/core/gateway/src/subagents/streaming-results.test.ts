/**
 * Streaming Results Tests
 *
 * Tests for subagent streaming functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import type { Router } from '../router.js';
import type { SessionsStore } from '@nachos/state';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentManager } from './subagent-manager.js';
import type { LLMRequestType, LLMStreamChunkType } from '@nachos/types';

describe('SubagentOrchestrator - Streaming Results', () => {
  let orchestrator: SubagentOrchestrator;
  let mockSubagentManager: SubagentManager;
  let mockSessionsStore: SessionsStore;
  let mockRouter: Router;
  let streamHandlers: Map<string, (data: unknown) => Promise<void>>;

  beforeEach(() => {
    streamHandlers = new Map();

    mockSubagentManager = {
      run: vi.fn().mockResolvedValue({
        success: true,
        response: { message: { role: 'assistant', content: 'Task completed' } },
        durationMs: 1000,
        sandboxed: false,
      }),
    } as unknown as SubagentManager;

    mockSessionsStore = {
      getOrCreateSessionAtomic: vi.fn().mockImplementation(() => ({
        session: {
          id: crypto.randomUUID(), // Valid UUID for session ID validation
          channel: 'test',
          conversationId: 'test-conv',
        },
        created: true,
      })),
      addMessage: vi.fn(),
    } as unknown as SessionsStore;

    mockRouter = {
      sendToChannel: vi.fn().mockResolvedValue(undefined),
    } as unknown as Router;

    const buildLLMRequest = vi
      .fn()
      .mockImplementation((sessionId: string, _extraMessages, stream: boolean) => {
        return Promise.resolve({
          messages: [],
          options: {},
          stream,
          sessionId,
        } as LLMRequestType);
      });

    const subscribe = vi
      .fn()
      .mockImplementation(async (topic: string, handler: (data: unknown) => Promise<void>) => {
        streamHandlers.set(topic, handler);
      });

    const unsubscribe = vi.fn().mockImplementation(async (topic: string) => {
      streamHandlers.delete(topic);
    });

    orchestrator = new SubagentOrchestrator({
      subagentManager: mockSubagentManager,
      sessionsStore: mockSessionsStore,
      router: mockRouter,
      buildLLMRequest,
      subscribe,
      unsubscribe,
      config: {
        maxConcurrent: 2,
        announce: { enabled: false }, // Disable announce for simpler tests
      },
    });
  });

  it('should enable streaming when stream=true', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
      stream: true,
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    expect(run.stream).toBe(true);
    expect(run.streamChunks).toEqual([]);

    // Wait for the run to start
    let updatedRun = orchestrator.getRun(run.runId);
    let attempts = 0;
    while (updatedRun?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    // Verify stream subscription was created
    const streamTopic = `nachos.llm.stream.${run.childSessionId}`;
    expect(streamHandlers.has(streamTopic)).toBe(true);
  });

  it('should not enable streaming when stream=false', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
      stream: false,
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    expect(run.stream).toBe(false);
    expect(run.streamChunks).toBeUndefined();
  });

  it('should accumulate stream chunks', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
      stream: true,
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Wait for the run to start
    let updatedRun = orchestrator.getRun(run.runId);
    let attempts = 0;
    while (updatedRun?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    // Simulate stream chunks
    const streamTopic = `nachos.llm.stream.${run.childSessionId}`;
    const handler = streamHandlers.get(streamTopic);
    expect(handler).toBeDefined();

    if (handler) {
      await handler({ type: 'delta', content: 'Hello ' } as LLMStreamChunkType);
      await handler({ type: 'delta', content: 'world' } as LLMStreamChunkType);
      await handler({ type: 'delta', content: '!' } as LLMStreamChunkType);
    }

    // Verify chunks were accumulated
    const finalRun = orchestrator.getRun(run.runId);
    expect(finalRun?.streamChunks).toEqual(['Hello ', 'world', '!']);
  });

  it('should ignore non-delta chunks', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
      stream: true,
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Wait for the run to start
    let updatedRun = orchestrator.getRun(run.runId);
    let attempts = 0;
    while (updatedRun?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    // Simulate various chunk types
    const streamTopic = `nachos.llm.stream.${run.childSessionId}`;
    const handler = streamHandlers.get(streamTopic);

    if (handler) {
      await handler({ type: 'start' } as LLMStreamChunkType);
      await handler({ type: 'delta', content: 'Hello' } as LLMStreamChunkType);
      await handler({ type: 'metadata', metadata: {} } as LLMStreamChunkType);
      await handler({ type: 'delta', content: ' world' } as LLMStreamChunkType);
      await handler({ type: 'end' } as LLMStreamChunkType);
    }

    // Only delta chunks should be accumulated
    const finalRun = orchestrator.getRun(run.runId);
    expect(finalRun?.streamChunks).toEqual(['Hello', ' world']);
  });

  it('should unsubscribe from stream topic after completion', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
      stream: true,
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    const streamTopic = `nachos.llm.stream.${run.childSessionId}`;

    // Wait for the run to start
    let updatedRun = orchestrator.getRun(run.runId);
    let attempts = 0;
    while (updatedRun?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    // Verify subscription exists
    expect(streamHandlers.has(streamTopic)).toBe(true);

    // Wait for completion
    while (updatedRun?.status === 'running' && attempts < 50) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    // Verify subscription was removed
    expect(streamHandlers.has(streamTopic)).toBe(false);
  });

  it('should include streamChunks in run record', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
      stream: true,
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Wait for the run to start
    let updatedRun = orchestrator.getRun(run.runId);
    let attempts = 0;
    while (updatedRun?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    // Send some chunks
    const streamTopic = `nachos.llm.stream.${run.childSessionId}`;
    const handler = streamHandlers.get(streamTopic);

    if (handler) {
      await handler({ type: 'delta', content: 'Test' } as LLMStreamChunkType);
      await handler({ type: 'delta', content: ' chunk' } as LLMStreamChunkType);
    }

    // Get run via listRuns
    const runs = orchestrator.listRuns();
    const targetRun = runs.find((r) => r.runId === run.runId);

    expect(targetRun).toBeDefined();
    expect(targetRun?.stream).toBe(true);
    expect(targetRun?.streamChunks).toEqual(['Test', ' chunk']);
  });
});
