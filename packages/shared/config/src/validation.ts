/**
 * Configuration Validation
 *
 * Validates nachos.toml configuration for correctness and safety
 */

import type { NachosConfig } from './schema.js';
import { createLogger } from '@nachos/types';

const logger = createLogger('config-validation');

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
    region: true, // AWS region for Bedrock provider
    context_window: true,
    timeout_ms: true,
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
      typing_indicators: true,
      commands: { enabled: true, admin_allowlist: true },
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          ids: true,
          channel_ids: true,
          user_allowlist: true,
          mention_gating: true,
        },
      },
    },
    discord: {
      enabled: true,
      token: true,
      allow_bots: true,
      bot_allowlist: true,
      typing_indicators: true,
      commands: { enabled: true, admin_allowlist: true },
      status_emojis: { enabled: true },
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          ids: true,
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
          ids: true,
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
          ids: true,
          channel_ids: true,
          user_allowlist: true,
          mention_gating: true,
        },
      },
    },
    matrix: {
      enabled: true,
      homeserver_url: true,
      access_token: true,
      user_id: true,
      device_id: true,
      dm: { user_allowlist: true, pairing: true },
      servers: {
        __array: {
          id: true,
          ids: true,
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
    shell: {
      enabled: true,
      rate_limit: { max_per_window: true, window_ms: true },
    },
    web_search: {
      enabled: true,
      api_key_env: true,
      default_country: true,
      safe_search: true,
      max_results: true,
    },
    web_fetch: {
      enabled: true,
      allowed_domains: true,
      domain_allowlist: true,
      max_chars: true,
      timeout_ms: true,
      timeout_seconds: true,
      max_redirects: true,
      user_agent: true,
    },
    bootstrap: { enabled: true },
    github: {
      enabled: true,
      default_repo: true,
      token_env: true,
      repo_allowlist: true,
    },
    bitbucket: {
      enabled: true,
      default_workspace: true,
      auth_type: true,
      username_env: true,
      password_env: true,
      token_env: true,
      workspace_allowlist: true,
    },
    composio: {
      enabled: true,
      api_key_env: true,
      entity_id: true,
      allowed_apps: true,
    },
    copilot: {
      enabled: true,
      max_prompt_length: true,
      max_output_size: true,
      default_timeout: true,
      max_timeout: true,
    },
    agent_exec: {
      enabled: true,
      max_concurrent: true,
      default_timeout: true,
      max_timeout: true,
      max_output_buffer: true,
    },
    groups: true,
  },
  security: {
    mode: true,
    i_understand_the_risks: true,
    dlp: { enabled: true, action: true, patterns: true },
    approval: { approver_allowlist: true },
    rate_limits: {
      messages_per_minute: true,
      tool_calls_per_minute: true,
      llm_requests_per_minute: true,
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
    service_resources: {
      gateway: { memory: true, cpus: true, pids_limit: true },
      llm_proxy: { memory: true, cpus: true, pids_limit: true },
      admin: { memory: true, cpus: true, pids_limit: true },
      bus: { memory: true, cpus: true, pids_limit: true },
      redis: { memory: true, cpus: true, pids_limit: true },
      channels: { memory: true, cpus: true, pids_limit: true },
      tools: { memory: true, cpus: true, pids_limit: true },
    },
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
      commands: {
        enabled: true,
        allow_in_dms: true,
        allow_in_channels: true,
        admin_allowlist: true,
        reset_triggers: true,
        context_triggers: true,
        identity_triggers: true,
        help_triggers: true,
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
      user_profile: {
        provider: true,
        filesystem: { dir: true },
        postgres: {
          connection_string: true,
          schema: true,
          ssl: true,
          max_connections: true,
        },
      },
      bootstrap: {
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
      sessions: {
        provider: true,
        sqlite: { db_path: true },
        postgres: {
          connection_string: true,
          schema: true,
          ssl: true,
          max_connections: true,
        },
      },
      semantic: {
        provider: true,
        local: { model: true, cache_dir: true },
      },
      prompt_report: {
        hash: true,
        include_tokens: true,
        max_memory_entries: true,
        max_memory_facts: true,
        include_session_state: true,
      },
      memory_injection: {
        enabled: true,
        manifest_max_tokens: true,
        manifest_preferences: true,
        manifest_recent_topics: true,
        manifest_fact_counts: true,
        recall_default_limit: true,
        recall_min_similarity: true,
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
  assistant: { name: true, system_prompt: true },
  skills: {
    enabled: true,
    allow: true,
    deny: true,
    entries: true,
    hot_reload: true,
    debounce_ms: true,
  },
  admin: { enabled: true, port: true },
  scheduler: {
    enabled: true,
    check_interval_seconds: true,
    max_concurrent_jobs: true,
    run_missed_on_startup: true,
    jobs: {
      __array: {
        name: true,
        description: true,
        schedule_type: true,
        schedule_value: true,
        timezone: true,
        action_type: true,
        action_text: true,
        action_prompt: true,
        delivery_channel: true,
        enabled: true,
      },
    },
  },
  heartbeat: {
    enabled: true,
    interval_minutes: true,
    prompt: true,
    channel: true,
  },
  sessions: {
    inactivity_timeout: true,
    archive_ttl: true,
  },
  // Plugin config sections are dynamic — validated by PluginConfigRegistry, not CONFIG_SHAPE.
  plugins: true,
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

  const validProviders = ['anthropic', 'openai', 'ollama', 'bedrock', 'custom'];
  if (!validProviders.includes(config.llm.provider)) {
    errors.push(
      `Invalid llm.provider: "${config.llm.provider}". Must be one of: ${validProviders.join(', ')}`
    );
  }

  // Bedrock provider should have region specified
  if (config.llm.provider === 'bedrock' && !config.llm.region) {
    errors.push('llm.region is required when using bedrock provider');
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

  if (config.llm.timeout_ms !== undefined) {
    if (config.llm.timeout_ms < 1000 || config.llm.timeout_ms > 600000) {
      errors.push('llm.timeout_ms must be between 1000 and 600000 (1s to 10min)');
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

  // Strict mode: audit logging should be enabled — warn if it is not
  if (config.security.mode === 'strict' && !config.security.audit?.enabled) {
    _warnings.push(
      'security.mode = "strict" but security.audit.enabled is not set — audit logging is recommended in strict mode'
    );
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
 * Check if a path is relative (starts with ./ or ../ or doesn't start with /)
 * and emit a warning about Docker deployment issues.
 */
function warnIfRelativePath(path: string, configKey: string, warnings: string[]): void {
  if (
    path.startsWith('./') ||
    path.startsWith('../') ||
    (!path.startsWith('/') && !path.match(/^[A-Za-z]:\\/))
  ) {
    warnings.push(
      `${configKey} is a relative path — in Docker, this resolves from the gateway WORKDIR, not the project root. Use absolute paths for Docker deployments.`
    );
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
    validateStore(config.runtime.state.user_profile, 'user_profile');
    validateStore(config.runtime.state.bootstrap, 'bootstrap');

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

  // Warn about relative paths that may fail in Docker
  if (config.runtime.state_dir) {
    warnIfRelativePath(config.runtime.state_dir, 'runtime.state_dir', _warnings);
  }

  if (config.runtime.state) {
    const storeLabels = ['identity', 'memory', 'user_profile', 'bootstrap'] as const;
    for (const label of storeLabels) {
      const store = config.runtime.state[label];
      if (store?.filesystem?.dir) {
        warnIfRelativePath(
          store.filesystem.dir,
          `runtime.state.${label}.filesystem.dir`,
          _warnings
        );
      }
    }

    if (config.runtime.state.sessions?.sqlite?.db_path) {
      warnIfRelativePath(
        config.runtime.state.sessions.sqlite.db_path,
        'runtime.state.sessions.sqlite.db_path',
        _warnings
      );
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
        ids?: string[];
        channel_ids?: string[];
        user_allowlist?: string[];
        mention_gating?: boolean;
      };
      const ids = Array.isArray(record.ids)
        ? record.ids.map((entry) => entry.trim()).filter(Boolean)
        : [];
      if ((!record.id || record.id.trim() === '') && ids.length === 0) {
        errors.push(`${prefix}.id or ${prefix}.ids is required`);
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
function validateSchedulerConfig(
  config: NachosConfig,
  errors: string[],
  _warnings: string[]
): void {
  const jobs = config.scheduler?.jobs;
  if (!jobs || !Array.isArray(jobs)) return;

  const VALID_SCHEDULE_TYPES = ['at', 'every', 'cron'];
  const VALID_ACTION_TYPES = ['systemEvent', 'agentTurn'];
  const seenNames = new Set<string>();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const prefix = `scheduler.jobs[${i}]`;

    if (!job) continue;

    if (!job.name?.trim()) {
      errors.push(`${prefix}.name is required`);
    } else if (seenNames.has(job.name)) {
      errors.push(`${prefix}.name "${job.name}" is duplicated — job names must be unique`);
    } else {
      seenNames.add(job.name);
    }

    if (!job.schedule_type) {
      errors.push(`${prefix}.schedule_type is required`);
    } else if (!VALID_SCHEDULE_TYPES.includes(job.schedule_type)) {
      errors.push(`${prefix}.schedule_type must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`);
    }

    if (!job.schedule_value) {
      errors.push(`${prefix}.schedule_value is required`);
    } else if (job.schedule_type === 'every') {
      const ms = parseInt(job.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        errors.push(
          `${prefix}.schedule_value must be a positive integer (milliseconds) for type "every"`
        );
      }
    }

    if (!job.action_type) {
      errors.push(`${prefix}.action_type is required`);
    } else if (!VALID_ACTION_TYPES.includes(job.action_type)) {
      errors.push(`${prefix}.action_type must be one of: ${VALID_ACTION_TYPES.join(', ')}`);
    } else if (job.action_type === 'systemEvent' && !job.action_text?.trim()) {
      errors.push(`${prefix}.action_text is required when action_type is "systemEvent"`);
    } else if (job.action_type === 'agentTurn' && !job.action_prompt?.trim()) {
      errors.push(`${prefix}.action_prompt is required when action_type is "agentTurn"`);
    }
  }
}

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
  validateSchedulerConfig(config, errors, warnings);

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
    logger.warn({ warnings: result.warnings }, 'Configuration warnings');
    for (const warning of result.warnings) {
      logger.warn(warning);
    }
  }
}
