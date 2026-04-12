import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initCommand } from './init.js';

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

describe('initCommand', () => {
  let tempDir: string;
  let originalCwd: string;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-init-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
  });

  it('creates project structure with defaults (JSON mode)', async () => {
    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.project_name).toBe('my-nachos-project');
    expect(output.data.provider).toBe('anthropic');
    expect(output.data.security_mode).toBe('standard');
    expect(output.data.webchat_enabled).toBe(true);

    // Verify files were created
    expect(existsSync(join(tempDir, 'nachos.toml'))).toBe(true);
    expect(existsSync(join(tempDir, '.env'))).toBe(true);
    expect(existsSync(join(tempDir, 'policies'))).toBe(true);
    expect(existsSync(join(tempDir, 'workspace'))).toBe(true);
    expect(existsSync(join(tempDir, 'data', 'gateway'))).toBe(true);
    expect(existsSync(join(tempDir, 'state'))).toBe(true);
    expect(existsSync(join(tempDir, '.gitignore'))).toBe(true);
  });

  it('generates valid TOML config', async () => {
    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    capture.parse();

    const config = readFileSync(join(tempDir, 'nachos.toml'), 'utf-8');
    expect(config).toContain('[nachos]');
    expect(config).toContain('name = "my-nachos-project"');
    expect(config).toContain('[llm]');
    expect(config).toContain('provider = "anthropic"');
    expect(config).toContain('[security]');
    expect(config).toContain('mode = "standard"');
    expect(config).toContain('[channels.webchat]');
  });

  it('generates .env with Anthropic key placeholder', async () => {
    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    capture.parse();

    const envContent = readFileSync(join(tempDir, '.env'), 'utf-8');
    expect(envContent).toContain('ANTHROPIC_API_KEY=');
  });

  it('generates standard security policy', async () => {
    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    capture.parse();

    const policyPath = join(tempDir, 'policies', 'standard.yaml');
    expect(existsSync(policyPath)).toBe(true);

    const policy = readFileSync(policyPath, 'utf-8');
    expect(policy).toContain('name: standard');
  });

  it('errors when nachos.toml already exists without --force (JSON mode)', async () => {
    writeFileSync(join(tempDir, 'nachos.toml'), '[nachos]\nname = "existing"', 'utf-8');

    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('CONFIG_EXISTS');
    expect(mockExit).toHaveBeenCalled();
  });

  it('overwrites when --force is provided', async () => {
    writeFileSync(join(tempDir, 'nachos.toml'), '[nachos]\nname = "existing"', 'utf-8');

    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true, force: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.project_name).toBe('my-nachos-project');
  });

  it('does not overwrite existing .env file', async () => {
    writeFileSync(join(tempDir, '.env'), 'MY_SECRET=keep_me\n', 'utf-8');

    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    capture.parse();

    const envContent = readFileSync(join(tempDir, '.env'), 'utf-8');
    expect(envContent).toContain('MY_SECRET=keep_me');
    // Should not contain the generated content
    expect(envContent).not.toContain('ANTHROPIC_API_KEY');
  });

  it('generates .gitignore with expected entries', async () => {
    const capture = captureJsonOutput();
    await initCommand({ json: true, defaults: true });
    capture.parse();

    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('docker-compose.generated.yml');
  });
});
