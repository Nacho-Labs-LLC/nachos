/**
 * Tests for the nachos migrate command
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateCommand } from './migrate.js';

// Prevent process.exit from actually terminating the test runner
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as (code?: number | string | null) => never);

function writeNachosConfig(baseDir: string): string {
  const stateDir = join(baseDir, 'state');
  const configPath = join(baseDir, 'nachos.toml');
  const content = `
[nachos]
name = "migrate-test"
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

[runtime.state.bootstrap]
provider = "filesystem"
`;
  mkdirSync(stateDir, { recursive: true });
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

describe('migrate command', () => {
  let tempDir: string;
  let sourceDir: string;
  let originalCwd: string;
  let originalConfigPath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nachos-migrate-test-'));
    sourceDir = join(tempDir, 'workspace');
    mkdirSync(sourceDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tempDir);
    originalConfigPath = process.env['NACHOS_CONFIG_PATH'];
    const configPath = writeNachosConfig(tempDir);
    process.env['NACHOS_CONFIG_PATH'] = configPath;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalConfigPath === undefined) {
      delete process.env['NACHOS_CONFIG_PATH'];
    } else {
      process.env['NACHOS_CONFIG_PATH'] = originalConfigPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('happy path', () => {
    it('imports all five markdown files and marks identity completed', async () => {
      writeFileSync(join(sourceDir, 'SOUL.md'), '# Soul\nI am a helpful assistant.', 'utf-8');
      writeFileSync(join(sourceDir, 'IDENTITY.md'), '# Identity\nName: Claw', 'utf-8');
      writeFileSync(join(sourceDir, 'USER.md'), '# User\nName: nebula', 'utf-8');
      writeFileSync(join(sourceDir, 'AGENTS.md'), '# Agents\nGeneral overseer.', 'utf-8');
      writeFileSync(join(sourceDir, 'TOOLS.md'), '# Tools\nVarious tools.', 'utf-8');

      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      const result = out.parse();

      expect(result.ok).toBe(true);
      expect(result.data.agentId).toBe('claw');
      expect(result.data.identityCompleted).toBe(true);
      expect(result.data.blocksWritten).toBe(5);
      expect(result.data.dryRun).toBe(false);
    });

    it('skips missing files gracefully', async () => {
      writeFileSync(join(sourceDir, 'SOUL.md'), '# Soul\nI am a helpful assistant.', 'utf-8');
      writeFileSync(join(sourceDir, 'IDENTITY.md'), '# Identity\nName: Claw', 'utf-8');
      // USER.md, AGENTS.md, TOOLS.md intentionally missing

      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      const result = out.parse();

      expect(result.ok).toBe(true);
      expect(result.data.blocksWritten).toBe(2);

      const skipped = result.data.results.filter(
        (r: { status: string }) => r.status === 'skipped'
      );
      expect(skipped).toHaveLength(3);
      expect(skipped.every((r: { reason: string }) => r.reason === 'file not found')).toBe(true);
    });

    it('skips empty files gracefully', async () => {
      writeFileSync(join(sourceDir, 'SOUL.md'), '# Soul\nI am a helpful assistant.', 'utf-8');
      writeFileSync(join(sourceDir, 'IDENTITY.md'), '# Identity\nName: Claw', 'utf-8');
      writeFileSync(join(sourceDir, 'TOOLS.md'), '   ', 'utf-8'); // empty/whitespace

      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      const result = out.parse();

      expect(result.ok).toBe(true);
      const toolsResult = result.data.results.find(
        (r: { file: string }) => r.file === 'TOOLS.md'
      );
      expect(toolsResult.status).toBe('skipped');
      expect(toolsResult.reason).toBe('empty file');
    });
  });

  describe('dry-run', () => {
    it('previews without writing anything', async () => {
      writeFileSync(join(sourceDir, 'SOUL.md'), '# Soul\nTest.', 'utf-8');
      writeFileSync(join(sourceDir, 'IDENTITY.md'), '# Identity\nTest.', 'utf-8');

      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw', dryRun: true });
      const result = out.parse();

      expect(result.ok).toBe(true);
      expect(result.data.dryRun).toBe(true);
      expect(result.data.blocksWritten).toBe(0);
      expect(result.data.note).toMatch(/dry run/i);
    });
  });

  describe('--force flag', () => {
    it('overwrites a completed identity when --force is passed', async () => {
      writeFileSync(join(sourceDir, 'SOUL.md'), '# Soul\nOriginal.', 'utf-8');
      writeFileSync(join(sourceDir, 'IDENTITY.md'), '# Identity\nOriginal.', 'utf-8');

      // First migration
      const out1 = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      out1.parse();

      // Second migration without --force should fail
      writeFileSync(join(sourceDir, 'SOUL.md'), '# Soul\nUpdated.', 'utf-8');
      const out2 = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      const result2 = out2.parse();
      expect(result2.ok).toBe(false);
      expect(result2.error.message).toMatch(/completed/i);

      // With --force it should succeed
      const out3 = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw', force: true });
      const result3 = out3.parse();
      expect(result3.ok).toBe(true);
      expect(result3.data.identityCompleted).toBe(true);
    });
  });

  describe('validation', () => {
    it('fails when --from directory does not exist', async () => {
      const out = captureJsonOutput();
      await migrateCommand({
        json: true,
        from: '/nonexistent/path',
        agentId: 'claw',
      });
      const result = out.parse();
      expect(result.ok).toBe(false);
      expect(result.error.message).toMatch(/does not exist/i);
    });

    it('fails when SOUL.md and IDENTITY.md are missing (cannot complete identity)', async () => {
      // Only USER.md — not enough to mark identity completed
      writeFileSync(join(sourceDir, 'USER.md'), '# User\nNebula.', 'utf-8');

      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      const result = out.parse();
      expect(result.ok).toBe(false);
      expect(result.error.message).toMatch(/SOUL\.md/i);
    });

    it('fails with helpful message when --from is missing', async () => {
      const out = captureJsonOutput();
      await migrateCommand({ json: true, agentId: 'claw' });
      const result = out.parse();
      expect(result.ok).toBe(false);
      expect(result.error.message).toMatch(/--from/i);
    });

    it('fails with helpful message when --agent-id is missing', async () => {
      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir });
      const result = out.parse();
      expect(result.ok).toBe(false);
      expect(result.error.message).toMatch(/--agent-id/i);
    });

    it('returns gracefully when source directory has no recognizable files', async () => {
      // Write an unrelated file
      writeFileSync(join(sourceDir, 'README.md'), '# README', 'utf-8');

      const out = captureJsonOutput();
      await migrateCommand({ json: true, from: sourceDir, agentId: 'claw' });
      const result = out.parse();
      // Should succeed but with 0 blocks written (no identity completion attempted)
      expect(result.ok).toBe(true);
      expect(result.data.blocksWritten).toBe(0);
    });
  });
});
