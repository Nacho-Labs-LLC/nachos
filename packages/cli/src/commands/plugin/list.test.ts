import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../core/prompt.js', () => ({
  confirmPrompt: vi.fn().mockResolvedValue(true),
  isInteractive: () => false,
}));

import { pluginListCommand } from './list.js';

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

describe('pluginListCommand', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-plugin-list-'));
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

  it('returns empty list when no plugins registered', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[channels]\n`);

    const out = captureJsonOutput();
    await pluginListCommand({ json: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.plugins).toEqual([]);
    expect(result.data.count).toBe(0);
  });

  it('lists registered plugins with correct fields', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[plugins.my-channel]
source = "path"
path = "./plugins/my-channel"

[channels.my-channel]
enabled = true
`
    );

    const out = captureJsonOutput();
    await pluginListCommand({ json: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(1);
    expect(result.data.plugins[0]).toMatchObject({
      name: 'my-channel',
      source: 'path',
      enabled: true,
      type: 'channel',
    });
  });

  it('lists multiple plugins', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[plugins.plug-a]
source = "path"
path = "./a"

[plugins.plug-b]
source = "npm"
package = "@nachos/plug-b"
version = "^1.0.0"

[channels.plug-a]
enabled = false

[tools.plug-b]
enabled = true
`
    );

    const out = captureJsonOutput();
    await pluginListCommand({ json: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(2);

    const names = result.data.plugins.map((p: { name: string }) => p.name);
    expect(names).toContain('plug-a');
    expect(names).toContain('plug-b');

    const plugB = result.data.plugins.find((p: { name: string }) => p.name === 'plug-b');
    expect(plugB.source).toBe('npm');
    expect(plugB.enabled).toBe(true);
    expect(plugB.type).toBe('tool');
  });

  it('shows disabled status for plugins without enabled flag', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[plugins.my-tool]
source = "path"
path = "./my-tool"

[tools.my-tool]
some_config = "value"
`
    );

    const out = captureJsonOutput();
    await pluginListCommand({ json: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.plugins[0].enabled).toBe(false);
  });
});
