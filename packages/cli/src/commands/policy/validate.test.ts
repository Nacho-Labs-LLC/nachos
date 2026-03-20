import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateCommand } from './validate.js';

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

describe('policy validate command', () => {
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

  it('validates valid policy files (JSON mode)', async () => {
    // Set up config and policies directory
    const configPath = join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '[nachos]\nname = "test"\nversion = "0.0.1"\n', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;

    const policiesDir = join(tempDir, 'policies');
    mkdirSync(policiesDir, { recursive: true });
    writeFileSync(
      join(policiesDir, 'standard.yaml'),
      'version: "1.0"\nrules:\n  - id: allow-read\n    priority: 100\n    match:\n      resource: tool\n      action: read\n    effect: allow\n',
      'utf-8'
    );

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.valid).toBe(true);
    expect(output.data.files).toHaveLength(1);
  });

  it('validates multiple policy files (JSON mode)', async () => {
    const configPath = join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '[nachos]\nname = "test"\nversion = "0.0.1"\n', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;

    const policiesDir = join(tempDir, 'policies');
    mkdirSync(policiesDir, { recursive: true });
    writeFileSync(
      join(policiesDir, 'standard.yaml'),
      'version: "1.0"\nrules:\n  - id: rule-a\n    priority: 100\n    match:\n      resource: tool\n      action: read\n    effect: allow\n',
      'utf-8'
    );
    writeFileSync(
      join(policiesDir, 'strict.yml'),
      'version: "1.0"\nrules:\n  - id: rule-b\n    priority: 90\n    match:\n      resource: tool\n      action: write\n    effect: deny\n',
      'utf-8'
    );

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(true);
    expect(output.data.files).toHaveLength(2);
  });

  it('errors when policies directory does not exist (JSON mode)', async () => {
    const configPath = join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '[nachos]\nname = "test"\nversion = "0.0.1"\n', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;

    // No policies directory created

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('POLICIES_DIR_NOT_FOUND');
    expect(mockExit).toHaveBeenCalled();
  });

  it('errors when no policy files exist (JSON mode)', async () => {
    const configPath = join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '[nachos]\nname = "test"\nversion = "0.0.1"\n', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;

    const policiesDir = join(tempDir, 'policies');
    mkdirSync(policiesDir, { recursive: true });
    // Create a non-YAML file that should be ignored
    writeFileSync(join(policiesDir, 'readme.txt'), 'not a policy', 'utf-8');

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('NO_POLICY_FILES');
    expect(mockExit).toHaveBeenCalled();
  });

  it('reports invalid YAML in policy files (JSON mode)', async () => {
    const configPath = join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '[nachos]\nname = "test"\nversion = "0.0.1"\n', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;

    const policiesDir = join(tempDir, 'policies');
    mkdirSync(policiesDir, { recursive: true });
    writeFileSync(join(policiesDir, 'bad.yaml'), '  invalid:\n yaml: [\n  broken', 'utf-8');

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('POLICY_VALIDATION_FAILED');
    expect(mockExit).toHaveBeenCalled();
  });

  it('reports invalid policy rule structure (JSON mode)', async () => {
    const configPath = join(tempDir, 'nachos.toml');
    writeFileSync(configPath, '[nachos]\nname = "test"\nversion = "0.0.1"\n', 'utf-8');
    process.env.NACHOS_CONFIG_PATH = configPath;

    const policiesDir = join(tempDir, 'policies');
    mkdirSync(policiesDir, { recursive: true });
    writeFileSync(
      join(policiesDir, 'invalid-structure.yaml'),
      'version: "1.0"\nrules:\n  - priority: high\n    effect: maybe\n',
      'utf-8'
    );

    const capture = captureJsonOutput();
    await validateCommand({ json: true });
    const output = capture.parse();

    expect(output.ok).toBe(false);
    expect(output.error.code).toBe('POLICY_VALIDATION_FAILED');
    expect(output.error.message).toContain('failed validation');
  });
});
