/**
 * nachos add channel command
 * Add a channel configuration stub to nachos.toml
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';

interface AddChannelOptions {
  json?: boolean;
}

const VALID_CHANNELS = ['webchat', 'slack', 'discord', 'telegram', 'whatsapp'];

// Channel configuration stubs (as objects)
const CHANNEL_STUBS: Record<string, any> = {
  webchat: {
    enabled: false,
    port: 8080,
  },
  slack: {
    enabled: false,
    mode: 'socket', // or 'http'
    // bot_token: set in .env as SLACK_BOT_TOKEN
    // app_token: set in .env as SLACK_APP_TOKEN (for socket mode)
    // signing_secret: set in .env as SLACK_SIGNING_SECRET (for http mode)
  },
  discord: {
    enabled: false,
    // token: set in .env as DISCORD_BOT_TOKEN
  },
  telegram: {
    enabled: false,
    // token: set in .env as TELEGRAM_BOT_TOKEN
  },
  whatsapp: {
    enabled: false,
    // token, phone_number_id, etc. - set in .env
  },
};

export async function addChannelCommand(
  name: string,
  options: AddChannelOptions,
): Promise<void> {
  const output = new OutputFormatter(
    options.json ?? false,
    'add channel',
    getVersion(),
  );

  // Find config file first (needs to be in scope for error handler)
  const configPath = findConfigFileOrThrow();

  try {
    // Validate channel name
    if (!VALID_CHANNELS.includes(name)) {
      throw new CLIError(
        `Unknown channel: ${name}`,
        'UNKNOWN_CHANNEL',
        1,
        `Valid channels: ${VALID_CHANNELS.join(', ')}`,
      );
    }
    const configContent = readFileSync(configPath, 'utf-8');

    // Parse TOML
    const config = TOML.parse(configContent) as any;

    // Check if channel already exists
    if (config.channels && config.channels[name]) {
      throw new CLIError(
        `Channel ${name} is already configured`,
        'CHANNEL_EXISTS',
        1,
        `Edit the existing [channels.${name}] section in ${configPath}`,
      );
    }

    // Add channel stub
    if (!config.channels) {
      config.channels = {};
    }
    config.channels[name] = CHANNEL_STUBS[name];

    // Write back to file
    const newContent = TOML.stringify(config);
    writeFileSync(configPath, newContent, 'utf-8');

    // Display results
    if (options.json) {
      output.success({
        channel: name,
        config_path: configPath,
      });
    } else {
      prettyOutput.success(`Added ${name} channel configuration`);
      prettyOutput.blank();
      prettyOutput.info('Next steps:');
      prettyOutput.indent(`1. Edit ${configPath}`);
      prettyOutput.indent(`2. Set enabled = true`);
      prettyOutput.indent(`3. Configure channel-specific settings`);
      prettyOutput.indent('4. Add required secrets to .env');
      prettyOutput.indent('5. Run "nachos restart"');
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
          `Fix syntax errors in ${configPath}, or use --force to overwrite`,
        ),
      );
    } else {
      output.error(error as Error);
    }
  }
}
