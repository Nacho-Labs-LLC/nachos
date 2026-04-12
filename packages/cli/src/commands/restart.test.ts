import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockIsDockerAvailable,
  mockIsComposeAvailable,
  mockBuild,
  mockUp,
  mockDown,
  mockPs,
  mockLoadAndValidateConfig,
  mockFindConfigFileOrThrow,
  mockGetProjectRoot,
  mockGenerateAndWriteComposeFile,
} = vi.hoisted(() => ({
  mockIsDockerAvailable: vi.fn(),
  mockIsComposeAvailable: vi.fn(),
  mockBuild: vi.fn(),
  mockUp: vi.fn(),
  mockDown: vi.fn(),
  mockPs: vi.fn(),
  mockLoadAndValidateConfig: vi.fn(),
  mockFindConfigFileOrThrow: vi.fn(),
  mockGetProjectRoot: vi.fn(),
  mockGenerateAndWriteComposeFile: vi.fn(),
}));

vi.mock('../core/docker-client.js', () => ({
  DockerClient: vi.fn().mockImplementation(() => ({
    isDockerAvailable: mockIsDockerAvailable,
    isComposeAvailable: mockIsComposeAvailable,
    build: mockBuild,
    up: mockUp,
    down: mockDown,
    ps: mockPs,
  })),
}));

vi.mock('@nachos/config', () => ({
  loadAndValidateConfig: (...args: unknown[]) => mockLoadAndValidateConfig(...args),
}));

vi.mock('../core/config-discovery.js', () => ({
  findConfigFileOrThrow: () => mockFindConfigFileOrThrow(),
  getProjectRoot: () => mockGetProjectRoot(),
}));

vi.mock('../core/compose-generator.js', () => ({
  generateAndWriteComposeFile: (...args: unknown[]) => mockGenerateAndWriteComposeFile(...args),
}));

vi.mock('../cli.js', () => ({
  getVersion: () => '0.0.0-test',
}));

const { restartCommand } = await import('./restart.js');

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

describe('restartCommand', () => {
  let tempDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-cli-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
  });

  it('errors when Docker is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await restartCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_NOT_AVAILABLE');
  });

  it('errors when Docker Compose is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await restartCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_COMPOSE_NOT_AVAILABLE');
  });

  it('restarts stack: stops existing, regenerates compose, starts fresh (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue(join(tempDir, 'nachos.toml'));
    mockGetProjectRoot.mockReturnValue(tempDir);
    mockLoadAndValidateConfig.mockResolvedValue({});

    // Create existing compose file so down() is called
    const composePath = join(tempDir, 'docker-compose.generated.yml');
    writeFileSync(composePath, 'services: {}', 'utf-8');

    mockGenerateAndWriteComposeFile.mockReturnValue(composePath);
    mockDown.mockResolvedValue(undefined);
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([{ Service: 'gateway', State: 'running', Health: 'healthy' }]);

    const capture = captureJsonOutput();
    await restartCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.containers).toBe(1);

    // Verify down was called for the existing compose file
    expect(mockDown).toHaveBeenCalledWith(composePath, { removeOrphans: true });
    // Verify up was called
    expect(mockUp).toHaveBeenCalled();
  });

  it('skips down when no existing compose file exists', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue(join(tempDir, 'nachos.toml'));
    mockGetProjectRoot.mockReturnValue(tempDir);
    mockLoadAndValidateConfig.mockResolvedValue({});

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    mockGenerateAndWriteComposeFile.mockReturnValue(composePath);
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([]);

    const capture = captureJsonOutput();
    await restartCommand({ json: true });
    capture.parse();

    // down should NOT have been called since compose file didn't exist
    expect(mockDown).not.toHaveBeenCalled();
    // up should still be called
    expect(mockUp).toHaveBeenCalled();
  });

  it('builds images when --build is provided', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue(join(tempDir, 'nachos.toml'));
    mockGetProjectRoot.mockReturnValue(tempDir);
    mockLoadAndValidateConfig.mockResolvedValue({});

    const composePath = join(tempDir, 'docker-compose.generated.yml');
    mockGenerateAndWriteComposeFile.mockReturnValue(composePath);
    mockBuild.mockResolvedValue(undefined);
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([]);

    const capture = captureJsonOutput();
    await restartCommand({ json: true, build: true });
    capture.parse();

    expect(mockBuild).toHaveBeenCalledWith(composePath);
  });
});
