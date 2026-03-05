import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as TOML from '@iarna/toml';

vi.mock('../../core/prompt.js', () => ({
  confirmPrompt: vi.fn().mockResolvedValue(false),
  isInteractive: () => false,
}));

vi.mock('prompts', () => ({
  default: vi.fn().mockResolvedValue({}),
}));

import { setupTokenCommand } from './setup-token.js';

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
    /** Parse just the first JSON object from captured output (handles multi-output cases) */
    parseFirst() {
      spy.mockRestore();
      // Each log entry is a separate JSON.stringify call
      for (const line of logs) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          try {
            return JSON.parse(trimmed);
          } catch {
            continue;
          }
        }
      }
      return null;
    },
  };
}

// Generate a valid-looking token (prefix + enough characters)
const VALID_TOKEN = 'sk-ant-oat01-' + 'a'.repeat(80);

describe('setupTokenCommand', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-setup-token-'));
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

  it('creates a new profile in nachos.toml', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[llm]\n`);

    const out = captureJsonOutput();
    await setupTokenCommand({ json: true, token: VALID_TOKEN, append: true });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.profile).toBe('anthropic-subscription');
    expect(result.data.action).toBe('created');
    expect(result.data.env_var).toBe('ANTHROPIC_SETUP_TOKEN');

    // Verify TOML was updated
    const config = TOML.parse(readFileSync(join(tempDir, 'nachos.toml'), 'utf-8')) as Record<
      string,
      unknown
    >;
    const llm = config.llm as Record<string, unknown>;
    expect(llm.profiles).toBeDefined();
    const profiles = llm.profiles as Array<Record<string, unknown>>;
    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe('anthropic-subscription');
    expect(profiles[0].provider).toBe('anthropic');
  });

  it('updates existing profile', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[llm]
profile_order = ["anthropic-subscription"]

[[llm.profiles]]
name = "anthropic-subscription"
provider = "anthropic"
api_key_env = "OLD_VAR"
`
    );

    const out = captureJsonOutput();
    await setupTokenCommand({
      json: true,
      token: VALID_TOKEN,
      env: 'ANTHROPIC_SETUP_TOKEN',
      append: true,
    });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.action).toBe('updated');

    const config = TOML.parse(readFileSync(join(tempDir, 'nachos.toml'), 'utf-8')) as Record<
      string,
      unknown
    >;
    const llm = config.llm as Record<string, unknown>;
    const profiles = llm.profiles as Array<Record<string, unknown>>;
    expect(profiles[0].api_key_env).toBe('ANTHROPIC_SETUP_TOKEN');
  });

  it('uses custom profile name and env var', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[llm]\n`);

    const out = captureJsonOutput();
    await setupTokenCommand({
      json: true,
      token: VALID_TOKEN,
      profile: 'my-profile',
      env: 'MY_TOKEN_VAR',
      append: true,
    });
    const result = out.parse();

    expect(result.ok).toBe(true);
    expect(result.data.profile).toBe('my-profile');
    expect(result.data.env_var).toBe('MY_TOKEN_VAR');
  });

  it('rejects invalid token prefix', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[llm]\n`);

    const out = captureJsonOutput();
    await setupTokenCommand({ json: true, token: 'sk-bad-prefix-' + 'a'.repeat(80) });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_SETUP_TOKEN');
  });

  it('rejects too-short token', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[llm]\n`);

    const out = captureJsonOutput();
    await setupTokenCommand({ json: true, token: 'sk-ant-oat01-short' });
    const result = out.parse();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_SETUP_TOKEN');
  });

  it('writes token to .env with --write-env', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[llm]\n`);

    const out = captureJsonOutput();
    await setupTokenCommand({
      json: true,
      token: VALID_TOKEN,
      writeEnv: true,
      append: true,
    });
    out.parse();

    const envPath = join(tempDir, '.env');
    expect(existsSync(envPath)).toBe(true);
    const envContent = readFileSync(envPath, 'utf-8');
    expect(envContent).toContain(`ANTHROPIC_SETUP_TOKEN=${VALID_TOKEN}`);
  });

  it('rejects unsupported provider', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir, `[llm]\n`);

    const out = captureJsonOutput();
    await setupTokenCommand({ json: true, token: VALID_TOKEN, provider: 'openai' });
    const result = out.parseFirst();

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('UNSUPPORTED_PROVIDER');
  });
});
