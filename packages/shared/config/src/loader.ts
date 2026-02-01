/**
 * TOML Configuration Loader
 *
 * Loads and parses nachos.toml configuration files
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as TOML from '@iarna/toml';
import type { NachosConfig } from './schema.js';

/**
 * Error thrown when configuration loading fails
 */
export class ConfigLoadError extends Error {
  public override readonly cause?: Error;
  
  constructor(
    message: string,
    cause?: Error,
  ) {
    super(message);
    this.name = 'ConfigLoadError';
    this.cause = cause;
  }
}

/**
 * Search paths for nachos.toml in order of precedence
 */
export function getConfigSearchPaths(): string[] {
  const paths: string[] = [];

  // 1. Current directory
  paths.push(path.join(process.cwd(), 'nachos.toml'));

  // 2. Home directory
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    paths.push(path.join(homeDir, '.nachos', 'nachos.toml'));
  }

  return paths;
}

/**
 * Find nachos.toml file in search paths
 */
export function findConfigFile(searchPaths?: string[]): string | null {
  const paths = searchPaths ?? getConfigSearchPaths();

  for (const configPath of paths) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * Load and parse TOML configuration from file
 */
export function loadTomlFile(filePath: string): NachosConfig {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseToml(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigLoadError(`Failed to load config from ${filePath}: ${error.message}`, error);
    }
    throw new ConfigLoadError(`Failed to load config from ${filePath}`);
  }
}

/**
 * Parse TOML string into configuration object
 */
export function parseToml(content: string): NachosConfig {
  try {
    const parsed = TOML.parse(content);
    return parsed as unknown as NachosConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new ConfigLoadError(`Failed to parse TOML: ${error.message}`, error);
    }
    throw new ConfigLoadError('Failed to parse TOML');
  }
}

/**
 * Load configuration from default locations
 *
 * @param customPath Optional custom path to nachos.toml
 * @returns Parsed configuration
 * @throws ConfigLoadError if no config file is found or parsing fails
 */
export function loadConfig(customPath?: string): NachosConfig {
  let configPath: string | null;

  if (customPath) {
    if (!fs.existsSync(customPath)) {
      throw new ConfigLoadError(`Configuration file not found: ${customPath}`);
    }
    configPath = customPath;
  } else {
    configPath = findConfigFile();
    if (!configPath) {
      throw new ConfigLoadError('No nachos.toml file found in search paths');
    }
  }

  return loadTomlFile(configPath);
}
