/**
 * Configuration Validation
 *
 * Validates nachos.toml configuration for correctness and safety
 */

import type { NachosConfig } from './schema.js';

/**
 * Error thrown when configuration validation fails
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[] = [],
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate core nachos settings
 */
function validateNachosSection(config: NachosConfig, errors: string[], _warnings: string[]): void {
  if (!config.nachos) {
    errors.push('Missing required [nachos] section');
    return;
  }

  if (!config.nachos.name || config.nachos.name.trim() === '') {
    errors.push('nachos.name is required and cannot be empty');
  }

  if (!config.nachos.version || config.nachos.version.trim() === '') {
    errors.push('nachos.version is required and cannot be empty');
  }
}

/**
 * Validate LLM configuration
 */
function validateLLMConfig(config: NachosConfig, errors: string[], warnings: string[]): void {
  if (!config.llm) {
    errors.push('Missing required [llm] section');
    return;
  }

  const validProviders = ['anthropic', 'openai', 'ollama', 'custom'];
  if (!validProviders.includes(config.llm.provider)) {
    errors.push(
      `Invalid llm.provider: "${config.llm.provider}". Must be one of: ${validProviders.join(', ')}`,
    );
  }

  if (!config.llm.model || config.llm.model.trim() === '') {
    errors.push('llm.model is required and cannot be empty');
  }

  if (config.llm.max_tokens !== undefined) {
    if (config.llm.max_tokens < 1 || config.llm.max_tokens > 1000000) {
      errors.push('llm.max_tokens must be between 1 and 1,000,000');
    }
  }

  if (config.llm.temperature !== undefined) {
    if (config.llm.temperature < 0 || config.llm.temperature > 2) {
      errors.push('llm.temperature must be between 0 and 2');
    }
  }

  if (config.llm.provider === 'ollama' && !config.llm.base_url) {
    warnings.push('llm.base_url should be specified for Ollama provider');
  }
}

/**
 * Validate security configuration
 */
function validateSecurityConfig(config: NachosConfig, errors: string[], _warnings: string[]): void {
  if (!config.security) {
    errors.push('Missing required [security] section');
    return;
  }

  const validModes = ['strict', 'standard', 'permissive'];
  if (!validModes.includes(config.security.mode)) {
    errors.push(
      `Invalid security.mode: "${config.security.mode}". Must be one of: ${validModes.join(', ')}`,
    );
  }

  // Permissive mode requires explicit acknowledgment
  if (config.security.mode === 'permissive' && !config.security.i_understand_the_risks) {
    errors.push(
      'security.mode = "permissive" requires security.i_understand_the_risks = true',
    );
  }

  // Shell tool requires permissive mode
  if (config.tools?.shell?.enabled && config.security.mode !== 'permissive') {
    errors.push('tools.shell.enabled = true requires security.mode = "permissive"');
  }

  // Validate DLP configuration
  if (config.security.dlp) {
    const validActions = ['block', 'warn', 'audit'];
    if (config.security.dlp.action && !validActions.includes(config.security.dlp.action)) {
      errors.push(
        `Invalid security.dlp.action: "${config.security.dlp.action}". Must be one of: ${validActions.join(', ')}`,
      );
    }
  }

  // Validate rate limits
  if (config.security.rate_limits) {
    const { messages_per_minute, tool_calls_per_minute, llm_requests_per_minute } =
      config.security.rate_limits;

    if (messages_per_minute !== undefined && messages_per_minute < 1) {
      errors.push('security.rate_limits.messages_per_minute must be at least 1');
    }

    if (tool_calls_per_minute !== undefined && tool_calls_per_minute < 1) {
      errors.push('security.rate_limits.tool_calls_per_minute must be at least 1');
    }

    if (llm_requests_per_minute !== undefined && llm_requests_per_minute < 1) {
      errors.push('security.rate_limits.llm_requests_per_minute must be at least 1');
    }
  }

  // Validate audit configuration
  if (config.security.audit?.retention_days !== undefined) {
    if (config.security.audit.retention_days < 1 || config.security.audit.retention_days > 365) {
      errors.push('security.audit.retention_days must be between 1 and 365');
    }
  }
  if (config.security.audit) {
    const validProviders = ['sqlite', 'file', 'webhook', 'custom', 'composite'];
    const { provider, providers, path, url, batch_size, flush_interval_ms } =
      config.security.audit;

    if (provider && !validProviders.includes(provider)) {
      errors.push(`security.audit.provider must be one of: ${validProviders.join(', ')}`);
    }

    if (providers && providers.some((item) => typeof item !== 'string')) {
      errors.push('security.audit.providers must be an array of strings');
    }

    if (provider === 'sqlite' || provider === 'file') {
      if (path === undefined || path === '') {
        errors.push('security.audit.path is required for sqlite or file providers');
      }
    }

    if (provider === 'webhook' && !url) {
      errors.push('security.audit.url is required for webhook providers');
    }

    if (provider === 'custom' && !config.security.audit.custom_path) {
      errors.push('security.audit.custom_path is required for custom providers');
    }

    if (provider === 'composite' && (!providers || providers.length === 0)) {
      errors.push('security.audit.providers is required for composite providers');
    }

    if (batch_size !== undefined && batch_size < 1) {
      errors.push('security.audit.batch_size must be at least 1');
    }

    if (flush_interval_ms !== undefined && flush_interval_ms < 100) {
      errors.push('security.audit.flush_interval_ms must be at least 100');
    }
  }
}

