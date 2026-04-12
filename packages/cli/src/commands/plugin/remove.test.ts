import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as TOML from '@iarna/toml';

vi.mock('../../core/prompt.js', () => ({
  confirmPrompt: vi.fn().mockResolvedValue(true),
  isInteractive: () => false,
}));

import { pluginRemoveCommand } from './remove.js';

function writeConfig(dir: string, content: string): string {
  const configPath = join(dir, 'nachos.toml');
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

describe('pluginRemoveCommand', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-plugin-rm-'));
    originalConfigPath = process.env.NACHOS_CONFIG_PATH;
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    // Re-ensure the mock always resolves true (in case a previous test changed it)
    const { confirmPrompt } = await import('../../core/prompt.js');
    vi.mocked(confirmPrompt).mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalConfigPath === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalConfigPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
    mockExit.mockRestore();
    vi.restoreAllMocks();
  });

  it('removes a plugin and its channel config', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[plugins.my-plugin]
source = "path"
path = "./my-plugin"

[channels.my-plugin]
enabled = true
`
    );

    const out = captureJsonOutput();
    await pluginRemoveCommand('my-plugin', { json: true, force: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.plugin_name).toBe('my-plugin');
    expect(result.data.config_removed).toBe('[channels.my-plugin]');

    // Verify nachos.toml was cleaned up
    const config = TOML.parse(readFileSync(join(tempDir, 'nachos.toml'), 'utf-8'));
    expect(config.plugins).toBeDefined();
    expect((config.plugins as Record<string, unknown>)['my-plugin']).toBeUndefined();
    expect((config.channels as Record<string, unknown>)?.['my-plugin']).toBeUndefined();
  });

  it('preserves config with --keep-config', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[plugins.keep-me]
source = "path"
path = "./keep-me"

[tools.keep-me]
enabled = true
some_setting = "value"
`
    );

    const out = captureJsonOutput();
    await pluginRemoveCommand('keep-me', { json: true, force: true, keepConfig: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.config_removed).toBeNull();

    // Plugin entry removed, but tools.keep-me preserved
    const config = TOML.parse(readFileSync(join(tempDir, 'nachos.toml'), 'utf-8'));
    expect((config.plugins as Record<string, unknown>)['keep-me']).toBeUndefined();
    expect((config.tools as Record<string, unknown>)['keep-me']).toBeDefined();
  });

  it('errors when plugin does not exist', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[channels]\n`);

    const out = captureJsonOutput();
    await pluginRemoveCommand('nonexistent', { json: true, force: true });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MODULE_NOT_FOUND');
  });

  it('dry run does not modify nachos.toml', async () => {
    const configPath = writeConfig(
      tempDir,
      `
[plugins.dry-test]
source = "path"
path = "./dry-test"

[channels.dry-test]
enabled = true
`
    );
    process.env.NACHOS_CONFIG_PATH = configPath;
    const originalContent = readFileSync(configPath, 'utf-8');

    const out = captureJsonOutput();
    await pluginRemoveCommand('dry-test', { json: true, dryRun: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);

    // Config should be unchanged
    expect(readFileSync(configPath, 'utf-8')).toBe(originalContent);
  });
});
