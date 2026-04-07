/**
 * Tests for SubagentManager sandbox modes: host vs full
 *
 * NACA-54: Verify different sandbox modes for subagents
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubagentManager } from './subagent-manager.js';
import { DockerSubagentSandbox } from './docker-sandbox.js';
import type { SubagentTask } from './types.js';
import type { LLMRequestType, LLMResponseType } from '@nachos/types';

// --- helpers ---

function makeTask(overrides: Partial<SubagentTask> = {}): SubagentTask {
  return {
    id: 'task-1',
    request: {} as LLMRequestType,
    ...overrides,
  };
}

const successResponse: LLMResponseType = {
  success: true,
  message: { role: 'assistant', content: 'ok' },
};

// --- mode = "host" ---

describe('SubagentManager – mode: host', () => {
  let sendRequest: ReturnType<typeof vi.fn>;
  let manager: SubagentManager;

  beforeEach(() => {
    sendRequest = vi.fn().mockResolvedValue(successResponse);
    manager = new SubagentManager({ mode: 'host' }, sendRequest);
  });

  it('runs the subagent in-process and returns success', async () => {
    const result = await manager.run(makeTask());

    expect(result.success).toBe(true);
    expect(result.sandboxed).toBe(false);
    expect(result.response).toEqual(successResponse);
    expect(sendRequest).toHaveBeenCalledOnce();
  });

  it('reports failure when the LLM call throws', async () => {
    sendRequest.mockRejectedValue(new Error('connection refused'));
    const result = await manager.run(makeTask());

    expect(result.success).toBe(false);
    expect(result.sandboxed).toBe(false);
    expect(result.error?.code).toBe('SUBAGENT_HOST_ERROR');
    expect(result.error?.message).toMatch(/connection refused/);
  });

  it('does not sandbox even when task overrides mode to host', async () => {
    const result = await manager.run(makeTask({ sandboxMode: 'host' }));
    expect(result.sandboxed).toBe(false);
  });

  it('records a reasonable durationMs', async () => {
    const result = await manager.run(makeTask());
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// --- mode = "full" (Docker sandbox) ---

describe('SubagentManager – mode: full', () => {
  let mockDockerSandbox: DockerSubagentSandbox;
  let manager: SubagentManager;
  let sendRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendRequest = vi.fn(); // should NOT be called in full mode

    // Mock the DockerSubagentSandbox so we don't need a real Docker daemon.
    mockDockerSandbox = {
      run: vi.fn().mockResolvedValue({
        success: true,
        response: successResponse,
        durationMs: 50,
        sandboxed: true,
      }),
    } as unknown as DockerSubagentSandbox;

    // Inject the mock sandbox via the constructor's docker config path,
    // then replace the internal dockerSandbox after construction.
    manager = new SubagentManager(
      {
        mode: 'full',
        docker: {
          image: 'nachos/subagent:latest',
          network: 'none',
        },
      },
      sendRequest
    );

    // Swap the internally created DockerSubagentSandbox with our mock.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).dockerSandbox = mockDockerSandbox;
  });

  it('delegates to DockerSubagentSandbox and marks result as sandboxed', async () => {
    const result = await manager.run(makeTask());

    expect(result.success).toBe(true);
    expect(result.sandboxed).toBe(true);
    expect(mockDockerSandbox.run).toHaveBeenCalledOnce();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('propagates docker sandbox errors', async () => {
    vi.mocked(mockDockerSandbox.run).mockResolvedValue({
      success: false,
      error: { code: 'SUBAGENT_SANDBOX_ERROR', message: 'container exited with code 1' },
      durationMs: 30,
      sandboxed: true,
    });

    const result = await manager.run(makeTask());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SUBAGENT_SANDBOX_ERROR');
  });

  it('respects task-level sandboxMode override to "full"', async () => {
    const result = await manager.run(makeTask({ sandboxMode: 'full' }));
    expect(result.sandboxed).toBe(true);
    expect(mockDockerSandbox.run).toHaveBeenCalledOnce();
  });
});

// --- mode = "full" with NO docker config ---

describe('SubagentManager – mode: full, no docker config', () => {
  it('returns SUBAGENT_SANDBOX_UNAVAILABLE when docker is not configured', async () => {
    const sendRequest = vi.fn();
    const manager = new SubagentManager({ mode: 'full' }, sendRequest);

    const result = await manager.run(makeTask());

    expect(result.success).toBe(false);
    expect(result.sandboxed).toBe(true);
    expect(result.error?.code).toBe('SUBAGENT_SANDBOX_UNAVAILABLE');
    expect(sendRequest).not.toHaveBeenCalled();
  });
});

// --- task-level sandboxMode overrides manager default ---

describe('SubagentManager – task sandboxMode overrides', () => {
  it('uses docker sandbox when task.sandboxMode is "full" and manager default is "host"', async () => {
    const sendRequest = vi.fn();
    const manager = new SubagentManager({ mode: 'host' }, sendRequest);

    const mockDockerSandbox = {
      run: vi.fn().mockResolvedValue({
        success: true,
        response: successResponse,
        durationMs: 20,
        sandboxed: true,
      }),
    } as unknown as DockerSubagentSandbox;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).dockerSandbox = mockDockerSandbox;

    const result = await manager.run(makeTask({ sandboxMode: 'full' }));

    expect(result.sandboxed).toBe(true);
    expect(mockDockerSandbox.run).toHaveBeenCalledOnce();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('uses host execution when task.sandboxMode is "host" and manager default is "full"', async () => {
    const sendRequest = vi.fn().mockResolvedValue(successResponse);
    const manager = new SubagentManager(
      { mode: 'full', docker: { image: 'nachos/subagent:latest' } },
      sendRequest
    );

    const mockDockerSandbox = {
      run: vi.fn(),
    } as unknown as DockerSubagentSandbox;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).dockerSandbox = mockDockerSandbox;

    const result = await manager.run(makeTask({ sandboxMode: 'host' }));

    expect(result.sandboxed).toBe(false);
    expect(sendRequest).toHaveBeenCalledOnce();
    expect(mockDockerSandbox.run).not.toHaveBeenCalled();
  });
});
