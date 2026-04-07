import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as TOML from '@iarna/toml';

vi.mock('../../core/prompt.js', () => ({
  confirmPrompt: vi.fn().mockResolvedValue(true),
  isInteractive: () => false,
}));

import { pluginAddCommand } from './add.js';

function writeConfig(dir: string, content: string): string {
  const configPath = join(dir, 'nachos.toml');
  writeFileSync(configPath, content.trim() + '\n', 'utf-8');
  return configPath;
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, 'nachos-plugin.json'), JSON.stringify(manifest), 'utf-8');
}

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'my-plugin',
    version: '1.0.0',
    type: 'channel',
    capabilities: {},
    provides: { channel: 'my-plugin' },
    entry: { dockerfile: 'Dockerfile', context: '.' },
    ...overrides,
  };
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

describe('pluginAddCommand', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-plugin-add-'));
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
    vi.restoreAllMocks();
  });

  it('adds a path-source plugin to nachos.toml (JSON mode)', async () => {
    const pluginDir = join(tempDir, 'my-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeManifest(pluginDir, validManifest());
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[channels]\n`);

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path' });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.plugin_name).toBe('my-plugin');
    expect(result.data.source_type).toBe('path');

    // Verify nachos.toml was updated
    const config = TOML.parse(readFileSync(join(tempDir, 'nachos.toml'), 'utf-8'));
    expect(config.plugins).toBeDefined();
    expect((config.plugins as Record<string, unknown>)['my-plugin']).toBeDefined();
  });

  it('dry run does not modify nachos.toml', async () => {
    const pluginDir = join(tempDir, 'dry-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeManifest(
      pluginDir,
      validManifest({ name: 'dry-plugin', provides: { channel: 'dry-plugin' } })
    );
    const configPath = writeConfig(tempDir, `[channels]\n`);
    process.env.NACHOS_CONFIG_PATH = configPath;
    const originalContent = readFileSync(configPath, 'utf-8');

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path', dryRun: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.dry_run).toBe(true);

    // Config should be unchanged
    expect(readFileSync(configPath, 'utf-8')).toBe(originalContent);
  });

  it('rejects duplicate plugin names', async () => {
    const pluginDir = join(tempDir, 'dup-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeManifest(
      pluginDir,
      validManifest({ name: 'dup-plugin', provides: { channel: 'dup-plugin' } })
    );
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `[plugins.dup-plugin]\nsource = "path"\npath = "./dup-plugin"\n\n[channels]\n`
    );

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path', name: 'dup-plugin' });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PLUGIN_DUPLICATE');
  });

  it('rejects built-in channel names', async () => {
    const pluginDir = join(tempDir, 'slack-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeManifest(
      pluginDir,
      validManifest({ name: 'slack-plugin', provides: { channel: 'slack' } })
    );
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[channels]\n`);

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path' });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PLUGIN_NAME_CONFLICT');
  });

  it('rejects invalid plugin manifest', async () => {
    const pluginDir = join(tempDir, 'bad-plugin');
    mkdirSync(pluginDir, { recursive: true });
    // Missing required fields
    writeManifest(pluginDir, { name: 'bad-plugin' });
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[channels]\n`);

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path' });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PLUGIN_MANIFEST_INVALID');
  });

  it('rejects missing manifest file', async () => {
    const pluginDir = join(tempDir, 'no-manifest');
    mkdirSync(pluginDir, { recursive: true });
    // No nachos-plugin.json
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[channels]\n`);

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path' });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('PLUGIN_MANIFEST_NOT_FOUND');
  });

  it('adds a tool-type plugin correctly', async () => {
    const pluginDir = join(tempDir, 'my-tool');
    mkdirSync(pluginDir, { recursive: true });
    writeManifest(
      pluginDir,
      validManifest({
        name: 'my-tool',
        type: 'tool',
        provides: { tool: 'my-tool' },
      })
    );
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[tools]\n`);

    const out = captureJsonOutput();
    await pluginAddCommand(pluginDir, { json: true, sourceType: 'path' });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.manifest.type).toBe('tool');

    const config = TOML.parse(readFileSync(join(tempDir, 'nachos.toml'), 'utf-8'));
    expect((config.tools as Record<string, unknown>)['my-tool']).toBeDefined();
  });
});
