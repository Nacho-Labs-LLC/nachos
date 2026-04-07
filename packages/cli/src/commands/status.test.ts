import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockIsDockerAvailable, mockIsComposeAvailable, mockPs, mockGetProjectRoot } = vi.hoisted(
  () => ({
    mockIsDockerAvailable: vi.fn(),
    mockIsComposeAvailable: vi.fn(),
    mockPs: vi.fn(),
    mockGetProjectRoot: vi.fn(),
  })
);

vi.mock('../core/docker-client.js', () => ({
  DockerClient: vi.fn().mockImplementation(() => ({
    isDockerAvailable: mockIsDockerAvailable,
    isComposeAvailable: mockIsComposeAvailable,
    ps: mockPs,
  })),
}));

vi.mock('../core/config-discovery.js', () => ({
  findConfigFileOrThrow: () => mockGetProjectRoot() + '/nachos.toml',
  getProjectRoot: () => mockGetProjectRoot(),
}));

vi.mock('../cli.js', () => ({
  getVersion: () => '0.0.0-test',
}));

const { statusCommand } = await import('./status.js');

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

describe('statusCommand', () => {
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
    await statusCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_NOT_AVAILABLE');
  });

  it('errors when compose file does not exist (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const capture = captureJsonOutput();
    await statusCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('COMPOSE_FILE_NOT_FOUND');
  });

  it('reports running status with service list (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockPs.mockResolvedValue([
      {
        ID: 'abc',
        Name: 'nachos-gateway',
        Service: 'gateway',
        State: 'running',
        Status: 'Up 5 minutes',
        Health: 'healthy',
        ExitCode: 0,
      },
      {
        ID: 'def',
        Name: 'nachos-bus',
        Service: 'bus',
        State: 'running',
        Status: 'Up 5 minutes',
        Health: 'healthy',
        ExitCode: 0,
      },
    ]);

    const capture = captureJsonOutput();
    await statusCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.running).toBe(true);
    expect(output.data.containers).toHaveLength(2);
    expect(output.data.urls.gateway).toBe('http://localhost:3000');
  });

  it('reports not running when containers are stopped (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockPs.mockResolvedValue([
      {
        ID: 'abc',
        Name: 'nachos-gateway',
        Service: 'gateway',
        State: 'exited',
        Status: 'Exited (0)',
        Health: '',
        ExitCode: 0,
      },
    ]);

    const capture = captureJsonOutput();
    await statusCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.running).toBe(false);
  });

  it('reports not running when no containers exist (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockPs.mockResolvedValue([]);

    const capture = captureJsonOutput();
    await statusCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.running).toBe(false);
    expect(output.data.containers).toHaveLength(0);
  });
});
