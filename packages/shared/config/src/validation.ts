/**
 * Configuration Validation
 *
 * Validates nachos.toml configuration for correctness and safety
 */

import type { NachosConfig } from './schema.js';

type SchemaNode = true | { [key: string]: SchemaNode } | { __array: SchemaNode };

const CONFIG_SHAPE: SchemaNode = {
  nachos: {
    name: true,
    version: true,
  },
  llm: {
    provider: true,
    model: true,
    fallback_order: true,
    providers: {
      __array: { name: true, type: true, base_url: true, models: true, profiles: true },
    },
    profiles: {
      __array: { name: true, provider: true, api_key_env: true, base_url: true },
    },
    profile_order: true,
    retry: { attempts: true, min_delay_ms: true, max_delay_ms: true, jitter: true },
    cooldowns: {
      initial_seconds: true,
      multiplier: true,
      max_seconds: true,
      billing_initial_hours: true,
      billing_max_hours: true,
    },
    max_tokens: true,
    temperature: true,
    base_url: true,
  },
  channels: {
    webchat: { enabled: true, port: true },
    slack: {
      enabled: true,
      mode: true,
      app_token: true,
      bot_token: true,
      signing_secret: true,
      webhook_path: true,
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          channel_ids: true,
          user_allowlist: true,
          mention_gating: true,
        },
      },
    },
    discord: {
      enabled: true,
      token: true,
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          channel_ids: true,
          user_allowlist: true,
          mention_gating: true,
        },
      },
    },
    telegram: {
      enabled: true,
      token: true,
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          channel_ids: true,
          user_allowlist: true,
          mention_gating: true,
        },
      },
    },
    whatsapp: {
      enabled: true,
      token: true,
      phone_number_id: true,
      verify_token: true,
      webhook_path: true,
      api_version: true,
      app_secret: true,
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          channel_ids: true,
          user_allowlist: true,
          mention_gating: true,
        },
      },
    },
  },
  tools: {
    filesystem: { enabled: true, paths: true, write: true, max_file_size: true },
    browser: { enabled: true, allowed_domains: true, headless: true, timeout: true },
    code_runner: { enabled: true, runtime: true, languages: true, timeout: true, max_memory: true },
    shell: { enabled: true },
    web_search: { enabled: true },
  },
  security: {
    mode: true,
    i_understand_the_risks: true,
    dlp: { enabled: true, action: true, patterns: true },
    rate_limits: {
      messages_per_minute: true,
      tool_calls_per_minute: true,
      llm_requests_per_minute: true,
    },
    approval: {
      approver_allowlist: true,
    },
    audit: {
      enabled: true,
      retention_days: true,
      log_inputs: true,
      log_outputs: true,
      log_tool_calls: true,
      provider: true,
      providers: true,
      path: true,
      rotate_size: true,
      max_files: true,
      url: true,
      headers: true,
      batch_size: true,
      flush_interval_ms: true,
      custom_path: true,
      custom_config: true,
    },
  },
  runtime: {
    state_dir: true,
    config_dir: true,
    workspace_dir: true,
    log_level: true,
    log_format: true,
    redis_url: true,
    resources: { memory: true, cpus: true, pids_limit: true },
    gateway_streaming_passthrough: true,
    gateway_streaming_chunk_size: true,
    gateway_streaming_min_interval_ms: true,
    context_management: {
      sliding_window: {
        enabled: true,
        mode: true,
        thresholds: {
          proactive_prune: true,
          light_compaction: true,
          aggressive_compaction: true,
          emergency: true,
        },
        keep_recent: { turns: true, messages: true, token_budget: true },
        slide_strategy: true,
        chunk_size: true,
      },
      summarization: {
        enabled: true,
        mode: true,
        tiers: {
          archival: { compression_ratio: true, format: true, preserves: true },
          compressed: { compression_ratio: true, format: true, preserves: true },
          condensed: { compression_ratio: true, format: true, preserves: true },
        },
        content_classification: {
          enabled: true,
          preserve_critical: true,
          preserve_code: true,
          preserve_errors: true,
        },
        custom_instructions: true,
      },
      proactive_history: {
        enabled: true,
        extractors: {
          decisions: true,
          facts: true,
          tasks: true,
          issues: true,
          files: true,
        },
        triggers: {
          on_compaction: true,
          on_threshold: true,
          on_memory_flush: true,
          periodic: true,
        },
        snapshots: { enabled: true, dir: true, max_snapshots: true },
        summary_archive: { enabled: true, dir: true, max_summaries: true },
        custom_pattern_files: true,
      },
      memory_flush: {
        enabled: true,
        soft_threshold_tokens: true,
        extract_structured: true,
        create_snapshot: true,
        validate_extraction: true,
        system_prompt: true,
        prompt: true,
      },
    },
    state: {
      identity: {
        provider: true,
        filesystem: { dir: true },
        postgres: {
          connection_string: true,
          schema: true,
          ssl: true,
          max_connections: true,
        },
      },
      memory: {
        provider: true,
        filesystem: { dir: true },
        postgres: {
          connection_string: true,
          schema: true,
          ssl: true,
          max_connections: true,
        },
      },
      session: { provider: true, redis_url: true, ttl_seconds: true },
      prompt_report: {
        hash: true,
        include_tokens: true,
        max_memory_entries: true,
        max_memory_facts: true,
        include_session_state: true,
      },
    },
    subagents: {
      enabled: true,
      max_concurrent: true,
      announce: { enabled: true, prompt: true },
      tools: { allow: true, deny: true, default_profile: true, profiles: true },
      sandbox: {
        mode: true,
        docker: {
          image: true,
          network: true,
          workspace_dir: true,
          config_dir: true,
          state_dir: true,
          timeout_ms: true,
        },
      },
    },
    sandbox: {
      mode: true,
      scope: true,
      workspace_access: true,
      extra_binds: true,
      env: true,
      setup_command: true,
      network: true,
    },
  },
  assistant: { name: true, system_prompt: true, context_files: true },
  skills: { enabled: true },
};

