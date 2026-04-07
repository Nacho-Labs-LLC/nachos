import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as TOML from '@iarna/toml';

// Mock the confirmation prompt to always confirm
vi.mock('../core/prompt.js', () => ({
  confirmPrompt: vi.fn().mockResolvedValue(true),
  isInteractive: () => false,
}));

import { removeCommand } from './remove.js';

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

describe('removeCommand', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-cli-'));
    originalConfigPath = process.env.NACHOS_CONFIG_PATH;
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

  it('removes a channel from configuration (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test"
version = "0.0.1"

[channels.slack]
enabled = true
mode = "socket"

[channels.discord]
enabled = true
`
    );

    const capture = captureJsonOutput();
    await removeCommand('channel', 'slack', { json: true, force: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.type).toBe('channel');
    expect(output.data.name).toBe('slack');

    // Verify slack was removed from file
    const content = readFileSync(process.env.NACHOS_CONFIG_PATH!, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };
    expect(config.channels!.slack).toBeUndefined();
    expect(config.channels!.discord).toBeDefined();
  });

  it('removes a tool from configuration (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test"
version = "0.0.1"

[tools.filesystem]
enabled = true
`
    );

    const capture = captureJsonOutput();
    await removeCommand('tool', 'filesystem', { json: true, force: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.type).toBe('tool');
    expect(output.data.name).toBe('filesystem');
  });

  it('errors on invalid module type (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test"
version = "0.0.1"
`
    );

    const capture = captureJsonOutput();
    await removeCommand('invalid', 'foo', { json: true, force: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('INVALID_MODULE_TYPE');
  });

  it('errors when module does not exist (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test"
version = "0.0.1"

[channels.slack]
enabled = true
`
    );

    const capture = captureJsonOutput();
    await removeCommand('channel', 'discord', { json: true, force: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('MODULE_NOT_FOUND');
  });

  it('supports dry-run mode without modifying the file (JSON mode)', async () => {
    const configContent = `
[nachos]
name = "test"
version = "0.0.1"

[channels.slack]
enabled = true
mode = "socket"
`;
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, configContent);

    const capture = captureJsonOutput();
    await removeCommand('channel', 'slack', { json: true, dryRun: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.dry_run).toBe(true);
    expect(output.data.section).toBe('[channels.slack]');

    // Verify file was NOT modified
    const content = readFileSync(process.env.NACHOS_CONFIG_PATH!, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };
    expect(config.channels!.slack).toBeDefined();
  });
});
