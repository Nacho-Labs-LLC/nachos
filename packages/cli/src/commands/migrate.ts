/**
 * nachos migrate command
 * Import file-based identity (SOUL.md, AGENTS.md, USER.md, IDENTITY.md, TOOLS.md)
 * into the bootstrap and identity stores, bypassing the interactive bootstrap flow.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadAndValidateConfig } from '@nachos/config';
import type { BootstrapProfile, IdentityProfile } from '@nachos/types';
import type { StateOperationContext } from '@nachos/state';
import { createStateLayerFromConfig } from '../core/state-layer.js';
import { findConfigFileOrThrow } from '../core/config-discovery.js';
import { CLIError } from '../core/errors.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';

// Mapping of source filenames to bootstrap block keys
const FILE_TO_BLOCK: Record<string, string> = {
  'SOUL.md': 'soul',
  'AGENTS.md': 'agents',
  'USER.md': 'user',
  'IDENTITY.md': 'identity',
  'TOOLS.md': 'tools',
};

interface MigrateCommandOptions {
  json?: boolean;
  from?: string;
  agentId?: string;
  dryRun?: boolean;
  force?: boolean;
  sessionId?: string;
}

interface BlockResult {
  file: string;
  block: string;
  status: 'imported' | 'skipped';
  reason?: string;
}

export async function migrateCommand(options: MigrateCommandOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'migrate', getVersion());

  try {
    const fromDir = resolve(ensureValue(options.from, 'from'));
    const agentId = ensureValue(options.agentId, 'agent-id');

    if (!existsSync(fromDir)) {
      throw new CLIError(
        `Source directory does not exist: ${fromDir}`,
        'INVALID_PATH',
        1,
        'Use --from <dir> to specify a directory containing SOUL.md, IDENTITY.md, USER.md, etc.'
      );
    }

    // Read all source files, skipping missing ones
    const blocks: Record<string, string> = {};
    const results: BlockResult[] = [];

    for (const [filename, blockKey] of Object.entries(FILE_TO_BLOCK)) {
      const filePath = join(fromDir, filename);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content.length === 0) {
          results.push({
            file: filename,
            block: blockKey,
            status: 'skipped',
            reason: 'empty file',
          });
        } else {
          blocks[blockKey] = content;
          results.push({ file: filename, block: blockKey, status: 'imported' });
        }
      } else {
        results.push({
          file: filename,
          block: blockKey,
          status: 'skipped',
          reason: 'file not found',
        });
      }
    }

    const importedBlocks = results.filter((r) => r.status === 'imported');

    if (importedBlocks.length === 0) {
      if (options.json) {
        output.success({ agentId, dryRun: options.dryRun ?? false, results, blocksWritten: 0 });
        return;
      }
      prettyOutput.brandedHeader('Nachos Migrate');
      prettyOutput.warn('No source files found in: ' + fromDir);
      prettyOutput.blank();
      printResults(results);
      return;
    }

    if (options.dryRun) {
      if (options.json) {
        output.success({
          agentId,
          dryRun: true,
          results,
          blocksWritten: 0,
          note: 'Dry run — no changes written',
        });
        return;
      }
      prettyOutput.brandedHeader('Nachos Migrate (Dry Run)');
      prettyOutput.keyValue('Agent', agentId);
      prettyOutput.keyValue('Source', fromDir);
      prettyOutput.blank();
      printResults(results);
      prettyOutput.blank();
      prettyOutput.warn('Dry run — no changes written. Remove --dry-run to apply.');
      prettyOutput.blank();
      return;
    }

    // Connect to state layer
    const configPath = findConfigFileOrThrow();
    const config = loadAndValidateConfig({ configPath });
    const stateLayer = createStateLayerFromConfig(config);
    const context = buildContext(config.security?.mode, options);

    try {
      // Check if identity is already completed
      const existing = await stateLayer.getIdentity(agentId, context);
      if (existing?.identityCompleted && !options.force) {
        throw new CLIError(
          `Agent "${agentId}" already has a completed identity`,
          'IDENTITY_EXISTS',
          1,
          'Use --force to overwrite the existing identity.'
        );
      }

      const now = new Date().toISOString();

      // Build and write bootstrap profile
      const bootstrapProfile: BootstrapProfile = {
        agentId,
        content: blocks,
        updatedAt: now,
        version: 1,
        source: 'filesystem',
      };

      await stateLayer.putBootstrap(bootstrapProfile, context);

      // Build and write identity profile (mark completed)
      const identityProfile: IdentityProfile = {
        agentId,
        soul: (blocks['soul'] ?? existing?.soul ?? '').trim(),
        identity: (blocks['identity'] ?? existing?.identity ?? '').trim(),
        userProfile: (blocks['user'] ?? existing?.userProfile ?? '').trim(),
        toolsNotes: blocks['tools'] ?? existing?.toolsNotes,
        updatedAt: now,
        version: existing?.version ? existing.version + 1 : 1,
        source: 'filesystem',
        identityCompleted: true,
        identityCompletedAt: now,
      };

      // Validate: putIdentity requires non-empty soul + identity when marking completed
      if (!identityProfile.soul || !identityProfile.identity) {
        const missing: string[] = [];
        if (!identityProfile.soul) missing.push('SOUL.md');
        if (!identityProfile.identity) missing.push('IDENTITY.md');
        throw new CLIError(
          `Cannot complete identity — missing required files: ${missing.join(', ')}`,
          'MISSING_REQUIRED_FILES',
          1,
          'Provide SOUL.md and IDENTITY.md in the --from directory to complete identity setup. ' +
            'Or remove these files from the source directory to import a partial bootstrap only ' +
            '(identity will not be marked as completed).'
        );
      }

      await stateLayer.putIdentity(identityProfile, context);

      if (options.json) {
        output.success({
          agentId,
          dryRun: false,
          results,
          blocksWritten: importedBlocks.length,
          identityCompleted: true,
        });
        return;
      }

      prettyOutput.brandedHeader('Nachos Migrate');
      prettyOutput.keyValue('Agent', agentId);
      prettyOutput.keyValue('Source', fromDir);
      prettyOutput.blank();
      printResults(results);
      prettyOutput.blank();
      prettyOutput.success(
        `Migrated ${importedBlocks.length} block(s). Identity marked as completed — bootstrap flow will be skipped on next boot.`
      );
      prettyOutput.blank();
    } finally {
      await stateLayer.close();
    }
  } catch (error) {
    output.error(error as Error);
  }
}

function printResults(results: BlockResult[]): void {
  for (const r of results) {
    if (r.status === 'imported') {
      prettyOutput.keyValue(`  ✓ ${r.file}`, `→ block: ${r.block}`);
    } else {
      prettyOutput.keyValue(`  - ${r.file}`, `skipped (${r.reason})`);
    }
  }
}

function ensureValue(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new CLIError(`Missing required --${label}`, 'MISSING_ARGUMENT', 2);
  }
  return value;
}

function buildContext(
  securityMode: StateOperationContext['securityMode'] | undefined,
  options: MigrateCommandOptions
): StateOperationContext {
  return {
    sessionId: options.sessionId ?? 'cli',
    securityMode: securityMode ?? 'standard',
    channel: 'cli',
    internalTool: true,
  };
}
