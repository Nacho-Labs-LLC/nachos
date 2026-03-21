import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkEnvVars } from './env.js';

type EnvSnapshot = Record<string, string | undefined>;

const REQUIRED_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_SETUP_TOKEN',
  'CLAUDE_SETUP_TOKEN',
  'OPENAI_API_KEY',
] as const;

function snapshotEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of REQUIRED_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const key of REQUIRED_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function buildSetupToken(): string {
  return `sk-ant-oat01-${'x'.repeat(80)}`;
}

function writeConfig(baseDir: string, content: string): string {
  const configPath = join(baseDir, 'nachos.toml');
  writeFileSync(configPath, content.trim() + '\n', 'utf-8');
  return configPath;
}

describe('checkEnvVars', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-cli-'));
    originalConfigPath = process.env.NACHOS_CONFIG_PATH;
    envSnapshot = snapshotEnv();
    for (const key of REQUIRED_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    if (originalConfigPath === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalConfigPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails when no Anthropic credentials are provided', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "cli-test"
version = "0.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"
`
    );

    const result = await checkEnvVars();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('ANTHROPIC_API_KEY');
    expect(result.message).toContain('ANTHROPIC_SETUP_TOKEN');
  });

  it('passes when a valid setup-token is present', async () => {
    process.env.ANTHROPIC_SETUP_TOKEN = buildSetupToken();
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "cli-test"
version = "0.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"
`
    );

    const result = await checkEnvVars();
    expect(result.status).toBe('pass');
  });

  it('fails when profiles are configured but none are set', async () => {
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "cli-test"
version = "0.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"

[[llm.profiles]]
name = "anthropic-primary"
provider = "anthropic"
api_key_env = "ANTHROPIC_SETUP_TOKEN"
`
    );

    const result = await checkEnvVars();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('ANTHROPIC_SETUP_TOKEN');
  });

  it('passes when a configured profile env var is set', async () => {
    process.env.ANTHROPIC_SETUP_TOKEN = buildSetupToken();
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "cli-test"
version = "0.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"

[[llm.profiles]]
name = "anthropic-primary"
provider = "anthropic"
api_key_env = "ANTHROPIC_SETUP_TOKEN"
`
    );

    const result = await checkEnvVars();
    expect(result.status).toBe('pass');
  });

  it('fails when only invalid setup-token is present', async () => {
    process.env.ANTHROPIC_SETUP_TOKEN = 'sk-ant-oat01-short';
    process.env.NACHOS_CONFIG_PATH = writeConfig(
      tempDir,
      `
[nachos]
name = "cli-test"
version = "0.0.0"

[llm]
provider = "anthropic"
model = "claude-sonnet-4"
`
    );

    const result = await checkEnvVars();
    expect(result.status).toBe('fail');
    expect(result.message).toContain('Invalid setup-token');
  });
});
