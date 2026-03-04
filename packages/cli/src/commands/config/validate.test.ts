import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateCommand } from './validate.js';

function writeConfig(baseDir: string, content: string): string {
  const configPath = join(baseDir, 'nachos.toml');
  writeFileSync(configPath, content.trim() + '\n', 'utf-8');
  return configPath;
}

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

describe('config validate command', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-cli-'));
    originalConfigPath = process.env.NACHOS_CONFIG_PATH;
    // Prevent process.exit from killing the test runner
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    if (originalConfigPath === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalConfigPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
  });

  it('validates a valid configuration (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test-project"
version = "0.0.1"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"

[security]
mode = "standard"
`
    );

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.valid).toBe(true);
    expect(output.data.config_path).toContain('nachos.toml');
  });

  it('rejects invalid configuration (JSON mode)', async () => {
    // Missing required fields (nachos, llm, security)
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[somethingelse]\nfoo = "bar"`);

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toMatch(/CONFIG_VALIDATION_FAILED|UNKNOWN_ERROR/);
    expect(mockExit).toHaveBeenCalled();
  });

  it('errors when config file is not found (JSON mode)', async () => {
    // Point to nonexistent file AND change CWD to temp dir so the
    // parent-directory walk won't find the repo's nachos.toml
    process.env.NACHOS_CONFIG_PATH = join(tempDir, 'nonexistent.toml');
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    process.chdir(originalCwd);

    expect(output.ok).toBe(false);
    expect(mockExit).toHaveBeenCalled();
  });
});
