/**
 * Environment Variable Overlay
 *
 * Allows environment variables to override TOML configuration values
 */

import type { NachosConfig, PartialNachosConfig } from './schema.js';

/**
 * Mapping of environment variables to configuration paths
 */
const ENV_VAR_MAPPINGS: Record<string, string> = {
  // Core settings
  NACHOS_NAME: 'nachos.name',
  NACHOS_VERSION: 'nachos.version',

  // LLM settings
  LLM_PROVIDER: 'llm.provider',
  LLM_MODEL: 'llm.model',
  LLM_FALLBACK_MODEL: 'llm.fallback_model',
  LLM_MAX_TOKENS: 'llm.max_tokens',
  LLM_TEMPERATURE: 'llm.temperature',
  LLM_BASE_URL: 'llm.base_url',

  // Security settings
  SECURITY_MODE: 'security.mode',
  SECURITY_DLP_ENABLED: 'security.dlp.enabled',
  SECURITY_DLP_ACTION: 'security.dlp.action',
  SECURITY_RATE_LIMIT_MESSAGES: 'security.rate_limits.messages_per_minute',
  SECURITY_RATE_LIMIT_TOOLS: 'security.rate_limits.tool_calls_per_minute',
  SECURITY_RATE_LIMIT_LLM: 'security.rate_limits.llm_requests_per_minute',
  SECURITY_AUDIT_ENABLED: 'security.audit.enabled',
  SECURITY_AUDIT_RETENTION_DAYS: 'security.audit.retention_days',

  // Runtime settings
  RUNTIME_STATE_DIR: 'runtime.state_dir',
  RUNTIME_LOG_LEVEL: 'runtime.log_level',
  RUNTIME_LOG_FORMAT: 'runtime.log_format',
  RUNTIME_MEMORY: 'runtime.resources.memory',
  RUNTIME_CPUS: 'runtime.resources.cpus',
  RUNTIME_PIDS_LIMIT: 'runtime.resources.pids_limit',

  // Assistant settings
  ASSISTANT_NAME: 'assistant.name',
  ASSISTANT_SYSTEM_PROMPT: 'assistant.system_prompt',

  // Channel settings
  CHANNEL_WEBCHAT_ENABLED: 'channels.webchat.enabled',
  CHANNEL_WEBCHAT_PORT: 'channels.webchat.port',
  CHANNEL_SLACK_ENABLED: 'channels.slack.enabled',
  CHANNEL_DISCORD_ENABLED: 'channels.discord.enabled',
  CHANNEL_DISCORD_DM_POLICY: 'channels.discord.dm_policy',
  CHANNEL_TELEGRAM_ENABLED: 'channels.telegram.enabled',
  CHANNEL_TELEGRAM_DM_POLICY: 'channels.telegram.dm_policy',

  // Tool settings
  TOOL_FILESYSTEM_ENABLED: 'tools.filesystem.enabled',
  TOOL_FILESYSTEM_WRITE: 'tools.filesystem.write',
  TOOL_BROWSER_ENABLED: 'tools.browser.enabled',
  TOOL_BROWSER_HEADLESS: 'tools.browser.headless',
  TOOL_BROWSER_TIMEOUT: 'tools.browser.timeout',
  TOOL_CODE_RUNNER_ENABLED: 'tools.code_runner.enabled',
  TOOL_CODE_RUNNER_RUNTIME: 'tools.code_runner.runtime',
  TOOL_CODE_RUNNER_TIMEOUT: 'tools.code_runner.timeout',
  TOOL_SHELL_ENABLED: 'tools.shell.enabled',
  TOOL_WEB_SEARCH_ENABLED: 'tools.web_search.enabled',
};

/**
 * Parse environment variable value to appropriate type
 */
function parseEnvValue(value: string, path: string): string | number | boolean | string[] {
  // Boolean values
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Number values (for specific paths)
  if (
    path.includes('port') ||
    path.includes('timeout') ||
    path.includes('max_tokens') ||
    path.includes('cpus') ||
    path.includes('pids_limit') ||
    path.includes('per_minute') ||
    path.includes('retention_days')
  ) {
    const num = Number(value);
    if (!isNaN(num)) return num;
  }

  // Float values (for temperature)
  if (path.includes('temperature')) {
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
  }

  // Array values (comma-separated)
  if (path.includes('allowed_users') || path.includes('languages') || path.includes('patterns')) {
    return value.split(',').map((v) => v.trim());
  }

  // String value
  return value;
}

/**
 * Check if a key is safe to use (not a prototype pollution vector)
 */
function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Set a nested property in an object using dot notation
 * Protected against prototype pollution
 */
function setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part || !isSafeKey(part)) continue;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart && isSafeKey(lastPart)) {
    current[lastPart] = value;
  }
}

/**
 * Create configuration overlay from environment variables
 */
export function createEnvOverlay(): PartialNachosConfig {
  const overlay: Record<string, unknown> = {};

  for (const [envVar, configPath] of Object.entries(ENV_VAR_MAPPINGS)) {
    const value = process.env[envVar];
    if (value !== undefined && value !== '') {
      const parsedValue = parseEnvValue(value, configPath);
      setNestedProperty(overlay, configPath, parsedValue);
    }
  }

  return overlay as PartialNachosConfig;
}

/**
 * Deep merge two objects, with source taking precedence
 * Protected against prototype pollution
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    // Guard against prototype pollution
    if (!isSafeKey(key)) {
      continue;
    }
    
    const sourceValue = source[key];
    const targetValue = result[key];

    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }

  return result;
}

/**
 * Apply environment variable overlay to configuration
 */
export function applyEnvOverlay(config: NachosConfig): NachosConfig {
  const overlay = createEnvOverlay();
  // Use type assertion through unknown for deep merge
  return deepMerge(
    config as unknown as Record<string, unknown>,
    overlay as unknown as Record<string, unknown>,
  ) as unknown as NachosConfig;
}
