import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  userProfileDeleteCommand,
  userProfileGetCommand,
  userProfileSetCommand,
} from './user-profile.js';

function writeConfig(baseDir: string): string {
  const stateDir = join(baseDir, 'state');
  const configPath = join(baseDir, 'nachos.toml');
  const content = `
[nachos]
name = "cli-test"
version = "0.0.0"

[llm]
provider = "openai"
model = "gpt-4o"

[security]
mode = "standard"

[runtime]
state_dir = "${stateDir.replace(/\\/g, '/')}"

[runtime.state.identity]
provider = "filesystem"

[runtime.state.memory]
provider = "filesystem"

[runtime.state.user_profile]
provider = "filesystem"
`;

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

describe('user-profile CLI commands', () => {
  let tempDir: string;
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-cli-'));
    originalConfigPath = process.env.NACHOS_CONFIG_PATH;
    delete process.env.SECURITY_MODE;
    delete process.env.SECURITY_I_UNDERSTAND_THE_RISKS;
    process.env.NACHOS_CONFIG_PATH = writeConfig(tempDir);
  });

  afterEach(() => {
    if (originalConfigPath === undefined) {
      delete process.env.NACHOS_CONFIG_PATH;
    } else {
      process.env.NACHOS_CONFIG_PATH = originalConfigPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sets, gets, and deletes user profiles', async () => {
    const setCapture = captureJsonOutput();
    await userProfileSetCommand({
      json: true,
      agentId: 'agent-1',
      userId: 'user-1',
      profile: 'User prefers concise replies.',
    });
    const setOutput = setCapture.parse();
    expect(setOutput.ok).toBe(true);
    expect(setOutput.data.profile.version).toBe(1);

    const getCapture = captureJsonOutput();
    await userProfileGetCommand({
      json: true,
      agentId: 'agent-1',
      userId: 'user-1',
    });
    const getOutput = getCapture.parse();
    expect(getOutput.ok).toBe(true);
    expect(getOutput.data.profile.profile).toContain('concise');

    const deleteCapture = captureJsonOutput();
    await userProfileDeleteCommand({
      json: true,
      agentId: 'agent-1',
      userId: 'user-1',
    });
    const deleteOutput = deleteCapture.parse();
    expect(deleteOutput.ok).toBe(true);
    expect(deleteOutput.data.deleted).toBe(true);
  });
});
