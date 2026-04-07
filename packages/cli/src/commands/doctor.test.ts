import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockRunDoctorChecks } = vi.hoisted(() => ({
  mockRunDoctorChecks: vi.fn(),
}));

vi.mock('../lib/doctor/index.js', () => ({
  runDoctorChecks: () => mockRunDoctorChecks(),
}));

vi.mock('../cli.js', () => ({
  getVersion: () => '0.0.0-test',
}));

const { doctorCommand } = await import('./doctor.js');

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

describe('doctorCommand', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent process.exit from killing the test runner
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
  });

  it('reports all checks passing (JSON mode)', async () => {
    mockRunDoctorChecks.mockResolvedValue({
      checks: [
        { id: 'docker', name: 'Docker', status: 'pass', message: 'Docker available' },
        { id: 'compose', name: 'Docker Compose', status: 'pass', message: 'Compose available' },
      ],
      summary: { total: 2, passed: 2, warned: 0, failed: 0 },
    });

    const capture = captureJsonOutput();
    await doctorCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.summary.total).toBe(2);
    expect(output.data.summary.passed).toBe(2);
    expect(output.data.summary.failed).toBe(0);
  });

  it('reports warnings (JSON mode)', async () => {
    mockRunDoctorChecks.mockResolvedValue({
      checks: [
        { id: 'docker', name: 'Docker', status: 'pass', message: 'Docker available' },
        {
          id: 'ports',
          name: 'Ports',
          status: 'warn',
          message: 'Port 8080 in use',
          suggestion: 'Change webchat port in nachos.toml',
        },
      ],
      summary: { total: 2, passed: 1, warned: 1, failed: 0 },
    });

    const capture = captureJsonOutput();
    await doctorCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.summary.warned).toBe(1);
    expect(output.data.checks[1].suggestion).toContain('Change webchat port');
  });

  it('reports failures (JSON mode)', async () => {
    mockRunDoctorChecks.mockResolvedValue({
      checks: [
        {
          id: 'docker',
          name: 'Docker',
          status: 'fail',
          message: 'Docker not found',
          suggestion: 'Install Docker',
        },
      ],
      summary: { total: 1, passed: 0, warned: 0, failed: 1 },
    });

    const capture = captureJsonOutput();
    await doctorCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.summary.failed).toBe(1);
    expect(output.data.checks[0].status).toBe('fail');
  });

  it('exits with code 1 in pretty mode when checks fail', async () => {
    mockRunDoctorChecks.mockResolvedValue({
      checks: [{ id: 'docker', name: 'Docker', status: 'fail', message: 'Docker not found' }],
      summary: { total: 1, passed: 0, warned: 0, failed: 1 },
    });

    // Suppress all console output in pretty mode
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await doctorCommand({ json: false });

    logSpy.mockRestore();
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
