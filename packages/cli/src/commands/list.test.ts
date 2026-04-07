import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listCommand } from './list.js';

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

describe('listCommand', () => {
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

  it('lists channels, tools, and skills (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test"
version = "0.0.1"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"

[security]
mode = "standard"

[channels.slack]
enabled = true
mode = "socket"

[channels.discord]
enabled = false

[tools.filesystem]
enabled = true

[skills.goplaces]
enabled = true
`
    );

    const capture = captureJsonOutput();
    await listCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.modules).toHaveLength(4);

    const slack = output.data.modules.find((m: { name: string }) => m.name === 'slack');
    expect(slack).toBeDefined();
    expect(slack.type).toBe('channel');
    expect(slack.enabled).toBe(true);

    const discord = output.data.modules.find((m: { name: string }) => m.name === 'discord');
    expect(discord).toBeDefined();
    expect(discord.enabled).toBe(false);

    const filesystem = output.data.modules.find((m: { name: string }) => m.name === 'filesystem');
    expect(filesystem).toBeDefined();
    expect(filesystem.type).toBe('tool');

    const goplaces = output.data.modules.find((m: { name: string }) => m.name === 'goplaces');
    expect(goplaces).toBeDefined();
    expect(goplaces.type).toBe('skill');
  });

  it('returns empty module list when none are configured (JSON mode)', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "test"
version = "0.0.1"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"

[security]
mode = "standard"
`
    );

    const capture = captureJsonOutput();
    await listCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.modules).toHaveLength(0);
  });

  it('errors when config file is not found (JSON mode)', async () => {
    // Point to nonexistent file AND change CWD to temp dir so the
    // parent-directory walk won't find the repo's nachos.toml
    process.env.NACHOS_CONFIG_PATH = join(tempDir, 'nonexistent.toml');
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    const capture = captureJsonOutput();
    await listCommand({ json: true });
    const output = capture.parse();

    process.chdir(originalCwd);

    expect(output.ok).toBe(false);
    expect(mockExit).toHaveBeenCalled();
  });
});
