/**
 * Environment variable health checks
 */

import { loadTomlFile } from '@nachos/config';
import { findConfigFile } from '../../../core/config-discovery.js';
import type { DoctorCheck } from '../types.js';

const ANTHROPIC_SETUP_TOKEN_PREFIX = 'sk-ant-oat01-';
const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;

function validateAnthropicSetupToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Expected token starting with ${ANTHROPIC_SETUP_TOKEN_PREFIX}`;
  }
  if (trimmed.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return 'Token looks too short; paste the full setup-token';
  }
  return undefined;
}

function resolveRequiredKeys(provider: string | undefined, config: ReturnType<typeof loadTomlFile>) {
  const profiles = config.llm?.profiles ?? [];
  const profileKeys = profiles
    .filter((profile) => profile.provider === provider)
    .map((profile) => profile.api_key_env)
    .filter((env): env is string => Boolean(env && env.trim()));

  const uniqueProfileKeys = Array.from(new Set(profileKeys));
  if (uniqueProfileKeys.length > 0) {
    return uniqueProfileKeys;
  }

  if (provider === 'anthropic') {
    return ['ANTHROPIC_API_KEY', 'ANTHROPIC_SETUP_TOKEN', 'CLAUDE_SETUP_TOKEN'];
  }

  if (provider === 'openai') {
    return ['OPENAI_API_KEY'];
  }

  return [];
}

function isLikelySetupToken(key: string, value: string): boolean {
  return key.includes('SETUP_TOKEN') || value.trim().startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX);
}

/**
 * Check if required environment variables are present
 */
export async function checkEnvVars(): Promise<DoctorCheck> {
  const configPath = findConfigFile();

  if (!configPath) {
    return {
      id: 'env-vars',
      name: 'Environment',
      status: 'warn',
      message: 'No config file found, cannot check environment variables',
    };
  }

  try {
    const config = loadTomlFile(configPath);
    const missing: string[] = [];
    const warnings: string[] = [];

    // Check LLM provider API keys
    const provider = config.llm?.provider;
    const requiredKeys = resolveRequiredKeys(provider, config);
    const presentKeys = requiredKeys.filter((key) => process.env[key]?.trim());
    const invalidSetupTokens: string[] = [];

    for (const key of presentKeys) {
      const value = process.env[key]?.trim() ?? '';
      if (!value) {
        continue;
      }
      if (provider === 'anthropic' && isLikelySetupToken(key, value)) {
        const error = validateAnthropicSetupToken(value);
        if (error) {
          invalidSetupTokens.push(key);
        }
      }
    }

    const validKeys = presentKeys.filter((key) => !invalidSetupTokens.includes(key));
    if (requiredKeys.length > 0 && validKeys.length === 0) {
      const invalidNote =
        invalidSetupTokens.length > 0
          ? ` Invalid setup-token: ${invalidSetupTokens.join(', ')}`
          : '';
      missing.push(`${requiredKeys.join(', ')}${invalidNote}`);
    } else if (invalidSetupTokens.length > 0) {
      warnings.push(`Invalid setup-token: ${invalidSetupTokens.join(', ')}`);
    }

    // Check channel-specific env vars
    if (config.channels?.slack?.enabled) {
      if (!process.env.SLACK_BOT_TOKEN && !config.channels.slack.bot_token) {
        warnings.push('SLACK_BOT_TOKEN');
      }
    }

    if (config.channels?.discord?.enabled) {
      if (!process.env.DISCORD_BOT_TOKEN && !config.channels.discord.token) {
        warnings.push('DISCORD_BOT_TOKEN');
      }
    }

    if (config.channels?.telegram?.enabled) {
      if (!process.env.TELEGRAM_BOT_TOKEN && !config.channels.telegram.token) {
        warnings.push('TELEGRAM_BOT_TOKEN');
      }
    }

    if (missing.length > 0) {
      return {
        id: 'env-vars',
        name: 'Environment',
        status: 'fail',
        message: `Missing required: ${missing.join(', ')}`,
        suggestion: 'Add to .env file or set as environment variables',
      };
    }

    if (warnings.length > 0) {
      return {
        id: 'env-vars',
        name: 'Environment',
        status: 'warn',
        message: `Missing optional: ${warnings.join(', ')}`,
        suggestion: 'Some channels may not work without these variables',
      };
    }

    return {
      id: 'env-vars',
      name: 'Environment',
      status: 'pass',
      message: 'All required environment variables present',
    };
  } catch (error) {
    return {
      id: 'env-vars',
      name: 'Environment',
      status: 'warn',
      message: `Could not check: ${(error as Error).message}`,
    };
  }
}
