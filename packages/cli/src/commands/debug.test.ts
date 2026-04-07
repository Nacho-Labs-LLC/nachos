import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const {
  mockIsDockerAvailable,
  mockIsComposeAvailable,
  mockGetDockerVersion,
  mockGetComposeVersion,
  mockFindConfigFileOrThrow,
  mockGetProjectRoot,
  mockGetConfigSearchPaths,
  mockLoadAndValidateConfig,
} = vi.hoisted(() => ({
  mockIsDockerAvailable: vi.fn(),
  mockIsComposeAvailable: vi.fn(),
  mockGetDockerVersion: vi.fn(),
  mockGetComposeVersion: vi.fn(),
  mockFindConfigFileOrThrow: vi.fn(),
  mockGetProjectRoot: vi.fn(),
  mockGetConfigSearchPaths: vi.fn(),
  mockLoadAndValidateConfig: vi.fn(),
}));

vi.mock('../core/docker-client.js', () => ({
  DockerClient: vi.fn().mockImplementation(() => ({
    isDockerAvailable: mockIsDockerAvailable,
    isComposeAvailable: mockIsComposeAvailable,
    getDockerVersion: mockGetDockerVersion,
    getComposeVersion: mockGetComposeVersion,
  })),
}));

vi.mock('../core/config-discovery.js', () => ({
  findConfigFileOrThrow: () => mockFindConfigFileOrThrow(),
  getProjectRoot: () => mockGetProjectRoot(),
  getConfigSearchPaths: () => mockGetConfigSearchPaths(),
}));

vi.mock('@nachos/config', () => ({
  loadAndValidateConfig: (...args: unknown[]) => mockLoadAndValidateConfig(...args),
}));

vi.mock('../cli.js', () => ({
  getVersion: () => '1.2.3-test',
}));

const { debugCommand } = await import('./debug.js');

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

describe('debugCommand', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('reports CLI and system info (JSON mode)', async () => {
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockGetConfigSearchPaths.mockReturnValue(['/project/nachos.toml']);
    mockLoadAndValidateConfig.mockResolvedValue({
      security: { mode: 'standard' },
      llm: { provider: 'anthropic' },
    });
    mockIsDockerAvailable.mockResolvedValue(true);
    mockIsComposeAvailable.mockResolvedValue(true);
    mockGetDockerVersion.mockResolvedValue('24.0.7');
    mockGetComposeVersion.mockResolvedValue('v2.23.0');

    const capture = captureJsonOutput();
    await debugCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.cli_version).toBe('1.2.3-test');
    expect(output.data.node_version).toBe(process.version);
    expect(output.data.platform).toBe(process.platform);
    expect(output.data.config.path).toBe('/project/nachos.toml');
    expect(output.data.config.loaded).toBe(true);
    expect(output.data.config.security_mode).toBe('standard');
    expect(output.data.config.llm_provider).toBe('anthropic');
    expect(output.data.docker.available).toBe(true);
    expect(output.data.docker.compose_available).toBe(true);
    expect(output.data.docker.version).toBe('24.0.7');
    expect(output.data.docker.compose_version).toBe('v2.23.0');
  });

  it('handles missing config gracefully (JSON mode)', async () => {
    mockFindConfigFileOrThrow.mockImplementation(() => {
      throw new Error('No nachos.toml found');
    });
    mockIsDockerAvailable.mockResolvedValue(false);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await debugCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.config.error).toContain('No nachos.toml found');
    expect(output.data.docker.available).toBe(false);
  });

  it('handles Docker not available (JSON mode)', async () => {
    mockFindConfigFileOrThrow.mockReturnValue('/project/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/project');
    mockGetConfigSearchPaths.mockReturnValue([]);
    mockLoadAndValidateConfig.mockResolvedValue({});
    mockIsDockerAvailable.mockResolvedValue(false);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await debugCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.docker.available).toBe(false);
    expect(output.data.docker.compose_available).toBe(false);
    // Should not have tried to get versions when Docker is unavailable
    expect(output.data.docker.version).toBeUndefined();
  });

  it('includes NACHOS_CONFIG_PATH when set (JSON mode)', async () => {
    const originalEnv = process.env.NACHOS_CONFIG_PATH;
    process.env.NACHOS_CONFIG_PATH = '/custom/nachos.toml';

    mockFindConfigFileOrThrow.mockReturnValue('/custom/nachos.toml');
    mockGetProjectRoot.mockReturnValue('/custom');
    mockGetConfigSearchPaths.mockReturnValue(['/custom/nachos.toml']);
    mockLoadAndValidateConfig.mockResolvedValue({});
    mockIsDockerAvailable.mockResolvedValue(false);
    mockIsComposeAvailable.mockResolvedValue(false);

    const capture = captureJsonOutput();
    await debugCommand({ json: true });
    const output = capture.parse();

    expect(output.data.env.NACHOS_CONFIG_PATH).toBe('/custom/nachos.toml');

    // Restore
    if (originalEnv === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalEnv;
    }
  });
});
