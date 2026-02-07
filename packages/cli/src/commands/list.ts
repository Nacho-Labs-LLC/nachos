/**
 * nachos list command
 * List configured modules
 */

import chalk from 'chalk';
import { loadTomlFile } from '@nachos/config';
import { findConfigFileOrThrow } from '../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../core/output.js';
import { getVersion } from '../cli.js';
import type { ModuleListItem } from '../core/types.js';

interface ListOptions {
  json?: boolean;
}

function isEnabled(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const enabled = (value as { enabled?: unknown }).enabled;
  return enabled === true;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'list', getVersion());

  try {
    // Find and load config
    const configPath = findConfigFileOrThrow();
    const config = loadTomlFile(configPath);

    // Build module list
    const modules: ModuleListItem[] = [];

    // Channels
    if (config.channels) {
      for (const [name, channelConfig] of Object.entries(config.channels)) {
        if (typeof channelConfig === 'object' && channelConfig !== null) {
          modules.push({
            name,
            type: 'channel',
            enabled: isEnabled(channelConfig),
            configured: true,
          });
        }
      }
    }

    // Tools
    if (config.tools) {
      for (const [name, toolConfig] of Object.entries(config.tools)) {
        if (typeof toolConfig === 'object' && toolConfig !== null) {
          modules.push({
            name,
            type: 'tool',
            enabled: isEnabled(toolConfig),
            configured: true,
          });
        }
      }
    }

    // Skills
    if (config.skills) {
      for (const [name, skillConfig] of Object.entries(config.skills)) {
        if (typeof skillConfig === 'object' && skillConfig !== null) {
          modules.push({
            name,
            type: 'skill',
            enabled: isEnabled(skillConfig),
            configured: true,
          });
        }
      }
    }

    // Display results
    if (options.json) {
      output.success({ modules });
    } else {
      prettyOutput.brandedHeader('Nachos Modules');
      prettyOutput.blank();

      // Group by type
      const channels = modules.filter((m) => m.type === 'channel');
      const tools = modules.filter((m) => m.type === 'tool');
      const skills = modules.filter((m) => m.type === 'skill');

      // Show channels
      if (channels.length > 0) {
        prettyOutput.header('Channels:');
        for (const module of channels) {
          const icon = module.enabled ? chalk.green('✓') : chalk.dim('✗');
          const status = module.enabled ? chalk.green('enabled') : chalk.dim('disabled');
          console.log(`  ${icon} ${chalk.cyan(module.name.padEnd(15))} ${status}`);
        }
        prettyOutput.blank();
      }

      // Show tools
      if (tools.length > 0) {
        prettyOutput.header('Tools:');
        for (const module of tools) {
          const icon = module.enabled ? chalk.green('✓') : chalk.dim('✗');
          const status = module.enabled ? chalk.green('enabled') : chalk.dim('disabled');
          console.log(`  ${icon} ${chalk.cyan(module.name.padEnd(15))} ${status}`);
        }
        prettyOutput.blank();
      }

      // Show skills
      if (skills.length > 0) {
        prettyOutput.header('Skills:');
        for (const module of skills) {
          const icon = module.enabled ? chalk.green('✓') : chalk.dim('✗');
          const status = module.enabled ? chalk.green('enabled') : chalk.dim('disabled');
          console.log(`  ${icon} ${chalk.cyan(module.name.padEnd(15))} ${status}`);
        }
        prettyOutput.blank();
      }

      if (modules.length === 0) {
        prettyOutput.warn('No modules configured');
        prettyOutput.blank();
        prettyOutput.info('Run "nachos add channel <name>" to add a channel');
        prettyOutput.info('Run "nachos add tool <name>" to add a tool');
        prettyOutput.blank();
      }
    }
  } catch (error) {
    output.error(error as Error);
  }
}
