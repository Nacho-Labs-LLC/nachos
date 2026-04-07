/**
 * nachos plugin remove command
 * Remove a registered plugin from nachos.toml
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';
import { confirmPrompt } from '../../core/prompt.js';

export interface PluginRemoveOptions {
  json?: boolean;
  force?: boolean;
  keepConfig?: boolean;
  dryRun?: boolean;
}

type TomlConfig = TOML.JsonMap & {
  plugins?: TOML.JsonMap;
  channels?: TOML.JsonMap;
  tools?: TOML.JsonMap;
};

export async function pluginRemoveCommand(
  name: string,
  options: PluginRemoveOptions
): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'plugin remove', getVersion());

  const configPath = findConfigFileOrThrow();

  try {
    // Read and parse nachos.toml
    const configContent = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(configContent) as TomlConfig;

    // Check if plugin exists
    if (!config.plugins || typeof config.plugins !== 'object' || !(name in config.plugins)) {
      throw new CLIError(
        `Plugin "${name}" is not registered`,
        'MODULE_NOT_FOUND',
        1,
        `No [plugins.${name}] section exists in ${configPath}.\nRun "nachos plugin list" to see registered plugins.`
      );
    }

    const plugins = config.plugins as TOML.JsonMap;
    const pluginEntry = plugins[name] as TOML.JsonMap;
    const sourceType = pluginEntry?.source as string | undefined;

    // Determine which config section to remove (channels or tools)
    // We need to figure out the provider key. We check both sections.
    let configSection: string | undefined;
    let providerKey: string | undefined;

    // Check channels
    if (config.channels && typeof config.channels === 'object') {
      const channels = config.channels as TOML.JsonMap;
      if (name in channels) {
        configSection = 'channels';
        providerKey = name;
      }
    }

    // Check tools
    if (!configSection && config.tools && typeof config.tools === 'object') {
      const tools = config.tools as TOML.JsonMap;
      if (name in tools) {
        configSection = 'tools';
        providerKey = name;
      }
    }

    // Dry run
    if (options.dryRun) {
      const result: Record<string, unknown> = {
        dry_run: true,
        plugin_name: name,
        source_type: sourceType,
        config_path: configPath,
        would_remove_plugin: `[plugins.${name}]`,
      };

      if (configSection && providerKey && !options.keepConfig) {
        result.would_remove_config = `[${configSection}.${providerKey}]`;
      }

      if (options.json) {
        output.success(result);
      } else {
        prettyOutput.info(`Would remove [plugins.${name}] from ${configPath}`);
        if (configSection && providerKey && !options.keepConfig) {
          prettyOutput.info(`Would remove [${configSection}.${providerKey}] from ${configPath}`);
        }
        prettyOutput.blank();
      }
      return;
    }

    // Confirm removal
    const confirmed = await confirmPrompt({
      message: `Remove plugin "${name}" from configuration?`,
      force: options.force,
      json: options.json,
    });
    if (!confirmed) {
      prettyOutput.info('Cancelled');
      return;
    }

    // Remove the plugin entry
    delete plugins[name];
    config.plugins = plugins;

    // Remove the config section unless --keep-config
    if (configSection && providerKey && !options.keepConfig) {
      const section = config[configSection] as TOML.JsonMap;
      delete section[providerKey];
      config[configSection] = section;
    }

    // Write back to file
    const newContent = TOML.stringify(config as TOML.JsonMap);
    writeFileSync(configPath, newContent, 'utf-8');

    // Display results
    if (options.json) {
      output.success({
        plugin_name: name,
        source_type: sourceType,
        config_path: configPath,
        config_removed:
          configSection && providerKey && !options.keepConfig
            ? `[${configSection}.${providerKey}]`
            : null,
      });
    } else {
      prettyOutput.success(`Removed plugin "${name}"`);
      if (configSection && providerKey && !options.keepConfig) {
        prettyOutput.info(`Also removed [${configSection}.${providerKey}] configuration`);
      }
      if (options.keepConfig && configSection && providerKey) {
        prettyOutput.info(
          `Configuration [${configSection}.${providerKey}] was preserved (--keep-config)`
        );
      }
      prettyOutput.blank();
      prettyOutput.info('Run "nachos restart" to apply changes');
      prettyOutput.blank();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('TOML')) {
      output.error(
        new CLIError(
          'Invalid TOML in configuration file',
          'INVALID_TOML',
          2,
          `Fix syntax errors in ${configPath} before removing plugins`
        )
      );
    } else {
      output.error(error as Error);
    }
  }
}