function validateNoUnknownKeys(
  value: unknown,
  shape: SchemaNode,
  errors: string[],
  path: string
): void {
  if (shape === true) {
    return;
  }

  if (typeof value !== 'object' || value === null) {
    return;
  }

  if ('__array' in shape) {
    if (!Array.isArray(value)) {
      return;
    }
    for (let i = 0; i < value.length; i += 1) {
      validateNoUnknownKeys(value[i], shape.__array, errors, `${path}[${i}]`);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(key in shape)) {
      const fullPath = path ? `${path}.${key}` : key;
      errors.push(`Unknown config key: ${fullPath}`);
      continue;
    }
    const childPath = path ? `${path}.${key}` : key;
    const childShape = (shape as Record<string, SchemaNode>)[key];
    if (childShape === undefined) {
      continue;
    }
    validateNoUnknownKeys(obj[key], childShape, errors, childPath);
  }
}

function isChannelEnabled(config?: { enabled?: boolean }): boolean {
  if (!config) return false;
  return config.enabled !== false;
}

/**
 * Error thrown when configuration validation fails
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[] = []
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
      `Invalid llm.provider: "${config.llm.provider}". Must be one of: ${validProviders.join(', ')}`
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

  if (config.llm.fallback_order) {
    for (const entry of config.llm.fallback_order) {
      const [provider, model] = entry.split(':');
      if (!provider || !model) {
        errors.push(`llm.fallback_order entry must be "provider:model": "${entry}"`);
        continue;
      }
      if (!validProviders.includes(provider)) {
        errors.push(
          `Invalid llm.fallback_order provider: "${provider}". Must be one of: ${validProviders.join(', ')}`
        );
      }
    }
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
      `Invalid security.mode: "${config.security.mode}". Must be one of: ${validModes.join(', ')}`
    );
  }

  // Permissive mode requires explicit acknowledgment
  if (config.security.mode === 'permissive' && !config.security.i_understand_the_risks) {
    errors.push('security.mode = "permissive" requires security.i_understand_the_risks = true');
  }

  // Shell tool requires permissive mode
  if (config.tools?.shell?.enabled && config.security.mode !== 'permissive') {
    errors.push('tools.shell.enabled = true requires security.mode = "permissive"');
  }

  // Validate DLP configuration
  if (config.security.dlp) {
    const validActions = ['block', 'warn', 'audit', 'allow', 'redact'];
    if (config.security.dlp.action && !validActions.includes(config.security.dlp.action)) {
      errors.push(
        `Invalid security.dlp.action: "${config.security.dlp.action}". Must be one of: ${validActions.join(', ')}`
      );
    }
  }

  if (config.security.approval?.approver_allowlist !== undefined) {
    if (!Array.isArray(config.security.approval.approver_allowlist)) {
      errors.push('security.approval.approver_allowlist must be an array');
    } else if (
      config.security.approval.approver_allowlist.some(
        (item) => typeof item !== 'string' || item.trim() === ''
      )
    ) {
      errors.push('security.approval.approver_allowlist must be an array of non-empty strings');
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
    const { provider, providers, path, url, batch_size, flush_interval_ms } = config.security.audit;

    if (provider && !validProviders.includes(provider)) {
      errors.push(`security.audit.provider must be one of: ${validProviders.join(', ')}`);
    }

    if (providers && providers.some((item) => typeof item !== 'string')) {
      errors.push('security.audit.providers must be an array of strings');
    }

    if (provider === 'sqlite' || provider === 'file') {
      if (!path) {
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
      `Invalid runtime.log_level: "${config.runtime.log_level}". Must be one of: ${validLogLevels.join(', ')}`
    );
  }

  const validLogFormats = ['pretty', 'json'];
  if (config.runtime.log_format && !validLogFormats.includes(config.runtime.log_format)) {
    errors.push(
      `Invalid runtime.log_format: "${config.runtime.log_format}". Must be one of: ${validLogFormats.join(', ')}`
    );
  }

  if (config.runtime.redis_url) {
    try {
      new URL(config.runtime.redis_url);
    } catch {
      errors.push('runtime.redis_url must be a valid URL');
    }
  }

  if (config.runtime.config_dir !== undefined && config.runtime.config_dir.trim() === '') {
    errors.push('runtime.config_dir must be a non-empty string if provided');
  }

  if (config.runtime.workspace_dir !== undefined && config.runtime.workspace_dir.trim() === '') {
    errors.push('runtime.workspace_dir must be a non-empty string if provided');
  }

  if (config.runtime.state) {
    const stateDir = config.runtime.state_dir;
    const validateStore = (
      store: typeof config.runtime.state.identity | undefined,
      label: string
    ) => {
      if (!store?.provider) return;
      if (store.provider !== 'filesystem' && store.provider !== 'postgres') {
        errors.push(`runtime.state.${label}.provider must be "filesystem" or "postgres"`);
      }
      if (store.provider === 'filesystem') {
        const dir = store.filesystem?.dir ?? stateDir;
        if (!dir) {
          errors.push(`runtime.state.${label}.filesystem.dir or runtime.state_dir is required`);
        }
      }
      if (store.provider === 'postgres' && !store.postgres?.connection_string) {
        errors.push(`runtime.state.${label}.postgres.connection_string is required`);
      }
    };

    validateStore(config.runtime.state.identity, 'identity');
    validateStore(config.runtime.state.memory, 'memory');

    if (config.runtime.state.session?.provider) {
      const provider = config.runtime.state.session.provider;
      if (provider !== 'redis' && provider !== 'memory') {
        errors.push('runtime.state.session.provider must be "redis" or "memory"');
      }
      if (provider === 'redis') {
        const redisUrl = config.runtime.state.session.redis_url ?? config.runtime.redis_url;
        if (!redisUrl) {
          errors.push('runtime.state.session.redis_url or runtime.redis_url is required for redis');
        }
        if (config.runtime.state.session.redis_url) {
          try {
            new URL(config.runtime.state.session.redis_url);
          } catch {
            errors.push('runtime.state.session.redis_url must be a valid URL');
          }
        }
      }
    }
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

  if (config.runtime.subagents?.sandbox?.mode) {
    const validModes = ['host', 'tool', 'full'];
    if (!validModes.includes(config.runtime.subagents.sandbox.mode)) {
      errors.push('runtime.subagents.sandbox.mode must be "host", "tool", or "full"');
    }

    if (config.runtime.subagents.sandbox.mode === 'full') {
      const image = config.runtime.subagents.sandbox.docker?.image;
      if (!image) {
        errors.push('runtime.subagents.sandbox.docker.image is required for full sandbox mode');
      }
    }
  }

  if (config.runtime.subagents?.tools?.default_profile) {
    const defaultProfile = config.runtime.subagents.tools.default_profile;
    const profiles = config.runtime.subagents.tools.profiles ?? {};
    if (!(defaultProfile in profiles)) {
      errors.push(
        `runtime.subagents.tools.default_profile references unknown profile: ${defaultProfile}`
      );
    }
  }

  if (
    config.runtime.gateway_streaming_chunk_size !== undefined &&
    config.runtime.gateway_streaming_chunk_size < 1
  ) {
    errors.push('runtime.gateway_streaming_chunk_size must be at least 1');
  }

  if (
    config.runtime.gateway_streaming_min_interval_ms !== undefined &&
    config.runtime.gateway_streaming_min_interval_ms < 0
  ) {
    errors.push('runtime.gateway_streaming_min_interval_ms must be 0 or greater');
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

  const enabledChannels = Object.entries(config.channels).filter(([_, cfg]) =>
    isChannelEnabled(cfg)
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

  const validateDmConfig = (path: string, dm: unknown): void => {
    if (!dm) return;
    if (typeof dm !== 'object' || dm === null) {
      errors.push(`${path}.dm must be an object`);
      return;
    }
    const dmConfig = dm as { user_allowlist?: string[] };
    if (!Array.isArray(dmConfig.user_allowlist)) {
      errors.push(`${path}.dm.user_allowlist is required and must be an array`);
    }
  };

  const validateServerConfig = (path: string, servers: unknown): void => {
    if (!servers) return;
    if (!Array.isArray(servers)) {
      errors.push(`${path}.servers must be an array`);
      return;
    }
    for (const [index, server] of servers.entries()) {
      const prefix = `${path}.servers[${index}]`;
      const record = server as {
        id?: string;
        channel_ids?: string[];
        user_allowlist?: string[];
        mention_gating?: boolean;
      };
      if (!record.id || record.id.trim() === '') {
        errors.push(`${prefix}.id is required`);
      }
      if (!Array.isArray(record.channel_ids)) {
        errors.push(`${prefix}.channel_ids is required and must be an array`);
      }
      if (!Array.isArray(record.user_allowlist)) {
        errors.push(`${prefix}.user_allowlist is required and must be an array`);
      }
      if (record.mention_gating !== undefined && typeof record.mention_gating !== 'boolean') {
        errors.push(`${prefix}.mention_gating must be a boolean`);
      }
    }
  };

  // Validate Slack
  if (isChannelEnabled(config.channels.slack)) {
    const slack = config.channels.slack;
    if (!slack?.dm && !slack?.servers) {
      warnings.push('channels.slack enabled but no dm or servers configured');
    }
    const mode = slack?.mode ?? 'socket';
    if (mode !== 'socket' && mode !== 'http') {
      errors.push('channels.slack.mode must be "socket" or "http"');
    }
    if (mode === 'socket') {
      if (!slack?.app_token) errors.push('channels.slack.app_token is required for socket mode');
      if (!slack?.bot_token) errors.push('channels.slack.bot_token is required for socket mode');
    }
    if (mode === 'http') {
      if (!slack?.bot_token) errors.push('channels.slack.bot_token is required for http mode');
      if (!slack?.signing_secret) {
        errors.push('channels.slack.signing_secret is required for http mode');
      }
      if (!slack?.webhook_path) {
        errors.push('channels.slack.webhook_path is required for http mode');
      }
    }
    validateDmConfig('channels.slack', slack?.dm);
    validateServerConfig('channels.slack', slack?.servers);
  }

  // Validate Discord
  if (isChannelEnabled(config.channels.discord)) {
    const discord = config.channels.discord;
    if (!discord?.dm && !discord?.servers) {
      warnings.push('channels.discord enabled but no dm or servers configured');
    }
    if (!discord?.token) errors.push('channels.discord.token is required');
    validateDmConfig('channels.discord', discord?.dm);
    validateServerConfig('channels.discord', discord?.servers);
  }

  // Validate Telegram
  if (isChannelEnabled(config.channels.telegram)) {
    const telegram = config.channels.telegram;
    if (!telegram?.dm && !telegram?.servers) {
      warnings.push('channels.telegram enabled but no dm or servers configured');
    }
    if (!telegram?.token) errors.push('channels.telegram.token is required');
    validateDmConfig('channels.telegram', telegram?.dm);
    validateServerConfig('channels.telegram', telegram?.servers);
  }

  // Validate WhatsApp
  if (isChannelEnabled(config.channels.whatsapp)) {
    const whatsapp = config.channels.whatsapp;
    if (!whatsapp?.dm && !whatsapp?.servers) {
      warnings.push('channels.whatsapp enabled but no dm or servers configured');
    }
    if (!whatsapp?.token) errors.push('channels.whatsapp.token is required');
    if (!whatsapp?.phone_number_id) {
      errors.push('channels.whatsapp.phone_number_id is required');
    }
    if (!whatsapp?.verify_token) {
      errors.push('channels.whatsapp.verify_token is required');
    }
    if (!whatsapp?.webhook_path) {
      errors.push('channels.whatsapp.webhook_path is required');
    }
    validateDmConfig('channels.whatsapp', whatsapp?.dm);
    validateServerConfig('channels.whatsapp', whatsapp?.servers);
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
        `Invalid tools.code_runner.runtime: "${config.tools.code_runner.runtime}". Must be one of: ${validRuntimes.join(', ')}`
      );
    }

    if (config.tools.code_runner.runtime === 'native' && config.security.mode !== 'permissive') {
      errors.push('tools.code_runner.runtime = "native" requires security.mode = "permissive"');
    }
  }

  // Validate timeouts
  if (config.tools.browser?.timeout !== undefined && config.tools.browser.timeout < 1) {
    errors.push('tools.browser.timeout must be at least 1 second');
  }

  if (config.tools.code_runner?.timeout !== undefined && config.tools.code_runner.timeout < 1) {
    errors.push('tools.code_runner.timeout must be at least 1 second');
  }

  // Warn about filesystem write permissions
  if (config.tools.filesystem?.enabled && config.tools.filesystem.write) {
    warnings.push(
      'tools.filesystem.write = true allows file modifications - ensure proper paths are configured'
    );
  }
}

/**
 * Validate complete configuration
 */
export function validateConfig(config: NachosConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateNoUnknownKeys(config, CONFIG_SHAPE, errors, '');
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
      result.errors
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