/**
 * Validate runtime configuration
 */
function validateRuntimeConfig(config: NachosConfig, errors: string[], _warnings: string[]): void {
  if (!config.runtime) {
    return; // Runtime is optional
  }

  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (config.runtime.log_level && !validLogLevels.includes(config.runtime.log_level)) {
    errors.push(
      `Invalid runtime.log_level: "${config.runtime.log_level}". Must be one of: ${validLogLevels.join(', ')}`,
    );
  }

  const validLogFormats = ['pretty', 'json'];
  if (config.runtime.log_format && !validLogFormats.includes(config.runtime.log_format)) {
    errors.push(
      `Invalid runtime.log_format: "${config.runtime.log_format}". Must be one of: ${validLogFormats.join(', ')}`,
    );
  }

  if (config.runtime.resources) {
    if (config.runtime.resources.cpus !== undefined && config.runtime.resources.cpus <= 0) {
      errors.push('runtime.resources.cpus must be greater than 0');
    }

    if (
      config.runtime.resources.pids_limit !== undefined &&
      config.runtime.resources.pids_limit < 1
    ) {
      errors.push('runtime.resources.pids_limit must be at least 1');
    }
  }
}

/**
 * Validate channels configuration
 */
function validateChannelsConfig(config: NachosConfig, errors: string[], warnings: string[]): void {
  if (!config.channels) {
    warnings.push('No channels configured - assistant will not be accessible');
    return;
  }

  const enabledChannels = Object.entries(config.channels).filter(
    ([_, cfg]) => cfg && cfg.enabled,
  );

  if (enabledChannels.length === 0) {
    warnings.push('No channels enabled - assistant will not be accessible');
  }

  // Validate webchat port
  if (config.channels.webchat?.enabled && config.channels.webchat.port) {
    const port = config.channels.webchat.port;
    if (port < 1 || port > 65535) {
      errors.push(`Invalid channels.webchat.port: ${port}. Must be between 1 and 65535`);
    }
  }

  // Validate Discord DM policy
  if (config.channels.discord?.enabled && config.channels.discord.dm_policy) {
    const validPolicies = ['allowlist', 'pairing', 'open'];
    if (!validPolicies.includes(config.channels.discord.dm_policy)) {
      errors.push(
        `Invalid channels.discord.dm_policy: "${config.channels.discord.dm_policy}". Must be one of: ${validPolicies.join(', ')}`,
      );
    }

    if (
      config.channels.discord.dm_policy === 'allowlist' &&
      (!config.channels.discord.allowed_users || config.channels.discord.allowed_users.length === 0)
    ) {
      warnings.push(
        'channels.discord.dm_policy = "allowlist" but no allowed_users specified',
      );
    }
  }

  // Validate Telegram DM policy
  if (config.channels.telegram?.enabled && config.channels.telegram.dm_policy) {
    const validPolicies = ['pairing', 'allowlist', 'open'];
    if (!validPolicies.includes(config.channels.telegram.dm_policy)) {
      errors.push(
        `Invalid channels.telegram.dm_policy: "${config.channels.telegram.dm_policy}". Must be one of: ${validPolicies.join(', ')}`,
      );
    }
  }
}

/**
 * Validate tools configuration
 */
function validateToolsConfig(config: NachosConfig, errors: string[], warnings: string[]): void {
  if (!config.tools) {
    return; // Tools are optional
  }

  // Validate code runner runtime
  if (config.tools.code_runner?.enabled && config.tools.code_runner.runtime) {
    const validRuntimes = ['sandboxed', 'native'];
    if (!validRuntimes.includes(config.tools.code_runner.runtime)) {
      errors.push(
        `Invalid tools.code_runner.runtime: "${config.tools.code_runner.runtime}". Must be one of: ${validRuntimes.join(', ')}`,
      );
    }

    if (
      config.tools.code_runner.runtime === 'native' &&
      config.security.mode !== 'permissive'
    ) {
      errors.push(
        'tools.code_runner.runtime = "native" requires security.mode = "permissive"',
      );
    }
  }

  // Validate timeouts
  if (config.tools.browser?.timeout !== undefined && config.tools.browser.timeout < 1) {
    errors.push('tools.browser.timeout must be at least 1 second');
  }

  if (
    config.tools.code_runner?.timeout !== undefined &&
    config.tools.code_runner.timeout < 1
  ) {
    errors.push('tools.code_runner.timeout must be at least 1 second');
  }

  // Warn about filesystem write permissions
  if (config.tools.filesystem?.enabled && config.tools.filesystem.write) {
    warnings.push('tools.filesystem.write = true allows file modifications - ensure proper paths are configured');
  }
}

/**
 * Validate complete configuration
 */
export function validateConfig(config: NachosConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateNachosSection(config, errors, warnings);
  validateLLMConfig(config, errors, warnings);
  validateSecurityConfig(config, errors, warnings);
  validateRuntimeConfig(config, errors, warnings);
  validateChannelsConfig(config, errors, warnings);
  validateToolsConfig(config, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate configuration and throw if invalid
 */
export function validateConfigOrThrow(config: NachosConfig): void {
  const result = validateConfig(config);

  if (!result.valid) {
    throw new ConfigValidationError(
      `Configuration validation failed:\n${result.errors.join('\n')}`,
      result.errors,
    );
  }

  // Log warnings if any
  if (result.warnings.length > 0) {
    console.warn('Configuration warnings:');
    for (const warning of result.warnings) {
      console.warn(`  - ${warning}`);
    }
  }
}
