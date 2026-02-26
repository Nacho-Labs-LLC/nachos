/**
 * Configuration-related health checks
 */

import { loadTomlFile, validateConfig } from '@nachos/config';
import { findConfigFile } from '../../../core/config-discovery.js';
import type { DoctorCheck } from '../types.js';

/**
 * Check if nachos.toml exists
 */
export async function checkConfigExists(): Promise<DoctorCheck> {
  const configPath = findConfigFile();

  if (!configPath) {
    return {
      id: 'config-exists',
      name: 'Configuration',
      status: 'fail',
      message: 'No nachos.toml file found',
      suggestion: 'Run: nachos init',
    };
  }

  return {
    id: 'config-exists',
    name: 'Configuration',
    status: 'pass',
    message: `Found at ${configPath}`,
  };
}

/**
 * Check if nachos.toml is valid
 */
export async function checkConfigValid(): Promise<DoctorCheck> {
  const configPath = findConfigFile();

  if (!configPath) {
    // Config doesn't exist, skip validation check
    return {
      id: 'config-valid',
      name: 'Configuration Validation',
      status: 'fail',
      message: 'No config file to validate',
      suggestion: 'Run: nachos init',
    };
  }

  try {
    const config = loadTomlFile(configPath);
    const result = validateConfig(config);

    if (!result.valid) {
      return {
        id: 'config-valid',
        name: 'Configuration Validation',
        status: 'fail',
        message: `Validation failed: ${result.errors?.[0] ?? 'Unknown error'}`,
        suggestion: 'Run: nachos config validate',
      };
    }

    return {
      id: 'config-valid',
      name: 'Configuration Validation',
      status: 'pass',
      message: 'nachos.toml validates successfully',
    };
  } catch (error) {
    return {
      id: 'config-valid',
      name: 'Configuration Validation',
      status: 'fail',
      message: `Failed to load config: ${(error as Error).message}`,
      suggestion: 'Check nachos.toml for syntax errors',
    };
  }
}
