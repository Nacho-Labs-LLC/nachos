/**
 * Environment variable health checks
 */

import { loadTomlFile } from '@nachos/config';
import { findConfigFile } from '../../../core/config-discovery.js';
import type { DoctorCheck } from '../types.js';

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

    if (provider === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) {
        missing.push('ANTHROPIC_API_KEY');
      }
    }

    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        missing.push('OPENAI_API_KEY');
      }
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
