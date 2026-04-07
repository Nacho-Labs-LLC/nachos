/**
 * Main Configuration Loading
 *
 * Convenience function that combines loading and validation.
 * Configuration lives in nachos.toml. Secrets (API keys) live in .env.
 */

import type { NachosConfig } from './schema.js';
import { loadConfig } from './loader.js';
import { validateConfigOrThrow } from './validation.js';
import { createLogger } from '@nachos/types';
import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

const logger = createLogger('config');

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Custom path to nachos.toml (optional) */
  configPath?: string;
  /** Whether to load a .env file into process.env (default: true) */
  applyDotenv?: boolean;
  /** Custom path to a .env file (optional) */
  envFilePath?: string;
  /** Whether to validate the configuration (default: true) */
  validate?: boolean;
}

/**
 * Load and validate configuration in one call
 *
 * This is the recommended way to load Nachos configuration.
 * All config lives in nachos.toml. The .env file is loaded to expose
 * secrets (API keys, bot tokens) into process.env for services that need them.
 *
 * @param options Configuration loading options
 * @returns Validated configuration
 * @throws ConfigLoadError if loading fails
 * @throws ConfigValidationError if validation fails
 */
export function loadAndValidateConfig(options: LoadConfigOptions = {}): NachosConfig {
  const { configPath, applyDotenv = true, envFilePath, validate = true } = options;

  if (applyDotenv) {
    const resolvedEnvPath =
      envFilePath ??
      process.env.NACHOS_ENV_PATH ??
      (configPath ? path.join(path.dirname(configPath), '.env') : path.join(process.cwd(), '.env'));
    if (fs.existsSync(resolvedEnvPath)) {
      dotenv.config({ path: resolvedEnvPath });
    } else if (envFilePath) {
      logger.warn({ path: resolvedEnvPath }, '.env file not found');
    }
  }

  const config = loadConfig(configPath);

  if (validate) {
    validateConfigOrThrow(config);
  }

  return config;
}
