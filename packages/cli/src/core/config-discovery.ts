/**
 * Enhanced config discovery for CLI
 * Adds directory tree walking and NACHOS_CONFIG_PATH support
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigNotFoundError } from './errors.js';

/**
 * Get all config search paths in order of precedence
 */
export function getConfigSearchPaths(): string[] {
  const paths: string[] = [];

  // 1. Explicit override via environment variable (highest priority)
  if (process.env.NACHOS_CONFIG_PATH) {
    paths.push(path.resolve(process.env.NACHOS_CONFIG_PATH));
  }

  // 2. Current directory
  paths.push(path.join(process.cwd(), 'nachos.toml'));

  // 3. Walk up directory tree (like .git discovery)
  let current = process.cwd();
  const root = path.parse(current).root;

  // Skip current directory since we already added it
  current = path.dirname(current);

  while (current !== root) {
    paths.push(path.join(current, 'nachos.toml'));
    current = path.dirname(current);
  }

  // 4. Home directory fallback
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    paths.push(path.join(homeDir, '.nachos', 'nachos.toml'));
  }

  return paths;
}

/**
 * Find nachos.toml configuration file
 *
 * Search order:
 * 1. NACHOS_CONFIG_PATH environment variable
 * 2. Current directory
 * 3. Parent directories (walking up the tree)
 * 4. ~/.nachos/nachos.toml
 *
 * @returns Path to config file, or null if not found
 */
export function findConfigFile(): string | null {
  const searchPaths = getConfigSearchPaths();

  for (const configPath of searchPaths) {
    if (fs.existsSync(configPath)) {
      return path.resolve(configPath);
    }
  }

  return null;
}

/**
 * Find nachos.toml or throw ConfigNotFoundError
 *
 * @returns Absolute path to config file
 * @throws ConfigNotFoundError if no config file is found
 */
export function findConfigFileOrThrow(): string {
  const configPath = findConfigFile();

  if (!configPath) {
    const searchedPaths = getConfigSearchPaths();
    throw new ConfigNotFoundError(searchedPaths);
  }

  return configPath;
}

/**
 * Get project root directory (directory containing nachos.toml)
 *
 * @returns Project root directory path
 * @throws ConfigNotFoundError if no config file is found
 */
export function getProjectRoot(): string {
  const configPath = findConfigFileOrThrow();
  return path.dirname(configPath);
}
