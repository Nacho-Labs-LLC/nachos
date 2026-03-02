/**
 * Progress Updates Tests
 *
 * Tests for subagent progress reporting functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Router } from '../router.js';
import type { SessionManager } from '../session.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type { SubagentManager } from './subagent-manager.js';
import type { LLMRequestType } from '@nachos/types';

describe('SubagentOrchestrator - Progress Updates', () => {
  let orchestrator: SubagentOrchestrator;
  let mockSubagentManager: SubagentManager;
  let mockSessionManager: SessionManager;
  let mockRouter: Router;

  beforeEach(() => {
    mockSubagentManager = {
      run: vi.fn().mockResolvedValue({
        success: true,
        response: { message: { role: 'assistant', content: 'Task completed' } },
        durationMs: 1000,
        sandboxed: false,
      }),
    } as unknown as SubagentManager;

    mockSessionManager = {
      getOrCreateSession: vi.fn().mockReturnValue({
        id: 'test-session-id',
        channel: 'test',
        conversationId: 'test-conv',
      }),
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
        announce: { enabled: false }, // Disable announce for simpler tests
      },
    });
  });

  it('should report progress for running subagent', async () => {
    // Enqueue a subagent task
    const run = await orchestrator.enqueue({
      task: 'Test task',
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Wait for the run to start (poll for status === 'running')
    let updatedRun = orchestrator.getRun(run.runId);
    let attempts = 0;
    while (updatedRun?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      updatedRun = orchestrator.getRun(run.runId);
      attempts++;
    }

    expect(updatedRun?.status).toBe('running');

    // Report progress
    const success = orchestrator.reportProgress(run.runId, 'Processing data', 25, {
      step: 'validation',
    });

    expect(success).toBe(true);

    // Get the updated run record
    const finalRun = orchestrator.getRun(run.runId);
    expect(finalRun).toBeTruthy();
    expect(finalRun?.progress).toBeDefined();
    expect(finalRun?.progress).toHaveLength(1);
    expect(finalRun?.progress?.[0]).toMatchObject({
      status: 'Processing data',
      percentage: 25,
      metadata: { step: 'validation' },
    });
    expect(finalRun?.progress?.[0].timestamp).toBeDefined();
  });

  it('should accumulate multiple progress updates', async () => {
    // Enqueue a subagent task
    const run = await orchestrator.enqueue({
      task: 'Test task',
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

    // Report multiple progress updates
    orchestrator.reportProgress(run.runId, 'Starting', 0);
    orchestrator.reportProgress(run.runId, 'Processing', 50);
    orchestrator.reportProgress(run.runId, 'Almost done', 90);

    // Get the updated run record
    const finalRun = orchestrator.getRun(run.runId);
    expect(finalRun?.progress).toHaveLength(3);
    expect(finalRun?.progress?.[0].status).toBe('Starting');
    expect(finalRun?.progress?.[1].status).toBe('Processing');
    expect(finalRun?.progress?.[2].status).toBe('Almost done');
  });

  it('should fail to report progress for queued subagent', async () => {
    // Create a mock that blocks execution to keep subsequent runs queued
    const blockingSubagentManager = {
      run: vi.fn().mockImplementation(
        () => new Promise(() => {}) // Never resolves
      ),
    } as unknown as SubagentManager;

    // Create orchestrator with concurrency 1
    const queuedOrchestrator = new SubagentOrchestrator({
      subagentManager: blockingSubagentManager,
      sessionManager: mockSessionManager,
      router: mockRouter,
      buildLLMRequest: vi.fn().mockResolvedValue({ messages: [], options: {} }),
      config: {
        maxConcurrent: 1, // Only one run at a time
        announce: { enabled: false },
      },
    });

    // Enqueue first run (will start running and block)
    const blockingRun = await queuedOrchestrator.enqueue({
      task: 'Blocking task',
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Wait for first run to start
    let blockingRunStatus = queuedOrchestrator.getRun(blockingRun.runId);
    let attempts = 0;
    while (blockingRunStatus?.status !== 'running' && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      blockingRunStatus = queuedOrchestrator.getRun(blockingRun.runId);
      attempts++;
    }

    // Enqueue second run (will stay queued because first is still running)
    const queuedRun = await queuedOrchestrator.enqueue({
      task: 'Queued task',
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Verify second run is queued
    const run = queuedOrchestrator.getRun(queuedRun.runId);
    expect(run?.status).toBe('queued');

    // Try to report progress for queued run
    const success = queuedOrchestrator.reportProgress(queuedRun.runId, 'Should fail');

    expect(success).toBe(false);
    const updatedRun = queuedOrchestrator.getRun(queuedRun.runId);
    expect(updatedRun?.progress).toBeUndefined();
  });

  it('should fail to report progress for completed subagent', async () => {
    // Enqueue a subagent task
    const run = await orchestrator.enqueue({
      task: 'Test task',
      requester: {
        sessionId: 'test-session',
        channel: 'test',
        conversationId: 'test-conv',
      },
    });

    // Wait for the run to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the run is completed
    const completedRun = orchestrator.getRun(run.runId);
    expect(completedRun?.status).toBe('completed');

    // Try to report progress for completed run
    const success = orchestrator.reportProgress(run.runId, 'Should fail');

    expect(success).toBe(false);
  });

  it('should fail to report progress for non-existent run', () => {
    const success = orchestrator.reportProgress('non-existent-run-id', 'Should fail');
    expect(success).toBe(false);
  });

  it('should include progress in listRuns output', async () => {
    // Enqueue a subagent task
    const run = await orchestrator.enqueue({
      task: 'Test task',
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

    // Report progress
    orchestrator.reportProgress(run.runId, 'In progress', 50);

    // Get all runs
    const runs = orchestrator.listRuns();
    const targetRun = runs.find((r) => r.runId === run.runId);

    expect(targetRun).toBeDefined();
    expect(targetRun?.progress).toHaveLength(1);
    expect(targetRun?.progress?.[0].status).toBe('In progress');
    expect(targetRun?.progress?.[0].percentage).toBe(50);
  });

  it('should allow progress updates without percentage', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
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

    const success = orchestrator.reportProgress(run.runId, 'Working on it');

    expect(success).toBe(true);
    const finalRun = orchestrator.getRun(run.runId);
    expect(finalRun?.progress?.[0]).toMatchObject({
      status: 'Working on it',
      percentage: undefined,
    });
  });

  it('should allow progress updates without metadata', async () => {
    const run = await orchestrator.enqueue({
      task: 'Test task',
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

    const success = orchestrator.reportProgress(run.runId, 'Working', 75);

    expect(success).toBe(true);
    const finalRun = orchestrator.getRun(run.runId);
    expect(finalRun?.progress?.[0]).toMatchObject({
      status: 'Working',
      percentage: 75,
      metadata: undefined,
    });
  });
});
