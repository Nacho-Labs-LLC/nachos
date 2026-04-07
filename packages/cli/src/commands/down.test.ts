import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockIsDockerAvailable, mockIsComposeAvailable, mockDown, mockGetProjectRoot } = vi.hoisted(
  () => ({
    mockIsDockerAvailable: vi.fn(),
    mockIsComposeAvailable: vi.fn(),
    mockDown: vi.fn(),
    mockGetProjectRoot: vi.fn(),
  })
);

vi.mock('../core/docker-client.js', () => ({
  DockerClient: vi.fn().mockImplementation(() => ({
    isDockerAvailable: mockIsDockerAvailable,
    isComposeAvailable: mockIsComposeAvailable,
    down: mockDown,
  })),
}));

vi.mock('../core/config-discovery.js', () => ({
  findConfigFileOrThrow: () => mockGetProjectRoot() + '/nachos.toml',
  getProjectRoot: () => mockGetProjectRoot(),
}));

vi.mock('../core/prompt.js', () => ({
  confirmPrompt: vi.fn().mockResolvedValue(true),
  isInteractive: () => false,
}));

vi.mock('../cli.js', () => ({
  getVersion: () => '0.0.0-test',
}));

const { downCommand } = await import('./down.js');

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

describe('downCommand', () => {
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
    await downCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_NOT_AVAILABLE');
  });

  it('errors when Docker Compose is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await downCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_COMPOSE_NOT_AVAILABLE');
  });

  it('errors when compose file does not exist (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const capture = captureJsonOutput();
    await downCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('COMPOSE_FILE_NOT_FOUND');
  });

  it('stops the stack successfully (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockDown.mockResolvedValue(undefined);

    const capture = captureJsonOutput();
    await downCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.stopped).toBe(true);
    expect(output.data.volumes_removed).toBe(false);
    expect(mockDown).toHaveBeenCalledWith(composePath, {
      volumes: undefined,
      removeOrphans: true,
    });
  });

  it('stops with volume removal when --volumes --force is provided (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockDown.mockResolvedValue(undefined);

    const capture = captureJsonOutput();
    await downCommand({ json: true, volumes: true, force: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.volumes_removed).toBe(true);
    expect(mockDown).toHaveBeenCalledWith(composePath, {
      volumes: true,
      removeOrphans: true,
    });
  });
});
