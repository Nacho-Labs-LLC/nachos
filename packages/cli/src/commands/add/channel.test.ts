import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { addChannelCommand } from './channel.js';

describe('addChannelCommand', () => {
  const originalEnv = process.env.NACHOS_CONFIG_PATH;
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'nachos-cli-'));
    configPath = path.join(tempDir, 'nachos.toml');
    writeFileSync(
      configPath,
      `[nachos]
name = "test"
version = "0.0.1"
`,
      'utf-8'
    );
    process.env.NACHOS_CONFIG_PATH = configPath;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds a slack channel with default socket mode', async () => {
    await addChannelCommand('slack', { json: true });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    expect(config.channels).toBeDefined();
    const slack = config.channels!.slack as Record<string, unknown>;
    expect(slack.enabled).toBe(true);
    expect(slack.mode).toBe('socket');
  });

  it('adds a discord channel', async () => {
    await addChannelCommand('discord', { json: true });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    expect(config.channels).toBeDefined();
    const discord = config.channels!.discord as Record<string, unknown>;
    expect(discord.enabled).toBe(true);
  });

  it('adds a telegram channel', async () => {
    await addChannelCommand('telegram', { json: true });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    expect(config.channels).toBeDefined();
    const telegram = config.channels!.telegram as Record<string, unknown>;
    expect(telegram.enabled).toBe(true);
  });

  it('adds a whatsapp channel', async () => {
    await addChannelCommand('whatsapp', { json: true });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    expect(config.channels).toBeDefined();
    const whatsapp = config.channels!.whatsapp as Record<string, unknown>;
    expect(whatsapp.enabled).toBe(true);
  });

  it('adds a webchat channel with default port', async () => {
    await addChannelCommand('webchat', { json: true });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    expect(config.channels).toBeDefined();
    const webchat = config.channels!.webchat as Record<string, unknown>;
    expect(webchat.enabled).toBe(true);
    expect(webchat.port).toBe(8080);
  });

  it('adds a webchat channel with custom port via flag', async () => {
    await addChannelCommand('webchat', { json: true, port: '9090' });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    const webchat = config.channels!.webchat as Record<string, unknown>;
    expect(webchat.port).toBe(9090);
  });

  it('adds a slack channel with HTTP mode via flag', async () => {
    await addChannelCommand('slack', { json: true, mode: 'http' });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    const slack = config.channels!.slack as Record<string, unknown>;
    expect(slack.mode).toBe('http');
  });

  it('updates an existing channel (idempotent merge)', async () => {
    // First add
    await addChannelCommand('slack', { json: true, mode: 'socket' });

    // Update
    await addChannelCommand('slack', { json: true, mode: 'http' });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    const slack = config.channels!.slack as Record<string, unknown>;
    expect(slack.mode).toBe('http');
    expect(slack.enabled).toBe(true);
  });

  it('rejects an unknown channel name (JSON mode)', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });

    await addChannelCommand('invalid-channel', { json: true });

    spy.mockRestore();
    mockExit.mockRestore();

    const raw = logs.join('\n').trim();
    const output = JSON.parse(raw);
    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('UNKNOWN_CHANNEL');
  });

  it('can add a channel as disabled via flag', async () => {
    await addChannelCommand('discord', { json: true, enabled: false });

    const content = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as { channels?: Record<string, unknown> };

    const discord = config.channels!.discord as Record<string, unknown>;
    expect(discord.enabled).toBe(false);
  });
});
