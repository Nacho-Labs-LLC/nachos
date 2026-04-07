import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../core/nats-client.js', () => ({
  createCliBusClient: async () => ({
    request: mockRequest,
    disconnect: mockDisconnect,
  }),
}));

const { subagentsFilesGetCommand, subagentsFilesListCommand } = await import('./subagents.js');

describe('subagents files CLI commands', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockDisconnect.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requests file listing with provided options', async () => {
    mockRequest.mockResolvedValueOnce({
      payload: {
        ok: true,
        data: {
          runId: 'run-1',
          entries: [{ name: 'out.txt', path: 'out.txt', type: 'file', size: 12 }],
        },
      },
    });

    await subagentsFilesListCommand('run-1', { json: true, path: 'results', recursive: true });

    expect(mockRequest).toHaveBeenCalledWith('nachos.gateway.subagents.files.list', {
      runId: 'run-1',
      path: 'results',
      recursive: true,
      limit: undefined,
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('requests file contents with size limit', async () => {
    mockRequest.mockResolvedValueOnce({
      payload: {
        ok: true,
        data: {
          runId: 'run-2',
          file: {
            path: 'output.txt',
            size: 10,
            updatedAtMs: 0,
            truncated: false,
            encoding: 'utf-8',
            content: 'hello',
          },
        },
      },
    });

    await subagentsFilesGetCommand('run-2', { json: true, path: 'output.txt', maxBytes: 512 });

    expect(mockRequest).toHaveBeenCalledWith('nachos.gateway.subagents.files.get', {
      runId: 'run-2',
      path: 'output.txt',
      maxBytes: 512,
    });
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
