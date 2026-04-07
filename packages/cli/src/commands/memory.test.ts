import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  memoryAppendEntryCommand,
  memoryAppendFactCommand,
  memoryDeleteCommand,
  memoryQueryCommand,
} from './memory.js';

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

describe('memory CLI commands', () => {
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

  it('appends and queries memory entries and facts', async () => {
    const entryCapture = captureJsonOutput();
    await memoryAppendEntryCommand({
      json: true,
      agentId: 'agent-1',
      kind: 'fact',
      content: 'User prefers short responses.',
      tags: 'preference,style',
    });
    const entryOutput = entryCapture.parse();
    expect(entryOutput.ok).toBe(true);
    expect(entryOutput.data.entry.agentId).toBe('agent-1');

    const factCapture = captureJsonOutput();
    await memoryAppendFactCommand({
      json: true,
      agentId: 'agent-1',
      subject: 'user',
      predicate: 'likes',
      object: 'short answers',
    });
    const factOutput = factCapture.parse();
    expect(factOutput.ok).toBe(true);
    expect(factOutput.data.facts).toHaveLength(1);

    const queryCapture = captureJsonOutput();
    await memoryQueryCommand({
      json: true,
      agentId: 'agent-1',
      text: 'short',
    });
    const queryOutput = queryCapture.parse();
    expect(queryOutput.ok).toBe(true);
    expect(queryOutput.data.entries.length).toBe(1);
    expect(queryOutput.data.facts.length).toBe(1);

    const deleteCapture = captureJsonOutput();
    await memoryDeleteCommand({
      json: true,
      agentId: 'agent-1',
      id: entryOutput.data.entry.id,
    });
    const deleteOutput = deleteCapture.parse();
    expect(deleteOutput.ok).toBe(true);
    expect(deleteOutput.data.deleted).toBe(true);
  });
});
