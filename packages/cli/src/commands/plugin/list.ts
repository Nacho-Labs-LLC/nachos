/**
 * nachos plugin list command
 * List all registered plugins with their status
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow, getProjectRoot } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';

export interface PluginListOptions {
  json?: boolean;
}

type TomlConfig = TOML.JsonMap & {
  plugins?: TOML.JsonMap;
  channels?: TOML.JsonMap;
  tools?: TOML.JsonMap;
};

interface PluginListEntry {
  name: string;
  type: string;
  source: string;
  enabled: boolean;
  location: string;
}

/**
 * Determine the plugin type by reading its manifest, or by checking which
 * config section (channels/tools) has a matching key.
 */
function resolvePluginType(
  name: string,
  pluginEntry: TOML.JsonMap,
  config: TomlConfig,
  projectRoot: string
): string {
  // Check config sections for a matching key
  if (config.channels && typeof config.channels === 'object' && name in config.channels) {
    return 'channel';
  }
  if (config.tools && typeof config.tools === 'object' && name in config.tools) {
    return 'tool';
  }

  // Try reading manifest to determine type
  const sourceType = pluginEntry.source as string;
  let manifestPath: string | undefined;

  if (sourceType === 'path' && typeof pluginEntry.path === 'string') {
    manifestPath = join(resolve(projectRoot, pluginEntry.path), 'nachos-plugin.json');
  } else if (sourceType === 'npm' && typeof pluginEntry.package === 'string') {
    manifestPath = join(projectRoot, 'node_modules', pluginEntry.package, 'nachos-plugin.json');
  } else if (sourceType === 'image' && typeof pluginEntry.manifest === 'string') {
    manifestPath = resolve(projectRoot, pluginEntry.manifest);
  }

  if (manifestPath && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      if (manifest.type === 'channel' || manifest.type === 'tool') {
        return manifest.type;
      }
    } catch {
      // Ignore parse errors; return unknown
    }
  }

  return 'unknown';
}

/**
 * Build a display location string for the plugin source
 */
function getLocationDisplay(pluginEntry: TOML.JsonMap): string {
  const sourceType = pluginEntry.source as string;

  switch (sourceType) {
    case 'path':
      return String(pluginEntry.path ?? '');
    case 'npm': {
      const pkg = String(pluginEntry.package ?? '');
      const version = pluginEntry.version ? `@${String(pluginEntry.version)}` : '';
      return `${pkg}${version}`;
    }
    case 'image':
      return String(pluginEntry.image ?? '');
    default:
      return '';
  }
}

/**
 * Check if a plugin is enabled by looking at the corresponding config section
 */
function isPluginEnabled(name: string, config: TomlConfig): boolean {
  // Check channels
  if (config.channels && typeof config.channels === 'object') {
    const channelConfig = (config.channels as Record<string, unknown>)[name];
    if (channelConfig && typeof channelConfig === 'object') {
      return (channelConfig as Record<string, unknown>).enabled === true;
    }
  }

  // Check tools
  if (config.tools && typeof config.tools === 'object') {
    const toolConfig = (config.tools as Record<string, unknown>)[name];
    if (toolConfig && typeof toolConfig === 'object') {
      return (toolConfig as Record<string, unknown>).enabled === true;
    }
  }

  return false;
}

export async function pluginListCommand(options: PluginListOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'plugin list', getVersion());

  try {
    const configPath = findConfigFileOrThrow();
    const projectRoot = getProjectRoot();
    const configContent = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(configContent) as TomlConfig;

    // Gather plugin entries
    const entries: PluginListEntry[] = [];

    if (config.plugins && typeof config.plugins === 'object') {
      for (const [name, entry] of Object.entries(config.plugins)) {
        if (typeof entry !== 'object' || entry === null) continue;

        const pluginEntry = entry as TOML.JsonMap;
        const sourceType = String(pluginEntry.source ?? 'unknown');
        const type = resolvePluginType(name, pluginEntry, config, projectRoot);
        const enabled = isPluginEnabled(name, config);
        const location = getLocationDisplay(pluginEntry);

        entries.push({
          name,
          type,
          source: sourceType,
          enabled,
          location,
        });
      }
    }

    // Display results
    if (options.json) {
      output.success({
        plugins: entries,
        count: entries.length,
      });
    } else {
      prettyOutput.brandedHeader('Nachos Plugins');
      prettyOutput.blank();

      if (entries.length === 0) {
        prettyOutput.info('No plugins registered');
        prettyOutput.blank();
        prettyOutput.info('Run "nachos plugin add <source>" to register a plugin');
        prettyOutput.info('Example: nachos plugin add ../my-channel-plugin');
        prettyOutput.blank();
        return;
      }

      // Table header
      const nameWidth = Math.max(12, ...entries.map((e) => e.name.length)) + 2;
      const typeWidth = 10;
      const sourceWidth = 8;
      const statusWidth = 10;

      console.log(
        `  ${chalk.bold('Name'.padEnd(nameWidth))} ${chalk.bold('Type'.padEnd(typeWidth))} ${chalk.bold('Source'.padEnd(sourceWidth))} ${chalk.bold('Status'.padEnd(statusWidth))} ${chalk.bold('Location')}`
      );
      console.log(
        `  ${''.padEnd(nameWidth, '-')} ${''.padEnd(typeWidth, '-')} ${''.padEnd(sourceWidth, '-')} ${''.padEnd(statusWidth, '-')} ${''.padEnd(20, '-')}`
      );

      for (const entry of entries) {
        const icon = entry.enabled ? chalk.green('*') : chalk.dim('*');
        const status = entry.enabled ? chalk.green('enabled') : chalk.dim('disabled');
        const nameStr = chalk.cyan(entry.name.padEnd(nameWidth));
        const typeStr = entry.type.padEnd(typeWidth);
        const sourceStr = entry.source.padEnd(sourceWidth);

        console.log(
          `  ${icon} ${nameStr}${typeStr} ${sourceStr} ${status.padEnd(statusWidth + 10)} ${chalk.dim(entry.location)}`
        );
      }

      prettyOutput.blank();
    }
  } catch (error) {
    output.error(error as Error);
  }
}
