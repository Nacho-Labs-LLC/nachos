/**
 * Main Configuration Loading
 *
 * Convenience function that combines loading, overlay, and validation
 */

import type { NachosConfig } from './schema.js';
import { loadConfig } from './loader.js';
import { applyEnvOverlay } from './env.js';
import { applyRuntimeOverlay } from './runtime-overlay.js';
import { validateConfigOrThrow } from './validation.js';

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Custom path to nachos.toml (optional) */
  configPath?: string;
  /** Whether to apply environment variable overlays (default: true) */
  applyEnv?: boolean;
  /** Whether to apply runtime state overlays (default: true) */
  applyRuntime?: boolean;
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
  const { configPath, applyEnv = true, applyRuntime = true, validate = true } = options;

  // Load base configuration from TOML file
  let config = loadConfig(configPath);

  // Apply environment variable overlays
  if (applyEnv) {
    config = applyEnvOverlay(config);
  }

  // Apply runtime state overlays
  if (applyRuntime) {
    config = applyRuntimeOverlay(config);
  }

  // Validate configuration
  if (validate) {
    validateConfigOrThrow(config);
  }

  return config;
}
