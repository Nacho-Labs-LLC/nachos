import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be hoisted before dynamic import) ────────────────────────────

const {
  mockIsDockerAvailable,
  mockIsComposeAvailable,
  mockBuild,
  mockUp,
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

const { upCommand } = await import('./up.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureJsonOutput() {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  return {
    restore() {
      spy.mockRestore();
    },
    parse() {
      spy.mockRestore();
      const raw = logs.join('\n').trim();
      return raw.length > 0 ? JSON.parse(raw) : null;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('upCommand', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent process.exit from killing the test runner
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('errors when Docker is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await upCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_NOT_AVAILABLE');
    expect(mockExit).toHaveBeenCalledWith(3);
  });

  it('errors when Docker Compose is not available (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await upCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('DOCKER_COMPOSE_NOT_AVAILABLE');
    expect(mockExit).toHaveBeenCalledWith(3);
  });

  it('starts the stack successfully (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockLoadAndValidateConfig.mockResolvedValue({
      channels: { webchat: { enabled: true, port: 8080 } },
      admin: { enabled: true, port: 8082 },
    });
    mockGenerateAndWriteComposeFile.mockReturnValue('/project/docker-compose.generated.yml');
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([
      { Service: 'gateway', State: 'running', Health: 'healthy' },
      { Service: 'bus', State: 'running', Health: 'healthy' },
    ]);

    const capture = captureJsonOutput();
    await upCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.containers).toBe(2);
    expect(output.data.services).toHaveLength(2);
    expect(output.data.urls.gateway).toBe('http://localhost:3000');
    expect(output.data.urls.webchat).toBe('http://localhost:8080');
    expect(output.data.urls.admin).toBe('http://localhost:8082');
  });

  it('passes services list when --only is provided', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockLoadAndValidateConfig.mockResolvedValue({});
    mockGenerateAndWriteComposeFile.mockReturnValue('/project/docker-compose.generated.yml');
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([{ Service: 'gateway', State: 'running', Health: 'healthy' }]);

    const capture = captureJsonOutput();
    await upCommand({ json: true, only: 'gateway,bus' });
    capture.parse();

    expect(mockUp).toHaveBeenCalledWith(
      '/project/docker-compose.generated.yml',
      expect.objectContaining({
        services: ['gateway', 'bus'],
      })
    );
  });

  it('builds images when --build is provided', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockLoadAndValidateConfig.mockResolvedValue({});
    mockGenerateAndWriteComposeFile.mockReturnValue('/project/docker-compose.generated.yml');
    mockBuild.mockResolvedValue(undefined);
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([]);

    const capture = captureJsonOutput();
    await upCommand({ json: true, build: true });
    capture.parse();

    expect(mockBuild).toHaveBeenCalledWith('/project/docker-compose.generated.yml');
  });

  it('omits webchat URL when webchat is not enabled', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockLoadAndValidateConfig.mockResolvedValue({
      channels: { slack: { enabled: true } },
    });
    mockGenerateAndWriteComposeFile.mockReturnValue('/project/docker-compose.generated.yml');
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([]);

    const capture = captureJsonOutput();
    await upCommand({ json: true });
    const output = capture.parse();

    expect(output.data.urls.webchat).toBeUndefined();
  });

  it('rejects invalid --timeout when --wait is enabled (JSON mode)', async () => {
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockLoadAndValidateConfig.mockResolvedValue({});
    mockGenerateAndWriteComposeFile.mockReturnValue('/project/docker-compose.generated.yml');
    mockUp.mockResolvedValue(undefined);
    mockPs.mockResolvedValue([{ Service: 'gateway', State: 'running', Health: 'healthy' }]);

    const capture = captureJsonOutput();
    await upCommand({ json: true, wait: true, timeout: '0' });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.message).toContain('between 1 and 600');
  });
});
