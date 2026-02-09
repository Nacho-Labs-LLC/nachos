/**
 * nachos auth setup-token command
 * Configure Anthropic setup-token auth profile
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import prompts from 'prompts';
import * as TOML from '@iarna/toml';
import { findConfigFileOrThrow } from '../../core/config-discovery.js';
import { OutputFormatter, prettyOutput } from '../../core/output.js';
import { CLIError } from '../../core/errors.js';
import { confirmPrompt, isInteractive } from '../../core/prompt.js';
import { getVersion } from '../../cli.js';

type SetupTokenOptions = {
  json?: boolean;
  provider?: string;
  profile?: string;
  env?: string;
  token?: string;
  append?: boolean;
  writeEnv?: boolean;
};

type TomlConfig = TOML.JsonMap & {
  llm?: TOML.JsonMap & {
    profiles?: TOML.JsonArray;
    profile_order?: TOML.JsonArray;
  };
};

const DEFAULT_PROFILE = 'anthropic-subscription';
const DEFAULT_ENV_VAR = 'ANTHROPIC_SETUP_TOKEN';
const ANTHROPIC_SETUP_TOKEN_PREFIX = 'sk-ant-oat01-';
const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;

function validateAnthropicSetupToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${ANTHROPIC_SETUP_TOKEN_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return 'Token looks too short; paste the full setup-token';
  }
  return undefined;
}

function normalizeProvider(raw?: string): string {
  const trimmed = raw?.trim().toLowerCase() ?? '';
  return trimmed || 'anthropic';
}

function normalizeProfileName(raw?: string): string {
  const trimmed = raw?.trim() ?? '';
  return trimmed || DEFAULT_PROFILE;
}

function normalizeEnvVar(raw?: string): string {
  const trimmed = raw?.trim() ?? '';
  return trimmed || DEFAULT_ENV_VAR;
}

function upsertProfile(
  config: TomlConfig,
  profileName: string,
  envVar: string
): { updated: boolean } {
  const llm = (config.llm ?? {}) as TomlConfig['llm'];
  const profiles = (llm?.profiles ?? []) as TOML.JsonArray;

  let updated = false;
  const nextProfiles = profiles.map((profile) => {
    if (typeof profile !== 'object' || profile === null) {
      return profile;
    }
    const record = profile as TOML.JsonMap;
    if (record.name === profileName) {
      updated = true;
      return {
        ...record,
        provider: 'anthropic',
        api_key_env: envVar,
      } as TOML.JsonMap;
    }
    return record;
  });

  if (!updated) {
    nextProfiles.push({
      name: profileName,
      provider: 'anthropic',
      api_key_env: envVar,
    } as TOML.JsonMap);
  }

  llm.profiles = nextProfiles as TOML.JsonArray;
  config.llm = llm;
  return { updated };
}

function updateProfileOrder(
  config: TomlConfig,
  profileName: string,
  append: boolean
): void {
  const llm = (config.llm ?? {}) as TomlConfig['llm'];
  const order = (llm?.profile_order ?? []) as TOML.JsonArray;
  const names = order.filter((item) => typeof item === 'string') as string[];

  const filtered = names.filter((name) => name !== profileName);
  if (append) {
    filtered.push(profileName);
  } else {
    filtered.unshift(profileName);
  }

  llm.profile_order = filtered as TOML.JsonArray;
  config.llm = llm;
}

function resolveEnvFile(configPath: string): string {
  return join(dirname(configPath), '.env');
}

function writeEnvVar(envPath: string, key: string, value: string): void {
  const nextLine = `${key}=${value}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, nextLine + '\n', 'utf-8');
    return;
  }

  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (!line || line.trim().startsWith('#')) {
      return line;
    }
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    nextLines.push(nextLine);
  }

  writeFileSync(envPath, nextLines.join('\n').replace(/\n+$/, '\n'), 'utf-8');
}

export async function setupTokenCommand(options: SetupTokenOptions): Promise<void> {
  const output = new OutputFormatter(options.json ?? false, 'auth setup-token', getVersion());
  const provider = normalizeProvider(options.provider);

  if (provider !== 'anthropic') {
    output.error(new CLIError('Only anthropic is supported for setup-token', 'UNSUPPORTED_PROVIDER'));
  }

  const configPath = findConfigFileOrThrow();

  try {
    const configContent = readFileSync(configPath, 'utf-8');
    const config = TOML.parse(configContent) as TomlConfig;

    const profileName = normalizeProfileName(options.profile);
    const envVar = normalizeEnvVar(options.env);

    let token = options.token?.trim();
    if (!token) {
      if (!isInteractive() || options.json) {
        throw new CLIError(
          'setup-token requires --token in non-interactive mode',
          'INPUT_REQUIRED',
          1,
          'Run in a TTY or pass --token <value>.'
        );
      }

      const response = await prompts({
        type: 'password',
        name: 'token',
        message: 'Paste Anthropic setup-token',
        validate: (value: string) => validateAnthropicSetupToken(value) ?? true,
      });
      token = String(response.token ?? '').trim();
    }

    const validationError = token ? validateAnthropicSetupToken(token) : 'Required';
    if (validationError) {
      throw new CLIError(validationError, 'INVALID_SETUP_TOKEN', 1);
    }

    const { updated } = upsertProfile(config, profileName, envVar);

    let append = Boolean(options.append);
    if (isInteractive() && !options.json && !options.append) {
      const shouldPrepend = await confirmPrompt({
        message: 'Make this profile the first choice?',
        defaultValue: true,
      });
      append = !shouldPrepend;
    }

    updateProfileOrder(config, profileName, append);

    const nextContent = TOML.stringify(config as TOML.JsonMap);
    writeFileSync(configPath, nextContent, 'utf-8');

    const envPath = resolveEnvFile(configPath);
    const canWriteEnv = Boolean(options.writeEnv);

    if (canWriteEnv) {
      writeEnvVar(envPath, envVar, token);
    } else if (isInteractive() && !options.json) {
      const confirmWrite = await confirmPrompt({
        message: `Write ${envVar} to ${envPath}?`,
        defaultValue: false,
      });
      if (confirmWrite) {
        writeEnvVar(envPath, envVar, token);
      }
    }

    if (options.json) {
      output.success({
        provider,
        profile: profileName,
        env_var: envVar,
        action: updated ? 'updated' : 'created',
        config_path: configPath,
      });
      return;
    }

    prettyOutput.brandedHeader('Anthropic setup-token configured');
    prettyOutput.blank();
    prettyOutput.keyValue('Profile', profileName);
    prettyOutput.keyValue('Env var', envVar);
    prettyOutput.keyValue('Config', configPath);
    prettyOutput.blank();

    if (!canWriteEnv) {
      prettyOutput.header('Next steps:');
      prettyOutput.indent(`1. Set ${envVar} in ${envPath} or your environment`);
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
