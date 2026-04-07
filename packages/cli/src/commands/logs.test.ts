import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockIsDockerAvailable, mockIsComposeAvailable, mockLogs, mockGetProjectRoot } = vi.hoisted(
  () => ({
    mockIsDockerAvailable: vi.fn(),
    mockIsComposeAvailable: vi.fn(),
    mockLogs: vi.fn(),
    mockGetProjectRoot: vi.fn(),
  })
);

vi.mock('../core/docker-client.js', () => ({
  DockerClient: vi.fn().mockImplementation(() => ({
    isDockerAvailable: mockIsDockerAvailable,
    isComposeAvailable: mockIsComposeAvailable,
    logs: mockLogs,
  })),
}));

vi.mock('../core/config-discovery.js', () => ({
  findConfigFileOrThrow: () => mockGetProjectRoot() + '/nachos.toml',
  getProjectRoot: () => mockGetProjectRoot(),
}));

vi.mock('../cli.js', () => ({
  getVersion: () => '0.0.0-test',
}));

const { logsCommand } = await import('./logs.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureJsonOutput() {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  return {
    parse() {
      spy.mockRestore();
      const raw = logs.join('\n').trim();
      return raw.length > 0 ? JSON.parse(raw) : null;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('logsCommand', () => {
  let tempDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-cli-'));
    mockGetProjectRoot.mockReturnValue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
  });

  it('errors when Docker is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await logsCommand(undefined, { json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_NOT_AVAILABLE');
    expect(mockExit).toHaveBeenCalledWith(3);
  });

  it('errors when Docker Compose is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await logsCommand(undefined, { json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_COMPOSE_NOT_AVAILABLE');
    expect(mockExit).toHaveBeenCalledWith(3);
  });

  it('errors when compose file does not exist (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const capture = captureJsonOutput();
    await logsCommand(undefined, { json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('COMPOSE_FILE_NOT_FOUND');
  });

  it('streams logs for all services', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    // Create the compose file
    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockLogs.mockResolvedValue(undefined);

    // Suppress pretty-mode console output
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logsCommand(undefined, {});

    logSpy.mockRestore();

    expect(mockLogs).toHaveBeenCalledWith(
      composePath,
      undefined,
      expect.objectContaining({
        follow: undefined,
        tail: undefined,
        timestamps: undefined,
      })
    );
  });

  it('streams logs for a specific service with flags', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockLogs.mockResolvedValue(undefined);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await logsCommand('gateway', { follow: true, tail: '100', timestamps: true });

    logSpy.mockRestore();

    expect(mockLogs).toHaveBeenCalledWith(
      composePath,
      'gateway',
      expect.objectContaining({
        follow: true,
        tail: 100,
        timestamps: true,
      })
    );
  });
});
