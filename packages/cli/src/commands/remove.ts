/**
 * nachos remove command
 * Remove a module from configuration
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';
import { CLIError } from '../core/errors.js';
import { confirmPrompt } from '../core/prompt.js';

interface RemoveOptions {
  json?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

export async function removeCommand(
  type: string,
  name: string,
  options: RemoveOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'remove', getVersion());

  // Find config file first (needs to be in scope for error handler)
  const configPath = findConfigFileOrThrow();

  try {
    // Validate type
    if (!['channel', 'tool', 'skill'].includes(type)) {
      throw new CLIError(
        `Invalid module type: ${type}`,
        'INVALID_MODULE_TYPE',
        1,
        'Valid types: channel, tool, skill'
      );
    }
    const configContent = readFileSync(configPath, 'utf-8');

    // Parse TOML
    const config = TOML.parse(configContent) as Record<string, unknown>;

    // Determine section name
    const section = `${type}s`; // channels, tools, skills

    // Check if module exists
    const sectionValue = config[section];
    if (!sectionValue || typeof sectionValue !== 'object' || !(name in sectionValue)) {
      throw new CLIError(
        `${type} "${name}" not found in configuration`,
        'MODULE_NOT_FOUND',
        1,
        `No [${section}.${name}] section exists in ${configPath}`
      );
    }

    // Dry run: show what would be removed without changing anything
    if (options.dryRun) {
      const moduleSection = sectionValue as Record<string, unknown>;
      if (options.json) {
        output.success({
          dry_run: true,
          type,
          name,
          config_path: configPath,
          section: `[${section}.${name}]`,
          would_remove: moduleSection[name],
        });
      } else {
        prettyOutput.info(`Would remove [${section}.${name}] from ${configPath}`);
        prettyOutput.blank();
      }
      return;
    }

    // Confirm removal
    const confirmed = await confirmPrompt({
      message: `Remove ${type} "${name}" from configuration?`,
      force: options.force,
      json: options.json,
    });
    if (!confirmed) {
      prettyOutput.info('Cancelled');
      return;
    }

    // Remove module
    const moduleSection = sectionValue as Record<string, unknown>;
    delete moduleSection[name];
    config[section] = moduleSection;

    // Write back to file
    const newContent = TOML.stringify(config as TOML.JsonMap);
    writeFileSync(configPath, newContent, 'utf-8');

    // Display results
    if (options.json) {
      output.success({
        type,
        name,
        config_path: configPath,
      });
    } else {
      prettyOutput.success(`Removed ${type} "${name}"`);
      prettyOutput.blank();
      prettyOutput.info('Run "nachos restart" to apply changes');
      prettyOutput.blank();
    }
  } catch (error) {
    // Handle TOML parse errors specifically
    if (error instanceof Error && error.message.includes('TOML')) {
      output.error(
        new CLIError(
          'Invalid TOML in configuration file',
          'INVALID_TOML',
          2,
          `Fix syntax errors in ${configPath} before removing modules`
        )
      );
    } else {
      output.error(error as Error);
    }
  }
}
