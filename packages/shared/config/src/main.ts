/**
 * Main Configuration Loading
 *
 * Convenience function that combines loading, overlay, and validation
 */

import type { NachosConfig } from './schema.js';
import { loadConfig } from './loader.js';
import { applyEnvOverlay } from './env.js';
import { validateConfigOrThrow } from './validation.js';

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Custom path to nachos.toml (optional) */
  configPath?: string;
  /** Whether to apply environment variable overlays (default: true) */
  applyEnv?: boolean;
  /** Whether to validate the configuration (default: true) */
  validate?: boolean;
}

/**
 * Load, overlay, and validate configuration in one call
 *
 * This is the recommended way to load Nachos configuration.
 *
 * @param options Configuration loading options
 * @returns Validated and merged configuration
 * @throws ConfigLoadError if loading fails
 * @throws ConfigValidationError if validation fails
 */
export function loadAndValidateConfig(options: LoadConfigOptions = {}): NachosConfig {
  const { configPath, applyEnv = true, validate = true } = options;

  // Load base configuration from TOML file
  let config = loadConfig(configPath);

  // Apply environment variable overlays
  if (applyEnv) {
    config = applyEnvOverlay(config);
  }

  // Validate configuration
  if (validate) {
    validateConfigOrThrow(config);
  }

  return config;
}
