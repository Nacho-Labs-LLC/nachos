/**
 * nachos add channel command
 * Guided channel setup with idempotent config writes
 */

import { readFileSync, writeFileSync } from 'node:fs';
import prompts from 'prompts';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { getVersion } from '../../cli.js';
import { CLIError } from '../../core/errors.js';
import { isInteractive } from '../../core/prompt.js';

export interface AddChannelOptions {
  json?: boolean;
  enabled?: boolean;
  mode?: string;
  port?: string;
}

const VALID_CHANNELS = ['webchat', 'slack', 'discord', 'telegram', 'whatsapp'] as const;

type ChannelName = (typeof VALID_CHANNELS)[number];

const isValidChannel = (value: string): value is ChannelName =>
  (VALID_CHANNELS as readonly string[]).includes(value);

type TomlConfig = TOML.JsonMap & {
  channels?: TOML.JsonMap;
};

/**
 * Channel-specific env var requirements
 */
const CHANNEL_ENV_VARS: Record<
  ChannelName,
  { required: string[]; optional?: string[]; notes?: string }
> = {
  slack: {
    required: ['SLACK_BOT_TOKEN'],
    optional: ['SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET', 'NACHOS_PAIRING_TOKEN'],
    notes: 'Socket Mode needs SLACK_APP_TOKEN. HTTP mode needs SLACK_SIGNING_SECRET.',
  },
  discord: {
    required: ['DISCORD_BOT_TOKEN'],
    optional: ['NACHOS_PAIRING_TOKEN'],
  },
  telegram: {
    required: ['TELEGRAM_BOT_TOKEN'],
    optional: ['NACHOS_PAIRING_TOKEN'],
    notes: 'Get your bot token from @BotFather on Telegram.',
  },
  whatsapp: {
    required: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    optional: ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'NACHOS_PAIRING_TOKEN'],
  },
  webchat: {
    required: [],
  },
};

/**
 * Build channel config from interactive prompts
 */
async function promptChannelConfig(name: ChannelName): Promise<TOML.JsonMap> {
  const config: TOML.JsonMap = { enabled: true };

  switch (name) {
    case 'slack': {
      const response = await prompts({
        type: 'select',
        name: 'mode',
        message: 'Slack connection mode:',
        choices: [
          { title: 'Socket Mode (recommended)', value: 'socket' },
          { title: 'HTTP Events API', value: 'http' },
        ],
        initial: 0,
      });
      config.mode = response.mode ?? 'socket';
      break;
    }

    case 'webchat': {
      const response = await prompts({
        type: 'number',
        name: 'port',
        message: 'Webchat port:',
        initial: 8080,
      });
      config.port = response.port ?? 8080;
      break;
    }

    // Discord, Telegram, WhatsApp: no channel-specific prompts needed
    default:
      break;
  }

  return config;
}

/**
 * Build channel config from CLI flags (non-interactive / agent mode)
 */
function buildConfigFromFlags(name: ChannelName, options: AddChannelOptions): TOML.JsonMap {
  const enabled = options.enabled !== false;
  const config: TOML.JsonMap = { enabled };

  switch (name) {
    case 'slack':
      config.mode = options.mode ?? 'socket';
      break;
    case 'webchat':
      config.port = options.port ? parseInt(options.port, 10) : 8080;
      break;
    default:
      break;
  }

  return config;
}

/**
 * Print env var setup guidance
 */
function printEnvGuidance(name: ChannelName): void {
  const vars = CHANNEL_ENV_VARS[name];
  if (!vars.required.length && !vars.optional?.length) return;

  prettyOutput.blank();
  prettyOutput.header('Environment variables:');

  if (vars.required.length) {
    prettyOutput.indent('Required (add to .env):');
    for (const v of vars.required) {
      prettyOutput.indent(`  ${v}=`, 2);
    }
  }

  if (vars.optional?.length) {
    prettyOutput.indent('Optional:');
    for (const v of vars.optional) {
      prettyOutput.indent(`  ${v}`, 2);
    }
  }

  if (vars.notes) {
    prettyOutput.blank();
    prettyOutput.info(vars.notes);
  }
}

export async function addChannelCommand(name: string, options: AddChannelOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'add channel', getVersion());

  const configPath = findConfigFileOrThrow();

  try {
    // Validate channel name
    if (!isValidChannel(name)) {
      throw new CLIError(
        `Unknown channel: ${name}`,
        'UNKNOWN_CHANNEL',
        1,
        `Valid channels: ${VALID_CHANNELS.join(', ')}`
      );
    }

    const configContent = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(configContent) as TomlConfig;

    // Initialize channels section
    const channels: TOML.JsonMap = {};
    if (config.channels && typeof config.channels === 'object') {
      Object.assign(channels, config.channels as TOML.JsonMap);
    }

    const isUpdate = !!channels[name];

    // Build channel config: interactive or flag-based
    let channelConfig: TOML.JsonMap;

    if (isInteractive() && !options.json) {
      if (!options.json) {
        prettyOutput.brandedHeader(`${isUpdate ? 'Update' : 'Add'} ${name} channel`);
        prettyOutput.blank();
      }

      channelConfig = await promptChannelConfig(name as ChannelName);
    } else {
      channelConfig = buildConfigFromFlags(name as ChannelName, options);
    }

    // Idempotent merge: if channel exists, merge new values over existing
    if (isUpdate) {
      const existing = channels[name] as TOML.JsonMap;
      channels[name] = { ...existing, ...channelConfig };
    } else {
      channels[name] = channelConfig;
    }

    config.channels = channels as TOML.JsonMap;

    // Write back to file
    const newContent = TOML.stringify(config as TOML.JsonMap);
    writeFileSync(configPath, newContent, 'utf-8');

    // Display results
    if (options.json) {
      output.success({
        channel: name,
        action: isUpdate ? 'updated' : 'added',
        config_path: configPath,
        config: channelConfig,
      });
    } else {
      prettyOutput.blank();
      prettyOutput.success(`${isUpdate ? 'Updated' : 'Added'} ${name} channel configuration`);

      printEnvGuidance(name as ChannelName);

      prettyOutput.blank();
      prettyOutput.header('Next steps:');
      prettyOutput.indent('1. Add required secrets to .env');
      prettyOutput.indent('2. Run "nachos restart" to apply');
      prettyOutput.blank();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('TOML')) {
      output.error(
        new CLIError(
          'Invalid TOML in configuration file',
          'INVALID_TOML',
          2,
          `Fix syntax errors in ${configPath}`
        )
      );
    } else {
      output.error(error as Error);
    }
  }
}
